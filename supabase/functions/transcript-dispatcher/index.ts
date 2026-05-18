// transcript-dispatcher
//
// Hybrid trigger: cron-driven backstop + on-demand invocation from
// Vercel after() / Edge Function waitUntil() per appointments_design.md §11.
//
// Trigger modes:
//   - GET / or POST / with no body → backstop pass (selects pending/retry
//     rows older than 30s and dispatches them all)
//   - POST / { transcript_id } → dispatch a single transcript right now
//
// Auth: Pattern A bearer check (same as orchestrator-direct).
//
// Per-transcript steps:
//   1. Load transcript_emails row + linked customer_chat_sessions + messages
//      + scheduler_audit_log error events
//   2. Build view model (sentiment classification DROPPED per design lock
//      2026-05-13 — deferred to Phase 2)
//   3. Send via Resend with Idempotency-Key: 'transcript:<session_id>'
//   4. On 2xx: status='sent', resend_id, sent_at
//      On 4xx/5xx: attempts++; status='failed' if attempts ≥ 5 else 'retry'
//   5. Errors-section in email body (replaces the [NEG] sentiment prefix
//      with an [ERR] prefix when scheduler_audit_log captured any errors)
//
// Chunk 8 changes (2026-05-13):
//   - DROP sentiment classification (gemini-3.1-flash-lite call removed)
//   - ADD errors section sourced from scheduler_audit_log
//   - ADD customer_notes_text + customer_question rendering (Steps 10.2/10.3)

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  buildTranscriptHtml,
  buildTranscriptSubject,
  fmtDateTime,
  partsToText,
  type TranscriptViewModel,
} from "../_shared/transcript-html.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SERVICE_TEAM_EMAIL =
  Deno.env.get("SERVICE_TEAM_EMAIL") ?? "service@jeffsautomotive.com";
const FROM_EMAIL =
  Deno.env.get("TRANSCRIPT_FROM_EMAIL") ??
  "Jeff's Automotive Scheduler <service@jeffsautomotive.com>";
// Phase 2 candidate — sentiment classification deferred per design lock 2026-05-13.
// Kept commented for reference when we re-enable it.
// const SENTIMENT_MODEL = Deno.env.get("TRANSCRIPT_SENTIMENT_MODEL") ?? "google/gemini-3.1-flash-lite";

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Errors from scheduler_audit_log ─────────────────────────────────────────

interface SessionError {
  occurred_at: string;
  step: string;
  event_type: string;
  error_message: string | null;
  event_detail: Record<string, unknown> | null;
}

/**
 * Pull error events for the session out of scheduler_audit_log. Filters to
 * the event types we want to surface to advisors:
 *   - tool_failed       — a scheduler tool threw after retry
 *   - tekmetric_error   — Tekmetric returned 4xx/5xx
 *   - escalation_triggered — chat agent triggered an escalation
 *
 * Per Chris's directive 2026-05-13: "log any errors and send it with the
 * appointment email to service advisors."
 */
async function loadSessionErrors(
  sb: SupabaseClient,
  sessionId: string,
): Promise<SessionError[]> {
  const { data, error } = await sb
    .from("scheduler_audit_log")
    .select("occurred_at, step, event_type, error_message, event_detail")
    .eq("session_id", sessionId)
    .in("event_type", ["tool_failed", "tekmetric_error", "escalation_triggered"])
    .order("occurred_at", { ascending: true });
  if (error) {
    // Best-effort — log + continue. Errors-section will simply be omitted.
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "scheduler_audit_log_errors_query_failed",
        session_id: sessionId,
        detail: error.message,
      }),
    );
    return [];
  }
  // Rows are typed as `any[]` against the generic SupabaseClient (no schema
  // typegen wired up for this function). Cast through unknown for safety.
  const rows = (data ?? []) as Array<{
    occurred_at: string;
    step: string;
    event_type: string;
    error_message: string | null;
    event_detail: Record<string, unknown> | null;
  }>;
  return rows.map((r) => ({
    occurred_at: r.occurred_at,
    step: r.step,
    event_type: r.event_type,
    error_message: r.error_message ?? null,
    event_detail: r.event_detail ?? null,
  }));
}

// ─── Resend send ─────────────────────────────────────────────────────────────

interface ResendSendResult {
  ok: boolean;
  status: number;
  resend_id?: string;
  error?: string;
}

