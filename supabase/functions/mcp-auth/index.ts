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

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_CODE_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  type AuthServerMetadata,
  canonicalizeResource,
  functionUrl,
  getExpectedMcpResource,
  randomToken,
  sha256Base64Url,
  stripFunctionPrefix,
  verifyPkce,
} from "../_shared/oauth.ts";
import { Sentry, withSentryScope } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";

const FUNCTION_NAME = "mcp-auth";

// Env-gated bootstrap secret for Dynamic Client Registration (RFC 7591).
//
// FAIL-CLOSED: the /register endpoint self-registers an OAuth client which then
// auto-approves on /authorize → a working access token bound to orchestrator-mcp.
// Left open, ANY unauthenticated caller can mint a client + drive the MCP tools
// as an anonymous actor. To close that front door:
//   - If MCP_DCR_BOOTSTRAP_SECRET is UNSET → /register is DISABLED (403).
//   - If it is SET → callers MUST present it in the `X-DCR-Bootstrap-Secret`
//     header (constant-time compare via bearersEqual). Mismatch/absent → 403.
// Deploying with the env unset immediately closes the hole; Chris sets the
// secret via `supabase secrets set MCP_DCR_BOOTSTRAP_SECRET=...` ONLY if/when he
// needs to register a new client. This gates ONLY /register — /token, /authorize,
// refresh, and already-registered clients (+ their refresh tokens) are untouched.
const DCR_BOOTSTRAP_SECRET_ENV = "MCP_DCR_BOOTSTRAP_SECRET";
/** Header a /register caller presents the bootstrap secret in. */
const DCR_BOOTSTRAP_HEADER = "X-DCR-Bootstrap-Secret";

// test seam — see index.test.ts. `sb` is lazily initialized via a Proxy so
// tests can swap the underlying client via _setSupabaseClientForTesting()
// WITHOUT triggering createClient() (which needs SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY at module load). In production the first property
// access constructs the real service-role client. Mirrors the established
// seam in keytag-tekmetric-webhook/index.ts.
// deno-lint-ignore no-explicit-any
let _sbImpl: any = null;

