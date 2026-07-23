// _shared/tekbridge/session.ts
//
// The tekbridge **session layer** — owns the bot's Tekmetric web-session JWT.
//
//   - decode/inspect the JWT (exp + claims) WITHOUT verifying its signature
//     (we don't hold Tekmetric's signing key; we only need `exp` for expiry
//     and non-secret claims like shopId for audit)
//   - read the JWT from Vault (cached module-scope, like tekmetric-client.ts)
//   - store a freshly-submitted JWT into Vault + record health in
//     `tekbridge_session_state`
//   - mark the session stale (on a 401 from the internal API) so the gateway
//     can surface "session needs refresh" instead of hammering Tekmetric
//
// Observability rule 9: every Supabase call checks `error`. No silent failures.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  TEKBRIDGE_JWT_EXPIRY_SKEW_SECONDS,
  TEKBRIDGE_SESSION_JWT_SECRET,
} from "./constants.ts";

// ─── Errors ──────────────────────────────────────────────────────────────────

export type TekbridgeSessionCode =
  | "no_session" // Vault has no JWT — a human must submit one
  | "expired" // JWT past its exp — needs refresh
  | "invalid_jwt"; // submitted value isn't a decodable JWT with an exp

/** Typed session failure. The gateway maps `.code` to a clear, actionable
 *  response ("tekbridge session missing/expired — log the bot in and resubmit")
 *  rather than a generic 500. */
export class TekbridgeSessionError extends Error {
  readonly code: TekbridgeSessionCode;
  constructor(code: TekbridgeSessionCode, message: string) {
    super(message);
    this.name = "TekbridgeSessionError";
    this.code = code;
  }
}

// ─── JWT decode (no signature verification) ──────────────────────────────────

export interface JwtClaims {
  sub?: string;
  userId?: string;
  shopId?: string;
  employeeId?: string;
  employeeRole?: { id?: number; code?: string; name?: string };
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

/**
 * Decode a JWT payload without verifying the signature. Returns null on any
 * malformed input (wrong segment count, bad base64, non-JSON). We never trust
 * these claims for authz — only for reading `exp` (expiry) and non-secret
 * metadata (shopId/employeeId) for state + audit.
 */
export function decodeJwtClaims(jwt: string): JwtClaims | null {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 (+ padding), then atob → JSON
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as JwtClaims) : null;
  } catch {
    return null;
  }
}

/** The JWT's `exp` (unix seconds), or null if absent/undecodable. */
export function jwtExpiresAt(jwt: string): number | null {
  const claims = decodeJwtClaims(jwt);
  return typeof claims?.exp === "number" ? claims.exp : null;
}

/**
 * True if the JWT is expired (or within `skew` seconds of expiry, or has no
 * usable `exp`). `nowSeconds` is injected for deterministic tests; callers in
 * the edge runtime pass `Date.now() / 1000`.
 */
export function isJwtExpired(
  jwt: string,
  nowSeconds: number,
  skewSeconds: number = TEKBRIDGE_JWT_EXPIRY_SKEW_SECONDS,
): boolean {
  const exp = jwtExpiresAt(jwt);
  if (exp === null) return true; // no exp ⇒ unusable ⇒ treat as expired
  return nowSeconds >= exp - skewSeconds;
}

// ─── Vault-backed JWT read/write ─────────────────────────────────────────────

let cachedJwt: string | null = null;

/** Clears the module-scope JWT cache. Called after a resubmit + on a 401. */
export function clearBotJwtCache(): void {
  cachedJwt = null;
}

/**
 * Read the bot session JWT from Vault (cached for this instance). Throws
 * TekbridgeSessionError("no_session") if Vault has none. Does NOT check expiry
 * here — the client does that so callers get a distinct "expired" signal.
 */
