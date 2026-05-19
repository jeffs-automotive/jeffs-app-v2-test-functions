/**
 * Sentry server-side init (Node runtime).
 *
 * Auto-loaded by instrumentation.ts when NEXT_RUNTIME === 'nodejs'. Covers:
 *   - Server Actions (when wrapped with withServerActionInstrumentation)
 *   - Server Components (via onRequestError)
 *   - Route handlers (app/api/chat/route.ts auto-instrumented)
 *
 * DSN comes from SENTRY_DSN. NEXT_PUBLIC_SENTRY_DSN is the client equivalent
 * and lives in instrumentation-client.ts. If neither is set, Sentry no-ops
 * gracefully — useful for local dev when Sentry isn't wanted.
 *
 * beforeSend redacts PII per chat-design.md §15 (no phone/name in error
 * payloads — only phone_last_4 + hashed identifiers). Server Action payloads
 * pass through here on capture so we MUST scrub before send.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 100% in dev to debug everything; 10% in prod to keep tier 1 quota OK.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Adds request headers + IP. We're already PII-aware (beforeSend below);
  // this gives Sentry's auto-instrumentation enough context to link Server
  // Action invocations to client traces.
  sendDefaultPii: true,

  // Capture Vercel AI SDK telemetry as gen_ai.* spans. force: true is
  // MANDATORY on Vercel — the `ai` package is bundled (not externalized)
  // in Next.js production builds, which defeats the integration's
  // auto-detection. Per Sentry docs:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/vercelai/
  //
  // Each generateObject/generateText call must ALSO set
  // experimental_telemetry: { isEnabled: true, functionId, recordInputs:
  // false, recordOutputs: false } at the call site — both pieces are
  // required for spans to materialize. See src/lib/scheduler/wizard/llm/.
  integrations: [Sentry.vercelAIIntegration({ force: true })],

  // Project-default tags per .claude/rules/observability.md rule 13.
  // shop_id stays static (single shop in Phase 1); employee_id N/A
  // (customer-facing wizard); plan_tier N/A here.
  initialScope: {
    tags: {
      surface: "scheduler-app",
      shop_id: "7476", // Jeff's Automotive — single-tenant in Phase 1.
    },
  },

  /**
   * Scrub PII before sending to Sentry. Two layers:
   *
   * 1. Structural walk — visit event.user / event.contexts / event.extra /
   *    event.breadcrumbs[*].data / event.request and redact any key whose
   *    name matches PII_KEY_BLOCKLIST.
   * 2. String regex pass — apply to event.message, event.exception.values[]
   *    .value, and every leaf string visited in (1):
   *      - email-like patterns        → '[email]'
   *      - E.164 US/CA phones         → '+1******NNNN' (preserve last 4)
   *      - 6-digit OTP near otp/code  → '[REDACTED]'
   *
   * Fail-closed: if scrubbing throws, drop the event entirely. Per
   * observability rule, silent leak is worse than silent drop.
   *
   * Surfaces this defends (per OBS-6 audit 2026-05-19):
   *   - tekmetric_error_text echo in extra: (submit-new-customer-info /
   *     submit-customer-info-edit / submit-new-vehicle / submit-customer-notes)
   *   - Postgres constraint violation messages in error.value
   *   - staff-notification subject embedded in exception.value
   *   - submit-otp extra.response with verifyResult shape
   *   - future regression sites (e.g., addBreadcrumb with customer data)
   *
   * Does NOT defend the Supabase Log Drain → Sentry channel — that bypasses
   * beforeSend (drain uses HTTP ingestion). For that path see OBS-6b
   * (Sentry project-level Data Scrubbing rules) — currently moot since
   * Log Drains require Supabase Team plan (org is Pro).
   */
  beforeSend(event) {
    try {
      return scrubEvent(event);
    } catch {
      return null;
    }
  },
});

// ─── PII scrubber ──────────────────────────────────────────────────────

// Key names whose VALUES we wipe wholesale (case-insensitive match).
// Captures every name/email/phone-bearing field used across the wizard,
// the Tekmetric customer/vehicle/appointment shapes, and the edit flows.
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
  // Tekmetric error echoes — large enough surface to wipe wholesale rather
  // than regex-scrub. Triage rows still carry status code + chatId.
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
  // numbers, booleans, bigints, symbols — passthrough
  return value;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // event.user — drop email/name/username; preserve id only if non-PII (UUID
  // / employee_id shapes). For customer wizard there's no setUser today, but
  // sendDefaultPii could pull IP — leave that for Sentry-side IP scrubbing.
  if (event.user) {
    const u = event.user as Record<string, unknown>;
    if ("email" in u) u.email = undefined;
    if ("username" in u) u.username = undefined;
    if ("name" in u) u.name = undefined;
  }

  // event.message — string regex pass
  if (typeof event.message === "string") {
    event.message = scrubString(event.message);
  }

  // event.exception.values[].value — string regex pass per exception
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    }
  }

  // event.contexts — recursive walk with key-blocklist + string scrub
  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  }

  // event.extra — same
  if (event.extra) {
    event.extra = scrubValue(event.extra) as typeof event.extra;
  }

  // event.breadcrumbs[].data — same
  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.data) b.data = scrubValue(b.data) as typeof b.data;
      if (typeof b.message === "string") b.message = scrubString(b.message);
    }
  }

  // event.request.data + headers — Sentry's HTTP capture. We don't pass
  // formData to withServerActionInstrumentation so request.data should be
  // empty, but scrub defensively in case a future opt-in adds it.
  if (event.request) {
    if (event.request.data) {
      event.request.data = scrubValue(event.request.data) as typeof event.request.data;
    }
    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers) as typeof event.request.headers;
    }
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    }
  }

  return event;
}
