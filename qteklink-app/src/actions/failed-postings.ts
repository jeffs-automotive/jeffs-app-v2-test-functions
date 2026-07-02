"use server";

/**
 * Failed-posting resolution actions (resolution-workflow Part B) — admin-only, the
 * two exits from a FAILED daily posting. Pattern S: no scope_hash → DRY RUN (plain
 * summary + hash, no writes); scope_hash → EXECUTE (retry = live QBO write via the
 * poster; accept = terminal ledger flip). Thin: requireQtekUser() FIRST, admin gate,
 * Zod, delegate to the failed-posting-resolution DAL, typed QboActionResult.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import {
  planFailedPostingResolution,
  executeFailedPostingResolution,
  type FailedPostingPlan,
  type FailedPostingExecuteResult,
} from "@/lib/dal/failed-posting-resolution";
import { qboFailure, type QboActionResult } from "./qbo/result";

const Schema = z.object({
  postingId: z.string().uuid("A valid posting id is required."),
  choice: z.enum(["retry", "accept"]),
  scopeHash: z.string().trim().min(1).max(128).optional(),
});

export type FailedPostingDryRun = { needsConfirmation: true; plan: FailedPostingPlan; choice: "retry" | "accept" };
export type FailedPostingExecuted = { outcome: NonNullable<FailedPostingExecuteResult["outcome"]>; resolvedReviewItems: number };
type State = QboActionResult<FailedPostingDryRun | FailedPostingExecuted>;

const PLAN_FAILURE: Record<string, string> = {
  no_connection: "QuickBooks isn't connected for this shop.",
  not_found: "That posting no longer exists.",
  not_failed: "That posting is no longer in a failed state — refresh the page.",
  superseded: "A newer version of this day exists — the normal approval flow owns it now.",
  scope_changed: "The day changed since you reviewed it — re-open and confirm again.",
  post_failed: "QuickBooks rejected the retry — the day is back on the fix-it list with the new error. (If it's still deposit-locked, unlink the deposit in QuickBooks first.)",
};

async function resolveFailedPostingImpl(_prev: State | null, formData: FormData): Promise<State> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") {
      return { ok: false, reason: "validation", message: "Admin role required.", timestamp: Date.now() };
    }

    const parsed = Schema.safeParse({
      postingId: formData.get("posting_id"),
      choice: formData.get("choice"),
      scopeHash: formData.get("scope_hash") || undefined,
    });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }
    const { postingId, choice, scopeHash } = parsed.data;

    if (!scopeHash) {
      const plan = await planFailedPostingResolution(shopId, postingId);
      if (!plan.ok) {
        return { ok: false, reason: "validation", message: PLAN_FAILURE[plan.reason] ?? "Unable to review this posting.", timestamp: Date.now() };
      }
      if (plan.mode === "stale") {
        return {
          ok: false,
          reason: "validation",
          message: "This day's numbers changed since the failure — the normal approval flow owns it now. Refresh the page.",
          timestamp: Date.now(),
        };
      }
      return { ok: true, data: { needsConfirmation: true, plan, choice }, timestamp: Date.now() };
    }

    const result = await executeFailedPostingResolution(shopId, postingId, choice, scopeHash, email);
    if (!result.ok) {
      return { ok: false, reason: "validation", message: PLAN_FAILURE[result.reason ?? ""] ?? "The action could not be completed.", timestamp: Date.now() };
    }
    return { ok: true, data: { outcome: result.outcome!, resolvedReviewItems: result.resolvedReviewItems ?? 0 }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const resolveFailedPostingAction = wrapQtekAction("qboResolveFailedPosting", resolveFailedPostingImpl);
