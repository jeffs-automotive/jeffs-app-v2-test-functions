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
import { getCachedSessionRow } from "@/lib/scheduler/cache";
import {
  fetchVehiclesForCustomer,
  listWaiterTimes,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { getRoutineServicesForChips } from "@/lib/scheduler/routine-services-cache";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";
import {
  computeAvailableDates,
  getEarliestAvailableDate,
} from "./availability";
import { buildSummaryCardPayload } from "./build-summary-data";
import { parseCustomerNote } from "./llm/parse-customer-note";
import { shopLocalToIsoString } from "./shop-tz";
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
  // Plan 04 Phase 5B: read via the per-session Next.js data cache so
  // concurrent RSC renders of the wizard share a single fetch +
  // revalidateTag(sessionTag(chatId)) from applyWizardTransition
  // invalidates ONLY this session's entry. The cached helper throws
  // on DB error; we mirror the prior null-on-error behavior here so
  // callers (BookPageShell) continue to fall back to the greeting card.
  let row: Awaited<ReturnType<typeof getCachedSessionRow>>;
  try {
    row = await getCachedSessionRow(chatId);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { surface: "get_current_card_session_read" },
      level: "warning",
      extra: { chatId },
    });
    return null;
  }
  if (!row) {
    return null;
  }
  const supabase = createSupabaseAdminClient();

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
          ? "Welcome back"
          : bucket === "new"
            ? "Let’s get you set up"
            : "A few details";
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
      // never names. Candidates are stashed on the row by
      // submit-phone-name (Round 1 fix 2026-05-16) from
      // step2Result.data.candidates, which scheduler-step2-direct now
      // pre-filters at the edge fn to drop null-vehicle entries.
      // parseCandidates here is still defensive (shape coercion +
      // double-filter) but should normally pass everything through.
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

    case "service_concern_picker": {
      // 2026-05-17 reshape: single-section picker showing all 10 routine
      // services with their starting price + (optional) waived-fee note.
      // testing_services is NO LONGER surfaced here — that catalog is
      // long, mechanic-jargon-heavy, and confusing to customers; the
      // diagnostic LLM selects the right test from testing_services in
      // Step 7.3 based on the customer's free-text concern_explanation.
      let routineServices: Array<{
        service_key: string;
        display_name: string;
        starting_price_cents: number | null;
        price_waived_note: string | null;
        description: string | null;
      }> = [];
      try {
        const { data: rows, error: rowsErr } = await supabase
          .from("routine_services")
          .select(
            "service_key, display_name, display_order, starting_price_cents, price_waived_note, description",
          )
          .eq("shop_id", 7476)
          .eq("active", true)
          .order("display_order", { ascending: true });
        if (rowsErr) {
          throw new Error(
            `routine_services lookup failed: ${rowsErr.message}`,
          );
        }
        routineServices = (
          (rows ?? []) as Array<{
            service_key: string;
            display_name: string;
            starting_price_cents: number | null;
            price_waived_note: string | null;
            description: string | null;
          }>
        ).map((r) => ({
          service_key: r.service_key,
          display_name: r.display_name,
          starting_price_cents: r.starting_price_cents,
          price_waived_note: r.price_waived_note,
          description: r.description,
        }));
      } catch (e) {
        Sentry.captureException(e, {
          tags: { surface: "get_current_card_service_concern_picker" },
          level: "warning",
        });
      }

      return {
        step: "service_concern_picker",
        payload: { routine_services: routineServices },
      };
    }

    case "concern_explanation": {
      // Pop the next un-explained item from explanation_required_items.
      // Phase 9c shape: { service_key, display_name, explanation_text } —
      // the first entry with empty explanation_text is the active card.
      const items = parseExplanationRequiredItems(
        row.explanation_required_items,
      );
      const next = items.find((i) => !i.explanation_text);
      if (!next) {
        // Queue drained — getCurrentCard shouldn't normally hit this (the
        // submit action would have advanced past concern_explanation). Fall
        // back to a stub; WizardSurface treats it like a transient state.
        return {
          step: "concern_explanation",
          payload: {
            service_key: "",
            display_name: "",
            lead_in_bubble: "",
          },
        };
      }
      return {
        step: "concern_explanation",
        payload: {
          service_key: next.service_key,
          display_name: next.display_name || next.service_key,
          lead_in_bubble: buildConcernExplanationLeadIn(
            next.service_key,
            next.display_name || next.service_key,
          ),
        },
      };
    }

    case "diagnostic_loading":
      return { step: "diagnostic_loading", payload: {} };

    case "clarification_question": {
      // Pop head of clarification_questions_pending (Phase 9a writes the
      // full payload there: question_id + question_text + options +
      // service_key + category, in MD-display order).
      const pending = parseClarificationQuestionsPending(
        row.clarification_questions_pending,
      );
      const head = pending[0];
      if (!head) {
        return {
          step: "clarification_question",
          payload: {
            question_id: 0,
            question_text: "",
            options: [],
            service_key: null,
            category: null,
            multi_select: false,
          },
        };
      }
      return {
        step: "clarification_question",
        payload: {
          question_id: head.question_id,
          question_text: head.question_text,
          options: head.options,
          service_key: head.service_key,
          category: head.category,
          multi_select: head.multi_select,
        },
      };
    }

    case "testing_service_approval": {
      // 2026-05-17 restoration: render the actual approval card per
      // chat-design.md §7.5. The prior auto-flip-to-second_routine_pass
      // behavior was based on a misread of the 2026-05-14 amendment;
      // the canonical design always had this step alive.
      //
      // Payload comes from row.recommended_testing_services (written by
      // run-diagnostics after the per-concern LLM pass). Each entry has
      // service_key + display_name + description + starting_price_cents
      // + source_concerns. We strip source_concerns from the customer-
      // facing payload — that's audit-only context.
      const raw = (row as Record<string, unknown>).recommended_testing_services;
      const services = Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>)
            .map((entry) => ({
              service_key:
                typeof entry.service_key === "string" ? entry.service_key : "",
              display_name:
                typeof entry.display_name === "string" ? entry.display_name : "",
              starting_price_cents:
                typeof entry.starting_price_cents === "number"
                  ? entry.starting_price_cents
                  : 0,
              notes:
                typeof entry.description === "string" ? entry.description : null,
            }))
            .filter((s) => s.service_key.length > 0 && s.display_name.length > 0)
        : [];
      return {
        step: "testing_service_approval",
        payload: {
          services,
          category: null,
        },
      };
    }

    case "second_routine_pass": {
      // Phase 10 (2026-05-15): load the full routine_services list as
      // chips. Already-picked items (from Step 7.1 selected_simple_services
      // OR Step 7.2 explanation_required_items) render disabled with an
      // "✓ added" badge — the card hides them from the pickable set so the
      // customer can't double-book a service.
      // Bug audit 2026-05-16: previously this rendered ALL routine_services
      // as add-on chips, including requires_explanation=true rows (Brake
      // Inspection, Check Battery, Warning Lights, Check Suspension, Check
      // A/C). Picking one silently skipped the concern_explanation +
      // diagnostic gap-detection flow that the spec mandates for those
      // services. The technician would receive a service request with no
      // symptoms description. Now we filter requires_explanation rows out
      // of the second-pass add-on grid — those services must be picked at
      // Step 7.1 where the diagnostic flow attaches.
      let commonServices: Array<{ service_key: string; display_name: string }> =
        [];
      try {
        const allRoutine = await getRoutineServicesForChips();
        const { data: explanationFlags, error: flagsErr } = await supabase
          .from("routine_services")
          .select("service_key, requires_explanation")
          .eq("shop_id", 7476)
          .eq("active", true);
        if (flagsErr) {
          throw new Error(
            `routine_services requires_explanation lookup failed: ${flagsErr.message}`,
          );
        }
        const requiresExplanationByKey = new Map<string, boolean>();
        for (const r of (explanationFlags ?? []) as Array<{
          service_key: string;
          requires_explanation: boolean;
        }>) {
          requiresExplanationByKey.set(r.service_key, r.requires_explanation);
        }
        commonServices = allRoutine
          .filter((r) => !requiresExplanationByKey.get(r.service_key))
          .map((r) => ({
            service_key: r.service_key,
            display_name: r.display_name,
          }));
      } catch (e) {
        Sentry.captureException(e, {
          tags: { surface: "get_current_card_second_routine_pass" },
          level: "warning",
        });
      }

      const alreadyPicked = collectPickedServiceKeys(row);
      return {
        step: "second_routine_pass",
        payload: {
          common_services: commonServices,
          already_picked: alreadyPicked,
        },
      };
    }

    case "appointment_type": {
      // Phase 10 (2026-05-15): pre-compute wait_eligibility + earliest
      // dates per type. Deterministic — no LLM. Wait-eligibility is
      // routine_services.wait_eligible AND across every picked service
      // (any single non-wait-eligible service blocks the whole basket;
      // any testing_services pick also blocks since they're not waitable).
      const allKeys = collectPickedServiceKeys(row);
      let waitEligible = true;
      let waitEligibilityReason: string | null = null;
      try {
        const result = await assessWaitEligibility(supabase, allKeys);
        waitEligible = result.wait_eligible;
        waitEligibilityReason = result.blocked_reason;
      } catch (e) {
        Sentry.captureException(e, {
          tags: { surface: "get_current_card_appointment_type_eligibility" },
          level: "warning",
        });
        // Default-safe: if eligibility can't be assessed, allow waiter
        // (customer's choice wins; submit-appointment-type re-validates
        // server-side before advancing).
      }

      const [earliestWaiter, earliestDropoff] = await Promise.all([
        waitEligible ? getEarliestAvailableDate("waiter", 30) : Promise.resolve(null),
        getEarliestAvailableDate("dropoff", 30).catch((e) => {
          Sentry.captureException(e, {
            tags: { surface: "get_current_card_appointment_type_dropoff" },
            level: "warning",
          });
          return null;
        }),
      ]);

      return {
        step: "appointment_type",
        payload: {
          options: [
            {
              type: "waiter",
              available: waitEligible,
              unavailable_reason: waitEligible ? null : waitEligibilityReason,
              earliest_hint: waitEligible
                ? formatDateHint(earliestWaiter)
                : null,
            },
            {
              type: "dropoff",
              available: true,
              unavailable_reason: null,
              earliest_hint: formatDateHint(earliestDropoff),
            },
          ],
        },
      };
    }

    case "date_pick": {
      // Phase 11 (2026-05-15): full 365-day window of capacity-aware
      // availability. computeAvailableDates handles the 5-layer stack;
      // we pre-set initial_focus to the earliest available day so the
      // calendar opens on the right month even when "today" has no
      // capacity. Fail-soft to an empty list — the card renders with a
      // "no openings in window" affordance + the shop phone fallback.
      const apptType =
        (row.appointment_type as "waiter" | "dropoff" | null) ?? "dropoff";
      let availableDates: string[] = [];
      try {
        availableDates = await computeAvailableDates({
          appointment_type: apptType,
          days_ahead: 365,
        });
      } catch (e) {
        Sentry.captureException(e, {
          tags: { surface: "get_current_card_date_pick" },
          level: "warning",
        });
      }

      const today = new Date();
      const rangeEndIso = ymdFromDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + 365),
      );

      return {
        step: "date_pick",
        payload: {
          available_dates: availableDates,
          type: apptType,
          initial_focus_date: availableDates[0] ?? null,
          range_end: rangeEndIso,
        },
      };
    }

    case "waiter_time_pick": {
      // Phase 11 (2026-05-15): real-time spots-left fetch via
      // scheduler-booking-direct list_waiter_times op. The edge function
      // counts holds + non-cancelled appointments against the day's
      // waiter_8am_slots / waiter_9am_slots capacity (timezone-aware per
      // the Phase 1 fix) and returns the surviving subset of ['08:00',
      // '09:00']. Race-protected: an empty array means both slots filled
      // between picking the date and now — the card renders an empty
      // state and the customer back-arrows to date_pick.
      const date = (row.appointment_date as string | null) ?? "";
      let availableTimes: Array<"08:00" | "09:00"> = [];
      if (date) {
        try {
          const result = await listWaiterTimes({
            op: "list_waiter_times",
            session_id: chatId,
            date,
          });
          availableTimes = result.available_times.filter(
            (t): t is "08:00" | "09:00" => t === "08:00" || t === "09:00",
          );
        } catch (e) {
          Sentry.captureException(e, {
            tags: {
              surface: "get_current_card_waiter_time_pick",
              reason:
                e instanceof BookingDirectError
                  ? `booking_direct_${e.status ?? "network"}`
                  : "booking_direct_unknown",
            },
            level: "warning",
          });
        }
      }
      return {
        step: "waiter_time_pick",
        payload: { date, available_times: availableTimes },
      };
    }

    case "summary": {
      // Phase 12 (2026-05-16): full payload via buildSummaryCardPayload.
      // Includes services breakdown (routine + concerns + testing), pre-
      // appointment reminders, and the hold_expires_at countdown read
      // from appointment_holds (the source-of-truth for hold TTL).
      const holdToken = (row.hold_token as string | null) ?? undefined;
      let holdExpiresAt: string | undefined = undefined;
      if (holdToken) {
        const { data: hold } = await supabase
          .from("appointment_holds")
          .select("expires_at, released_at")
          .eq("id", holdToken)
          .maybeSingle();
        if (hold && !hold.released_at) {
          holdExpiresAt = hold.expires_at as string;
        }
      }
      try {
        const payload = await buildSummaryCardPayload({
          chatId,
          hold_id: holdToken,
          hold_expires_at: holdExpiresAt,
        });
        return { step: "summary", payload };
      } catch (e) {
        Sentry.captureException(e, {
          tags: { surface: "get_current_card_summary" },
          level: "warning",
        });
        // Fail-soft skeleton so the card still renders something.
        return {
          step: "summary",
          payload: {
            hold_id: holdToken ?? null,
            hold_expires_at: holdExpiresAt ?? null,
            starts_at:
              (row.appointment_date as string | null) ?? "",
            customer: buildCustomerName(row),
            vehicle: "",
            type:
              (row.appointment_type as "waiter" | "dropoff" | null) ??
              "dropoff",
            services: [],
            reminders: [],
          },
        };
      }
    }

    case "customer_notes": {
      // Phase 13 (2026-05-16): two modes.
      //
      // Input mode: row.customer_notes_text is null OR
      //   customer_notes_approved is non-null (already finalized; shouldn't
      //   normally be on this step but defensive). Render with no preview.
      //
      // Approval mode: row.customer_notes_text is set AND approved is null.
      //   We LLM-parse the stored raw text and surface the preview. The
      //   action submitCustomerNotesV2 handles Approve / Edit. Re-parse on
      //   every render so an Edit click (which only bumps edit_attempts)
      //   produces fresh alternate wording without us persisting it.
      const rawText = (row.customer_notes_text as string | null) ?? null;
      const approved = (row.customer_notes_approved as boolean | null) ?? null;
      const editAttempts =
        (row.customer_notes_edit_attempts as number | null) ?? 0;

      const inputMode =
        !rawText || rawText.trim().length === 0 || approved !== null;

      if (inputMode) {
        return {
          step: "customer_notes",
          payload: {
            initial_text: rawText,
            parsed_preview: null,
            edit_attempts: editAttempts,
          },
        };
      }

      // Approval mode — call the LLM rewriter. Attempt 2 fires on the
      // 1st Edit click (edit_attempts === 1 after the action incremented).
      const firstName =
        (row.verified_first_name as string | null) ??
        (row.entered_first_name as string | null) ??
        null;
      const attempt: 1 | 2 = editAttempts >= 1 ? 2 : 1;

      let parsedPreview = rawText.trim().slice(0, 150);
      try {
        const result = await parseCustomerNote({
          raw_text: rawText,
          attempt,
          customer_first_name: firstName,
        });
        // Fail-safe inside parseCustomerNote returns parsed_text=raw on
        // LLM error, so this branch always produces a non-empty preview.
        if (result.parsed_text.trim().length > 0) {
          parsedPreview = result.parsed_text;
        }
      } catch (e) {
        Sentry.captureException(e, {
          tags: { surface: "get_current_card_customer_notes_parse" },
          level: "warning",
          extra: { chatId, attempt },
        });
      }

      return {
        step: "customer_notes",
        payload: {
          initial_text: rawText,
          parsed_preview: parsedPreview,
          edit_attempts: editAttempts,
        },
      };
    }

    case "customer_question":
      return { step: "customer_question", payload: {} };

    case "completed":
      // Phase 13 (2026-05-16): build appointment_label from
      // appointment_date + appointment_time + appointment_type. The label
      // appears in the completed card recap ("We'll see you Wednesday,
      // May 13 at 8:00 AM" for waiter; bare date for dropoff).
      return {
        step: "completed",
        payload: {
          first_name:
            (row.verified_first_name as string | null) ??
            (row.entered_first_name as string | null) ??
            null,
          appointment_label: buildAppointmentLabel(
            row.appointment_date as string | null,
            row.appointment_time as string | null,
            row.appointment_type as "waiter" | "dropoff" | null,
          ),
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

// ─── Phase 9c — explanation queue + clarification queue parsers ─────────────

interface ExplanationItem {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category?: string | null;
}

function parseExplanationRequiredItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const service_key =
      typeof e.service_key === "string" ? e.service_key : null;
    if (!service_key) continue;
    const display_name =
      typeof e.display_name === "string" ? e.display_name : service_key;
    const explanation_text =
      typeof e.explanation_text === "string" ? e.explanation_text : "";
    const category =
      typeof e.category === "string" && e.category.length > 0
        ? e.category
        : null;
    out.push({ service_key, display_name, explanation_text, category });
  }
  return out;
}