async function sendViaResend(
  view: TranscriptViewModel,
  html: string,
  subject: string,
): Promise<ResendSendResult> {
  if (!RESEND_API_KEY) {
    return { ok: false, status: 0, error: "RESEND_API_KEY not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `transcript:${view.session_id}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [SERVICE_TEAM_EMAIL],
        subject,
        html,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    let resend_id: string | undefined;
    try {
      const json = JSON.parse(text);
      if (typeof json.id === "string") resend_id = json.id;
    } catch {
      // 200 with non-JSON body — still treat as success
    }
    return { ok: true, status: res.status, resend_id };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Tekmetric customer-name lookup (best-effort; fall back to phone) ────────

async function getCustomerLabel(
  customerId: number | null,
  phoneE164: string | null,
): Promise<string> {
  if (!customerId) {
    return phoneE164 ? `Customer (${phoneE164})` : "Customer";
  }
  // Phase 1: cached customer name lives in conversation parts. We don't keep
  // a separate customers cache yet. So fall back to phone for the email
  // header and let the ops team see name from the conversation body.
  return phoneE164 ? `Customer (${phoneE164})` : `Customer #${customerId}`;
}

// ─── Pricing-discussed extractor ─────────────────────────────────────────────

async function extractPricingDiscussed(
  messages: Array<{ parts: unknown }>,
): Promise<TranscriptViewModel["pricing_discussed"]> {
  // Look for tool-call results from `lookup_testing_service_pricing`. The v5
  // UIMessage parts have entries like { type: 'tool-lookup_testing_service_pricing',
  // output: { services: [...] } }.
  const seen = new Set<string>();
  const results: NonNullable<TranscriptViewModel["pricing_discussed"]> = [];
  for (const m of messages) {
    if (!Array.isArray(m.parts)) continue;
    for (const p of m.parts) {
      if (typeof p !== "object" || p === null) continue;
      const part = p as {
        type?: string;
        output?: { services?: Array<Record<string, unknown>> };
      };
      if (part.type !== "tool-lookup_testing_service_pricing") continue;
      const services = part.output?.services ?? [];
      for (const s of services) {
        const key = String(s.service_key ?? s.display_name ?? "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push({
          display_name: String(s.display_name ?? key),
          starting_price_cents: Number(s.starting_price_cents ?? 0),
          notes: typeof s.notes === "string" ? s.notes : null,
        });
      }
    }
  }
  return results;
}

// ─── Structured activity helpers (2026-05-18 redesign) ──────────────────────
//
// The transcript email's primary section is now a structured "Customer
// activity" block summarizing what the customer chose — NOT a raw replay
// of every chat bubble. The helpers below collect service-keys + question
// IDs from the session JSONB columns and load display-name lookups in one
// IN-clause query each.
//
// Reference: Chris's 2026-05-18 directive ("It should have everything the
// customer chooses … If they verify their personal information it should
// just say customer verified their info, or customer added a vehicle.").

function collectStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v : null))
    .filter((v): v is string => v !== null);
}

function collectRecommendedTestingKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const k = (entry as Record<string, unknown>).service_key;
      if (typeof k === "string") keys.push(k);
    }
  }
  return keys;
}

function collectClarificationQuestionIds(raw: unknown): number[] {
  if (!raw || typeof raw !== "object") return [];
  const ids: number[] = [];
  for (const key of Object.keys(raw)) {
    const n = Number(key);
    if (Number.isFinite(n)) ids.push(n);
  }
  return ids;
}

interface RoutineLookup {
  display_name: string;
  starting_price_cents: number | null;
}
async function loadRoutineServiceLookup(
  sb: SupabaseClient,
  shopId: number,
  keys: string[],
): Promise<Map<string, RoutineLookup>> {
  const out = new Map<string, RoutineLookup>();
  const unique = Array.from(new Set(keys.filter((k) => k.length > 0)));
  if (unique.length === 0) return out;
  const { data, error } = await sb
    .from("routine_services")
    .select("service_key, display_name, starting_price_cents")
    .eq("shop_id", shopId)
    .in("service_key", unique);
  if (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "routine_service_lookup_failed",
        detail: error.message,
      }),
    );
    return out;
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = row.service_key as string;
    out.set(key, {
      display_name: (row.display_name as string) ?? key,
      starting_price_cents: (row.starting_price_cents as number) ?? null,
    });
  }
  return out;
}

