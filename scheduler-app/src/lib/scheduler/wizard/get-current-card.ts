/**
 * getCurrentCard — read the customer_chat_sessions row and build the
 * WizardCard the page should render.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14": this is the
 * single source of truth for "which card and what props" — replaces the
 * AI-SDK-driven last-assistant-message-with-incomplete-tool-call logic.
 *
 * Per-step payload builders live inline as switch cases. Each migration
 * phase fills in the case for its step:
 *   - Phase 3: greeting
 *   - Phase 4: phone_name
 *   - Phase 5: otp_pending, partial_verification_gate,
 *              multi_account_disambiguation, no_match_choose_path
 *   - Phase 6: customer_info_edit, new_customer_info
 *   - Phase 7: vehicle_pick, new_vehicle_form
 *   - Phase 8: service_concern_picker
 *   - Phase 9: concern_explanation, diagnostic_loading,
 *              clarification_question, testing_service_approval
 *   - Phase 10: second_routine_pass, appointment_type
 *   - Phase 11: date_pick, waiter_time_pick
 *   - Phase 12: summary
 *   - Phase 13: customer_notes, customer_question, completed
 *   - Phase 14: escalated, abandoned
 *
 * Phase 2 lands the scaffold + the trivial cases. Cases marked
 * `TODO(phase_NN)` return defensively-shaped placeholder payloads built
 * directly from row columns — they're correct enough for the WizardSurface
 * placeholder rendering during migration and become the basis the next
 * phase builds on.
 */
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchVehiclesForCustomer,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import type { WizardCard } from "./card-payloads";
import type { WizardStep } from "../session-state";

const SHOP_PHONE = "6102536565";

/**
 * Read the chat session row and return the WizardCard for the page to
 * render. Returns null when the row doesn't exist (caller should create
 * the row + treat as a fresh greeting session).
 */