interface PendingQuestion {
  question_id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  service_key: string | null;
  category: string | null;
  multi_select: boolean;
}

function parseClarificationQuestionsPending(raw: unknown): PendingQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingQuestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const question_id =
      typeof e.question_id === "number" ? e.question_id : null;
    const question_text =
      typeof e.question_text === "string" ? e.question_text : null;
    if (question_id === null || question_text === null) continue;
    const optsRaw = Array.isArray(e.options) ? e.options : [];
    const options = optsRaw
      .map((o) => {
        if (!o || typeof o !== "object") return null;
        const oo = o as Record<string, unknown>;
        return typeof oo.label === "string" && typeof oo.value === "string"
          ? { label: oo.label, value: oo.value }
          : null;
      })
      .filter((x): x is { label: string; value: string } => x !== null);
    out.push({
      question_id,
      question_text,
      options,
      service_key:
        typeof e.service_key === "string" && e.service_key.length > 0
          ? e.service_key
          : null,
      category:
        typeof e.category === "string" && e.category.length > 0
          ? e.category
          : null,
      multi_select: e.multi_select === true,
    });
  }
  return out;
}

/**
 * Stock lead-in bubble for the Step 7.2 concern_explanation card. Per
 * chat-design.md §7.2 the bubble varies by service kind:
 *
 *   - "💬 Other Issue" gets the empathetic open-ended prompt because the
 *     customer has no specific service in mind — they need permission to
 *     describe what's wrong in their own words.
 *   - Every other requires_explanation chip (Brake Inspection, Check
 *     Battery, Warning Lights, Check Suspension, Check A/C) gets a
 *     concise per-service prompt.
 */
