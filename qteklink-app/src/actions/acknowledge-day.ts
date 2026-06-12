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
import { acknowledgeDay } from "@/lib/dal/daily-reconcile";
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

    const result = await acknowledgeDay(shopId, parsed.data.date, email);
    if (!result.ok) {
      if (result.reason === "reconnect_required") {
        return { ok: false, reason: "reconnect_required", message: "QuickBooks isn't connected for this shop.", timestamp: Date.now() };
      }
      return {
        ok: false,
        reason: "validation",
        message: "This day has entries QTekLink already posted (or is posting) to QuickBooks — it can't be marked as covered by Accounting Link.",
        timestamp: Date.now(),
      };
    }
    return { ok: true, data: { acknowledged: result.acknowledged }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const acknowledgeDayAction = wrapQtekAction("qboAcknowledgeDay", acknowledgeDayImpl);
