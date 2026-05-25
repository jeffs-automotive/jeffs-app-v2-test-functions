/**
 * Sentry server-side init for admin-app (Node runtime).
 *
 * Simpler than scheduler-app's config — no Vercel AI / Anthropic SDK
 * integrations (admin-app doesn't call LLMs directly; orchestrator does).
 * Same PII scrubber shape because admin Server Actions WILL surface
 * customer data via orchestrator reads (vehicle owner names, RO numbers,
 * etc.) and we should never leak that to Sentry.
 *
 * DSN comes from SENTRY_DSN. If unset, Sentry no-ops gracefully — useful
 * for local dev when you don't want to pollute the project's events.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Required for Sentry.logger.* calls (structured logs that don't create
  // issues). Per Sentry docs must be set on every runtime.
  enableLogs: true,

  sendDefaultPii: true,

  initialScope: {
    tags: {
      surface: "admin-app",
      shop_id: "7476", // single-tenant Phase 1
    },
  },

  beforeSend(event) {
    try {
      return scrubEvent(event);
    } catch {
      // Fail-closed: silent leak is worse than silent drop.
      return null;
    }
  },
});

// ─── PII scrubber (same shape as scheduler-app/sentry.server.config.ts) ──

const PII_KEY_BLOCKLIST = new Set([
  "email",
  "emails",
  "first_name",
  "last_name",
  "name",
  "full_name",
  "customer_name",
  "primary_email",
  "phone",
  "phones",
  "phone_e164",
  "phone_number",
  "address",
  "address1",
  "address2",
  "street_address",
  "city",
  "state",
  "zip",
  "postal_code",
  "tekmetric_error_text",
]);

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_E164_RE = /\+1\d{6}(\d{4})/g;

function scrubString(s: string): string {
  if (typeof s !== "string" || s.length === 0) return s;
  return s.replace(EMAIL_RE, "[email]").replace(PHONE_E164_RE, "+1******$1");
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

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // The actor email (from requireAdmin) IS intentionally captured for
  // audit — we DO want to know which employee triggered the error. But
  // we strip the user.email field that Sentry's auto-PII puts on
  // event.user; the meaningful actor lives in tag.actor_email set per
  // Server Action.
  if (event.user) {
    const u = event.user as Record<string, unknown>;
    if ("email" in u) u.email = undefined;
    if ("username" in u) u.username = undefined;
    if ("name" in u) u.name = undefined;
  }

  if (typeof event.message === "string") {
    event.message = scrubString(event.message);
  }

  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    }
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  }
  if (event.extra) {
    event.extra = scrubValue(event.extra) as typeof event.extra;
  }
  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.data) b.data = scrubValue(b.data) as typeof b.data;
      if (typeof b.message === "string") b.message = scrubString(b.message);
    }
  }
  if (event.request) {
    if (event.request.data) {
      event.request.data = scrubValue(
        event.request.data,
      ) as typeof event.request.data;
    }
    if (event.request.headers) {
      event.request.headers = scrubValue(
        event.request.headers,
      ) as typeof event.request.headers;
    }
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    }
  }

  return event;
}