function buildConcernExplanationLeadIn(
  serviceKey: string,
  displayName: string,
): string {
  if (serviceKey === "other_issue") {
    return "I'm sorry to hear you're dealing with this. Can you tell me what's going on with your car? 🤔";
  }
  return `Got it — tell me a bit about ${displayName.toLowerCase()}. What are you noticing? 🤔`;
}

// ─── Phase 10 — service pick aggregation + wait-eligibility ─────────────────

/**
 * Collect every service_key the customer has committed to across the four
 * row buckets:
 *   - selected_simple_services (Step 7.1 routine non-explanation picks)
 *   - approved_testing_services (Step 7.1 diagnostic chip section)
 *   - explanation_required_items[].service_key (Step 7.2 queue entries)
 *   - additional_routine_services_round2 (Step 7.6 add-ons)
 *
 * Returns a de-duplicated array. Order is preserved as much as possible
 * (selected_simple_services first, then testing, then explanation queue,
 * then second-pass adds) so downstream UI can render in a consistent
 * sequence.
 */
function collectPickedServiceKeys(row: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  const out: string[] = [];
  const push = (k: string) => {
    if (!keys.has(k)) {
      keys.add(k);
      out.push(k);
    }
  };
  for (const k of (row.selected_simple_services as string[] | null) ?? []) {
    push(k);
  }
  for (const k of (row.approved_testing_services as string[] | null) ?? []) {
    push(k);
  }
  if (Array.isArray(row.explanation_required_items)) {
    for (const entry of row.explanation_required_items) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).service_key === "string"
      ) {
        push((entry as Record<string, unknown>).service_key as string);
      }
    }
  }
  for (const k of (row.additional_routine_services_round2 as
    | string[]
    | null) ?? []) {
    push(k);
  }
  return out;
}

