// qbo-oauth-callback — one-time QuickBooks Online (Intuit) OAuth handshake helper.
//
// Self-contained, stateless (no DB). Two GET modes on the same registered path:
//   GET ?start=1              -> 302 to Intuit's authorize endpoint (with a signed state)
//   GET ?code&state&realmId   -> verify state, exchange code -> tokens, render the
//                                refresh_token + realmId for the operator to copy into the
//                                local QuickBooks MCP server (@qboapi/qbo-mcp-server).
//
// verify_jwt is false (set in config.toml) because Intuit redirects an UNAUTHENTICATED
// browser here. This is an operator-only bootstrap: it never stores tokens server-side and
// only succeeds for whoever can complete Intuit's own login + consent for the QBO company.
//
// Concept adapted from the v1 app's QBO callback; written fresh here. No qbo_connections
// table, no dashboard redirect — this feature only needs to surface the refresh_token.
//
// Required edge secrets (supabase secrets set ...): QBO_CLIENT_ID, QBO_CLIENT_SECRET,
// QBO_STATE_SECRET (HMAC key for the state param). QBO_ENVIRONMENT is informational only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  base64UrlEncode,
  escapeHtml,
  functionUrl,
  randomToken,
} from "../_shared/oauth.ts";
import { withSentryScope } from "../_shared/sentry-edge.ts";

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

/** Wraps body in a minimal branded HTML page. */
function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>QuickBooks OAuth — Jeff's Automotive</title><style>` +
      `body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem;line-height:1.55;color:#18181b}` +
      `pre{background:#f4f4f5;border-radius:8px;padding:1rem;overflow:auto;white-space:pre-wrap;word-break:break-all}` +
      `.k{color:#96003C;font-weight:600;margin:1rem 0 .25rem}a{color:#96003C}` +
      `</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

Deno.serve((req) =>
  withSentryScope(req, FUNCTION_NAME, async () => {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const missing: string[] = [];
    if (!CLIENT_ID) missing.push("QBO_CLIENT_ID");
    if (!CLIENT_SECRET) missing.push("QBO_CLIENT_SECRET");
    if (!STATE_SECRET) missing.push("QBO_STATE_SECRET");
    if (missing.length > 0) {
      return html(
        `<h1>QuickBooks OAuth — not configured</h1>` +
          `<p>Missing edge secret(s): <code>${escapeHtml(missing.join(", "))}</code>.</p>` +
          `<p>Set them once, then retry:</p><pre>supabase secrets set \\\n  ${
            escapeHtml(missing.map((m) => `${m}=…`).join(" \\\n  "))
          } \\\n  --project-ref itzdasxobllfiuolmbxu</pre>`,
        200,
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
      return html(
        `<h1>Authorization failed</h1><p>Intuit returned: <code>${escapeHtml(oauthError)}</code></p>` +
          `<p><a href="?start=1">Try again</a></p>`,
        200,
      );
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
      return html(
        `<h1>Invalid or expired link</h1>` +
          `<p>The handshake link expired (10 min) or the state was tampered with. ` +
          `<a href="?start=1">Start over</a>.</p>`,
        200,
      );
    }
    if (!realmId) {
      return html(
        `<h1>Missing company id</h1><p>Intuit did not return a <code>realmId</code>. ` +
          `<a href="?start=1">Start over</a>.</p>`,
        200,
      );
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
      return html(
        `<h1>Token exchange failed</h1><p>Intuit returned HTTP ${tokenRes.status}.</p>` +
          `<pre>${escapeHtml(raw)}</pre><p><a href="?start=1">Start over</a></p>`,
        200,
      );
    }

    let tokens: { refresh_token?: string; access_token?: string };
    try {
      tokens = JSON.parse(raw);
    } catch {
      return html(`<h1>Unexpected token response</h1><pre>${escapeHtml(raw)}</pre>`, 200);
    }
    const refresh = tokens.refresh_token ?? "";

    return html(
      `<h1>QuickBooks connected ✓</h1>` +
        `<p>Copy these into the QuickBooks MCP server's <code>.env</code> ` +
        `(<code>~/quickbooks-online-mcp-server</code>) and your machine env vars — ` +
        `see <code>QUICKBOOKS-MCP-SETUP.md</code> in the dotfiles repo.</p>` +
        `<div class="k">QUICKBOOKS_REFRESH_TOKEN</div><pre>${escapeHtml(refresh)}</pre>` +
        `<div class="k">QUICKBOOKS_REALM_ID</div><pre>${escapeHtml(realmId)}</pre>` +
        `<div class="k">QUICKBOOKS_ENVIRONMENT</div><pre>production</pre>` +
        `<p style="color:#b91c1c"><strong>Treat the refresh token like a password.</strong> ` +
        `It rotates on each use; re-run <a href="?start=1">this flow</a> if it ever stops working.</p>`,
    );
  })
);
