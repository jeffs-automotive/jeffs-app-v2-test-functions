// sentry-edge.ts — Sentry init + scope wrapper for Supabase Edge Functions.
//
// OBS-4 (2026-05-19): Supabase Log Drain → Sentry is the canonical
// observability rule per .claude/rules/observability.md D4, but Log Drains
// require Supabase Team plan ($599/mo+). Org is on Pro. This module is the
// fallback: each edge function imports it once + wraps its handler in
// `withSentryScope(req, fn)` to get per-request isolation + captureException
// coverage without needing the Log Drain feature.
//
// DSN comes from EDGE_FN_SENTRY_DSN secret (points at the
// jeffs-app-v2-supabase Sentry project — the dedicated edge-fn destination).
// Note: Supabase env vars cannot start with SUPABASE_ — that's why this is
// EDGE_FN_SENTRY_DSN rather than SUPABASE_SENTRY_DSN.
// If the secret is unset, Sentry no-ops gracefully — useful for local dev
// or when an edge function is invoked from a test harness that doesn't have
// the secret.
//
// OBS-6b: Sentry-side Data Scrubbing rules should ALSO be configured at the
// project level for defense-in-depth — beforeSend below catches what passes
// through this module, but if @sentry/deno ever auto-captures something
// without going through scrubEvent, the project-level scrubbing acts as a
// safety net. Configure via Sentry Settings → Security & Privacy → Data
// Scrubber.
//
// Per-request scope is REQUIRED in Deno edge runtime — the @sentry/deno
// SDK does NOT automatically isolate breadcrumbs / context across concurrent
// requests in the same isolate (per Sentry docs). Without withScope, an
// error in request A could surface tagged with context from request B.
//
// Usage:
//
//   import * as Sentry from "npm:@sentry/deno";
//   import { withSentryScope } from "../_shared/sentry-edge.ts";
//
//   Deno.serve((req) => withSentryScope(req, "appointments-sync", async () => {
//     // handler body — any throw becomes Sentry.captureException
//     // automatically; the scope is tagged with surface + url + method
//     return new Response(JSON.stringify({ok: true}), { status: 200 });
//   }));
//
// Manual capture inside the handler (when caught + returning a typed error):
//
//   try { ... } catch (e) {
//     Sentry.captureException(e, { tags: { tekmetric_op: "create_customer" }});
//     return jsonResponse({ ok: false, error: "tekmetric_5xx" }, 502);
//   }

import * as Sentry from "npm:@sentry/deno";

const DSN = Deno.env.get("EDGE_FN_SENTRY_DSN");

let initialized = false;
function initOnce(): void {
  if (initialized) return;
  if (!DSN) {
    initialized = true; // mark to avoid re-checking the env every request
    return;
  }
  Sentry.init({
    dsn: DSN,
    // Lower than scheduler-app's 10% — edge fns fire on cron + every webhook,
    // so 5% keeps cost predictable while still surfacing patterns.
    tracesSampleRate: 0.05,
    // We scrub PII below; sendDefaultPii adds request headers + IP which
    // help correlate edge-fn events to scheduler-app events.
    sendDefaultPii: true,
    // PLAN-02 Phase 1 — REQUIRED per Sentry+Supabase official docs
    // (https://supabase.com/docs/guides/functions/examples/sentry-monitoring).
    // The Sentry Deno SDK does NOT auto-instrument Deno.serve. Default
    // integrations install global handlers/state that LEAK across concurrent
    // requests in the same warm isolate. Disabling them + relying on
    // withIsolationScope + flush below is the documented safe pattern.
    defaultIntegrations: false,
    // PLAN-02 Phase 2B (I-OBS-8) — enable Sentry.logger.* (defaults to
    // false per Sentry docs). Edge functions don't currently call
    // logger.* but enabling here keeps parity with scheduler-app and
    // gives future telemetry calls a working substrate.
    enableLogs: true,
    initialScope: {
      tags: {
        surface: "supabase-edge",
        shop_id: "7476",
      },
    },
    // Mirror the scheduler-app server-side PII scrubber. Same blocklist
    // + same regexes. See scheduler-app/sentry.server.config.ts for the
    // canonical version + rationale.
    beforeSend(event) {
      try {
        return scrubEvent(event);
      } catch {
        return null;
      }
    },
  });
  initialized = true;
}

