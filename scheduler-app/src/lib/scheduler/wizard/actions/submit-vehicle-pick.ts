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
 * Plan 04 Phase 3A (closes I-COR-4): the picker UI only shows the
 * customer's Tekmetric-owned vehicles, but a tampered Server Action
 * call could bypass the picker and bind any vehicle_id. We now
 * re-fetch the customer's vehicle list server-side and reject any
 * vehicle_id that isn't in it (IDOR defense). The fetch ALSO
 * populates new_vehicle_info metadata for the SummaryCard +
 * Tekmetric appointment title (preserves the 2026-05-16 fix).
 *
 * Defense in depth: scheduler-step2-direct's identity-gate binds the
 * row's customer_id to the phone-OTP-verified account before this
 * step ever fires, so the customer_id we use as the ownership-set
 * key is itself trusted.
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
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

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

async function submitVehiclePickV2Impl(
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

    // Plan 04 Phase 3A (closes I-COR-4) — IDOR defense.
    //
    // The vehicle picker UI only renders the customer's Tekmetric-owned
    // vehicles, so the historical assumption was "the vehicle_id is
    // trusted." A tampered Server Action call (bypassing the picker)
    // could bind ARBITRARY vehicle_id to the session — letting an
    // attacker stage a Tekmetric appointment against any vehicle in
    // the shop's catalog. This is a real cross-tenant risk.
    //
    // Defense: re-fetch the customer's vehicle list and require the
    // picked vehicle_id to be in it. The fetch ALSO populates
    // new_vehicle_info metadata for the SummaryCard + Tekmetric title
    // (per the 2026-05-16 fix preserved below).
    //
    // Fail-soft policy on the fetch itself: if fetchVehiclesForCustomer
    // throws OR returns ok:false (transient Tekmetric outage, network
    // hiccup, etc.) we proceed WITHOUT IDOR enforcement — same as the
    // pre-Phase-3A behavior, since blocking legitimate users on
    // Tekmetric flakiness is worse than the casual-tamper risk that a
    // sophisticated DDoS-Tekmetric attacker would exploit. Per
    // PLAN-04 §Phase 3 risk note: "Worst case: a legitimate edge case
    // (e.g. vehicle just added to Tekmetric not yet visible to
    // scheduler) gets blocked — bump to a `level: 'info'` log + add a
    // manual escalation path." We err toward letting users through.
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("customer_id, edit_return_step")
      .eq("id", chatId)
      .maybeSingle();
    const customerId = (row?.customer_id as number | null) ?? null;
    const fromHub =
      (row?.edit_return_step as string | null) === "summary_edit_hub";

    if (!customerId) {
      // Data-integrity issue — by the vehicle_pick step the row MUST
      // have customer_id (set by scheduler-step2-direct after OTP
      // verification). If it's missing, refusing to write is safer
      // than guessing.
      Sentry.captureMessage("vehicle_pick_missing_customer_id", {
        level: "warning",
        tags: {
          surface: "submit_vehicle_pick_v2_missing_customer_id",
          chat_id: chatId,
        },
      });
      return {
        ok: false,
        error: "session_missing_customer_id",
      };
    }

    let newVehicleInfo: Record<string, unknown> | undefined = undefined;
    try {
      const result = await fetchVehiclesForCustomer({
        op: "fetch_vehicles_for_customer",
        session_id: chatId,
        customer_id: customerId,
      });
      if (result.ok && result.vehicles) {
        const picked = result.vehicles.find((v) => v.id === vehicleIdNum);
        if (!picked) {
          // IDOR: client supplied a vehicle_id that's NOT in this
          // customer's Tekmetric-owned vehicles. Reject with warning.
          Sentry.captureMessage("vehicle_id_not_owned_by_customer", {
            level: "warning",
            tags: {
              surface: "submit_vehicle_pick_v2_idor",
              chat_id: chatId,
            },
            extra: {
              customer_id: customerId,
              attempted_vehicle_id: vehicleIdNum,
              owned_vehicle_count: result.vehicles.length,
            },
          });
          return {
            ok: false,
            error: "vehicle_id_not_owned",
          };
        }
        newVehicleInfo = {
          year: picked.year,
          make: picked.make,
          model: picked.model,
          sub_model: picked.sub_model,
          license_plate: picked.license_plate,
          color: picked.color,
        };
      } else {
        // M2 post-validator fix (2026-05-25): fetch succeeded but
        // result.ok=false OR result.vehicles missing → IDOR
        // enforcement is silently DISABLED for this request. Ops
        // need visibility so they can distinguish "transient
        // Tekmetric outage that's acceptable" from "persistent
        // IDOR coverage gap that needs investigation." Surface tag
        // explicitly says idor_skipped (vs the catch block which
        // documents the throw shape).
        Sentry.captureMessage(
          "submit_vehicle_pick_v2 IDOR enforcement skipped (fetch returned !ok or no .vehicles)",
          {
            level: "warning",
            tags: {
              surface: "submit_vehicle_pick_v2_idor_skipped_fail_soft",
              chat_id: chatId,
              reason: "fetch_ok_false_or_no_vehicles",
            },
            extra: {
              customer_id: customerId,
              attempted_vehicle_id: vehicleIdNum,
              fetch_ok:
                "ok" in result && typeof result.ok === "boolean"
                  ? result.ok
                  : null,
              has_vehicles: "vehicles" in result,
            },
          },
        );
      }
    } catch (e) {
      // M2 post-validator fix (2026-05-25): rename surface tag to
      // make ops-visibility intent explicit. The throw path is also
      // an IDOR-skipped event (we couldn't verify ownership), but
      // distinguished from the result.ok=false case above by the
      // reason sub-tag. Casual-tamper risk accepted on this path;
      // sophisticated-attacker DDoS-of-Tekmetric is out of scope.
      Sentry.captureException(e, {
        tags: {
          surface: "submit_vehicle_pick_v2_idor_skipped_fail_soft",
          chat_id: chatId,
          reason:
            e instanceof BookingDirectError
              ? `fetch_throw_booking_direct_${e.status ?? "network"}`
              : "fetch_throw_unknown",
        },
        level: "warning",
      });
    }

    // Summary edit hub (task EH1, 2026-07-04): when this pick was reached
    // FROM the hub (edit_return_step='summary_edit_hub'), return to the hub
    // instead of the forced forward chain into service_concern_picker. The
    // flag stays set (only the hub's "done" / start-over clears it).
    return applyWizardTransition({
      chatId,
      updates: {
        vehicle_id: vehicleIdNum,
        // Only include new_vehicle_info when we successfully resolved the
        // vehicle. Skipping the key entirely is safer than writing null
        // (preserves any prior write).
        ...(newVehicleInfo ? { new_vehicle_info: newVehicleInfo } : {}),
      },
      nextStep: fromHub ? "summary_edit_hub" : "service_concern_picker",
      jeffBubble: fromHub
        ? "Updated your vehicle. ✅"
        : "Got it! 🔧 What can we help with today?",
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

export const submitVehiclePickV2 = wrapAction(
  "submitVehiclePickV2",
  submitVehiclePickV2Impl,
);
