// scheduler-manual-review-email
//
// P1.7 post-validator fix (2026-05-25) — closes CLN-13.
//
// Sends an email to the service team when a scheduler manual review is
// created. Mirrors the keytag system's email pattern (laymen-terms voice;
// 6-char code in subject; "code XXX-YYYYYY option a" footer for advisor
// resolution) but lives in its own edge fn because the keytag
// _shared/manual-review-email.ts is Deno-imported by the keytag webhook +
// cron and can't be imported from Vercel Server Actions.
//
// Why an edge fn (not a Vercel-side fetch directly to Resend):
//
//   1. Resend API key stays a Supabase secret (not exposed to the Vercel
//      bundle even as RESEND_API_KEY on the server — defense in depth).
//   2. Sentry context is captured in the edge runtime, where the keytag
//      email path already lives — single triage surface.
//   3. Idempotency: Resend's `Idempotency-Key` header is keyed on the
//      6-char code. Multiple POSTs for the same code (Vercel retry,
//      orchestrator retry, future cron-driven retry) dedupe at Resend.
//
// Request:
//   POST / {
//     code: "AVM-ABCDEF",                                    // 10 chars (PFX-XXXXXX)
//     category: "appointment_verification_mismatch",
//     issue_summary: "...",                                  // operator-readable
//     options: [{ key, label, description, needs_tag_input? }],
//     context: { chat_id, appointment_id, customer_id, vehicle_id, diff }
//   }
//
// Response:
//   { ok: true, dedup?: true, latency_ms: number }
//   { ok: false, error: "resend_not_configured" | "resend_send_failed" | ... }
//
// Auth: same Pattern A bearer as scheduler-booking-direct.
//
// Re-deploy with: supabase functions deploy scheduler-manual-review-email --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const REVIEW_TO_EMAIL =
  Deno.env.get("SCHEDULER_MANUAL_REVIEW_TO_EMAIL") ??
  Deno.env.get("KEYTAG_REPORT_TO_EMAIL") ??
  "service@jeffsautomotive.com";
const REVIEW_FROM_EMAIL =
  Deno.env.get("SCHEDULER_MANUAL_REVIEW_FROM_EMAIL") ??
  Deno.env.get("KEYTAG_REPORT_FROM_EMAIL") ??
  "Jeff's Automotive Scheduler <alerts@jeffsautomotive.com>";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface ManualReviewOption {
  key: string;
  label: string;
  description: string;
  needs_tag_input?: boolean;
}

interface AvmContext {
  chat_id?: string;
  appointment_id?: number;
  customer_id?: number;
  vehicle_id?: number;
  diff?: string;
  [k: string]: unknown;
}

interface RequestBody {
  code?: string;
  category?: string;
  issue_summary?: string;
  options?: ManualReviewOption[];
  context?: AvmContext;
}

// Bounded category set. Add new categories here only after extending
// renderCategoryBody + buildSubject + the matching create_manual_review
// callers on the Vercel side. Unknown categories return ok=false to
// avoid silently emitting a generic / confusing email.
const SUPPORTED_CATEGORIES = new Set<string>([
  "appointment_verification_mismatch",
]);

Deno.serve(async (req: Request) => {
  return await withSentryScope(req, "scheduler-manual-review-email", async () => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    const authCheck = checkSchedulerBearer(req);
    if (!authCheck.ok) {
      return unauthorizedResponse(authCheck);
    }

    if (!RESEND_API_KEY) {
      return jsonResponse(
        { ok: false, error: "resend_not_configured" },
        503,
      );
    }

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch (e) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_json",
          detail: e instanceof Error ? e.message : String(e),
        },
        400,
      );
    }

    if (
      !body.code ||
      typeof body.code !== "string" ||
      !/^[A-Z]{3}-[A-Z0-9]{6}$/.test(body.code)
    ) {
      return jsonResponse(
        { ok: false, error: "missing_or_malformed_code" },
        400,
      );
    }
    if (!body.category || !SUPPORTED_CATEGORIES.has(body.category)) {
      return jsonResponse(
        { ok: false, error: "unsupported_category", category: body.category },
        400,
      );
    }
    if (typeof body.issue_summary !== "string" || body.issue_summary.length === 0) {
      return jsonResponse(
        { ok: false, error: "missing_issue_summary" },
        400,
      );
    }
    if (!Array.isArray(body.options) || body.options.length === 0) {
      return jsonResponse({ ok: false, error: "missing_options" }, 400);
    }

    const subject = buildSubject(body.code, body.category, body.context ?? {});
    const html = buildHtml(
      body.code,
      body.category,
      body.issue_summary,
      body.options,
      body.context ?? {},
    );

    const t0 = Date.now();
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          // Per-code idempotency. Resend dedupes within ~24h. Multiple
          // POSTs for the same code (Vercel retry / orchestrator
          // retry) collapse into one email.
          "Idempotency-Key": `scheduler-manual-review:${body.code}`,
        },
        body: JSON.stringify({
          from: REVIEW_FROM_EMAIL,
          to: [REVIEW_TO_EMAIL],
          subject,
          html,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 409) {
        return jsonResponse({ ok: true, dedup: true, latency_ms });
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "<unreadable>");
        await logEdgeError(sb, {
          origin_id: "scheduler-manual-review-email",
          surface: "scheduler-manual-review-email/resend_send",
          level: "error",
          error_code: `resend_${res.status}`,
          message: `Resend returned ${res.status}`,
          context: { code: body.code, status: res.status, body: text.slice(0, 300) },
        });
        return jsonResponse(
          {
            ok: false,
            error: "resend_send_failed",
            status: res.status,
            detail: text.slice(0, 300),
            latency_ms,
          },
          502,
        );
      }
      return jsonResponse({ ok: true, latency_ms });
    } catch (e) {
      const latency_ms = Date.now() - t0;
      Sentry.captureException(e, {
        tags: { surface: "scheduler-manual-review-email/resend_send_throw" },
        level: "error",
        extra: { code: body.code },
      });
      await logEdgeError(sb, {
        origin_id: "scheduler-manual-review-email",
        surface: "scheduler-manual-review-email/resend_send_throw",
        level: "error",
        error_code: "resend_send_threw",
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? (e.stack ?? null) : null,
        context: { code: body.code },
      });
      return jsonResponse(
        {
          ok: false,
          error: "resend_send_threw",
          detail: e instanceof Error ? e.message : String(e),
          latency_ms,
        },
        502,
      );
    }
  });
});