interface TestingLookup {
  display_name: string;
  starting_price_cents: number | null;
  notes: string | null;
}
async function loadTestingServiceLookup(
  sb: SupabaseClient,
  shopId: number,
  keys: string[],
): Promise<Map<string, TestingLookup>> {
  const out = new Map<string, TestingLookup>();
  const unique = Array.from(new Set(keys.filter((k) => k.length > 0)));
  if (unique.length === 0) return out;
  const { data, error } = await sb
    .from("testing_services")
    .select("service_key, display_name, starting_price_cents, notes")
    .eq("shop_id", shopId)
    .in("service_key", unique);
  if (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "testing_service_lookup_failed",
        detail: error.message,
      }),
    );
    return out;
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = row.service_key as string;
    out.set(key, {
      display_name: (row.display_name as string) ?? key,
      starting_price_cents: (row.starting_price_cents as number) ?? null,
      notes: (row.notes as string) ?? null,
    });
  }
  return out;
}

interface QuestionLookup {
  question_text: string;
  options: Array<{ label: string; value: string }>;
}
async function loadConcernQuestionLookup(
  sb: SupabaseClient,
  shopId: number,
  ids: number[],
): Promise<Map<number, QuestionLookup>> {
  const out = new Map<number, QuestionLookup>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, question_text, options")
    .eq("shop_id", shopId)
    .in("id", unique);
  if (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "concern_question_lookup_failed",
        detail: error.message,
      }),
    );
    return out;
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const rawOptions = row.options;
    const options: Array<{ label: string; value: string }> = Array.isArray(
      rawOptions,
    )
      ? (rawOptions
          .map((opt) => {
            if (!opt || typeof opt !== "object") return null;
            const o = opt as Record<string, unknown>;
            const label = typeof o.label === "string" ? o.label : null;
            const value = typeof o.value === "string" ? o.value : null;
            if (!label || !value) return null;
            return { label, value };
          })
          .filter((x): x is { label: string; value: string } => x !== null))
      : [];
    out.set(row.id as number, {
      question_text: (row.question_text as string) ?? "",
      options,
    });
  }
  return out;
}

interface ActivityArgs {
  session: Record<string, unknown>;
  appointmentRow: {
    start_time: string | null;
    end_time: string | null;
    appointment_type: string | null;
    title: string | null;
    description: string | null;
  } | null;
  routineLookup: Map<string, RoutineLookup>;
  testingLookup: Map<string, TestingLookup>;
  questionLookup: Map<number, QuestionLookup>;
}

/**
 * Render the session's structured fields into the ordered list of
 * customer-activity events that the email surfaces. Each event has a
 * short label (e.g., "Verified identity") + an optional detail line.
 * Skips events with no data so a half-complete session doesn't render
 * empty rows.
 */
