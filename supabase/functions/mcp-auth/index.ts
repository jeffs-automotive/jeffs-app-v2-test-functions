// mcp-auth — OAuth 2.1 + PKCE authorization server for the MCP Custom Connector flow.
//
// Routes (path is what's left after stripping /functions/v1/mcp-auth):
//   GET  /.well-known/oauth-authorization-server   discovery metadata
//   POST /register                                  Dynamic Client Registration (RFC 7591)
//   GET  /authorize?...                             consent page (HTML)
//   POST /authorize                                 consent form submission → redirect with code
//   POST /token                                     code → access_token
//
// Why all-in-one: Supabase Edge Functions route by `name`; routing inside the
// function lets us keep a single deploy unit. orchestrator-mcp owns the
// /.well-known/oauth-protected-resource endpoint (lives there because PRM
// describes the RESOURCE, not the AS).
//
// Spec references:
//   MCP Authorization spec   https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
//   OAuth 2.1                https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1
//   RFC 7636 (PKCE)          https://datatracker.ietf.org/doc/html/rfc7636
//   RFC 7591 (DCR)           https://datatracker.ietf.org/doc/html/rfc7591
//   RFC 8414 (AS Metadata)   https://datatracker.ietf.org/doc/html/rfc8414
//   RFC 8707 (Resource Indicators) https://datatracker.ietf.org/doc/html/rfc8707

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_CODE_TTL_SEC,
  type AuthServerMetadata,
  functionUrl,
  randomToken,
  sha256Base64Url,
  stripFunctionPrefix,
  verifyPkce,
} from "../_shared/oauth.ts";

const FUNCTION_NAME = "mcp-auth";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Response helpers ───────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

function oauthError(error: string, description?: string, status = 400): Response {
  return json({ error, ...(description ? { error_description: description } : {}) }, status);
}

// ─── Route: GET /.well-known/{oauth-authorization-server | openid-configuration}
// We serve the same body at both paths. Per MCP auth spec, clients try OIDC
// discovery (openid-configuration) FIRST, falling back to OAuth 2.0 metadata.
// Some clients (incl. Anthropic's connector backend) treat a 404 on OIDC as
// "this server doesn't support standardized auth" and bail before checking the
// OAuth path. Aliasing both keeps every spec-compliant client happy.
//
// We're not strictly an OIDC provider (no id_tokens), but the response is a
// valid superset for OAuth 2.0 clients and tolerable for OIDC clients that
// only need authorization_endpoint + token_endpoint + registration_endpoint.

function handleDiscovery(): Response {
  const issuer = functionUrl(FUNCTION_NAME);
  const metadata: AuthServerMetadata & {
    response_modes_supported: string[];
    /** OIDC compat — present so OIDC clients stop bailing on missing fields. */
    subject_types_supported?: string[];
    id_token_signing_alg_values_supported?: string[];
  } = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    scopes_supported: ["mcp"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    // OIDC fields included for client compatibility — we don't actually issue
    // id_tokens or run OIDC subject resolution. Listing RS256 + public is the
    // minimum that gets OIDC clients past their "missing required field" check.
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
  return json(metadata);
}

// ─── Route: POST /register (Dynamic Client Registration, RFC 7591) ─────────

interface DcrRequestBody {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

async function handleRegister(req: Request): Promise<Response> {
  let body: DcrRequestBody;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be valid JSON");
  }

  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return oauthError("invalid_redirect_uri", "redirect_uris is required and must be a non-empty array");
  }
  for (const uri of body.redirect_uris) {
    try {
      const u = new URL(uri);
      // Allow https + localhost http (Claude Desktop sometimes uses localhost callbacks)
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
        return oauthError("invalid_redirect_uri", `redirect_uri must be https or localhost: ${uri}`);
      }
    } catch {
      return oauthError("invalid_redirect_uri", `redirect_uri is not a valid URL: ${uri}`);
    }
  }

  // Generate client_id + secret. PKCE-only (no secret) is allowed if the client
  // explicitly requests "none" auth method; otherwise we issue a secret.
  const clientId = `mcp_${randomToken(16)}`;
  const authMethod = body.token_endpoint_auth_method ?? "client_secret_post";
  const issueSecret = authMethod !== "none";
  const clientSecret = issueSecret ? randomToken(32) : null;
  const clientSecretHash = clientSecret ? await sha256Base64Url(clientSecret) : null;

  const registrationAccessToken = randomToken(32);
  const registrationAccessTokenHash = await sha256Base64Url(registrationAccessToken);

  const { error } = await sb.from("oauth_clients").insert({
    id: clientId,
    client_secret_hash: clientSecretHash,
    client_name: body.client_name ?? "unknown",
    redirect_uris: body.redirect_uris,
    grant_types: body.grant_types ?? ["authorization_code"],
    response_types: body.response_types ?? ["code"],
    scope: body.scope ?? "mcp",
    token_endpoint_auth_method: authMethod,
    registration_access_token_hash: registrationAccessTokenHash,
    dynamically_registered: true,
    active: true,
  });

  if (error) {
    console.error("oauth_clients insert failed:", error.message);
    return oauthError("server_error", error.message, 500);
  }

  return json(
    {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret_expires_at: 0 } : {}), // 0 = never
      client_name: body.client_name ?? "unknown",
      redirect_uris: body.redirect_uris,
      grant_types: body.grant_types ?? ["authorization_code"],
      response_types: body.response_types ?? ["code"],
      scope: body.scope ?? "mcp",
      token_endpoint_auth_method: authMethod,
      registration_access_token: registrationAccessToken,
    },
    201,
  );
}

