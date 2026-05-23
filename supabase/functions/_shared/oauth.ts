// Shared OAuth 2.1 helpers used by mcp-auth (server-side flow) and orchestrator-mcp
// (token validation on each request).
//
// Token storage rule: we hash with SHA-256 + url-safe base64 before any DB write.
// Raw tokens never land in the DB; if the table is leaked, attackers can't replay.

// ─── Crypto primitives ──────────────────────────────────────────────────────

const encoder = new TextEncoder();

/** Generates a cryptographically random url-safe string of `bytes` random bytes. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** Base64url-encodes a Uint8Array (no padding, URL-safe alphabet). */
export function base64UrlEncode(buf: Uint8Array): string {
  // btoa expects a binary string
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** SHA-256 hash of a string, base64url-encoded — used for token-at-rest storage. */
export async function sha256Base64Url(input: string): Promise<string> {
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * PKCE verifier check.
 *   method=S256: stored challenge == sha256Base64Url(verifier)
 *   method=plain: stored challenge == verifier (we accept but discourage)
 */
export async function verifyPkce(
  verifier: string,
  challenge: string,
  method: "S256" | "plain",
): Promise<boolean> {
  if (method === "plain") return verifier === challenge;
  const computed = await sha256Base64Url(verifier);
  return computed === challenge;
}

// ─── HTML rendering for the consent page (no template engine — keep tiny) ───

/**
 * Escapes user-supplied values before injecting into HTML. Anything that came
 * from the network (client_id, redirect_uri, state, scope) MUST go through this
 * before being put in attribute values or text — protects against reflected XSS
 * if a malicious client uses crafted params.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── URL helpers ────────────────────────────────────────────────────────────

/**
 * Strips the `/functions/v1/<function-name>` prefix from a Supabase Edge Function
 * URL so we can do internal path routing on the remainder.
 *
 * Example:
 *   In:  https://x.supabase.co/functions/v1/mcp-auth/.well-known/oauth-authorization-server
 *   Out: /.well-known/oauth-authorization-server
 *
 * If the prefix doesn't match (running locally, or unexpected layout), returns
 * the untouched pathname so the caller can still match it.
 */
export function stripFunctionPrefix(req: Request, functionName: string): string {
  const url = new URL(req.url);
  const prefix = `/functions/v1/${functionName}`;
  if (url.pathname === prefix) return "/";
  if (url.pathname.startsWith(prefix + "/")) {
    return url.pathname.slice(prefix.length) || "/";
  }
  // Local serve under `supabase functions serve` mounts at /<function-name>
  if (url.pathname === `/${functionName}`) return "/";
  if (url.pathname.startsWith(`/${functionName}/`)) {
    return url.pathname.slice(`/${functionName}`.length) || "/";
  }
  return url.pathname;
}

/** Reads the canonical issuer / external base URL for this deployment. */
export function getIssuerUrl(): string {
  // SUPABASE_URL points at the project (https://<ref>.supabase.co); the function
  // base lives at /functions/v1/<name>. We let callers append the function name.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL not set in edge runtime env");
  return supabaseUrl.replace(/\/+$/, "");
}

export function functionUrl(functionName: string): string {
  return `${getIssuerUrl()}/functions/v1/${functionName}`;
}

// ─── RFC 8707 resource indicator helpers ────────────────────────────────────
//
// MCP Authorization spec (2025-11-25) §"Resource Parameter Implementation"
// requires clients to send `resource` on BOTH /authorize and /token and use
// the canonical MCP server URL. RFC 8707 §2 defines the URI format:
//   - MUST be absolute URI (RFC 3986 §4.3)
//   - MUST NOT include a fragment
//   - SHOULD NOT include a query (we allow none for our purposes)
// MCP spec adds:
//   - Examples use the form WITHOUT a trailing slash
//   - Implementations SHOULD accept uppercase scheme/host for robustness but
//     emit lowercase
//   - Only http/https schemes are valid for our protected resource (the
//     edge function is HTTPS-only in prod, http allowed only for `localhost`
//     so we don't break local `supabase functions serve` dev loops)

/**
 * Canonicalises an RFC 8707 resource indicator for storage + comparison.
 *
 * Returns a structurally-valid canonical string on success, or null if the
 * value is missing/malformed (caller MUST reject with `invalid_target`).
 *
 * Canonicalisation rules (MCP spec 2025-11-25 + RFC 8707 §2):
 *   - Reject empty / non-string / unparseable / non-http(s) / fragment-bearing
 *     values
 *   - Lowercase scheme + host (RFC 3986 §6.2.2.1)
 *   - Strip default port (`:443` for https, `:80` for http) when present
 *   - Strip a single trailing slash from the path unless the path IS "/"
 *   - Drop fragment outright (already covered by the reject branch above —
 *     defence in depth in case the URL parser tolerates one)
 *   - Preserve query and userinfo if present (we don't generate either, but
 *     don't silently strip in case a client legitimately includes one)
 */
export function canonicalizeResource(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.hash) return null; // RFC 8707 §2: "MUST NOT include a fragment"

  // URL ctor already lowercases scheme + host, but be explicit so any future
  // refactor that introduces manual concatenation can't silently regress.
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  // Drop default port (URL ctor leaves it out for canonical schemes, but
  // tolerate explicit `:443` / `:80` for robustness per MCP spec).
  let portPart = "";
  if (parsed.port) {
    const isDefault =
      (scheme === "https:" && parsed.port === "443") ||
      (scheme === "http:" && parsed.port === "80");
    portPart = isDefault ? "" : `:${parsed.port}`;
  }

  // Strip a single trailing slash from path unless path is the bare root "/".
  // MCP spec recommends form WITHOUT trailing slash for interoperability.
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  const userinfo = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
    : "";

  return `${scheme}//${userinfo}${host}${portPart}${path}${parsed.search}`;
}

/**
 * Returns the canonical RFC 8707 resource value for this MCP server. Clients
 * MUST send exactly this value (or one that canonicalises to exactly this)
 * on /authorize and /token. orchestrator-mcp validates the access-token's
 * stored resource against this on every call.
 *
 * Source-of-truth: `functionUrl(MCP_RESOURCE_FUNCTION)` — the same URL
 * advertised in the Protected Resource Metadata endpoint. Keeping it derived
 * from a single helper means any future deploy-url change propagates to AS,
 * RS, and PRM consistently.
 */
export const MCP_RESOURCE_FUNCTION = "orchestrator-mcp";

export function getExpectedMcpResource(): string {
  // functionUrl() emits canonical form already (lowercase, no trailing slash),
  // but we run it through the canonicaliser for defence in depth — a future
  // SUPABASE_URL with trailing slash or uppercase would otherwise break audience
  // matching silently.
  const canonical = canonicalizeResource(functionUrl(MCP_RESOURCE_FUNCTION));
  if (!canonical) {
    // Unreachable in practice — functionUrl emits a valid https URL — but
    // throwing here surfaces a deploy-config mistake LOUDLY instead of
    // silently rejecting every OAuth call.
    throw new Error("getExpectedMcpResource: functionUrl did not produce a canonicalisable URL");
  }
  return canonical;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Authorization-code TTL — single-use codes, narrow window per OAuth 2.1 guidance. */
export const AUTH_CODE_TTL_SEC = 10 * 60; // 10 minutes

/**
 * Access-token TTL. Short by design — refresh tokens (added 2026-05-11)
 * handle silent renewal so this can be aggressive without UX cost.
 * 1 hour balances "tight enough that a leaked token has limited blast
 * radius" against "loose enough that we're not refreshing constantly".
 */
export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour

/**
 * Refresh-token TTL. 90 days = re-consent quarterly. Rotated on every
 * use (per OAuth 2.1 §6.1) so the EFFECTIVE TTL is whichever comes
 * first: 90d sliding window OR explicit revoke.
 */
export const REFRESH_TOKEN_TTL_SEC = 90 * 24 * 60 * 60; // 90 days

/** What we serve for the /.well-known/oauth-authorization-server discovery doc. */
export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

/** What we serve for /.well-known/oauth-protected-resource on orchestrator-mcp. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}
