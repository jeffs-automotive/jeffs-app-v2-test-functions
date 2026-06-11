"use server";

/**
 * Acknowledge-day action (admin-only) — mark a business day "approved WITHOUT
 * posting": the day is already in QuickBooks via Accounting Link, so QTekLink
 * records it as done and will never post or correct it. Used to clear the
 * backlog of days from before QTekLink took over posting.
 *
 * Mechanics: reconcile the day (so its ≤3 category rows exist), then flip every
 * PENDING row to `acknowledged` (terminal). Days already posted by QTekLink are
 * refused — acknowledging them would orphan real QBO entries.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { runDailyReconciliation } from "@/lib/dal/daily-reconcile";
import { listDailyPostingsForDay, acknowledgeDailyPosting } from "@/lib/dal/daily-postings";
import { isIsoDate } from "@/lib/format";
import { qboFailure, type QboActionResult } from "./qbo/result";

const Schema = z.object({
  date: z.string().refine(isIsoDate, "A valid date is required."),
});

type AckState = QboActionResult<{ acknowledged: number }>;

async function acknowledgeDayImpl(_prev: AckState | null, formData: FormData): Promise<AckState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") {
      return { ok: false, reason: "validation", message: "Only an admin can mark a day as covered by Accounting Link.", timestamp: Date.now() };
    }
    const parsed = Schema.safeParse({ date: formData.get("date") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid date.", timestamp: Date.now() };
    }
    const date = parsed.data.date;

    // Stage the day's rows (no QBO write), then acknowledge every pending one.
    const recon = await runDailyReconciliation(shopId, date);
    if (!recon.realmId) {
      return { ok: false, reason: "reconnect_required", message: "QuickBooks isn't connected for this shop.", timestamp: Date.now() };
    }
    const { postings } = await listDailyPostingsForDay(shopId, date);
    if (postings.some((p) => p.status === "posted" || p.status === "posting" || p.status === "approved")) {
      return {
        ok: false,
        reason: "validation",
        message: "This day has entries QTekLink already posted (or is posting) to QuickBooks — it can't be marked as covered by Accounting Link.",
        timestamp: Date.now(),
      };
    }
    let acknowledged = 0;
    for (const p of postings.filter((p) => p.status === "pending")) {
      const r = await acknowledgeDailyPosting(shopId, p.id, email);
      if (r.acknowledged) acknowledged++;
    }
    return { ok: true, data: { acknowledged }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const acknowledgeDayAction = wrapQtekAction("qboAcknowledgeDay", acknowledgeDayImpl);