// ─── Route: GET /authorize (auto-approve — no HTML consent page) ────────────
//
// Why no HTML consent UI: Supabase Edge Functions force `Content-Type: text/plain`
// AND attach `Content-Security-Policy: default-src 'none'; sandbox` to all responses.
// That CSP blocks form submission AND the wrong Content-Type makes the browser
// render the HTML as source. Supabase deliberately treats edge functions as API
// endpoints, not HTML hosts. Workarounds (host consent page on Cloudflare Pages /
// Vercel / GitHub Pages) all add a separate-host moving piece for Phase 1 sandbox
// and don't actually buy anything we need yet.
//
// Phase 1 trade-off: auto-approve every authorize request that passes client +
// redirect_uri validation. The audit label is derived from the OAuth client (each
// Claude Desktop install registers its own DCR client → unique label per install).
//
// Phase 2 (when we wire real per-user identity): replace this with a Supabase Auth
// login redirect. Supabase Auth UI is already designed for browser flows and does
// not have the edge-function CSP problem.

async function handleAuthorizeGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = url.searchParams;

  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = (params.get("code_challenge_method") ?? "S256") as "S256" | "plain";
  const scope = params.get("scope") ?? "mcp";
  const state = params.get("state") ?? "";
  const resource = params.get("resource") ?? "";

  if (!clientId || !redirectUri || !responseType || !codeChallenge) {
    return oauthError("invalid_request", "Missing required parameter (client_id, redirect_uri, response_type, code_challenge)");
  }
  if (responseType !== "code") {
    return oauthError("unsupported_response_type", `Only response_type=code is supported, got: ${responseType}`);
  }
  if (codeChallengeMethod !== "S256") {
    return oauthError("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  const { data: client, error: clientErr } = await sb
    .from("oauth_clients")
    .select("id, redirect_uris, scope, active, client_name")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr) return oauthError("server_error", clientErr.message, 500);
  if (!client || !client.active) return oauthError("invalid_client", "Unknown or inactive client_id");
  if (!client.redirect_uris.includes(redirectUri)) {
    return oauthError("invalid_redirect_uri", "redirect_uri is not registered for this client");
  }

  // Derive audit label. client_name comes from DCR; falls back to client_id if absent.
  const userLabel = (client.client_name && client.client_name !== "unknown")
    ? client.client_name
    : `client:${clientId.slice(0, 16)}`;

  // Mint single-use auth code, store hashed
  const code = randomToken(32);
  const codeHash = await sha256Base64Url(code);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000).toISOString();

  const { error: insertErr } = await sb.from("oauth_authorization_codes").insert({
    code_hash: codeHash,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    user_label: userLabel,
    resource: resource || null,
    expires_at: expiresAt,
  });

  if (insertErr) {
    console.error("oauth_authorization_codes insert failed:", insertErr.message);
    return oauthError("server_error", insertErr.message, 500);
  }

  // Redirect back to the client with the code (and state, if provided)
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return Response.redirect(redirect.toString(), 302);
}

// ─── Route: POST /token (code exchange) ─────────────────────────────────────