export async function getBotJwt(sb: SupabaseClient): Promise<string> {
  if (cachedJwt) return cachedJwt;
  const { data, error } = await sb.rpc("tekmetric_get_secret", {
    p_name: TEKBRIDGE_SESSION_JWT_SECRET,
  });
  if (error) {
    throw new Error(`tekbridge getBotJwt: tekmetric_get_secret failed: ${error.message}`);
  }
  if (!data || typeof data !== "string") {
    throw new TekbridgeSessionError(
      "no_session",
      `No tekbridge session JWT in Vault ("${TEKBRIDGE_SESSION_JWT_SECRET}"). ` +
        `Log the tekbridge bot into Tekmetric and submit its JWT to the session endpoint.`,
    );
  }
  cachedJwt = data;
  return cachedJwt;
}

/**
 * Store a freshly-minted JWT into Vault + record health. Validates the value is
 * a decodable JWT with an `exp` before persisting (rejects garbage submissions).
 * `shopId` scopes the state row.
 */
export async function setBotJwt(
  sb: SupabaseClient,
  jwt: string,
  shopId: number,
): Promise<{ expiresAt: string }> {
  const claims = decodeJwtClaims(jwt);
  if (!claims || typeof claims.exp !== "number") {
    throw new TekbridgeSessionError(
      "invalid_jwt",
      "Submitted value is not a decodable JWT with an `exp` claim.",
    );
  }
  const expiresAtIso = new Date(claims.exp * 1000).toISOString();

  const { error: secErr } = await sb.rpc("tekmetric_set_secret", {
    p_name: TEKBRIDGE_SESSION_JWT_SECRET,
    p_value: jwt,
    p_description: "tekbridge bot session JWT (x-auth-token for the internal Tekmetric API)",
  });
  if (secErr) {
    throw new Error(`tekbridge setBotJwt: tekmetric_set_secret failed: ${secErr.message}`);
  }
  clearBotJwtCache();

  await upsertSessionState(sb, {
    shopId,
    status: "active",
    expiresAt: expiresAtIso,
    lastError: null,
  });

  return { expiresAt: expiresAtIso };
}

// ─── Session-health state (non-secret row) ───────────────────────────────────

export interface SessionState {
  shopId: number;
  status: "active" | "stale" | "expired";
  expiresAt: string | null;
  lastError: string | null;
}

/** Upsert the `tekbridge_session_state` row for a shop. */
export async function upsertSessionState(
  sb: SupabaseClient,
  state: SessionState,
): Promise<void> {
  const { error } = await sb
    .from("tekbridge_session_state")
    .upsert(
      {
        shop_id: state.shopId,
        status: state.status,
        expires_at: state.expiresAt,
        last_error: state.lastError,
        last_refreshed_at: state.status === "active" ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id" },
    );
  if (error) {
    throw new Error(`tekbridge upsertSessionState failed: ${error.message}`);
  }
}

/**
 * Mark the session stale (on a 401 from the internal API). Clears the cache so
 * the next call re-reads Vault (in case a human just resubmitted a fresh JWT).
 * Never throws on the state write — a failed health write must not mask the
 * original 401; it's logged by the caller's Sentry scope.
 */
export async function markSessionStale(
  sb: SupabaseClient,
  shopId: number,
  reason: string,
): Promise<void> {
  clearBotJwtCache();
  const { error } = await sb
    .from("tekbridge_session_state")
    .upsert(
      {
        shop_id: shopId,
        status: "stale",
        last_error: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id" },
    );
  if (error) {
    // Deliberately swallow-with-log: the caller is already handling the 401;
    // a stale-marker write failure shouldn't throw over it.
    console.error(`tekbridge markSessionStale: state write failed: ${error.message}`);
  }
}

/** Read the current health row (for the gateway's `GET /session`). */
export async function getSessionHealth(
  sb: SupabaseClient,
  shopId: number,
): Promise<SessionState | null> {
  const { data, error } = await sb
    .from("tekbridge_session_state")
    .select("shop_id, status, expires_at, last_error")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) {
    throw new Error(`tekbridge getSessionHealth failed: ${error.message}`);
  }
  if (!data) return null;
  return {
    shopId: data.shop_id as number,
    status: data.status as SessionState["status"],
    expiresAt: (data.expires_at as string | null) ?? null,
    lastError: (data.last_error as string | null) ?? null,
  };
}