function buildCustomerActivity(
  args: ActivityArgs,
): NonNullable<TranscriptViewModel["activity"]> {
  const { session, appointmentRow, routineLookup, testingLookup, questionLookup } = args;
  const events: NonNullable<TranscriptViewModel["activity"]> = [];

  // 1. Identity — verified vs. provided.
  const verifiedFirst = (session.verified_first_name as string | null) ?? null;
  const verifiedLast = (session.verified_last_name as string | null) ?? null;
  const enteredFirst = (session.entered_first_name as string | null) ?? null;
  const enteredLast = (session.entered_last_name as string | null) ?? null;
  const phone = (session.phone_e164 as string | null) ?? null;
  if (verifiedFirst || verifiedLast) {
    const name = [verifiedFirst, verifiedLast].filter(Boolean).join(" ").trim();
    events.push({
      kind: "identity_verified",
      label: "Verified personal info",
      detail: `${name}${phone ? ` · ${phone}` : ""}`,
    });
  } else if (enteredFirst || enteredLast) {
    const name = [enteredFirst, enteredLast].filter(Boolean).join(" ").trim();
    events.push({
      kind: "identity_provided",
      label: "Provided name as a new customer",
      detail: `${name}${phone ? ` · ${phone}` : ""}`,
    });
  } else if (phone) {
    events.push({
      kind: "identity_provided",
      label: "Provided phone number",
      detail: phone,
    });
  }

  // 2. Vehicle — added new vs. selected existing.
  const nvi = session.new_vehicle_info as Record<string, unknown> | null;
  if (nvi && typeof nvi === "object" && (nvi.make || nvi.model || nvi.year)) {
    const parts = [
      nvi.year ? String(nvi.year) : "",
      nvi.make ? String(nvi.make).trim() : "",
      nvi.model ? String(nvi.model).trim() : "",
      nvi.sub_model ? String(nvi.sub_model).trim() : "",
    ].filter(Boolean);
    const plate =
      typeof nvi.license_plate === "string" && nvi.license_plate.length > 0
        ? ` · plate ${nvi.license_plate}`
        : "";
    events.push({
      kind: "vehicle_added",
      label: "Added a new vehicle",
      detail: `${parts.join(" ")}${plate}`,
    });
  } else if (session.vehicle_id) {
    events.push({
      kind: "vehicle_selected",
      label: "Selected an existing vehicle",
      detail: `Tekmetric #${session.vehicle_id}`,
    });
  }

  // 3. Routine services chosen at Step 6.
  const routineKeys = collectStringArray(session.selected_simple_services);
  if (routineKeys.length > 0) {
    events.push({
      kind: "routine_services_picked",
      label: "Picked routine services",
      detail: routineKeys
        .map((k) => routineLookup.get(k)?.display_name ?? k)
        .join(" · "),
    });
  }

  // 4. Free-text concern descriptions (Step 6.5 explanation_required_items).
  const items = session.explanation_required_items as
    | Array<Record<string, unknown>>
    | null;
  if (Array.isArray(items)) {
    for (const item of items) {
      const display = (item.display_name as string) ?? (item.service_key as string) ?? "Concern";
      const text = (item.explanation_text as string) ?? "";
      if (!text) continue;
      events.push({
        kind: "concern_described",
        label: `Described concern (${display})`,
        detail: `"${text}"`,
      });
    }
  }

  // 5. Clarification Q&A (Step 7.4) — each answered question rendered as
  //    question text + chosen option label. Stored value is either a
  //    string (single-select or "skipped") or string[] (multi-select,
  //    added 2026-05-18 with CAT-2 catalog rebuild).
  const answered = session.clarification_questions_answered as
    | Record<string, string | string[]>
    | null;
  if (answered && typeof answered === "object") {
    const ids = Object.keys(answered).sort((a, b) => Number(a) - Number(b));
    const qaLines: string[] = [];
    for (const idStr of ids) {
      const qid = Number(idStr);
      const value = answered[idStr];
      const lookup = questionLookup.get(qid);
      // Helper: map an option value to its label (or fallback to value).
      const labelFor = (v: string): string =>
        lookup?.options.find((o) => o.value === v)?.label ?? v;

      let answerLabel: string;
      if (Array.isArray(value)) {
        // Multi-select: join chosen labels with " · ".
        answerLabel = value.length === 0
          ? "(no answer)"
          : value.map(labelFor).join(" · ");
      } else if (value === "skipped") {
        answerLabel = "(skipped)";
      } else {
        answerLabel = labelFor(value);
      }
      if (!lookup) {
        qaLines.push(`Q#${idStr}: ${answerLabel}`);
        continue;
      }
      qaLines.push(`• ${lookup.question_text} — ${answerLabel}`);
    }
    if (qaLines.length > 0) {
      events.push({
        kind: "clarification_answered",
        label: `Answered ${qaLines.length} clarification question${qaLines.length === 1 ? "" : "s"}`,
        detail: qaLines.join("\n"),
      });
    }
  }

  // 6. Testing services approved / declined.
  const approvedTesting = collectStringArray(session.approved_testing_services);
  if (approvedTesting.length > 0) {
    events.push({
      kind: "testing_approved",
      label: "Approved testing services",
      detail: approvedTesting
        .map((k) => testingLookup.get(k)?.display_name ?? k)
        .join(" · "),
    });
  }
  const declinedTesting = collectStringArray(session.declined_testing_services);
  if (declinedTesting.length > 0) {
    events.push({
      kind: "testing_declined",
      label: "Declined testing services",
      detail: declinedTesting
        .map((k) => testingLookup.get(k)?.display_name ?? k)
        .join(" · "),
    });
  }

  // 7. Round-2 routine adds (after the testing approval card).
  const round2 = collectStringArray(session.additional_routine_services_round2);
  if (round2.length > 0) {
    events.push({
      kind: "routine_round2_added",
      label: "Added extra routine services",
      detail: round2
        .map((k) => routineLookup.get(k)?.display_name ?? k)
        .join(" · "),
    });
  }

  // 8. Appointment selection — type + date/time.
  const apptType =
    (appointmentRow?.appointment_type as string | null) ??
    ((session.appointment_type as string | null) ?? null);
  if (apptType || appointmentRow?.start_time) {
    const typeDisplay = apptType === "waiter" ? "Wait" : apptType === "dropoff" ? "Drop-off" : "Appointment";
    const when = appointmentRow?.start_time
      ? fmtDateTime(appointmentRow.start_time)
      : ((session.appointment_date as string | null) ?? "TBD");
    events.push({
      kind: "appointment_chosen",
      label: `Chose ${typeDisplay.toLowerCase()} appointment`,
      detail: when,
    });
  }

  return events;
}

