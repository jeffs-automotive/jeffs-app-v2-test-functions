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
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
      // TODO(phase_05): scheduler-step2-direct already returns candidates
      // for this case; stash them on the row + read here instead of empty.
      return {
        step: "multi_account_disambiguation",
        payload: {
          candidates: [],
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

    case "vehicle_pick":
      // TODO(phase_07): lookupVehiclesForCustomer via Tekmetric.
      return {
        step: "vehicle_pick",
        payload: {
          vehicles: [],
          // Partial-verification customers can't add a vehicle (spec §3.5a).
          allow_add_new:
            (row.identity_verification_level as string | null) !== "partial",
        },
      };

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

function parsePhones(
  raw: unknown,
): Array<{ phone_e164: string; is_primary: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ phone_e164: string; is_primary: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    // Tekmetric-shape: { id?, number, type, primary }. We normalize to
    // { phone_e164, is_primary } for the new card. `number` may be 10-digit
    // (Tekmetric) or E.164 — phase 6 will normalize uniformly; phase 2 just
    // passes through whatever's on the row.
    const number = typeof e.number === "string" ? e.number : "";
    if (!number) continue;
    out.push({
      phone_e164: number,
      is_primary: e.primary === true,
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
    out.push({ email, is_primary: e.primary === true });
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
