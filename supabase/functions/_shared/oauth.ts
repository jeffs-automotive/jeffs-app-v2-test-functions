// Shared low-level helpers: crypto-random tokens, base64url encoding, HTML
// escaping, and Supabase Edge Function URL/path helpers.
//
// HISTORY: until 2026-07-23 this file also held the MCP OAuth 2.1 primitives —
// SHA-256 token hashing, PKCE verification, RFC 8707 resource-indicator
// canonicalisation, access/refresh-token TTLs, and the AS/PRM metadata types.
// Those were removed together with the `mcp-auth` function and orchestrator's
// OAuth bearer branch when Claude Desktop was retired. What remains is used by:
//   - qbo-oauth-callback  → randomToken (Intuit OAuth `state`), base64UrlEncode,
//                           functionUrl (redirect URL)
//   - orchestrator + tekbridge → stripFunctionPrefix (internal path routing)
//   - the email builders (manual-review, transcript, tekbridge alert, keytag
//     daily report) → escapeHtml

// ─── Crypto primitives ──────────────────────────────────────────────────────

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

// ─── HTML rendering helper ──────────────────────────────────────────────────

/**
 * Escapes user-supplied values before injecting into HTML. Anything that came
 * from the network (form fields, tool args, external API data) MUST go through
 * this before being put in attribute values or text — protects against
 * reflected XSS.
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
 *   In:  https://x.supabase.co/functions/v1/tekbridge/session
 *   Out: /session
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