async function handleToken(req: Request): Promise<Response> {
  const ct = req.headers.get("Content-Type") ?? "";
  let params: URLSearchParams;
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (ct.includes("application/json")) {
    const body = (await req.json()) as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    return oauthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded or application/json");
  }

  const grantType = params.get("grant_type");
  if (grantType !== "authorization_code") {
    return oauthError("unsupported_grant_type", `grant_type=${grantType} is not supported`);
  }

  const code = params.get("code") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeVerifier = params.get("code_verifier") ?? "";

  // Client authentication — try Basic header first, then form params.
  let clientIdAuth = "";
  let clientSecretAuth = "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6));
      const sep = decoded.indexOf(":");
      if (sep >= 0) {
        clientIdAuth = decodeURIComponent(decoded.slice(0, sep));
        clientSecretAuth = decodeURIComponent(decoded.slice(sep + 1));
      }
    } catch { /* fall through */ }
  }
  if (!clientIdAuth) {
    clientIdAuth = params.get("client_id") ?? "";
    clientSecretAuth = params.get("client_secret") ?? "";
  }

  if (!code || !codeVerifier || !clientIdAuth || !redirectUri) {
    return oauthError("invalid_request", "Missing code, code_verifier, client_id, or redirect_uri");
  }

  const { data: client, error: clientErr } = await sb
    .from("oauth_clients")
    .select("id, client_secret_hash, redirect_uris, active, token_endpoint_auth_method")
    .eq("id", clientIdAuth)
    .maybeSingle();
  if (clientErr) return oauthError("server_error", clientErr.message, 500);
  if (!client || !client.active) return oauthError("invalid_client", "Unknown or inactive client_id", 401);

  if (client.client_secret_hash) {
    if (!clientSecretAuth) return oauthError("invalid_client", "Client secret required", 401);
    const secretHash = await sha256Base64Url(clientSecretAuth);
    if (secretHash !== client.client_secret_hash) {
      return oauthError("invalid_client", "Invalid client secret", 401);
    }
  }

  const codeHash = await sha256Base64Url(code);
  const { data: codeRow, error: codeErr } = await sb
    .from("oauth_authorization_codes")
    .select("client_id, redirect_uri, code_challenge, code_challenge_method, scope, user_label, resource, expires_at, used_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (codeErr) return oauthError("server_error", codeErr.message, 500);
  if (!codeRow) return oauthError("invalid_grant", "Authorization code is unknown");
  if (codeRow.used_at) return oauthError("invalid_grant", "Authorization code already used");
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    return oauthError("invalid_grant", "Authorization code expired");
  }
  if (codeRow.client_id !== clientIdAuth) {
    return oauthError("invalid_grant", "Authorization code was issued to a different client");
  }
  if (codeRow.redirect_uri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorize request");
  }

  const pkceOk = await verifyPkce(
    codeVerifier,
    codeRow.code_challenge,
    codeRow.code_challenge_method as "S256" | "plain",
  );
  if (!pkceOk) return oauthError("invalid_grant", "PKCE code_verifier does not match challenge");

  // Mark code used (single-use). Race-safe via the `used_at IS NULL` filter.
  const { data: marked, error: markErr } = await sb
    .from("oauth_authorization_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .select("code_hash")
    .maybeSingle();
  if (markErr) return oauthError("server_error", markErr.message, 500);
  if (!marked) return oauthError("invalid_grant", "Authorization code already used (race)");

  const accessToken = randomToken(32);
  const accessTokenHash = await sha256Base64Url(accessToken);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();

  const { error: tokenErr } = await sb.from("oauth_access_tokens").insert({
    token_hash: accessTokenHash,
    client_id: clientIdAuth,
    user_label: codeRow.user_label,
    scope: codeRow.scope,
    resource: codeRow.resource,
    expires_at: expiresAt,
  });
  if (tokenErr) {
    console.error("oauth_access_tokens insert failed:", tokenErr.message);
    return oauthError("server_error", tokenErr.message, 500);
  }

  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope: codeRow.scope,
  });
}

// ─── Main entry ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const path = stripFunctionPrefix(req, FUNCTION_NAME);

  try {
    if (
      req.method === "GET" &&
      (path === "/.well-known/oauth-authorization-server" ||
        path === "/.well-known/openid-configuration")
    ) {
      return handleDiscovery();
    }
    if (req.method === "POST" && path === "/register") {
      return await handleRegister(req);
    }
    if (req.method === "GET" && path === "/authorize") {
      return await handleAuthorizeGet(req);
    }
    if (req.method === "POST" && path === "/token") {
      return await handleToken(req);
    }
    if (req.method === "GET" && (path === "/" || path === "")) {
      return json({ ok: true, server: FUNCTION_NAME, issuer: functionUrl(FUNCTION_NAME) });
    }

    return json({ error: "not_found", path }, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${FUNCTION_NAME} unhandled:`, msg);
    return oauthError("server_error", msg, 500);
  }
});