export async function getCurrentCard(
  chatId: string,
): Promise<WizardCard | null> {
  const supabase = createSupabaseAdminClient();
  const { data: row, error } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", chatId)
    .maybeSingle();

  if (error || !row) {
    return null;
  }

  // Default to greeting when current_step is NULL (fresh row not yet advanced).
  const step = (row.current_step as WizardStep | null) ?? "greeting";

  // Helper: phone last-4 safely from possibly-null entered_phone.
  const phoneLastFour = (
    typeof row.phone_e164 === "string" ? row.phone_e164 : ""
  ).slice(-4);

  switch (step) {
    case "greeting":
      return { step: "greeting", payload: {} };

    case "phone_name": {
      const bucket = row.customer_self_identified as
        | "returning"
        | "new"
        | "unsure"
        | null;
      const step_label =
        bucket === "returning"
          ? "Step 2 · Welcome back"
          : bucket === "new"
            ? "Step 2 · Let’s get you set up"
            : "Step 2 · A few details";
      // Prefill from prior entries when resuming or bouncing back from a
      // §3.5 branch (no-match → try different phone, etc.). undefined when
      // the column is null so the PhoneNameCard's defaults take over.
      return {
        step: "phone_name",
        payload: {
          step_label,
          initial_first_name:
            (row.entered_first_name as string | null) ?? undefined,
          initial_last_name:
            (row.entered_last_name as string | null) ?? undefined,
          initial_phone_e164:
            (row.phone_e164 as string | null) ?? undefined,
        },
      };
    }

    case "otp_pending": {
      const attempts = (row.otp_attempts as number | null) ?? 0;
      return {
        step: "otp_pending",
        payload: {
          phone_last_four: phoneLastFour,
          ttl_seconds: 300,
          attempts_remaining: Math.max(0, 3 - attempts),
        },
      };
    }

    case "partial_verification_gate":
      // Default to matched_axis='name' — the only branch scheduler-step2-
      // direct currently emits (phone hit 0, name hit 1; chat-design.md
      // §3.5b). The matched_axis='phone' branch (phone matched but name
      // didn't) isn't implemented today because the §4.3 reconciliation
      // matrix routes 1+ phone hits to 'full' verification via OTP
      // regardless of name match. Phase 5 may stash matched_axis on the
      // row if a future case needs the 'phone' value.
      return {
        step: "partial_verification_gate",
        payload: {
          matched_axis: "name",
          attempted_first_name:
            (row.entered_first_name as string | null) ?? null,
          attempted_phone_last_four: phoneLastFour || null,
          // PII protection (chat-design.md spec line 217): the matched
          // customer's name is suppressed at the partial-verification gate
          // when matched_axis='name'.
          matched_first_name: null,
        },
      };

    case "multi_account_disambiguation":
      // Per chat-design.md §3.5c lines 685 + 710 — VEHICLE-only picker,
      // never names. Candidates were stashed on the row by
      // scheduler-step2-direct when phone hit 2+ Tekmetric records;
      // parseCandidates defensively filters out any entry missing
      // recent_vehicle (the spec requires it for the card to render).
      return {
        step: "multi_account_disambiguation",
        payload: {
          candidates: parseCandidates(row.pending_candidates),
          attempted_phone_last_four: phoneLastFour || null,
        },
      };

    case "no_match_choose_path":
      return {
        step: "no_match_choose_path",
        payload: {
          attempted_first_name:
            (row.entered_first_name as string | null) ?? null,
          attempted_phone_last_four: phoneLastFour || null,
        },
      };

    case "customer_info_edit":
      // TODO(phase_06): lookupCustomerByPhone via Tekmetric when phones/
      // emails/address not yet stashed on edited_*. Phase 2 placeholder
      // reads what's on the row (empty for fresh sessions).
      return {
        step: "customer_info_edit",
        payload: {
          first_name: (row.verified_first_name as string | null) ?? "",
          last_name: (row.verified_last_name as string | null) ?? "",
          initial_phones: parsePhones(row.edited_phones),
          initial_emails: parseEmails(row.edited_emails),
          initial_address: parseAddress(row.edited_address),
        },
      };

    case "new_customer_info":
      return {
        step: "new_customer_info",
        payload: {
          first_name: (row.entered_first_name as string | null) ?? "",
          last_name: (row.entered_last_name as string | null) ?? "",
          verified_phone_e164: (row.phone_e164 as string | null) ?? "",
        },
      };

    case "vehicle_pick": {
      // Partial-verification customers can't add a vehicle (spec §3.5a).
      const allowAddNew =
        (row.identity_verification_level as string | null) !== "partial";
      const customerId = row.customer_id as number | null;
      if (!customerId) {
        // New-customer flow (no Tekmetric record yet) — render empty list +
        // allow_add_new=true so the customer drills directly into add-flow.
        // Should be rare in practice: submitNewCustomerInfoV2 has just
        // created the record by the time we're on vehicle_pick.
        return {
          step: "vehicle_pick",
          payload: { vehicles: [], allow_add_new: allowAddNew },
        };
      }
      // Fetch via scheduler-booking-direct. Fail-soft: on Tekmetric failure
      // the card renders with empty list + allow_add_new=true so the
      // customer can still proceed by adding a new vehicle.
      try {
        const result = await fetchVehiclesForCustomer({
          op: "fetch_vehicles_for_customer",
          session_id: chatId,
          customer_id: customerId,
        });
        const vehicles = (result.ok && result.vehicles ? result.vehicles : [])
          .map((v) => ({
            id: String(v.id),
            label: buildVehicleLabel(v),
          }))
          .filter((v) => v.label.length > 0);
        return {
          step: "vehicle_pick",
          payload: { vehicles, allow_add_new: allowAddNew },
        };
      } catch (e) {
        Sentry.captureException(e, {
          tags: {
            surface: "get_current_card_vehicle_fetch",
            reason:
              e instanceof BookingDirectError
                ? `booking_direct_${e.status ?? "network"}`
                : "booking_direct_unknown",
          },
          level: "warning",
        });
        return {
          step: "vehicle_pick",
          payload: { vehicles: [], allow_add_new: allowAddNew },
        };
      }
    }

    case "new_vehicle_form":
      return { step: "new_vehicle_form", payload: {} };

    case "service_concern_picker":
      // TODO(phase_08): hydrate from routine_services cache.
      return {
        step: "service_concern_picker",
        payload: { common_services: [] },
      };

    case "concern_explanation":
      // TODO(phase_09): pop the next un-explained service from
      // explanation_required_items; render its lead-in bubble.
      return {
        step: "concern_explanation",
        payload: { service_key: "", display_name: "", lead_in_bubble: "" },
      };

    case "diagnostic_loading":
      return { step: "diagnostic_loading", payload: {} };

    case "clarification_question":
      // TODO(phase_09): pop next from clarification_questions_pending.
      return {
        step: "clarification_question",
        payload: {
          question_id: 0,
          question_text: "",
          options: [],
          service_key: null,
          category: null,
        },
      };

    case "testing_service_approval":
      // TODO(phase_09): read recommended_testing_services off the row +
      // join testing_services for pricing/notes.
      return {
        step: "testing_service_approval",
        payload: { services: [], category: null },
      };

    case "second_routine_pass":
      // TODO(phase_10): load routine_services list + already-picked from
      // selected_simple_services.
      return {
        step: "second_routine_pass",
        payload: {
          common_services: [],
          already_picked:
            (row.selected_simple_services as string[] | null) ?? [],
        },
      };

    case "appointment_type":
      // TODO(phase_10): pre-compute wait_eligible + earliest hints.
      return {
        step: "appointment_type",
        payload: {
          options: [
            {
              type: "waiter",
              available: true,
              unavailable_reason: null,
              earliest_hint: null,
            },
            {
              type: "dropoff",
              available: true,
              unavailable_reason: null,
              earliest_hint: null,
            },
          ],
        },
      };

    case "date_pick":
      // TODO(phase_11): call computeAvailableDates.
      return {
        step: "date_pick",
        payload: {
          available_dates: [],
          type:
            (row.appointment_type as "waiter" | "dropoff" | null) ?? "dropoff",
          initial_focus_date: null,
          range_end: null,
        },
      };

    case "waiter_time_pick":
      // TODO(phase_11): call list_waiter_times against scheduler-booking-direct.
      return {
        step: "waiter_time_pick",
        payload: {
          date: (row.appointment_date as string | null) ?? "",
          available_times: [],
        },
      };

    case "summary":
      // TODO(phase_12): full summary build — customer name, vehicle label,
      // services breakdown, hold_expires_at, reminders.
      return {
        step: "summary",
        payload: {
          hold_id: (row.hold_token as string | null) ?? null,
          hold_expires_at: null,
          starts_at:
            (row.appointment_date as string | null) ??
            "",
          customer: buildCustomerName(row),
          vehicle: "",
          type:
            (row.appointment_type as "waiter" | "dropoff" | null) ?? "dropoff",
          services: [],
          reminders: [],
        },
      };

    case "customer_notes":
      return {
        step: "customer_notes",
        payload: {
          initial_text: (row.customer_notes_text as string | null) ?? null,
        },
      };

    case "customer_question":
      return { step: "customer_question", payload: {} };

    case "completed":
      // TODO(phase_13): build appointment_label from appointment_date + time.
      return {
        step: "completed",
        payload: {
          first_name: (row.verified_first_name as string | null) ?? null,
          appointment_label: null,
          allow_schedule_another: true,
        },
      };

    case "escalated":
      return {
        step: "escalated",
        payload: {
          reason: (row.escalation_reason as string | null) ?? "unknown",
          shop_phone: SHOP_PHONE,
        },
      };

    case "abandoned":
      return { step: "abandoned", payload: {} };

    default: {
      // Exhaustiveness check — adding a new step to WIZARD_STEPS without
      // updating this switch is a TypeScript error.
      const _exhaustive: never = step;
      void _exhaustive;
      return null;
    }
  }
}

