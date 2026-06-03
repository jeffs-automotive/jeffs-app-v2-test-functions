// qbo-oauth-callback — one-time QuickBooks Online (Intuit) OAuth handshake helper.
//
// Self-contained. Two GET modes on the same registered path:
//   GET ?start=1              -> 302 to Intuit's authorize endpoint (with a signed state)
//   GET ?code&state&realmId   -> verify state, exchange code -> tokens, then SEED them into
//                                qbo_connections (Vault) for the deployed Accounting Link
//                                client AND print the refresh_token + realmId for the
//                                optional local QuickBooks MCP server (@qboapi/qbo-mcp-server).
//
// verify_jwt is false (set in config.toml) because Intuit redirects an UNAUTHENTICATED
// browser here. This is an operator-only bootstrap: it stores the tokens server-side in
// Vault (via the qbo_persist_tokens RPC) and only succeeds for whoever can complete
// Intuit's own login + consent for the QBO company.
//
// Responses are PLAIN TEXT on purpose: Supabase Edge Functions force
// `Content-Type: text/plain` on responses (anti-phishing; documented in mcp-auth/index.ts),
// so HTML would display as raw source. Plain text renders cleanly and the success page's
// KEY=value lines are easy to copy. Only the start-redirect (302) and method-guard (405)
// are non-200; every human-facing page is a 200 whose text conveys the outcome.
//
// Concept adapted from the v1 app's QBO callback; written fresh here. Seeds qbo_connections
// (added 2026-06-03) so the deployed admin-app client has its own server-side grant.
//
// Required edge secrets (supabase secrets set ...): QBO_CLIENT_ID, QBO_CLIENT_SECRET,
// QBO_STATE_SECRET (HMAC key for the state param). QBO_ENVIRONMENT is informational only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { base64UrlEncode, functionUrl, randomToken } from "../_shared/oauth.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";

const FUNCTION_NAME = "qbo-oauth-callback";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") ?? "";
const STATE_SECRET = Deno.env.get("QBO_STATE_SECRET") ?? "";

const enc = new TextEncoder();

