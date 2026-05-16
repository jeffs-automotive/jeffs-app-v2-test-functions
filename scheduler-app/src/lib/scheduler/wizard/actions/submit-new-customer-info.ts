"use server";

/**
 * Step 4 (new client) — New customer info submit (V2, server-state-driven).
 *
 * Per chat-design.md §2589-2682 + the Architecture amendment — 2026-05-14.
 *
 * Flow:
 *   1. Validate input (Zod, server-side mirroring the card's checks)
 *   2. Read row: entered_first_name, entered_last_name, phone_e164 (the
 *      OTP-verified phone from Option B's Step 3 path)
 *   3. Call scheduler-booking-direct op='create_customer' (Tekmetric
 *      POST /customers with name + verified phone + primary email + address)
 *   4. On success:
 *        - row writes: customer_id (returned from Tekmetric), edited_*,
 *          verified_first_name/last_name, identity_verification_level='full'
 *        - advance to vehicle_pick (or new_vehicle_form via Step 6 logic)
 *   5. On phone_duplicate (409): bounce back to phone_name with bucket=
 *      'returning' so the customer can OTP into the existing account
 *   6. On other Tekmetric errors: escalate
 *
 * Per the spec, the OTP-verified phone is read-only on the card — the
 * customer can ADD a second phone but can't change the primary. We trust
 * the row's phone_e164 as the verified primary phone.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createCustomer,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";

const phoneEntrySchema = z.object({
  phone_e164: z.string().regex(/^\+1\d{10}$/, "phone must be +1XXXXXXXXXX"),
  is_primary: z.boolean(),
});

const emailEntrySchema = z.object({
  email: z.string().email("invalid email"),
  is_primary: z.boolean(),
});

const addressRequiredSchema = z.object({
  address1: z.string().trim().min(1, "address1 required"),
  address2: z.string().trim().optional(),
  city: z.string().trim().min(1, "city required"),
  state: z.string().trim().min(1, "state required"),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "zip must be 5 digits or ZIP+4"),
});

const submitNewCustomerInfoSchema = z.object({
  chatId: z.string().min(1),
  edited_phones: z.array(phoneEntrySchema).min(1).max(2),
  edited_emails: z.array(emailEntrySchema).min(1).max(2),
  edited_address: addressRequiredSchema,
  primary_email_for_description: z.string().email(),
});

export type SubmitNewCustomerInfoV2Args = z.infer<
  typeof submitNewCustomerInfoSchema
>;

export async function submitNewCustomerInfoV2(
  args: SubmitNewCustomerInfoV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitNewCustomerInfoSchema.safeParse(args);
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
      .select("entered_first_name, entered_last_name, phone_e164, customer_id")
      .eq("id", chatId)
      .maybeSingle();
    if (readErr) {
      Sentry.captureException(readErr, {
        tags: { surface: "submit_new_customer_info_v2_read" },
        level: "error",
      });
      return { ok: false, error: readErr.message };
    }
    if (!row) {
      return { ok: false, error: "session_not_found" };
    }

    // Idempotency pre-flight (R4-IMPORTANT-B-1 2026-05-16): Tekmetric POST
    // /customers is NOT idempotent. If this Server Action gets retried
    // (double-tap, browser retry on transient error, React Server Action
    // re-fire) AFTER a prior successful POST, customer_id is already on
    // the row. Skip the second POST and just advance — the prior write
    // already populated the row's edited_* + verified_* columns too.
    if (typeof row.customer_id === "number") {
      return applyWizardTransition({
        chatId,
        nextStep: "new_vehicle_form",
        jeffBubble: "All set up! 🎉 Now tell me about your vehicle.",
      });
    }

    const firstName = (row.entered_first_name as string | null) ?? "";
    const lastName = (row.entered_last_name as string | null) ?? "";
    const verifiedPhone = (row.phone_e164 as string | null) ?? "";

    if (!firstName || !lastName || !verifiedPhone) {
      // Defensive — should never reach this Server Action without these
      // populated by submitGreetingV2 + submitPhoneNameV2 + submitOtpV2.
      Sentry.captureMessage(
        "submit_new_customer_info_v2 row missing required fields",
        {
          level: "warning",
          extra: { chatId, hasFirst: !!firstName, hasLast: !!lastName, hasPhone: !!verifiedPhone },
        },
      );
      return { ok: false, error: "missing_session_fields" };
    }

    // Use the primary email for Tekmetric (single-field on the API). The
    // secondary email lives in row.edited_emails for app-side reference
    // only (per spec — Tekmetric has no second-email field).
    const primaryEmail =
      edited_emails.find((e) => e.is_primary)?.email ?? edited_emails[0]?.email;

    let createResult;
    try {
      createResult = await createCustomer({
        op: "create_customer",
        session_id: chatId,
        payload: {
          first_name: firstName,
          last_name: lastName,
          phone_e164: verifiedPhone,
          email: primaryEmail,
          address: {
            address1: edited_address.address1,
            address2: edited_address.address2,
            city: edited_address.city,
            state: edited_address.state,
            zip: edited_address.zip,
          },
        },
      });
    } catch (e) {
      const reasonTag =
        e instanceof BookingDirectError
          ? `create_customer_${e.status ?? "network"}`
          : "create_customer_unknown";
      Sentry.captureException(e, {
        tags: { surface: "submit_new_customer_info_v2_call", reason: reasonTag },
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
          "Hmm, something glitched while setting up your account. Please call us at (610) 253-6565. 📞",
      });
    }

    if (!createResult.ok) {
      // 'phone_duplicate' (409) — Tekmetric refuses POST /customers
      // because the phone is already on a different account. Bug audit
      // 2026-05-16 (the "loops back to step 1" report): previously this
      // unconditionally bounced to phone_name with bucket='returning',
      // which infinite-looped for customers whose phone IS in Tekmetric
      // (the next step2 lookup would find them; if the multi-account
      // disambiguation card was empty due to the related candidate-
      // persistence bug, they had no path forward). Phase 1 policy:
      // escalate with a clear bubble. Advisor handles it manually. The
      // prior customer_id (if step2 found a match) stays on the row.
      if (createResult.error === "phone_duplicate") {
        Sentry.captureMessage("create_customer phone_duplicate", {
          level: "warning",
          extra: {
            chatId,
            tekmetric_error: createResult.tekmetric_error_text,
          },
        });
        return applyWizardTransition({
          chatId,
          updates: {
            status: "escalated",
            escalated_at: new Date().toISOString(),
            escalation_reason: "create_customer_phone_duplicate",
          },
          nextStep: "escalated",
          jeffBubble:
            "Looks like this number is already on file under a different account. Please call us at (610) 253-6565 and we'll get you sorted in a minute. 📞",
        });
      }

      // Other Tekmetric errors (4xx / 5xx / unknown) — escalate.
      Sentry.captureMessage("create_customer returned !ok", {
        level: "warning",
        extra: { chatId, error: createResult.error, text: createResult.tekmetric_error_text },
      });
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: `create_customer_${createResult.error ?? "unknown"}`,
        },
        nextStep: "escalated",
        jeffBubble:
          "Hmm, I couldn't get your account created. Please call us at (610) 253-6565. 📞",
      });
    }

    // Success — Tekmetric returned a customer_id. The edge function
    // already set customer_id + identity_verification_level='full' on the
    // row (see scheduler-booking-direct's create_customer handler). Here
    // we add the edited_* values + verified_first/last_name for the
    // summary card and downstream cards to render.
    if (!createResult.customer_id) {
      Sentry.captureMessage(
        "create_customer ok but missing customer_id",
        { level: "warning", extra: { chatId } },
      );
    }

    return applyWizardTransition({
      chatId,
      updates: {
        edited_phones,
        edited_emails,
        edited_address,
        primary_email_for_description,
        verified_first_name: firstName,
        verified_last_name: lastName,
        // identity_verification_level was set to 'full' by the edge
        // function's create_customer path; re-asserting here is harmless
        // and makes the row write self-documenting.
        identity_verification_level: "full",
      },
      // Bug fix 2026-05-16: per chat-design.md §2599-2755, new customers
      // SKIP Step 6 vehicle_pick (they have no Tekmetric vehicles yet)
      // and go directly to new_vehicle_form. The prior nextStep of
      // 'vehicle_pick' cost a wasted Tekmetric fetch_vehicles_for_customer
      // round-trip + made the customer tap "Add a vehicle" on an empty
      // picker.
      nextStep: "new_vehicle_form",
      jeffBubble: "All set up! 🎉 Now tell me about your vehicle.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_new_customer_info_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_new_customer_info_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}