// ─── Main per-row dispatch ───────────────────────────────────────────────────

interface TranscriptRow {
  id: string;
  session_id: string;
  status: string;
  attempts: number;
}

async function dispatchOne(transcript: TranscriptRow): Promise<{
  id: string;
  result: "sent" | "retry" | "failed";
  detail?: string;
}> {
  const { id, session_id, attempts } = transcript;

  // Load session — selects every field we need to render the structured
  // "Customer activity" block (2026-05-18 redesign per Chris's directive:
  // transcript email should summarize what the customer chose, not stream
  // raw bubble text). Sentiment column kept selected for back-compat though
  // sentiment classification is deferred to Phase 2.
  //
  // NOTE: select uses a single string literal (not an array .join()) so
  // supabase-js type inference can resolve the row shape. With .join() the
  // result types collapse to GenericStringError.
  const { data: sessionRaw, error: sessionErr } = await sb
    .from("customer_chat_sessions")
    .select(
      "id, shop_id, channel, phone_e164, customer_id, vehicle_id, status, outcome, sentiment, appointment_id, started_at, ended_at, customer_notes_text, customer_question, verified_first_name, verified_last_name, entered_first_name, entered_last_name, is_returning_customer, otp_verified_at, new_vehicle_info, selected_simple_services, explanation_required_items, clarification_questions_answered, recommended_testing_services, approved_testing_services, declined_testing_services, additional_routine_services_round2, appointment_type, appointment_date, appointment_time",
    )
    .eq("id", session_id)
    .maybeSingle();
  if (sessionErr || !sessionRaw) {
    return {
      id,
      result: "failed",
      detail: `session_not_found: ${sessionErr?.message ?? session_id}`,
    };
  }
  // Cast to a loose record so downstream field accesses don't fight the
  // narrowed/un-inferred type from supabase-js. The cast is safe because
  // every consumer site applies its own narrow cast (e.g. `as string | null`).
  const session = sessionRaw as unknown as Record<string, unknown>;

  // Load messages
  const { data: messageRows, error: msgErr } = await sb
    .from("customer_chat_messages")
    .select("id, role, parts, created_at")
    .eq("session_id", session_id)
    .order("created_at", { ascending: true });
  if (msgErr) {
    return {
      id,
      result: "retry",
      detail: `messages_load_failed: ${msgErr.message}`,
    };
  }

  // Build view rows (kept as low-emphasis "raw conversation log" at the
  // bottom of the email — structured Customer activity block above is now
  // the primary read).
  const messageViews = (messageRows ?? []).map((r) => {
    const { text, tools } = partsToText(r.parts);
    return {
      role: r.role as "user" | "assistant" | "system" | "tool",
      text,
      tools,
      id: r.id as string,
      created_at: r.created_at as string,
    };
  });

  // Sentiment classification DROPPED per design lock 2026-05-13 (Chunk 8).
  // Phase 2 will re-enable via classifySentiment(). For now we pass through
  // whatever is stored (typically null) so the schema field remains compatible.
  const sentiment: "positive" | "neutral" | "negative" | null =
    (session.sentiment as "positive" | "neutral" | "negative" | null) ?? null;

  // Load appointment row (start_time + type + description + title) if a
  // booking landed. Used by the summary header.
  let appointmentRow: {
    start_time: string | null;
    end_time: string | null;
    appointment_type: string | null;
    title: string | null;
    description: string | null;
  } | null = null;
  if (session.appointment_id) {
    const { data: appt } = await sb
      .from("appointments")
      .select("start_time, end_time, appointment_type, title, description")
      .eq("shop_id", session.shop_id ?? 7476)
      .eq("tekmetric_appointment_id", session.appointment_id)
      .maybeSingle();
    if (appt) {
      appointmentRow = {
        start_time: (appt.start_time as string) ?? null,
        end_time: (appt.end_time as string) ?? null,
        appointment_type: (appt.appointment_type as string) ?? null,
        title: (appt.title as string) ?? null,
        description: (appt.description as string) ?? null,
      };
    }
  }

  // Pricing-discussed
  const pricingDiscussed = await extractPricingDiscussed(messageRows ?? []);

  // Customer label — prefer verified name; otherwise entered name; otherwise phone.
  const verifiedFirst = (session.verified_first_name as string | null) ?? null;
  const verifiedLast = (session.verified_last_name as string | null) ?? null;
  const enteredFirst = (session.entered_first_name as string | null) ?? null;
  const enteredLast = (session.entered_last_name as string | null) ?? null;
  let customerName: string;
  if (verifiedFirst || verifiedLast) {
    customerName = [verifiedFirst, verifiedLast].filter(Boolean).join(" ").trim();
  } else if (enteredFirst || enteredLast) {
    customerName = [enteredFirst, enteredLast].filter(Boolean).join(" ").trim();
  } else {
    customerName = await getCustomerLabel(
      session.customer_id as number | null,
      session.phone_e164 as string | null,
    );
  }

  // Errors logged during the session — surfaced in the email per Chris's
  // 2026-05-13 directive. Best-effort; failure to load returns [].
  const sessionErrors = await loadSessionErrors(sb, session_id);

  // Resolve service-key + question-id lookups for the structured activity
  // block. Each query is a single batch — IN-clause keeps it cheap.
  const routineKeys = collectStringArray(session.selected_simple_services).concat(
    collectStringArray(session.additional_routine_services_round2),
  );
  const testingKeys = collectStringArray(session.approved_testing_services).concat(
    collectStringArray(session.declined_testing_services),
    collectRecommendedTestingKeys(session.recommended_testing_services),
  );
  const questionIds = collectClarificationQuestionIds(
    session.clarification_questions_answered,
  );
  const shopIdForLookups = (session.shop_id as number) ?? 7476;

  const [routineLookup, testingLookup, questionLookup] = await Promise.all([
    loadRoutineServiceLookup(sb, shopIdForLookups, routineKeys),
    loadTestingServiceLookup(sb, shopIdForLookups, testingKeys),
    loadConcernQuestionLookup(sb, shopIdForLookups, questionIds),
  ]);

  // Build the structured "Customer activity" view from the session row.
  // Cast through unknown — Supabase-js doesn't have typegen wired for this
  // function so `session` is `any`; the helper consumes a Record shape.
  const activity = buildCustomerActivity({
    session: session as unknown as Record<string, unknown>,
    appointmentRow,
    routineLookup,
    testingLookup,
    questionLookup,
  });

  // Tekmetric admin URL for the appointment — same pattern as
  // notifyStaffOfNewAppointment in scheduler-app/.../staff-notification.ts.
  const appointmentLink = session.appointment_id
    ? `https://shop.tekmetric.com/admin/shop/${shopIdForLookups}/appointments/${session.appointment_id}`
    : null;

  const view: TranscriptViewModel = {
    session_id,
    channel: session.channel as "web" | "sms",
    customer_name: customerName,
    customer_phone_e164: session.phone_e164 as string | null,
    outcome:
      (session.outcome as TranscriptViewModel["outcome"]) ?? "unknown",
    sentiment,
    appointment_id: session.appointment_id as number | null,
    appointment_starts_at: appointmentRow?.start_time ?? null,
    appointment_type:
      (appointmentRow?.appointment_type as "waiter" | "dropoff" | null) ??
      ((session.appointment_type as "waiter" | "dropoff" | null) ?? null),
    appointment_link: appointmentLink,
    appointment_title: appointmentRow?.title ?? null,
    appointment_description: appointmentRow?.description ?? null,
    pricing_discussed: pricingDiscussed,
    errors: sessionErrors,
    customer_notes_text: (session.customer_notes_text ?? null) as string | null,
    customer_question: (session.customer_question ?? null) as string | null,
    messages: messageViews,
    activity,
    started_at: session.started_at as string,
    ended_at: (session.ended_at as string) ?? new Date().toISOString(),
  };

  const html = buildTranscriptHtml(view);
  const subject = buildTranscriptSubject(view);

  // Sentry-equivalent: log a warning entry to console (Supabase Log Drain
  // routes this to Sentry per observability.md decision D4).
  // Chunk 8 (2026-05-13): pivoted from sentiment-driven warning to
  // errors-driven warning — sessions with logged tool_failed /
  // tekmetric_error / escalation_triggered events get the warning ping.
  if (sessionErrors.length > 0) {
    console.log(
      JSON.stringify({
        level: "warning",
        msg: "scheduler_session_with_errors",
        session_id,
        outcome: view.outcome,
        error_count: sessionErrors.length,
        error_types: Array.from(new Set(sessionErrors.map((e) => e.event_type))),
      }),
    );
  }

  const send = await sendViaResend(view, html, subject);

  if (send.ok) {
    await sb
      .from("transcript_emails")
      .update({
        status: "sent",
        resend_id: send.resend_id ?? null,
        attempts: attempts + 1,
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", id);
    return { id, result: "sent", detail: send.resend_id };
  }

  // Treat 409 (Idempotency-Key replay) as success
  if (send.status === 409) {
    await sb
      .from("transcript_emails")
      .update({
        status: "sent",
        attempts: attempts + 1,
        sent_at: new Date().toISOString(),
        last_error: "409 idempotency replay (treated as sent)",
      })
      .eq("id", id);
    return { id, result: "sent", detail: "409_idempotency_replay" };
  }

  const newAttempts = attempts + 1;
  const newStatus = newAttempts >= 5 ? "failed" : "retry";
  await sb
    .from("transcript_emails")
    .update({
      status: newStatus,
      attempts: newAttempts,
      last_error: send.error ?? `http_${send.status}`,
    })
    .eq("id", id);
  return { id, result: newStatus, detail: send.error };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const auth = checkSchedulerBearer(req, "transcript-dispatcher");
  if (!auth.ok) {
    await logEdgeError(sb, {
      surface: "transcript-dispatcher/auth",
      origin_id: "transcript-dispatcher",
      level: "warning",
      error_code: `auth_${auth.reason ?? "unknown"}`,
      message: auth.reason ?? null,
      context: auth.diagnostic ? { diagnostic: auth.diagnostic } : null,
    });
    return unauthorizedResponse(auth);
  }

  // Optional payload for single-transcript dispatch
  let targetId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = (await req.json().catch(() => null)) as
        | { transcript_id?: string }
        | null;
      if (body && typeof body.transcript_id === "string") {
        targetId = body.transcript_id;
      }
    } catch {
      // empty body is fine — backstop mode
    }
  }

  // Pull the work list
  let q = sb
    .from("transcript_emails")
    .select("id, session_id, status, attempts")
    .in("status", ["pending", "retry"]);
  if (targetId) {
    q = q.eq("id", targetId);
  } else {
    // Backstop mode: only pick rows older than 30s (give immediate path a head-start)
    q = q.lte(
      "created_at",
      new Date(Date.now() - 30_000).toISOString(),
    );
  }
  const { data: rows, error } = await q.limit(25);
  if (error) {
    return jsonResponse(
      { ok: false, error: `transcript_emails query: ${error.message}` },
      500,
    );
  }
  if (!rows || rows.length === 0) {
    return jsonResponse({ ok: true, processed: 0, results: [] });
  }

  const results: Array<{ id: string; result: string; detail?: string }> = [];
  for (const row of rows as TranscriptRow[]) {
    try {
      const r = await dispatchOne(row);
      results.push(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          msg: "transcript_dispatch_unhandled",
          transcript_id: row.id,
          detail: msg,
        }),
      );
      // Hard failure during dispatch — bump attempts but stay in retry until 5
      const newAttempts = row.attempts + 1;
      await sb
        .from("transcript_emails")
        .update({
          status: newAttempts >= 5 ? "failed" : "retry",
          attempts: newAttempts,
          last_error: msg,
        })
        .eq("id", row.id);
      results.push({ id: row.id, result: "retry", detail: msg });
    }
  }

  return jsonResponse({ ok: true, processed: results.length, results });
});
