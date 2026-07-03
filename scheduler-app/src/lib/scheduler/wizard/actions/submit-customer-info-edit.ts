"use server";

/**
 * Step 5 (returning customer) — Customer info edit submit (V2,
 * server-state-driven).
 *
 * Per chat-design.md §Step 5 lines 940-1075 + the Architecture amendment —
 * 2026-05-14.
 *
 * Flow:
 *   1. Validate input (Zod, server-side mirroring the card's checks)
 *   2. Read row: customer_id + identity_verification_level + current edited_*
 *   3. Diff vs current row.edited_* — if nothing changed, skip Tekmetric
 *      PATCH (just advance current_step)
 *   4. If changes + verification_level='full' → call
 *      scheduler-booking-direct op='patch_customer' (Tekmetric PATCH /customers
 *      with full phone array, primary email, address)
 *   5. Write edited_phones / edited_emails / edited_address /
 *      primary_email_for_description to the row + advance to vehicle_pick
 *
 * Partial-verification customers should never reach this Server Action —
 * they bypass Step 5 entirely via submit-partial-verification-choice's
 * 'proceed_as_partial' branch (skips directly to vehicle_pick). Defensive
 * check below: skip PATCH but allow row write so getCurrentCard still has
 * the values for the summary card.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  patchCustomer,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

const phoneEntrySchema = z.object({
  phone_e164: z.string().regex(/^\+1\d{10}$/, "phone must be +1XXXXXXXXXX"),
  is_primary: z.boolean(),
});

const emailEntrySchema = z.object({
  email: z.string().email("invalid email"),
  is_primary: z.boolean(),
});

const addressSchema = z
  .object({
    address1: z.string().trim().optional(),
    address2: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    zip: z.string().trim().optional(),
  })
  .nullable();

const submitCustomerInfoEditSchema = z.object({
  chatId: z.string().min(1),
  edited_phones: z.array(phoneEntrySchema).min(1).max(2),
  edited_emails: z.array(emailEntrySchema).min(1).max(2),
  edited_address: addressSchema,
  primary_email_for_description: z.string().email().nullable(),
});

export type SubmitCustomerInfoEditV2Args = z.infer<
  typeof submitCustomerInfoEditSchema
>;

async function submitCustomerInfoEditV2Impl(
  args: SubmitCustomerInfoEditV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitCustomerInfoEditSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const {
    chatId,
    edited_phones,
    edited_emails,
    edited_address,
    primary_email_for_description,
  } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: readErr } = await supabase
      .from("customer_chat_sessions")
      .select(
        "customer_id, identity_verification_level, edited_phones, edited_emails, edited_address, primary_email_for_description, edit_return_step",
      )
      .eq("id", chatId)
      .maybeSingle();
    if (readErr) {
      Sentry.captureException(readErr, {
        tags: { surface: "submit_customer_info_edit_v2_read" },
        level: "error",
      });
      return { ok: false, error: readErr.message };
    }
    if (!row) {
      return { ok: false, error: "session_not_found" };
    }

    const verificationLevel = row.identity_verification_level as
      | "full"
      | "partial"
      | "none"
      | null;
    const customerId = row.customer_id as number | null;

    // Diff vs current row.edited_* values. If nothing changed AND the row
    // already has the user's submitted shape, skip Tekmetric PATCH.
    const phonesChanged = !shallowEqJson(row.edited_phones, edited_phones);
    const emailsChanged = !shallowEqJson(row.edited_emails, edited_emails);
    const addressChanged = !shallowEqJson(row.edited_address, edited_address);
    const primaryEmailChanged =
      (row.primary_email_for_description as string | null) !==
      primary_email_for_description;
    const anyChanged =
      phonesChanged || emailsChanged || addressChanged || primaryEmailChanged;

    // Call Tekmetric PATCH only when:
    //   - changes were detected (no point calling for a no-op), AND
    //   - the customer is fully verified (partial users skip Step 5 entirely
    //     per chat-design.md §3.5 lines 750-758 — but defensive in case they
    //     reach here via Edit-from-Summary in a future phase)
    //   - we have a customer_id to PATCH against
    if (anyChanged && verificationLevel === "full" && customerId !== null) {
      try {
        const patchResult = await patchCustomer({
          op: "patch_customer",
          session_id: chatId,
          customer_id: customerId,
          edited_phones,
          edited_emails,
          edited_address,
        });
        if (!patchResult.ok) {
          // Tekmetric 4xx/5xx — escalate so the customer has an out.
          Sentry.captureMessage("patch_customer returned !ok", {
            level: "warning",
            extra: { chatId, error: patchResult.error, text: patchResult.tekmetric_error_text },
          });
          return applyWizardTransition({
            chatId,
            updates: {
              status: "escalated",
              escalated_at: new Date().toISOString(),
              escalation_reason: `patch_customer_${patchResult.error ?? "unknown"}`,
            },
            nextStep: "escalated",
            jeffBubble:
              "Hmm, I'm having trouble saving your info. Please call us at (610) 253-6565. 📞",
          });
        }
      } catch (e) {
        const reasonTag =
          e instanceof BookingDirectError
            ? `patch_customer_${e.status ?? "network"}`
            : "patch_customer_unknown";
        Sentry.captureException(e, {
          tags: { surface: "submit_customer_info_edit_v2_patch", reason: reasonTag },
          level: "error",
        });
        return applyWizardTransition({
          chatId,
          updates: {
            status: "escalated",
            escalated_at: new Date().toISOString(),
            escalation_reason: reasonTag,
          },
          nextStep: "escalated",
          jeffBubble:
            "Hmm, something glitched while saving your info. Please call us at (610) 253-6565. 📞",
        });
      }
    }

    // Write the user's submitted values to the row + advance.
    // This always runs (even when Tekmetric PATCH was skipped) so the
    // summary card later renders what the customer just confirmed.
    //
    // Summary edit hub (task EH1, 2026-07-04): when this edit was reached
    // FROM the hub (edit_return_step='summary_edit_hub'), return to the hub
    // instead of the forced forward chain into vehicle_pick. The flag stays
    // set (only the hub's "done" / start-over clears it) so the customer
    // can edit multiple sections.
    const fromHub =
      (row.edit_return_step as string | null) === "summary_edit_hub";
    return applyWizardTransition({
      chatId,
      updates: {
        edited_phones,
        edited_emails,
        edited_address,
        primary_email_for_description,
      },
      nextStep: fromHub ? "summary_edit_hub" : "vehicle_pick",
      jeffBubble: fromHub
        ? "Saved your contact info. ✅"
        : "Looks good — let's pick your vehicle. 🚗",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_customer_info_edit_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_customer_info_edit_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}

export const submitCustomerInfoEditV2 = wrapAction(
  "submitCustomerInfoEditV2",
  submitCustomerInfoEditV2Impl,
);

/**
 * Shallow JSON equality — sufficient for the edited_* shapes we compare.
 * Stringifies both sides and compares; order-sensitive for arrays. That's
 * fine here because both sides are built in the same insertion order
 * (form-render order on read; user-submit order on write).
 */
function shallowEqJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
