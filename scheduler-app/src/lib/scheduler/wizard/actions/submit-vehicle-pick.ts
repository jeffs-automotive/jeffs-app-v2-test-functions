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

import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

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

    return applyWizardTransition({
      chatId,
      updates: { vehicle_id: vehicleIdNum },
      nextStep: "service_concern_picker",
      jeffBubble: "Got it! 🔧 What can we help with today?",
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_vehicle_pick_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