/**
 * Decide whether the picked-service basket is eligible for the waiter
 * slot. Every key must be in routine_services with wait_eligible=true.
 * Any testing_services pick (no wait_eligible column) blocks eligibility
 * — those services take time and require a tech bay.
 *
 * Returns the blocking display_name in blocked_reason when a single
 * service is the culprit; falls back to a generic reason when multiple
 * services are blocking.
 */
async function assessWaitEligibility(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  allKeys: string[],
): Promise<{ wait_eligible: boolean; blocked_reason: string | null }> {
  if (allKeys.length === 0) {
    return { wait_eligible: true, blocked_reason: null };
  }

  // Look up display_name + wait_eligible from BOTH routine_services and
  // testing_services. Bug audit 2026-05-16: previously this only queried
  // routine_services, so any testing-service key in the basket got
  // surfaced to the customer as a raw service_key (e.g.,
  // "engine_noise_diagnostic takes longer than a waiter slot allows").
  // Pull testing_services too so the blocker name is human-readable.
  const [{ data: routineRows, error: routineErr }, { data: testingRows }] =
    await Promise.all([
      supabase
        .from("routine_services")
        .select("service_key, display_name, wait_eligible")
        .eq("shop_id", SHOP_ID)
        .in("service_key", allKeys),
      supabase
        .from("testing_services")
        .select("service_key, display_name")
        .eq("shop_id", SHOP_ID)
        .in("service_key", allKeys),
    ]);
  if (routineErr) {
    throw new Error(
      `routine_services wait_eligible lookup failed: ${routineErr.message}`,
    );
  }
  // R6-C-2 2026-05-16: a service_key may legitimately appear in BOTH
  // testing_services and routine_services (current intentional collisions:
  // brake_inspection — testing for the $39.99 diagnostic, routine with
  // requires_explanation=TRUE for the picker UX). When that happens, the
  // ROUTINE row wins via the lookup-order below (we read routineByKey
  // first, fall back to testingByKey). Future deliberate collisions must
  // preserve this resolution order; surprise collisions should be caught
  // via the upsert_testing_service / upsert_routine_service admin tools
  // (which can lint cross-table uniqueness before inserting).
  const routineByKey = new Map<
    string,
    { display_name: string; wait_eligible: boolean }
  >();
  for (const r of (routineRows ?? []) as Array<{
    service_key: string;
    display_name: string;
    wait_eligible: boolean;
  }>) {
    routineByKey.set(r.service_key, {
      display_name: r.display_name,
      wait_eligible: !!r.wait_eligible,
    });
  }
  const testingByKey = new Map<string, { display_name: string }>();
  for (const r of (testingRows ?? []) as Array<{
    service_key: string;
    display_name: string;
  }>) {
    testingByKey.set(r.service_key, { display_name: r.display_name });
  }

  const blockers: string[] = [];
  for (const key of allKeys) {
    const r = routineByKey.get(key);
    if (r === undefined) {
      // Not in routine_services — check testing_services for a display_name.
      // Testing services are never wait-eligible (require a tech bay).
      const t = testingByKey.get(key);
      blockers.push(t?.display_name ?? key);
      continue;
    }
    if (!r.wait_eligible) {
      blockers.push(r.display_name);
    }
  }

  if (blockers.length === 0) {
    return { wait_eligible: true, blocked_reason: null };
  }
  if (blockers.length === 1) {
    return {
      wait_eligible: false,
      blocked_reason: `${blockers[0]} takes longer than a waiter slot allows.`,
    };
  }
  return {
    wait_eligible: false,
    blocked_reason:
      "Some of the services you picked take longer than a waiter slot allows.",
  };
}