// ─── Row-column parsers ─────────────────────────────────────────────────────
// edited_phones / edited_emails / edited_address are JSONB on the row. Phase 1
// writers (session-actions.ts) write the shapes documented in chat-design.md
// §5 + §11 + §12. These parsers defensively coerce — fallback to safe defaults
// when the JSONB shape isn't what we expect.

/**
 * Parse edited_phones JSONB into the typed array CustomerInfoEditCard +
 * NewCustomerInfoCard expect. Canonical V1/V2 shape on the row is
 * { phone_e164, is_primary }. Also accepts legacy { number, primary }
 * keys defensively in case any pre-refactor rows linger.
 */
function parsePhones(
  raw: unknown,
): Array<{ phone_e164: string; is_primary: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ phone_e164: string; is_primary: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const phone =
      typeof e.phone_e164 === "string"
        ? e.phone_e164
        : typeof e.number === "string"
          ? e.number
          : "";
    if (!phone) continue;
    out.push({
      phone_e164: phone,
      is_primary: e.is_primary === true || e.primary === true,
    });
  }
  return out;
}

function parseEmails(
  raw: unknown,
): Array<{ email: string; is_primary: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ email: string; is_primary: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const email = typeof e.email === "string" ? e.email : "";
    if (!email) continue;
    out.push({
      email,
      is_primary: e.is_primary === true || e.primary === true,
    });
  }
  return out;
}

