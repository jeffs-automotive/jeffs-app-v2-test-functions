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
  partsToText,
  type TranscriptViewModel,
} from "../_shared/transcript-html.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";

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

  // Load session (sentiment column kept selected for backwards-compat but the
  // Chunk 8 dispatcher does NOT classify or render sentiment — Phase 2).
  const { data: session, error: sessionErr } = await sb
    .from("customer_chat_sessions")
    .select(
      "id, channel, phone_e164, customer_id, vehicle_id, status, outcome, sentiment, appointment_id, started_at, ended_at, customer_notes_text, customer_question",
    )
    .eq("id", session_id)
    .maybeSingle();
  if (sessionErr || !session) {
    return {
      id,
      result: "failed",
      detail: `session_not_found: ${sessionErr?.message ?? session_id}`,
    };
  }

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

  // Build view rows
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

  // Get appointment timing if booked
  let appointmentStartsAt: string | null = null;
  if (session.appointment_id) {
    const { data: appt } = await sb
      .from("appointments")
      .select("start_time")
      .eq("shop_id", 7476)
      .eq("tekmetric_appointment_id", session.appointment_id)
      .maybeSingle();
    appointmentStartsAt = (appt?.start_time as string) ?? null;
  }

  // Pricing-discussed
  const pricingDiscussed = await extractPricingDiscussed(messageRows ?? []);

  // Customer label
  const customerName = await getCustomerLabel(
    session.customer_id as number | null,
    session.phone_e164 as string | null,
  );

  // Errors logged during the session — surfaced in the email per Chris's
  // 2026-05-13 directive. Best-effort; failure to load returns [].
  const sessionErrors = await loadSessionErrors(sb, session_id);

  const view: TranscriptViewModel = {
    session_id,
    channel: session.channel as "web" | "sms",
    customer_name: customerName,
    customer_phone_e164: session.phone_e164 as string | null,
    outcome:
      (session.outcome as TranscriptViewModel["outcome"]) ?? "unknown",
    sentiment,
    appointment_id: session.appointment_id as number | null,
    appointment_starts_at: appointmentStartsAt,
    pricing_discussed: pricingDiscussed,
    errors: sessionErrors,
    customer_notes_text: (session.customer_notes_text ?? null) as string | null,
    customer_question: (session.customer_question ?? null) as string | null,
    messages: messageViews,
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
