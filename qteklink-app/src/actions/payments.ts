"use server";

/**
 * Payment actions (C6) — admin-only. Currently: record a MANUAL method-pick for a
 * paid RO with no payment_made event (the RO snapshot shows it was paid but not how;
 * the user picks the method + enters the CC fee for a card — plan §5). Thin (the
 * QTekLink pattern): requireQtekUser() FIRST, admin gate, Zod-validate, delegate to
 * the DAL, return a typed QboActionResult. Shaped for React 19 useActionState.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { recordManualPayment, deleteManualPayment } from "@/lib/dal/manual-payments";
import { qboFailure, type QboActionResult } from "./qbo/result";

// Methods that route to the NON-CASH path (need a specific `otherPaymentType`).
const NONCASH_METHODS = new Set(["other", "oth"]);

const RecordManualPaymentSchema = z
  .object({
    repairOrderId: z.coerce.number().int().positive("A repair order id is required."),
    method: z.string().trim().min(1, "A payment method is required.").max(100),
    otherPaymentType: z.string().trim().max(200).optional().nullable(),
    // The GROSS amount + paid date are NOT client inputs — the DAL derives them from the
    // RO's posting snapshot (amountPaid / postedDate). Only the CC fee is user-entered.
    ccFeeCents: z.coerce.number().int().nonnegative("CC fee must be ≥ 0.").optional(),
  })
  // A non-cash pick needs its specific type (else it's guaranteed unmapped at post).
  .refine((d) => !NONCASH_METHODS.has(d.method.toLowerCase()) || Boolean(d.otherPaymentType?.trim()), {
    message: "A non-cash payment needs its specific type (e.g. Tire Protection Plan).",
    path: ["otherPaymentType"],
  })
  // The CC processing fee only exists for a Credit Card payment.
  .refine((d) => !d.ccFeeCents || d.method === "Credit Card", {
    message: "A CC fee applies only to a Credit Card payment.",
    path: ["ccFeeCents"],
  });

type RecordManualPaymentState = QboActionResult<{ id: string }>;

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required to record a manual payment.", timestamp: Date.now() };
}

async function recordManualPaymentImpl(
  _prev: RecordManualPaymentState | null,
  formData: FormData,
): Promise<RecordManualPaymentState> {
  // Full-body guard (observability rule 1/2): auth + validation + DB inside the try;
  // qboFailure re-throws Next control-flow (redirect/notFound).
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = RecordManualPaymentSchema.safeParse({
      repairOrderId: formData.get("repair_order_id"),
      method: formData.get("method"),
      otherPaymentType: formData.get("other_payment_type") || null,
      ccFeeCents: formData.get("cc_fee_cents") || 0,
    });
    if (!parsed.success) {
      return {
        ok: false,
        reason: "validation",
        message: parsed.error.issues[0]?.message ?? "Invalid manual-payment input.",
        timestamp: Date.now(),
      };
    }

    const data = await recordManualPayment(shopId, parsed.data, email);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const recordManualPaymentAction = wrapQtekAction("qboRecordManualPayment", recordManualPaymentImpl);

// ── Delete a manual pick (resolution-workflow Part E — the conflict resolution) ──

const DeleteManualPaymentSchema = z.object({ id: z.string().uuid("A valid manual-payment id is required.") });

type DeleteManualPaymentState = QboActionResult<{ deleted: boolean }>;

async function deleteManualPaymentImpl(
  _prev: DeleteManualPaymentState | null,
  formData: FormData,
): Promise<DeleteManualPaymentState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = DeleteManualPaymentSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }
    const data = await deleteManualPayment(shopId, parsed.data.id, email);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const deleteManualPaymentAction = wrapQtekAction("qboDeleteManualPayment", deleteManualPaymentImpl);
