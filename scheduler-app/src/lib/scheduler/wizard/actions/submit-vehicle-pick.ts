"use server";

/**
 * Step 6 — Vehicle pick submit (V2, server-state-driven).
 *
 * Per chat-design.md §Step 6 lines 1178-1408 + the Architecture amendment —
 * 2026-05-14.
 *
 * Two branches:
 *   - vehicle_id === 'new' → advance to new_vehicle_form (Step 6 drill-
 *     down). No row write besides current_step; the NewVehicleCard
 *     submit (submitNewVehicleV2) handles the Tekmetric POST + vehicle_id
 *     write.
 *   - vehicle_id is a number (Tekmetric vehicle ID, stringified by the
 *     picker) → write vehicle_id on the row + advance to
 *     service_concern_picker.
 *
 * No Tekmetric call here — the picker only shows vehicles the customer
 * actually owns, so the ID is trusted. (Defense in depth: scheduler-
 * step2-direct's identity-gate already bound the row's customer_id to
 * the phone-OTP-verified account; the picker fetches only that
 * customer's vehicles.)
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchVehiclesForCustomer,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";

const submitVehiclePickSchema = z.object({
  chatId: z.string().min(1),
  vehicle_id: z.union([
    z.literal("new"),
    // Numeric IDs come in as stringified numbers from the VehiclePicker
    // (it stores them as strings). Coerce to a positive integer here.
    z.string().regex(/^\d+$/, "vehicle_id must be 'new' or a numeric string"),
  ]),
});

export type SubmitVehiclePickV2Args = z.infer<typeof submitVehiclePickSchema>;

export async function submitVehiclePickV2(
  args: SubmitVehiclePickV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitVehiclePickSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, vehicle_id } = parsed.data;

  try {
    if (vehicle_id === "new") {
      return applyWizardTransition({
        chatId,
        updates: {},
        nextStep: "new_vehicle_form",
        jeffBubble: "Awesome — let's add it! Just the basics. 🚗",
      });
    }

    // Existing vehicle pick — write vehicle_id and advance.
    const vehicleIdNum = Number.parseInt(vehicle_id, 10);
    if (!Number.isFinite(vehicleIdNum) || vehicleIdNum <= 0) {
      return { ok: false, error: "vehicle_id must be a positive integer" };
    }

    // Bug fix 2026-05-16: also populate new_vehicle_info with the
    // picked vehicle's year/make/model so the SummaryCard + the
    // Tekmetric appointment title render correctly. Without this,
    // returning customers got an empty vehicle field on the summary
    // and the Tekmetric calendar title showed no year/make/model.
    //
    // Re-fetch the customer's vehicle list to find the picked entry's
    // metadata. Fail-soft: if the lookup fails, advance without
    // new_vehicle_info — the downstream code falls back to an empty
    // vehicle string rather than blocking the booking.
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("customer_id")
      .eq("id", chatId)
      .maybeSingle();
    const customerId = (row?.customer_id as number | null) ?? null;

    let newVehicleInfo: Record<string, unknown> | undefined = undefined;
    if (customerId) {
      try {
        const result = await fetchVehiclesForCustomer({
          op: "fetch_vehicles_for_customer",
          session_id: chatId,
          customer_id: customerId,
        });
        if (result.ok && result.vehicles) {
          const picked = result.vehicles.find((v) => v.id === vehicleIdNum);
          if (picked) {
            newVehicleInfo = {
              year: picked.year,
              make: picked.make,
              model: picked.model,
              sub_model: picked.sub_model,
              license_plate: picked.license_plate,
              color: picked.color,
            };
          }
        }
      } catch (e) {
        // Don't block — log + advance with no vehicle metadata.
        Sentry.captureException(e, {
          tags: {
            surface: "submit_vehicle_pick_v2_fetch_vehicle_metadata",
            reason:
              e instanceof BookingDirectError
                ? `booking_direct_${e.status ?? "network"}`
                : "booking_direct_unknown",
          },
          level: "warning",
        });
      }
    }

    return applyWizardTransition({
      chatId,
      updates: {
        vehicle_id: vehicleIdNum,
        // Only include new_vehicle_info when we successfully resolved the
        // vehicle. Skipping the key entirely is safer than writing null
        // (preserves any prior write).
        ...(newVehicleInfo ? { new_vehicle_info: newVehicleInfo } : {}),
      },
      nextStep: "service_concern_picker",
      jeffBubble: "Got it! 🔧 What can we help with today?",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_vehicle_pick_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_vehicle_pick_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}