/**
 * Format a YYYY-MM-DD into a short human-readable hint like "Mon May 19"
 * for the appointment_type card buttons. Returns null when input is null
 * so the card can suppress the "Earliest:" line.
 */
function formatDateHint(ymd: string | null): string | null {
  if (!ymd) return null;
  // Construct the date AT NOON UTC for the day so timezone shifts can't
  // bump us to the prior calendar day in any locale.
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(d);
}

/**
 * Format a local Date as YYYY-MM-DD using the local timezone components
 * (NOT toISOString which shifts to UTC). Used by the date_pick payload
 * builder for range_end (today + 365 days) so the calendar's bounds match
 * the calendar's own grid math (which uses local-time year/month/day).
 */
function ymdFromDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build the friendly recap string for the completed card.
 *   waiter:  "Wed, May 13 at 8:00 AM"
 *   dropoff: "Wed, May 13"
 *
 * Times are shop-local (America/New_York). Returns null when date is
 * missing so the card suppresses the "We'll see you ..." line.
 */
function buildAppointmentLabel(
  date: string | null,
  time: string | null,
  type: "waiter" | "dropoff" | null,
): string | null {
  if (!date) return null;
  const timeStr = type === "waiter" ? (time ?? "08:00") : "12:00";
  // R6 pattern-extension 2026-05-16: was hardcoded "-04:00" — broke
  // Nov-Mar (EST) by reading the wrong UTC instant. shopLocalToIsoString
  // probes Intl.DateTimeFormat for the correct per-date offset.
  const startIso = shopLocalToIsoString(date, timeStr);
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return null;

  const dayPart = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  if (type !== "waiter") {
    return dayPart;
  }

  const timePart = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${dayPart} at ${timePart}`;
}