/**
 * Per-request flush deadline (ms). Sentry.flush returns as soon as the queue
 * is empty OR this timeout hits — usually <50ms for requests with no events.
 * Cap kept low (1000ms) so we don't add measurable latency to webhooks even
 * if the Sentry ingest endpoint stalls. Research per
 * .tmp/agent-output/research-sentry-observability + Supabase docs.
 */
const FLUSH_TIMEOUT_MS = 1000;

export async function withSentryScope<T>(
  req: Request,
  surface: string,
  handler: () => Promise<T>,
): Promise<T> {
  initOnce();
  if (!DSN) {
    // Sentry not configured — just run the handler.
    return await handler();
  }
  // PLAN-02 Phase 1 — withIsolationScope (not just withScope) per Sentry 10.x.
  // An isolation scope forks the ENTIRE scope chain (breadcrumbs, contexts,
  // tags, user, spans) for this request — concurrent requests in the same
  // warm isolate cannot observe or mutate each other's scope. withScope on
  // its own only forks the current scope, leaving the isolation scope
  // shared. See https://docs.sentry.io/platforms/javascript/configuration/scopes/
  return await Sentry.withIsolationScope(async (scope) => {
    scope.setTag("surface", surface);
    scope.setTag("method", req.method);
    try {
      const url = new URL(req.url);
      scope.setTag("path", url.pathname);
    } catch {
      // Ignore — URL parse can throw on malformed requests.
    }
    try {
      const result = await handler();
      // Flush BEFORE returning. Without this, events queued during the
      // request can be dropped when the Deno isolate shuts down before
      // the network send completes. Critical for cron crons + webhook
      // fire-and-forget paths.
      await Sentry.flush(FLUSH_TIMEOUT_MS);
      return result;
    } catch (e) {
      Sentry.captureException(e);
      // Flush in the error path too — error events are the events we
      // care MOST about not losing.
      await Sentry.flush(FLUSH_TIMEOUT_MS);
      throw e; // re-throw so the request still 5xxs as before
    }
  });
}

// Export Sentry for ad-hoc captureException / captureMessage / setTag calls
// from inside an already-scoped handler (e.g., inside logEdgeError).
export { Sentry };

// ─── PII scrubber (mirrors scheduler-app/sentry.server.config.ts) ──────

const PII_KEY_BLOCKLIST = new Set([
  "email",
  "emails",
  "first_name",
  "last_name",
  "name",
  "full_name",
  "customer_name",
  "customername",
  "primary_email",
  "primary_email_for_description",
  "entered_first_name",
  "entered_last_name",
  "verified_first_name",
  "verified_last_name",
  "edited_emails",
  "edited_phones",
  "phone",
  "phones",
  "phone_e164",
  "phone_number",
  "address",
  "address1",
  "address2",
  "street_address",
  "streetaddress",
  "city",
  "state",
  "zip",
  "postal_code",
  "tekmetric_error_text",
]);

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_E164_RE = /\+1\d{6}(\d{4})/g;
const OTP_NEAR_KEY_RE = /("(?:code|otp_code|otp)")\s*:\s*"\d{6}"/gi;

function scrubString(s: string): string {
  if (typeof s !== "string" || s.length === 0) return s;
  return s
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_E164_RE, "+1******$1")
    .replace(OTP_NEAR_KEY_RE, '$1:"[REDACTED]"');
}

function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEY_BLOCKLIST.has(k.toLowerCase())) {
        out[k] = "[redacted]";
      } else {
        out[k] = scrubValue(v);
      }
    }
    return out;
  }
  return value;
}

// deno-lint-ignore no-explicit-any
function scrubEvent(event: any): any {
  if (event.user) {
    if ("email" in event.user) event.user.email = undefined;
    if ("username" in event.user) event.user.username = undefined;
    if ("name" in event.user) event.user.name = undefined;
  }
  if (typeof event.message === "string") {
    event.message = scrubString(event.message);
  }
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    }
  }
  if (event.contexts) event.contexts = scrubValue(event.contexts);
  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.data) b.data = scrubValue(b.data);
      if (typeof b.message === "string") b.message = scrubString(b.message);
    }
  }
  if (event.request) {
    if (event.request.data) event.request.data = scrubValue(event.request.data);
    if (event.request.headers) event.request.headers = scrubValue(event.request.headers);
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    }
  }
  return event;
}
