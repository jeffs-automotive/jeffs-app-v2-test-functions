"use server";

/**
 * Reconciliation actions (C7) — admin-only. Trigger the daily reconciliation job for
 * a business date: build + gate the day's drafts, persist a §9 review item per
 * non-postable draft, return the roll-up. Thin (the QTekLink pattern): requireQtekUser()
 * FIRST, admin gate, Zod-validate, delegate to the DAL, return a typed QboActionResult.
 * (The nightly cron — app/api/cron/daily-sync — calls runDailyReconciliation directly;
 * this is the manual/UI trigger.)
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { runDailyReconciliation, type DailyReconcileSummary } from "@/lib/dal/daily-reconcile";
import { reduceShopPaymentState } from "@/lib/dal/payment-state";
import { qboFailure, type QboActionResult } from "./qbo/result";

const RunReconcileSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
});

type RunReconcileState = QboActionResult<DailyReconcileSummary>;

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required to run reconciliation.", timestamp: Date.now() };
}

async function runDailyReconciliationImpl(
  _prev: RunReconcileState | null,
  formData: FormData,
): Promise<RunReconcileState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = RunReconcileSchema.safeParse({ businessDate: formData.get("business_date") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid date.", timestamp: Date.now() };
    }

    // Refresh the payment projection first (otherwise nightly-only) so the manual
    // "check the numbers again" sees payments whose webhooks landed today.
    await reduceShopPaymentState(shopId);
    const data = await runDailyReconciliation(shopId, parsed.data.businessDate);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const runDailyReconciliationAction = wrapQtekAction("qboRunDailyReconciliation", runDailyReconciliationImpl);
