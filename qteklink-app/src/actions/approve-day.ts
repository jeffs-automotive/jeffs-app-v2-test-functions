"use server";

/**
 * Approve+post-day action (approval-dashboard upgrade, plan §6) — admin-only, the LIVE QBO
 * write. Two branches (Pattern S), admin-gated on BOTH:
 *   - no scope_hash → DRY RUN: returns the per-type summary + a scope_hash. No writes.
 *   - scope_hash    → EXECUTE: re-derives the scope, rejects if the hash changed (the day
 *                     moved since review), else enqueues→approves→scoped-posts each id.
 * Thin: requireQtekUser() FIRST, admin gate, Zod, delegate to the approve-post-day DAL.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { planApproveDay, executeApproveDay, type ApproveDaySummary } from "@/lib/dal/approve-post-day";
import { qboFailure, type QboActionResult } from "./qbo/result";

const Schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required."),
  scope: z.enum(["day", "sale", "payment"]),
  scopeHash: z.string().trim().min(1).max(128).optional(),
});

export type ApproveDayDryRun = { needsConfirmation: true; scope: "day" | "sale" | "payment"; date: string; scopeHash: string; summary: ApproveDaySummary };
export type ApproveDayExecuted = { posted: number; failed: number; skipped: number; stale: number };
type ApproveDayState = QboActionResult<ApproveDayDryRun | ApproveDayExecuted>;

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required to approve + post.", timestamp: Date.now() };
}

async function approveAndPostDayImpl(
  _prev: ApproveDayState | null,
  formData: FormData,
): Promise<ApproveDayState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = Schema.safeParse({
      date: formData.get("date"),
      scope: formData.get("scope"),
      scopeHash: formData.get("scope_hash") || undefined,
    });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }
    const { date, scope, scopeHash } = parsed.data;

    if (!scopeHash) {
      // ── DRY RUN (no writes) ──
      const plan = await planApproveDay(shopId, date, scope);
      if (!plan.realmId) {
        return { ok: false, reason: "reconnect_required", message: "QuickBooks isn't connected for this shop.", timestamp: Date.now() };
      }
      return { ok: true, data: { needsConfirmation: true, scope, date, scopeHash: plan.scopeHash, summary: plan.summary }, timestamp: Date.now() };
    }

    // ── EXECUTE (live QBO write; the poster uses the real client) ──
    const result = await executeApproveDay(shopId, date, scope, scopeHash, email);
    if (!result.ok) {
      const message = result.reason === "scope_changed"
        ? "The day changed since you reviewed it — re-open and confirm again."
        : "QuickBooks isn't connected for this shop.";
      return { ok: false, reason: "validation", message, timestamp: Date.now() };
    }
    return { ok: true, data: { posted: result.posted, failed: result.failed, skipped: result.skipped, stale: result.stale }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const approveAndPostDayAction = wrapQtekAction("qboApproveAndPostDay", approveAndPostDayImpl);
