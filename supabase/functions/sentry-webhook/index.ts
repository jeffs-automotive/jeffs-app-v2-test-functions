// sentry-webhook
//
// Receives Sentry Integration Platform webhook deliveries from a
// project-scoped Internal Integration and writes them to
// public.sentry_webhook_events for postmortem + MCP-driven querying.
//
// Created 2026-05-24 alongside migration 20260524200000.
//
// Auth model
// ----------
// Sentry signs each webhook with HMAC-SHA256 keyed on the Internal
// Integration's "Client Secret". Per the official spec
// (https://docs.sentry.io/integrations/integration-platform/webhooks/
// #sentry-hook-signature) the message is `JSON.stringify(request.body)`
// — NOT the raw request body bytes. This is a deliberate Sentry choice
// (and a frequent footgun) — we MUST parse-then-stringify before
// hashing or the digest will not match.
//
//   const hmac = crypto.createHmac("sha256", secret);
//   hmac.update(JSON.stringify(request.body), "utf8");
//   const digest = hmac.digest("hex");
//   return digest === request.headers["sentry-hook-signature"];
//
// Constant-time compare via bearersEqual from _shared/scheduler-auth.
//
// Response policy
// ---------------
// Sentry's docs require a response within 1 second or the delivery is
// flagged as timed out. We always return 200 once we've successfully
// inserted the row, even when signature_verified=false — keeping the
// row gives us an audit trail of forged or misconfigured attempts.
// Returning 200 on bad-signature means Sentry won't retry the delivery
// during a misconfiguration window (e.g., while the user is rotating
// the client secret). The signature_verified flag in the table is the
// source of truth.
//
// We DO return 500 if the DB insert itself fails — Sentry will retry,
// and we want to retry because we have no record yet of the delivery.
//
// Required Supabase env vars
// --------------------------
//   SENTRY_INTEGRATION_CLIENT_SECRET — set after creating the Internal
//                                       Integration in Sentry's UI.
//                                       If absent or empty, all signature
//                                       checks fail-closed (we still log
//                                       the row with signature_verified
//                                       = false).
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — standard.
//   EDGE_FN_SENTRY_DSN — for withSentryScope (consumed by the helper).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { withSentryScope } from "../_shared/sentry-edge.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SENTRY_INTEGRATION_CLIENT_SECRET =
  Deno.env.get("SENTRY_INTEGRATION_CLIENT_SECRET") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Request-ID, Sentry-Hook-Resource, Sentry-Hook-Timestamp, Sentry-Hook-Signature",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── HMAC verification per Sentry spec ───────────────────────────────────────

/**
 * Compute hex-encoded HMAC-SHA256 of `message` using `secret` (UTF-8).
 *
 * Sentry's signature scheme keys on the integration's "Client Secret"
 * and signs `JSON.stringify(parsed_body)` — see the spec link at the top.
 *
 * Returns the hex digest. Caller compares against the Sentry-Hook-Signature
 * header using a constant-time comparator (bearersEqual).
 */
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface VerificationResult {
  verified: boolean;
  reason?: string;
}

/**
 * Verify a Sentry webhook's HMAC-SHA256 signature against the spec.
 *
 *   computed = hex(HMAC_SHA256(client_secret, JSON.stringify(parsed_body)))
 *   computed must equal header['sentry-hook-signature']
 *
 * Fails closed when the secret env var is missing — that case is the
 * "Client Secret hasn't been set in Supabase yet" misconfiguration,
 * and we'd rather flag the rows than silently accept unsigned deliveries.
 *
 * Constant-time compare via bearersEqual.
 */
