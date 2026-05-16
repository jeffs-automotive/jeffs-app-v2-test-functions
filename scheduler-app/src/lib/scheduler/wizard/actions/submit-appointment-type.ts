"use server";

/**
 * Step 8 submit — appointment type (Phase 10, 2026-05-15).
 *
 * Per chat-design.md §Step 8 (lines 1952-2059): customer picks 'waiter'
 * or 'dropoff'. The card already enforces wait-eligibility client-side
 * (the disabled-state on the waiter button), but we still validate
 * server-side so a stale form submit can't bypass it.
 *
 * Validation rule: if appointment_type=waiter, every picked service must
 * be in routine_services.wait_eligible=true. Testing services are never
 * wait-eligible (they take time / require a tech bay). When validation
 * fails we fall through to nextStep='appointment_type' with a clarifying
 * bubble — the row state isn't mutated.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

const SHOP_ID = 7476; // Phase 1 single-shop

const submitAppointmentTypeSchema = z.object({
  chatId: z.string().min(1),
  appointment_type: z.enum(["waiter", "dropoff"]),
});

export type SubmitAppointmentTypeV2Args = z.infer<
  typeof submitAppointmentTypeSchema
>;

async function submitAppointmentTypeV2Impl(
  args: SubmitAppointmentTypeV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitAppointmentTypeSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, appointment_type } = parsed.data;

  try {
    if (appointment_type === "waiter") {
      const eligible = await isWaitEligibleForSession(chatId);
      if (!eligible) {
        return applyWizardTransition({
          chatId,
          nextStep: "appointment_type",
          jeffBubble:
            "Hmm — looks like one of the services you picked needs more time than our waiter slots allow. Let's go with drop-off instead. 🔑",
        });
      }
    }

    return applyWizardTransition({
      chatId,
      updates: { appointment_type },
      nextStep: "date_pick",
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_appointment_type_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitAppointmentTypeV2 = wrapAction(
  "submitAppointmentTypeV2",
  submitAppointmentTypeV2Impl,
);

/**
 * Returns true when every picked service is in routine_services with
 * wait_eligible=true. Testing services in the pick set make this false
 * (no wait_eligible column on testing_services; they're never wait-able).
 *
 * The pick set is the union of:
 *   - selected_simple_services (Step 7.1 routine non-explanation picks)
 *   - approved_testing_services (Step 7.5 was skipped — these come from
 *     the Step 7.1 diagnostic chip section)
 *   - explanation_required_items[].service_key (Step 7.2 queue)
 *   - additional_routine_services_round2 (Step 7.6)
 */
async function isWaitEligibleForSession(chatId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select(
      "selected_simple_services, approved_testing_services, explanation_required_items, additional_routine_services_round2",
    )
    .eq("id", chatId)
    .maybeSingle();
  if (rowErr || !row) {
    // Fail closed: if we can't read the row we can't prove eligibility.
    throw new Error(rowErr?.message ?? "session_not_found");
  }

  const allKeys = collectAllPickedServiceKeys(row);
  if (allKeys.length === 0) {
    // No picks recorded — defensive default: allow waiter (the card
    // shouldn't even have rendered with no picks, but if it did, the
    // customer's choice wins).
    return true;
  }

  // Pull every routine_services row for these keys.
  const { data: routineRows, error: routineErr } = await supabase
    .from("routine_services")
    .select("service_key, wait_eligible")
    .eq("shop_id", SHOP_ID)
    .in("service_key", allKeys);
  if (routineErr) {
    throw new Error(
      `routine_services wait_eligible lookup failed: ${routineErr.message}`,
    );
  }
  const routineByKey = new Map<string, boolean>();
  for (const r of (routineRows ?? []) as Array<{
    service_key: string;
    wait_eligible: boolean;
  }>) {
    routineByKey.set(r.service_key, !!r.wait_eligible);
  }

  for (const key of allKeys) {
    const flag = routineByKey.get(key);
    if (flag === undefined) {
      // Not in routine_services → it's a testing service (or stale key).
      // Testing services have no wait_eligible column — they're never
      // wait-able. Either way, eligibility fails.
      return false;
    }
    if (!flag) return false;
  }
  return true;
}

function collectAllPickedServiceKeys(row: {
  selected_simple_services: string[] | null;
  approved_testing_services: string[] | null;
  explanation_required_items: unknown;
  additional_routine_services_round2: string[] | null;
}): string[] {
  const keys = new Set<string>();
  for (const k of row.selected_simple_services ?? []) keys.add(k);
  for (const k of row.approved_testing_services ?? []) keys.add(k);
  for (const k of row.additional_routine_services_round2 ?? []) keys.add(k);
  if (Array.isArray(row.explanation_required_items)) {
    for (const entry of row.explanation_required_items) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).service_key === "string"
      ) {
        keys.add((entry as Record<string, unknown>).service_key as string);
      }
    }
  }
  return Array.from(keys);
}
