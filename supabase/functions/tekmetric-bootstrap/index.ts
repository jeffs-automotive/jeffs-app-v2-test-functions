// tekmetric-bootstrap
//
// One-shot edge function that exchanges Tekmetric client credentials for a
// non-expiring access token and persists it in the Supabase Vault.
//
// Per project policy:
//   - Tekmetric tokens do not expire. We fetch ONCE and store ONCE.
//   - This function is invoked manually after seeding client_id / client_secret /
//     url in the Vault. After it succeeds, the orchestrator and tool functions
//     read tekmetric_access_token directly from the Vault on every call —
//     never re-bootstrapping.
//   - Caller must use the project's service_role key (the function verifies the
//     supabase-js client below was constructed with service_role).
//
// Tekmetric OAuth contract (from Plan/.../TEKMETRIC_API_DOCS.md):
//   POST TEKMETRIC_OAUTH_TOKEN_URL  (constant from _shared/tekmetric.ts)
//   Headers:
//     Authorization: Basic base64(client_id:client_secret)
//     Content-Type:  application/x-www-form-urlencoded;charset=UTF-8
//   Body:
//     grant_type=client_credentials
//
//   Response:
//     { "access_token": "...", "token_type": "bearer", "scope": "1 2" }
//
// Vault secrets this function touches:
//   reads:  tekmetric_client_id, tekmetric_client_secret
//   writes: tekmetric_access_token
//
// (The OAuth URL is NOT in Vault — it's a non-secret constant in _shared/tekmetric.ts
//  so flipping sandbox ↔ production is a one-line code change.)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { TEKMETRIC_OAUTH_TOKEN_URL, VAULT_NAMES } from "../_shared/tekmetric.ts";

interface BootstrapResponse {
  ok: boolean;
  message: string;
  token_preview?: string; // first 8 chars only — never the whole token
  scope?: string;
  token_type?: string;
  error?: string;
  details?: unknown;
}

function jsonResponse(status: number, body: BootstrapResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      message: "method not allowed",
      error: "Use POST",
    });
  }

  // Service-role key is required — the wrapper functions are restricted to it.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      ok: false,
      message: "edge function misconfigured",
      error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from runtime env",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Read Tekmetric credentials from the Vault ─────────────────────────
  const [clientIdRes, clientSecretRes] = await Promise.all([
    supabase.rpc("tekmetric_get_secret", { p_name: VAULT_NAMES.CLIENT_ID }),
    supabase.rpc("tekmetric_get_secret", { p_name: VAULT_NAMES.CLIENT_SECRET }),
  ]);

  if (clientIdRes.error || clientSecretRes.error) {
    return jsonResponse(500, {
      ok: false,
      message: "failed to read Vault secrets",
      error: "tekmetric_get_secret RPC errored",
      details: {
        client_id_error: clientIdRes.error?.message,
        client_secret_error: clientSecretRes.error?.message,
      },
    });
  }

  const clientId = clientIdRes.data as string | null;
  const clientSecret = clientSecretRes.data as string | null;

  const missing: string[] = [];
  if (!clientId) missing.push(VAULT_NAMES.CLIENT_ID);
  if (!clientSecret) missing.push(VAULT_NAMES.CLIENT_SECRET);
  if (missing.length > 0) {
    return jsonResponse(412, {
      ok: false,
      message: "Vault is missing required secrets",
      error: `Add these in Studio → Project Settings → Vault: ${missing.join(", ")}`,
    });
  }

  // ── 2. Exchange credentials for an access token (Tekmetric OAuth) ────────
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(TEKMETRIC_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "grant_type=client_credentials",
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      message: "network error reaching Tekmetric",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!tokenResponse.ok) {
    let errorBody: unknown;
    try {
      errorBody = await tokenResponse.json();
    } catch {
      errorBody = await tokenResponse.text();
    }
    return jsonResponse(tokenResponse.status, {
      ok: false,
      message: "Tekmetric token endpoint returned non-2xx",
      error: `HTTP ${tokenResponse.status}`,
      details: errorBody,
    });
  }

  let tokenJson: { access_token?: string; token_type?: string; scope?: string };
  try {
    tokenJson = await tokenResponse.json();
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      message: "Tekmetric token response was not valid JSON",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!tokenJson.access_token) {
    return jsonResponse(502, {
      ok: false,
      message: "Tekmetric response missing access_token",
      details: tokenJson,
    });
  }

  // ── 3. Persist access_token in the Vault ─────────────────────────────────
  const setRes = await supabase.rpc("tekmetric_set_secret", {
    p_name: VAULT_NAMES.ACCESS_TOKEN,
    p_value: tokenJson.access_token,
    p_description:
      `Tekmetric access token (non-expiring per Tekmetric docs). Bootstrapped at ${new Date().toISOString()}.`,
  });

  if (setRes.error) {
    return jsonResponse(500, {
      ok: false,
      message: "fetched token but failed to persist to Vault",
      error: setRes.error.message,
    });
  }

  // ── 4. Done. Return preview only — never the full token. ─────────────────
  return jsonResponse(200, {
    ok: true,
    message: `Bootstrap complete. Access token stored in Vault under "${VAULT_NAMES.ACCESS_TOKEN}".`,
    token_preview: `${tokenJson.access_token.slice(0, 8)}…`,
    token_type: tokenJson.token_type,
    scope: tokenJson.scope,
  });
});