async function verifySentrySignature(
  parsedBody: unknown,
  signatureHeader: string | null,
): Promise<VerificationResult> {
  if (!SENTRY_INTEGRATION_CLIENT_SECRET) {
    return { verified: false, reason: "client_secret_env_unset" };
  }
  if (!signatureHeader) {
    return { verified: false, reason: "signature_header_missing" };
  }
  // Sentry signs JSON.stringify(parsed_body). We round-trip
  // parse→stringify to match exactly what their server signed.
  let canonical: string;
  try {
    canonical = JSON.stringify(parsedBody);
  } catch (_err) {
    return { verified: false, reason: "body_stringify_failed" };
  }
  const computed = await hmacSha256Hex(
    canonical,
    SENTRY_INTEGRATION_CLIENT_SECRET,
  );
  if (computed.length !== signatureHeader.length) {
    return { verified: false, reason: "signature_length_mismatch" };
  }
  if (bearersEqual(computed, signatureHeader)) {
    return { verified: true };
  }
  return { verified: false, reason: "signature_mismatch" };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve((req) => withSentryScope(req, "sentry-webhook", async () => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Capture all headers for the audit row. We pluck the Sentry-specific
  // ones into typed columns, and stash the full set as JSONB for any
  // future debugging (e.g., new Sentry-Hook-* headers we don't know
  // about yet).
  const headerSnapshot: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headerSnapshot[key] = value;
  });

  const requestId = req.headers.get("request-id");
  const resource = req.headers.get("sentry-hook-resource");
  const hookTimestamp = req.headers.get("sentry-hook-timestamp");
  const signatureHeader = req.headers.get("sentry-hook-signature");

  // Read raw body. Sentry sends JSON; non-JSON is malformed (or a probe).
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (e) {
    await logEdgeError(sb, {
      surface: "sentry-webhook/body_read",
      origin_id: "sentry-webhook",
      level: "warning",
      error_code: "body_read_failed",
      message: e instanceof Error ? e.message : String(e),
    });
    return jsonResponse({ ok: false, error: "body_read_failed" }, 400);
  }

  let parsedBody: unknown;
  let parseError: string | null = null;
  if (rawBody.length === 0) {
    parseError = "empty_body";
    parsedBody = null;
  } else {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
      parsedBody = null;
    }
  }

  // Verify the signature against the parsed body. If parsing failed,
  // we can't verify (the spec signs the parsed-then-stringified body).
  let verification: VerificationResult;
  if (parsedBody === null) {
    verification = {
      verified: false,
      reason: parseError ?? "parsed_body_null",
    };
  } else {
    verification = await verifySentrySignature(parsedBody, signatureHeader);
  }

  // Extract common body fields for typed columns. Defensive parsing —
  // missing fields land as null rather than throwing. The full payload
  // is in the payload JSONB column for downstream queries.
  const body = (parsedBody ?? {}) as {
    action?: unknown;
    installation?: { uuid?: unknown };
    actor?: { type?: unknown; id?: unknown; name?: unknown };
  };
  const action =
    typeof body.action === "string" ? body.action : null;
  const installationUuid =
    body.installation && typeof body.installation.uuid === "string"
      ? body.installation.uuid
      : null;
  const actorType =
    body.actor && typeof body.actor.type === "string" ? body.actor.type : null;
  const actorId =
    body.actor &&
    (typeof body.actor.id === "string" || typeof body.actor.id === "number")
      ? String(body.actor.id)
      : null;
  const actorName =
    body.actor && typeof body.actor.name === "string"
      ? body.actor.name
      : null;

  // Build the row. resource is NOT NULL per the table contract, so we
  // fall back to "unknown" when the header is missing — that way we
  // still log the delivery instead of dropping it (likely a probe or
  // misconfigured request hitting our URL).
  const row = {
    request_id: requestId,
    resource: resource ?? "unknown",
    hook_timestamp: hookTimestamp,
    signature_header: signatureHeader,
    signature_verified: verification.verified,
    action,
    installation_uuid: installationUuid,
    actor_type: actorType,
    actor_id: actorId,
    actor_name: actorName,
    payload: parsedBody ?? rawBody,
    raw_headers: headerSnapshot,
    ingest_error: parseError ?? verification.reason ?? null,
  };

  const { error: insertErr } = await sb
    .from("sentry_webhook_events")
    .insert(row);

  if (insertErr) {
    // DB insert failed — return 500 so Sentry retries. The Sentry
    // observability for this edge function (via withSentryScope) plus
    // logEdgeError to scheduler_error_log give us coverage of the
    // failure itself.
    await logEdgeError(sb, {
      surface: "sentry-webhook/insert",
      origin_id: "sentry-webhook",
      level: "error",
      error_code: "insert_failed",
      message: insertErr.message,
      context: {
        resource: resource ?? null,
        request_id: requestId,
        signature_verified: verification.verified,
      },
    });
    return jsonResponse({ ok: false, error: "insert_failed" }, 500);
  }

  return jsonResponse({
    ok: true,
    signature_verified: verification.verified,
  });
}));