/** Imports the HMAC-SHA256 signing key from QBO_STATE_SECRET. */
async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Builds a tamper-evident, short-lived `state`: `<nonce>.<expiryMs>.<hmac>`. */
async function signState(): Promise<string> {
  const payload = `${randomToken(16)}.${Date.now() + STATE_TTL_MS}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Verifies the HMAC + TTL of a `state` produced by signState(). */
async function verifyState(state: string): Promise<boolean> {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expiryStr, sig] = parts;
  const expected = base64UrlEncode(
    new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(`${nonce}.${expiryStr}`))),
  );
  if (sig.length !== expected.length || sig !== expected) return false;
  const expiry = Number(expiryStr);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

/** Plain-text response (Supabase forces text/plain on edge fns anyway). */
function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

Deno.serve((req) =>
  withSentryScope(req, FUNCTION_NAME, async () => {
    if (req.method !== "GET") {
      return text("Method not allowed.", 405);
    }

    const missing: string[] = [];
    if (!CLIENT_ID) missing.push("QBO_CLIENT_ID");
    if (!CLIENT_SECRET) missing.push("QBO_CLIENT_SECRET");
    if (!STATE_SECRET) missing.push("QBO_STATE_SECRET");
    if (missing.length > 0) {
      return text(
        `QuickBooks OAuth - not configured\n\n` +
          `Missing edge secret(s): ${missing.join(", ")}\n\n` +
          `Set them once, then retry:\n\n` +
          `  supabase secrets set ${missing.map((m) => `${m}=...`).join(" ")} \\\n` +
          `    --project-ref itzdasxobllfiuolmbxu\n`,
      );
    }

    const url = new URL(req.url);
    const redirectUri = functionUrl(FUNCTION_NAME);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    // Intuit returned an error (e.g., user denied consent)
    if (oauthError) {
      return text(`Authorization failed.\n\nIntuit returned: ${oauthError}\n\nStart over: ?start=1\n`);
    }

    // START mode — no code yet: redirect the operator to Intuit's consent screen.
    if (!code) {
      const authUrl = new URL(AUTHORIZE_URL);
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("scope", SCOPE);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("state", await signState());
      return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
    }

    // CALLBACK mode — validate state + company, then exchange the code.
    if (!state || !(await verifyState(state))) {
      return text(
        `Invalid or expired link.\n\nThe handshake link expired (10 min) or the state was ` +
          `tampered with.\n\nStart over: ?start=1\n`,
      );
    }
    if (!realmId) {
      return text(`Missing company id.\n\nIntuit did not return a realmId.\n\nStart over: ?start=1\n`);
    }

    const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const raw = await tokenRes.text();
    if (!tokenRes.ok) {
      console.error(`[${FUNCTION_NAME}] token exchange failed: HTTP ${tokenRes.status}`);
      return text(
        `Token exchange failed.\n\nIntuit returned HTTP ${tokenRes.status}:\n\n${raw}\n\nStart over: ?start=1\n`,
      );
    }

    let tokens: {
      refresh_token?: string;
      access_token?: string;
      expires_in?: number;
      x_refresh_token_expires_in?: number;
    };
    try {
      tokens = JSON.parse(raw);
    } catch {
      return text(`Unexpected token response:\n\n${raw}\n`);
    }
    const refresh = tokens.refresh_token ?? "";
    const access = tokens.access_token ?? "";
    if (!access || !refresh) {
      return text(
        `Token exchange returned an unexpected shape (missing access or refresh token).\n\n` +
          `${raw}\n\nStart over: ?start=1\n`,
      );
    }

    // Seed qbo_connections so the DEPLOYED Accounting Link client has its own
    // server-side grant (Vault-backed). This is a SEPARATE grant from the local
    // QuickBooks MCP server's — qbo_persist_tokens upserts the Vault secrets +
    // the row (environment defaults to 'production'). Migration 20260602140000.
    const now = Date.now();
    const accessTtlS =
      typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
    const refreshTtlS =
      typeof tokens.x_refresh_token_expires_in === "number"
        ? tokens.x_refresh_token_expires_in
        : 8_726_400;
    let stored = false;
    let storeError: string | null = null;
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { error } = await sb.rpc("qbo_persist_tokens", {
        p_realm_id: realmId,
        p_access_token: access,
        p_refresh_token: refresh,
        p_access_token_expires_at: new Date(now + accessTtlS * 1000).toISOString(),
        p_refresh_token_expires_at: new Date(now + refreshTtlS * 1000).toISOString(),
      });
      if (error) throw new Error(error.message);
      stored = true;
    } catch (e) {
      // No silent failure: capture + structured log, and surface on the page so
      // the operator can still fall back to the MCP env values below.
      storeError = e instanceof Error ? e.message : String(e);
      Sentry.captureException(e, {
        tags: { qbo_op: "seed_qbo_connections", realm_id: realmId },
      });
      console.error(
        JSON.stringify({
          level: "error",
          msg: "qbo-oauth-callback: qbo_persist_tokens failed",
          realm_id: realmId,
          error: storeError,
        }),
      );
    }

    const storeLine = stored
      ? `Stored for the Accounting Link app (qbo_connections, realm ${realmId}).\n` +
        `The deployed admin-app client can now read + refresh autonomously.\n\n`
      : `WARNING: could NOT store to qbo_connections — ${storeError}\n` +
        `The deployed app is NOT connected yet. Use the values below as a fallback\n` +
        `and/or re-run ?start=1, or report this error.\n\n`;

    return text(
      `QuickBooks connected.\n\n` +
        storeLine +
        `Local QuickBooks MCP server (OPTIONAL) — copy into ~/quickbooks-online-mcp-server\n` +
        `.env + machine env vars (see QUICKBOOKS-MCP-SETUP.md in the dotfiles repo):\n\n` +
        `QUICKBOOKS_REFRESH_TOKEN=${refresh}\n` +
        `QUICKBOOKS_REALM_ID=${realmId}\n` +
        `QUICKBOOKS_ENVIRONMENT=production\n\n` +
        `Treat the refresh token like a password. It rotates on each use; re-run\n` +
        `this flow (?start=1) if it ever stops working.\n`,
    );
  })
);