// ─── Subject + HTML helpers ─────────────────────────────────────────────────

function buildSubject(code: string, category: string, context: AvmContext): string {
  switch (category) {
    case "appointment_verification_mismatch": {
      const apt = context.appointment_id ? `appointment #${context.appointment_id}` : "an appointment";
      return `Scheduler Review (${code}): Tekmetric stored ${apt} differently than we sent`;
    }
    default:
      return `Scheduler Review (${code})`;
  }
}

function buildHtml(
  code: string,
  category: string,
  issueSummary: string,
  options: ManualReviewOption[],
  context: AvmContext,
): string {
  const body = renderCategoryBody(category, context, issueSummary);
  const optionsHtml = options
    .map((o, i) => {
      const letter = String.fromCharCode(97 + i); // a, b, c...
      return `<li style="margin-bottom:14px;">
        <strong style="color:#D2B487;">Option ${letter} — ${escapeHtml(o.label)}</strong>
        <div style="margin-top:4px;color:#ddd;">${escapeHtml(o.description)}</div>
      </li>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#1a1a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:28px 24px;background:#262626;">

  <h1 style="margin:0 0 4px 0;color:#96003C;font-size:22px;border-bottom:2px solid #D2B487;padding-bottom:10px;">
    Scheduler Review Needed
  </h1>
  <p style="margin:8px 0 18px 0;font-family:monospace;font-size:16px;color:#D2B487;font-weight:700;letter-spacing:2px;">
    Code: ${escapeHtml(code)}
  </p>

  <h2 style="color:#f0a8a8;font-size:15px;margin:18px 0 6px 0;">What happened</h2>
  <div style="color:#e0e0e0;line-height:1.55;font-size:14px;">${body}</div>

  <h2 style="color:#f0a8a8;font-size:15px;margin:24px 0 6px 0;">What you can do</h2>
  <ul style="margin:0;padding:0 0 0 18px;list-style:none;">
    ${optionsHtml}
  </ul>

  <div style="margin-top:28px;padding:14px 16px;background:#1f1f1f;border-left:3px solid #D2B487;border-radius:3px;">
    <strong style="color:#D2B487;font-size:13px;">How to resolve</strong>
    <div style="margin-top:6px;color:#ddd;font-size:13px;line-height:1.5;">
      Open Claude Desktop and type: <code style="background:#0f0f0f;padding:2px 6px;border-radius:3px;color:#f0c860;">code ${escapeHtml(code)} option a</code>
      (replace <code style="color:#f0c860;">a</code> with your choice).
      Any service team member can resolve this. The code is single-use, so once it's resolved here it's done.
    </div>
  </div>

  <p style="margin:28px 0 0 0;font-size:11px;color:#777;line-height:1.5;">
    Issued by Jeff's Automotive Scheduler. Sent automatically when the system runs into something it can't decide on its own. Reply-to is not monitored — use Claude Desktop's scheduler tools to make changes.
  </p>

</div></body></html>`;
}

function renderCategoryBody(
  category: string,
  context: AvmContext,
  issueSummary: string,
): string {
  switch (category) {
    case "appointment_verification_mismatch": {
      const apt = context.appointment_id
        ? `<strong>appointment #${context.appointment_id}</strong>`
        : "the appointment";
      const diff = context.diff ?? "";
      const diffBlock = diff
        ? `<p style="margin:10px 0;padding:8px 12px;background:#1f1f1f;border-left:3px solid #f0a8a8;font-family:monospace;font-size:12px;color:#f0a8a8;">${escapeHtml(diff)}</p>`
        : "";
      return `A customer just confirmed an appointment through our online scheduler. The booking went through to Tekmetric successfully (so the slot IS held), but when we read the appointment back to double-check, Tekmetric's stored version <strong>differs</strong> from what we sent.
        ${diffBlock}
        <p style="margin:10px 0;">Issue summary (raw): ${escapeHtml(issueSummary)}</p>
        <p style="margin:10px 0;">What that could mean:</p>
        <ul style="margin:6px 0;padding-left:18px;color:#ddd;">
          <li>A racing edit in Tekmetric (advisor on the desktop opened the appointment + saved a change between our POST + our GET) — Tekmetric's version is what the shop actually expects to see, so accept their version.</li>
          <li>Tekmetric silently normalized a field (e.g., color, casing, whitespace) — usually safe to ignore but worth a quick eyeball.</li>
          <li>A genuine sync bug on our side — the customer might show up expecting one thing while Tekmetric expects another. Reach out to confirm.</li>
        </ul>
        <p style="margin:10px 0 0 0;">Until you choose, ${apt} stays bound in Tekmetric (the customer's confirmation already landed; this is a back-office reconciliation, not a customer-facing block).</p>`;
    }
    default:
      return `Issue summary: ${escapeHtml(issueSummary)}`;
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
