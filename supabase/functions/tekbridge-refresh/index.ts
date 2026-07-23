// tekbridge-refresh — keeps the bot session alive, server-side.
//
// Invoked by pg_cron every ~6h via scheduler_invoke_edge_function (which sends
// the SERVICE_ROLE bearer, no actor). Calls Tekmetric's token-refresh endpoint
// with the stored token and persists the fresh one — no browser, no reCAPTCHA.
//
// On failure (chain broke / no token on file), it marks the session stale,
// emails the operator (de-duped) so they can re-log-the-bot-in, and reports to
// Sentry. On success it clears the alert de-dup so the next break notifies
// immediately.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { Sentry, withSentryScope } from "../_shared/sentry-edge.ts";
import { hasValidServiceRoleBearer } from "../_shared/tekbridge/auth.ts";
import { refreshBotJwt } from "../_shared/tekbridge/refresh.ts";
import { clearBotAlert, sendBotSessionAlert } from "../_shared/tekbridge/alert.ts";
import { markSessionStale, TekbridgeSessionError } from "../_shared/tekbridge/session.ts";

const FUNCTION_NAME = "tekbridge-refresh";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY")!;
const SHOP_ID = parseInt(Deno.env.get("TEKMETRIC_SHOP_ID") ?? "7476", 10);

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Human-readable cause for the operator email, keyed on the failure type. */
function reasonFor(code: string): string {
  switch (code) {
    case "no_session":
      return "There is no session token on file — the tekbridge bot has never been logged in, or its token was cleared.";
    case "expired":
      return "The bot session expired before it could be refreshed — the refresh chain broke (a refresh window was likely missed).";
    default:
      return "The tekbridge token refresh call failed.";
  }
}

Deno.serve((req) =>
  withSentryScope(req, FUNCTION_NAME, async () => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });

    // System endpoint: SERVICE_ROLE bearer only (cron sends no actor email).
    if (!hasValidServiceRoleBearer(req)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    try {
      const { expiresAt, previousExpiresAt } = await refreshBotJwt(sb, SHOP_ID);
      // Chain healthy — reset the alert de-dup so a future break notifies at once.
      await clearBotAlert(sb, SHOP_ID);
      return json({ ok: true, expires_at: expiresAt, previous_expires_at: previousExpiresAt });
    } catch (e) {
      const code = e instanceof TekbridgeSessionError ? e.code : "refresh_failed";
      const detail = e instanceof Error ? e.message : String(e);

      // Record the broken state, then alert the operator (de-duped).
      await markSessionStale(sb, SHOP_ID, `refresh failed (${code}): ${detail}`);
      const alertRes = await sendBotSessionAlert(sb, SHOP_ID, {
        reason: reasonFor(code),
        detail,
      });

      Sentry.captureException(e instanceof Error ? e : new Error(detail), {
        tags: { fn: FUNCTION_NAME, code, emailed: String(alertRes.emailed) },
      });
      return json({ ok: false, code, error: detail, emailed: alertRes.emailed }, 502);
    }
  })
);
