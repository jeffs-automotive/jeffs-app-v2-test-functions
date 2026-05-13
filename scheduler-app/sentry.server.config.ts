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
   * Scrub PII before sending to Sentry. Pattern:
   *   - phone_e164      → phone_last_4
   *   - first_name      → drop (we don't need it in error context)
   *   - last_name       → drop
   *   - otp code        → never include
   *   - email           → drop (no email PII in scheduler Phase 1 anyway)
   *
   * This is best-effort string replacement at the top level of the event.
   * Deep-nested PII (e.g., inside formData) is handled by
   * withServerActionInstrumentation's recordResponse: false default; we
   * only opt-in to recordResponse on actions that don't carry PII in their
   * return.
   */
  beforeSend(event) {
    try {
      const json = JSON.stringify(event);
      // E.164 US/CA: +1XXXXXXXXXX → +1******NNNN
      const scrubbed = json
        .replace(/\+1\d{6}(\d{4})/g, "+1******$1")
        // 6-digit OTP codes near the words "code" or "otp"
        .replace(
          /("(?:code|otp_code|otp)")\s*:\s*"\d{6}"/gi,
          '$1:"[REDACTED]"',
        );
      return JSON.parse(scrubbed) as typeof event;
    } catch {
      // If scrubbing fails for any reason, drop the event entirely rather
      // than send raw PII upstream. Per observability rule: silent leak is
      // worse than silent drop.
      return null;
    }
  },
});