// deno-lint-ignore no-explicit-any
function _getSbImpl(): any {
  if (_sbImpl === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    _sbImpl = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _sbImpl;
}

// deno-lint-ignore no-explicit-any
const sb = new Proxy({} as any, {
  get(_target, prop, _receiver): unknown {
    const impl = _getSbImpl();
    const val = impl[prop];
    return typeof val === "function" ? val.bind(impl) : val;
  },
});

/**
 * Test-only: replace the module-level Supabase client with a mock. Setting any
 * non-null value bypasses lazy-init in _getSbImpl(). Production never calls this.
 */
export function _setSupabaseClientForTesting(client: unknown): void {
  _sbImpl = client;
}

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
    grant_types_supported: ["authorization_code", "refresh_token"],
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

/**
 * Rejects a /register call, logs it (so probing is visible), and returns the
 * OAuth-style 403. `description` distinguishes "disabled" (env unset) from
 * "requires a bootstrap secret" (env set, secret wrong/absent).
 */
function rejectRegistration(description: string, reason: string): Response {
  Sentry.captureMessage("OAuth /register rejected — bootstrap gate", {
    level: "warning",
    tags: { oauth_event: "register_rejected" },
    extra: { reason },
  });
  return oauthError("access_denied", description, 403);
}

/**
 * FAIL-CLOSED bootstrap-secret gate for Dynamic Client Registration. Returns a
 * 403 Response to short-circuit on rejection, or null to let registration
 * proceed. See the DCR_BOOTSTRAP_SECRET_ENV comment block above for the policy.
 */
function checkDcrBootstrap(req: Request): Response | null {
  const configured = Deno.env.get(DCR_BOOTSTRAP_SECRET_ENV);
  // Env unset (or empty) → registration is disabled. This is the default and
  // closes the hole the moment this ships without any secret being set.
  if (!configured) {
    return rejectRegistration("dynamic client registration is disabled", "env_unset");
  }
  const presented = req.headers.get(DCR_BOOTSTRAP_HEADER) ?? "";
  // Constant-time compare (bearersEqual) — never `===`, which can leak per-byte
  // timing on the secret.
  if (!presented || !bearersEqual(presented, configured)) {
    return rejectRegistration(
      "dynamic client registration requires a bootstrap secret",
      presented ? "secret_mismatch" : "secret_absent",
    );
  }
  return null;
}

export async function handleRegister(req: Request): Promise<Response> {
  // FAIL-CLOSED gate — must run BEFORE any client is minted.
  const gate = checkDcrBootstrap(req);
  if (gate) return gate;

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
  const rawResource = params.get("resource");

  if (!clientId || !redirectUri || !responseType || !codeChallenge) {
    return oauthError("invalid_request", "Missing required parameter (client_id, redirect_uri, response_type, code_challenge)");
  }
  if (responseType !== "code") {
    return oauthError("unsupported_response_type", `Only response_type=code is supported, got: ${responseType}`);
  }
  if (codeChallengeMethod !== "S256") {
    return oauthError("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  // RFC 8707 + MCP spec 2025-11-25: clients MUST send `resource` on /authorize.
  // Strict rejection if missing — older Claude Desktop builds that don't send
  // it must be upgraded; the 30-day backward-compat window in orchestrator-mcp
  // (NULL token.resource = allow + log) absorbs legacy tokens already in
  // circulation, NOT new /authorize calls from out-of-date clients.
  if (!rawResource) {
    Sentry.captureMessage("OAuth /authorize missing RFC 8707 resource indicator", {
      level: "warning",
      tags: { oauth_event: "authorize_missing_resource", client_id: clientId },
    });
    return oauthError(
      "invalid_request",
      "missing resource indicator (RFC 8707) — MCP spec 2025-11-25 requires `resource` on /authorize",
    );
  }

  const canonicalResource = canonicalizeResource(rawResource);
  if (!canonicalResource) {
    Sentry.captureMessage("OAuth /authorize malformed resource indicator", {
      level: "warning",
      tags: { oauth_event: "authorize_malformed_resource", client_id: clientId },
      extra: { raw_resource: rawResource },
    });
    return oauthError(
      "invalid_target",
      "resource indicator is not a valid http(s) absolute URI (RFC 8707 §2 — no fragment, http or https scheme)",
    );
  }

  // Audience binding: the resource MUST identify this MCP server. Tokens issued
  // for some OTHER resource (even one that uses the same auth provider) must
  // NOT be acceptable here. This is the core defence against the "confused
  // deputy" vulnerability that motivated RFC 8707.
  const expectedResource = getExpectedMcpResource();
  if (canonicalResource !== expectedResource) {
    Sentry.captureMessage("OAuth /authorize resource mismatch", {
      level: "warning",
      tags: { oauth_event: "authorize_resource_mismatch", client_id: clientId },
      extra: {
        requested_resource: canonicalResource,
        expected_resource: expectedResource,
      },
    });
    return oauthError(
      "invalid_target",
      `resource does not match this MCP server (expected ${expectedResource})`,
    );
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
    resource: canonicalResource,
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

// ─── Route: POST /token (code exchange OR refresh) ─────────────────────────

/**
 * Atomically inserts an access_token + refresh_token pair bound to the same
 * identity and token FAMILY. Called from BOTH grant types — authorization_code
 * (initial issue, fresh familyId) and refresh_token (rotation, inherited
 * familyId). Returns the OAuth-spec response body to send to the client, or an
 * error Response on DB failure.
 *
 * L4: the two rows are inserted by a single SECURITY DEFINER RPC
 * (`oauth_issue_token_pair`) so they commit in one transaction. The previous
 * implementation did two sequential `.insert()` calls — a partial-failure
 * window where the access row could persist without its refresh row.
 */
async function issueTokenPair(args: {
  clientId: string;
  userLabel: string;
  scope: string;
  resource: string | null;
  familyId: string; // fresh uuid on initial issue, inherited on rotation
  parentRefreshTokenHash: string | null; // null on initial issue, set on rotation
}): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const { clientId, userLabel, scope, resource, familyId, parentRefreshTokenHash } = args;

  const accessToken = randomToken(32);
  const accessTokenHash = await sha256Base64Url(accessToken);

  const refreshToken = randomToken(48);
  const refreshTokenHash = await sha256Base64Url(refreshToken);

  // Single transaction: both rows commit together or not at all (L4).
  const { error: issueErr } = await sb.rpc("oauth_issue_token_pair", {
    p_access_token_hash: accessTokenHash,
    p_refresh_token_hash: refreshTokenHash,
    p_client_id: clientId,
    p_user_label: userLabel,
    p_scope: scope,
    p_resource: resource,
    p_family_id: familyId,
    p_parent_token_hash: parentRefreshTokenHash,
    p_access_ttl_seconds: ACCESS_TOKEN_TTL_SEC,
    p_refresh_ttl_seconds: REFRESH_TOKEN_TTL_SEC,
  });
  if (issueErr) {
    console.error("oauth_issue_token_pair RPC failed:", issueErr.message);
    return { ok: false, response: oauthError("server_error", issueErr.message, 500) };
  }

  return {
    ok: true,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: refreshToken,
      scope,
    },
  };
}

/**
 * Validates the client_id (+ optional secret) on the /token endpoint.
 * Shared between authorization_code and refresh_token grants.
 */
async function authenticateTokenClient(
  req: Request,
  params: URLSearchParams,
): Promise<
  | {
      ok: true;
      clientId: string;
      tokenEndpointAuthMethod: string;
      requiresSecret: boolean;
    }
  | { ok: false; response: Response }
> {
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
  if (!clientIdAuth) {
    return { ok: false, response: oauthError("invalid_request", "Missing client_id") };
  }

  const { data: client, error: clientErr } = await sb
    .from("oauth_clients")
    .select("id, client_secret_hash, redirect_uris, active, token_endpoint_auth_method")
    .eq("id", clientIdAuth)
    .maybeSingle();
  if (clientErr) {
    return { ok: false, response: oauthError("server_error", clientErr.message, 500) };
  }
  if (!client || !client.active) {
    return { ok: false, response: oauthError("invalid_client", "Unknown or inactive client_id", 401) };
  }

  const requiresSecret = !!client.client_secret_hash;
  if (requiresSecret) {
    if (!clientSecretAuth) {
      return { ok: false, response: oauthError("invalid_client", "Client secret required", 401) };
    }
    const secretHash = await sha256Base64Url(clientSecretAuth);
    if (secretHash !== client.client_secret_hash) {
      return { ok: false, response: oauthError("invalid_client", "Invalid client secret", 401) };
    }
  }

  return {
    ok: true,
    clientId: clientIdAuth,
    tokenEndpointAuthMethod: client.token_endpoint_auth_method as string,
    requiresSecret,
  };
}

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

  if (grantType === "refresh_token") {
    return handleRefreshTokenGrant(req, params);
  }
  if (grantType !== "authorization_code") {
    return oauthError(
      "unsupported_grant_type",
      `grant_type=${grantType} is not supported (allowed: authorization_code, refresh_token)`,
    );
  }

  const code = params.get("code") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeVerifier = params.get("code_verifier") ?? "";

  if (!code || !codeVerifier || !redirectUri) {
    return oauthError("invalid_request", "Missing code, code_verifier, or redirect_uri");
  }

  // Authenticate the client (Basic header OR form params) — shared with refresh grant.
  const clientAuth = await authenticateTokenClient(req, params);
  if (!clientAuth.ok) return clientAuth.response;
  const clientIdAuth = clientAuth.clientId;

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

  // RFC 8707 §2.2 + MCP spec 2025-11-25: clients SHOULD send `resource` on
  // /token. If they do, it MUST match the resource that was sent on /authorize.
  // We don't require it on /token — RFC 8707 allows it to be omitted to inherit
  // the code's resource — but if the client supplies one, we hard-validate.
  //
  // Note: we DO require resource on /authorize (strict per MCP spec). Once that
  // gate is enforced, codeRow.resource is always non-null for any code issued
  // after this change ships. Legacy in-flight codes from before the deploy
  // could have a null resource (the 10-min TTL bounds that window to ~10 min
  // post-deploy); we treat null-on-code as "client never said anything about
  // resource" and require token-side resource (if any) to also be unset.
  const rawTokenResource = params.get("resource");
  if (rawTokenResource !== null) {
    const canonTokenResource = canonicalizeResource(rawTokenResource);
    if (!canonTokenResource) {
      Sentry.captureMessage("OAuth /token malformed resource indicator", {
        level: "warning",
        tags: { oauth_event: "token_malformed_resource", client_id: clientIdAuth },
        extra: { raw_resource: rawTokenResource },
      });
      return oauthError(
        "invalid_target",
        "resource indicator is not a valid http(s) absolute URI (RFC 8707 §2)",
      );
    }
    if (canonTokenResource !== codeRow.resource) {
      Sentry.captureMessage("OAuth /token resource mismatch with /authorize", {
        level: "warning",
        tags: { oauth_event: "token_resource_mismatch", client_id: clientIdAuth },
        extra: {
          token_request_resource: canonTokenResource,
          auth_code_resource: codeRow.resource,
        },
      });
      return oauthError(
        "invalid_target",
        "resource indicator on /token does not match the value sent on /authorize (RFC 8707)",
      );
    }
  }

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

  // Issue an access + refresh token pair bound to this consent. A fresh
  // authorization grant starts a NEW token family — every rotation descended
  // from this consent inherits this familyId, so the whole chain can be
  // revoked together if a stolen refresh token is ever replayed (M7).
  const issued = await issueTokenPair({
    clientId: clientIdAuth,
    userLabel: codeRow.user_label,
    scope: codeRow.scope,
    resource: codeRow.resource,
    familyId: crypto.randomUUID(),
    parentRefreshTokenHash: null,
  });
  if (!issued.ok) return issued.response;
  return json(issued.body);
}

// ─── Route: POST /token grant_type=refresh_token ────────────────────────────
//
// Validates the presented refresh_token, atomically marks it revoked (via
// the oauth_consume_refresh_token RPC), and issues a fresh access+refresh
// pair. Rotation is mandatory per OAuth 2.1 §6.1 — the old refresh token
// is dead the moment it's accepted, so a stolen replay returns invalid_grant.

export async function handleRefreshTokenGrant(
  req: Request,
  params: URLSearchParams,
): Promise<Response> {
  const refreshToken = params.get("refresh_token") ?? "";
  if (!refreshToken) {
    return oauthError("invalid_request", "Missing refresh_token");
  }

  const clientAuth = await authenticateTokenClient(req, params);
  if (!clientAuth.ok) return clientAuth.response;
  const clientIdAuth = clientAuth.clientId;

  // Atomically rotate the presented token AND classify the outcome. The RPC
  // returns a `status` discriminator:
  //   'rotated' → token was active, is now consumed (happy path)
  //   'reuse'   → an ALREADY-revoked token was replayed → THEFT signal
  //               (RFC 6819 §5.2.2.3 / OAuth 2.1 §6.1): two parties hold this
  //               token. Revoke the ENTIRE family (all access + refresh
  //               tokens descended from the same authorization grant) and
  //               return invalid_grant.
  //   'invalid' → unknown / expired token → plain invalid_grant.
  const refreshTokenHash = await sha256Base64Url(refreshToken);
  const { data: consumeRows, error: consumeErr } = await sb.rpc(
    "oauth_consume_refresh_token",
    { p_token_hash: refreshTokenHash },
  );
  if (consumeErr) {
    console.error("oauth_consume_refresh_token RPC failed:", consumeErr.message);
    return oauthError("server_error", consumeErr.message, 500);
  }
  const consumed = Array.isArray(consumeRows) ? consumeRows[0] : consumeRows;
  // The RPC always returns exactly one row with a status. A missing row means
  // the RPC shape is wrong — fail closed.
  if (!consumed || typeof consumed.status !== "string") {
    console.error("oauth_consume_refresh_token returned no status row");
    return oauthError("server_error", "refresh token consume returned no status", 500);
  }

  if (consumed.status === "reuse") {
    // Reuse detection: a refresh token that was already rotated/revoked has
    // been presented again. Revoke the whole family — the legitimate holder's
    // current tokens included, because we cannot tell attacker from victim and
    // the safe action is to force a re-consent.
    //
    // Gate the family sweep on the consumed token's client_id matching the
    // authenticated client. Anyone replaying a refresh token already holds its
    // raw value, so this is not a confidentiality boundary — but it stops a
    // caller authenticated as client X from triggering revocation of an
    // unrelated client Y's family (a cross-client DoS) by replaying a token
    // they somehow obtained. Either way the presented (revoked) token does not
    // succeed; we just scope the blast radius of the family sweep.
    const tokenClientId = (consumed.client_id as string | null) ?? null;
    const familyId = tokenClientId === clientIdAuth
      ? ((consumed.family_id as string | null) ?? null)
      : null;
    let revokeSummary: unknown = null;
    if (familyId) {
      const { data: revokeRows, error: revokeErr } = await sb.rpc(
        "oauth_revoke_token_family",
        { p_family_id: familyId },
      );
      if (revokeErr) {
        // Log but still return invalid_grant — the presented token is already
        // revoked (the consume RPC saw it as such), so the replay does not
        // succeed regardless of whether the family sweep landed.
        console.error("oauth_revoke_token_family RPC failed:", revokeErr.message);
      } else {
        revokeSummary = Array.isArray(revokeRows) ? revokeRows[0] : revokeRows;
      }
    }
    Sentry.captureMessage("OAuth refresh-token REUSE detected — family revoked", {
      level: "warning",
      tags: {
        oauth_event: "refresh_token_reuse",
        client_id: (consumed.client_id as string | null) ?? clientIdAuth,
      },
      extra: {
        family_id: familyId,
        revoked: revokeSummary,
        // Don't log the raw token; the hash is enough to correlate in DB.
        presented_token_hash_prefix: refreshTokenHash.slice(0, 12),
      },
    });
    return oauthError(
      "invalid_grant",
      "Refresh token has already been used — the token family has been revoked. Re-authorize to continue.",
    );
  }

  if (consumed.status !== "rotated") {
    // 'invalid' (unknown / expired) — nothing to revoke.
    return oauthError("invalid_grant", "Refresh token is unknown, expired, or revoked");
  }

  if (consumed.client_id !== clientIdAuth) {
    return oauthError("invalid_grant", "Refresh token was issued to a different client");
  }

  // Per OAuth 2.1 §6, scope on refresh MUST NOT broaden. The client may
  // request a narrower scope via the optional `scope` param; otherwise we
  // re-issue with the original scope.
  const requestedScope = params.get("scope");
  const newScope =
    requestedScope && isScopeSubset(requestedScope, consumed.scope as string)
      ? requestedScope
      : (consumed.scope as string);

  // RFC 8707: if the client sends `resource` on a refresh-token grant, it MUST
  // be one of the originally granted resources. We bind tokens to a single
  // resource at issue time, so the match is strict equality with the refresh
  // token's stored resource. The new access+refresh pair inherits the original
  // resource — narrowing is impossible (the chain only has one audience) and
  // broadening is forbidden by the spec.
  const refreshResource = (consumed.resource as string | null) ?? null;
  const rawRefreshTokenResource = params.get("resource");
  if (rawRefreshTokenResource !== null) {
    const canonRefreshTokenResource = canonicalizeResource(rawRefreshTokenResource);
    if (!canonRefreshTokenResource) {
      Sentry.captureMessage("OAuth /token (refresh) malformed resource indicator", {
        level: "warning",
        tags: { oauth_event: "refresh_malformed_resource", client_id: clientIdAuth },
        extra: { raw_resource: rawRefreshTokenResource },
      });
      return oauthError(
        "invalid_target",
        "resource indicator is not a valid http(s) absolute URI (RFC 8707 §2)",
      );
    }
    if (canonRefreshTokenResource !== refreshResource) {
      Sentry.captureMessage("OAuth /token (refresh) resource mismatch", {
        level: "warning",
        tags: { oauth_event: "refresh_resource_mismatch", client_id: clientIdAuth },
        extra: {
          refresh_request_resource: canonRefreshTokenResource,
          refresh_token_resource: refreshResource,
        },
      });
      return oauthError(
        "invalid_target",
        "resource indicator on refresh does not match the originally-granted resource (RFC 8707)",
      );
    }
  }

  // Rotation stays in the SAME token family as the consumed token, so a later
  // reuse anywhere in the chain revokes this descendant too (M7).
  const familyId = consumed.family_id as string;
  const issued = await issueTokenPair({
    clientId: clientIdAuth,
    userLabel: consumed.user_label as string,
    scope: newScope,
    resource: refreshResource,
    familyId,
    parentRefreshTokenHash: refreshTokenHash,
  });
  if (!issued.ok) return issued.response;
  return json(issued.body);
}

/**
 * Returns true if `requested` is a subset of `granted` (space-separated
 * scope strings per RFC 6749). Used to enforce "refresh MUST NOT broaden".
 */
function isScopeSubset(requested: string, granted: string): boolean {
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  const requestedList = requested.split(/\s+/).filter(Boolean);
  return requestedList.every((s) => grantedSet.has(s));
}

// ─── Main entry ─────────────────────────────────────────────────────────────

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) => withSentryScope(req, "mcp-auth", async () => {
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
}));