function parseAddress(
  raw: unknown,
):
  | {
      address1?: string;
      address2?: string;
      city?: string;
      state?: string;
      zip?: string;
    }
  | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const result: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
  } = {};
  if (typeof a.address1 === "string") result.address1 = a.address1;
  if (typeof a.address2 === "string") result.address2 = a.address2;
  if (typeof a.city === "string") result.city = a.city;
  if (typeof a.state === "string") result.state = a.state;
  if (typeof a.zip === "string") result.zip = a.zip;
  // Return null if nothing meaningful was on the row.
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse pending_candidates JSONB into the typed candidate array the
 * MultiAccountDisambiguationCard expects.
 *
 * Per chat-design.md §3.5c lines 685 + 710: PII-protective vehicle-only
 * picker. Any entry missing recent_vehicle is omitted entirely — the
 * card cannot render an unidentified row, and the spec instructs the
 * orchestrator to drop such candidates rather than surface them blank.
 *
 * Defensive about JSON shape: scheduler-step2-direct writes the array
 * as `(decision.data as Record<string, unknown>).candidates` and the
 * Tekmetric helpers' recent_vehicle may be null when the matched
 * customer has no vehicle on file.
 */
function parseCandidates(
  raw: unknown,
): Array<{ customer_id: number; recent_vehicle: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ customer_id: number; recent_vehicle: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.customer_id !== "number") continue;
    if (typeof e.recent_vehicle !== "string" || e.recent_vehicle.length === 0) {
      continue;
    }
    out.push({
      customer_id: e.customer_id,
      recent_vehicle: e.recent_vehicle,
    });
  }
  return out;
}

/**
 * Build the customer-facing vehicle label per chat-design.md §Step 6
 * (line 1196): "2022 Toyota Camry" with optional "PA · ABC-1234" plate.
 * Returns empty string when year + make + model are all missing — caller
 * filters those out so the picker doesn't render naked entries.
 *
 * Color is intentionally NOT included in the label — chat-design.md §6
 * shows year/make/model + optional plate; color is on the Tekmetric record
 * but not surfaced for picker disambiguation.
 */
function buildVehicleLabel(v: {
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
}): string {
  const parts: string[] = [];
  if (v.year != null) parts.push(String(v.year));
  if (v.make) parts.push(v.make);
  if (v.model) parts.push(v.model);
  const base = parts.join(" ").trim();
  if (!base) return "";
  if (v.license_plate) return `${base} · ${v.license_plate}`;
  return base;
}

function buildCustomerName(row: Record<string, unknown>): string {
  const first =
    (row.verified_first_name as string | null) ??
    (row.entered_first_name as string | null) ??
    "";
  const last =
    (row.verified_last_name as string | null) ??
    (row.entered_last_name as string | null) ??
    "";
  return [first, last].filter(Boolean).join(" ");
}
