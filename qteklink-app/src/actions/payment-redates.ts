"use server";

/**
 * Payment-redate actions (resolution-workflow Part A) — admin-only escape hatch:
 * "post it to this day anyway" lifts the redate hold (pending → approved); the
 * normal correction flow then stages the update (a deposit-locked day continues
 * into the Retry/Accept resolution). The HAPPY path needs no action at all —
 * voiding + re-dating the payment in Tekmetric auto-resolves the row.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { approvePaymentRedate } from "@/lib/dal/payment-redates";
import { qboFailure, type QboActionResult } from "./qbo/result";

const Schema = z.object({ id: z.string().uuid("A valid redate id is required.") });

type State = QboActionResult<{ approved: boolean }>;

async function approvePaymentRedateImpl(_prev: State | null, formData: FormData): Promise<State> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") {
      return { ok: false, reason: "validation", message: "Admin role required.", timestamp: Date.now() };
    }
    const parsed = Schema.safeParse({ id: formData.get("id") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }
    const data = await approvePaymentRedate(shopId, parsed.data.id, email);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const approvePaymentRedateAction = wrapQtekAction("qboApprovePaymentRedate", approvePaymentRedateImpl);
