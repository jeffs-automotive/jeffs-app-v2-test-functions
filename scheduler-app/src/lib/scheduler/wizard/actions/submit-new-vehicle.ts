"use server";

/**
 * Step 6 drill-down — New vehicle submit (V2, server-state-driven).
 *
 * Per chat-design.md §1248-1306 (returning-client add-new) + §2684-2753
 * (new-client Step 5) + the Architecture amendment — 2026-05-14.
 *
 * Both paths use the SAME card + Server Action shape. They differ only in
 * the row's customer_self_identified bucket and where they land afterwards:
 *
 *   - Returning customer (entered via VehiclePicker → "+ Add a vehicle"):
 *     after success, advances to service_concern_picker.
 *   - New customer (entered via submitNewCustomerInfoV2 → vehicle_pick →
 *     "+ Add a vehicle"): same — after success, service_concern_picker.
 *
 * Server Action:
 *   1. Validate input (Zod, server-side mirroring the card's checks)
 *   2. Read row: customer_id (required — must exist for create_vehicle)
 *   3. Call scheduler-booking-direct op='create_vehicle' (Tekmetric POST
 *      /vehicles); the edge function persists vehicle_id on the row.
 *   4. Stash the customer's notes (Tekmetric POST /vehicles doesn't carry
 *      a notes field — per chat-design.md §1281 notes are "stored verbatim,
 *      no AI parsing"). We write them to row.new_vehicle_info JSONB so
 *      Step 10 (summary / appointment description) can include them.
 *   5. Advance to service_concern_picker on success; escalate on
 *      Tekmetric 4xx/5xx.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createVehicle,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1980;
const MAX_YEAR = CURRENT_YEAR + 1;
const PLATE_REGEX = /^[A-Z0-9-]{1,15}$/;

const submitNewVehicleSchema = z.object({
  chatId: z.string().min(1),
  year: z
    .number()
    .int()
    .min(MIN_YEAR, `year must be >= ${MIN_YEAR}`)
    .max(MAX_YEAR, `year must be <= ${MAX_YEAR}`),
  make: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(50),
  license_plate: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PLATE_REGEX, "plate must be 1-15 letters / numbers / dashes")
    .optional(),
  notes: z.string().trim().max(200).optional(),
});

export type SubmitNewVehicleV2Args = z.infer<typeof submitNewVehicleSchema>;

export async function submitNewVehicleV2(
  args: SubmitNewVehicleV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitNewVehicleSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, year, make, model, license_plate, notes } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: readErr } = await supabase
      .from("customer_chat_sessions")
      .select("customer_id")
      .eq("id", chatId)
      .maybeSingle();
    if (readErr) {
      Sentry.captureException(readErr, {
        tags: { surface: "submit_new_vehicle_v2_read" },
        level: "error",
      });
      return { ok: false, error: readErr.message };
    }
    if (!row || typeof row.customer_id !== "number") {
      // Defensive — this Server Action only reachable AFTER
      // submitNewCustomerInfoV2 (new client) OR submitCustomerInfoEditV2
      // (returning), both of which set customer_id on the row.
      Sentry.captureMessage(
        "submit_new_vehicle_v2 reached without customer_id on row",
        { level: "warning", extra: { chatId } },
      );
      return { ok: false, error: "missing_customer_id" };
    }

    let createResult;
    try {
      createResult = await createVehicle({
        op: "create_vehicle",
        session_id: chatId,
        customer_id: row.customer_id,
        payload: {
          year,
          make,
          model,
          license_plate,
        },
      });
    } catch (e) {
      const reasonTag =
        e instanceof BookingDirectError
          ? `create_vehicle_${e.status ?? "network"}`
          : "create_vehicle_unknown";
      Sentry.captureException(e, {
        tags: { surface: "submit_new_vehicle_v2_call", reason: reasonTag },
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
          "Hmm, something glitched while adding your vehicle. Please call us at (610) 253-6565. 📞",
      });
    }

    if (!createResult.ok) {
      Sentry.captureMessage("create_vehicle returned !ok", {
        level: "warning",
        extra: {
          chatId,
          error: createResult.error,
          text: createResult.tekmetric_error_text,
        },
      });
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: `create_vehicle_${createResult.error ?? "unknown"}`,
        },
        nextStep: "escalated",
        jeffBubble:
          "Hmm, I couldn't add your vehicle. Please call us at (610) 253-6565. 📞",
      });
    }

    // Edge function already wrote vehicle_id to the row in its
    // create_vehicle handler. Stash notes + the user-typed details on
    // new_vehicle_info so Step 10 (summary / appointment description)
    // can include them. Per chat-design.md §1281, notes are stored
    // verbatim — no AI parsing in Phase 1.
    return applyWizardTransition({
      chatId,
      updates: {
        new_vehicle_info: {
          year,
          make,
          model,
          license_plate: license_plate ?? null,
          notes: notes ?? null,
        },
      },
      nextStep: "service_concern_picker",
      jeffBubble: `Added your ${year} ${make} ${model}! 🚗 What can we help with today? 🔧`,
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_new_vehicle_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
