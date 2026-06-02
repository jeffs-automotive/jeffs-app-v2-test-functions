/**
 * QBO token lifecycle (attestation #1) — load the stored connection and
 * autonomously refresh on expiry.
 *
 * `intuit-oauth` owns the token endpoint (refresh + rotation); we persist the
 * rotated refresh_token + new expiries via the `qbo_persist_tokens` Postgres
 * RPC. Single-flight: that RPC does SELECT … FOR UPDATE (C3 migration) so the
 * read-rotate-write is serialized. A concurrent-refresh race is benign — a
 * rotated refresh token's predecessor stays valid ~24h (Intuit), so
 * last-write-wins never locks anyone out. `invalid_grant` → reconnect_required
 * (no silent failure). See docs/qbo/qbo-api-client-plan.md §Token lifecycle.
 */
import OAuthClient from "intuit-oauth";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveQboEnvironment, type QboEnvironment } from "@/lib/qbo/config";
import { QboClientError } from "@/lib/qbo/errors";

/** Refresh when the access token is within this skew of expiry. */
const REFRESH_SKEW_MS = 5 * 60_000;
/** Fallbacks if Intuit omits the lifetimes (access 1h; refresh ~101d). */
const DEFAULT_ACCESS_TTL_S = 3600;
const DEFAULT_REFRESH_TTL_S = 8_726_400;

export interface QboConnection {
  realmId: string;
  environment: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number; // epoch ms
  refreshTokenExpiresAt: number; // epoch ms
}

interface ConnectionRow {
  realm_id: string;
  environment: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
}

function rowToConnection(row: ConnectionRow): QboConnection {
  return {
    realmId: row.realm_id,
    environment: row.environment,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: Date.parse(row.access_token_expires_at),
    refreshTokenExpiresAt: Date.parse(row.refresh_token_expires_at),
  };
}

/**
 * Load the stored QBO connection (the RPC decrypts the secrets). Returns null
 * when no connection exists (not yet authorized). Throws on a DB error
 * (no silent failure).
 */
export async function loadConnection(
  realmId?: string,
): Promise<QboConnection | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("qbo_get_connection", {
    p_realm_id: realmId ?? null,
  });
  if (error) {
    throw new QboClientError(`qbo_get_connection failed: ${error.message}`, {
      kind: "unknown",
      cause: error,
    });
  }
  const row = (Array.isArray(data) ? data[0] : data) as ConnectionRow | null;
  return row ? rowToConnection(row) : null;
}

/** Broadly detect an `invalid_grant` across intuit-oauth's error shapes. */
function isInvalidGrant(e: unknown): boolean {
  const o = e as Record<string, unknown>;
  return [o?.error, o?.code, o?.error_description, o?.description, (e as Error)?.message]
    .map((v) => (typeof v === "string" ? v : ""))
    .join(" ")
    .toLowerCase()
    .includes("invalid_grant");
}

/**
 * Return a non-expired access token for the connection, refreshing + persisting
 * the rotation when within REFRESH_SKEW_MS of expiry. Throws
 * `QboClientError{kind:"reconnect_required"}` when not connected or the refresh
 * token is dead.
 */
export async function getValidAccessToken(
  realmId?: string,
  opts?: { forceRefresh?: boolean },
): Promise<{ accessToken: string; realmId: string }> {
  const conn = await loadConnection(realmId);
  if (!conn) {
    throw new QboClientError(
      "QuickBooks is not connected — run the OAuth handshake.",
      { kind: "reconnect_required" },
    );
  }
  if (
    !opts?.forceRefresh &&
    conn.accessTokenExpiresAt - Date.now() > REFRESH_SKEW_MS
  ) {
    return { accessToken: conn.accessToken, realmId: conn.realmId };
  }

  // Refresh via intuit-oauth (owns the token endpoint + rotation).
  const oauth = new OAuthClient({
    environment: (conn.environment as QboEnvironment) || resolveQboEnvironment(),
    clientId: process.env.QBO_CLIENT_ID ?? "",
    clientSecret: process.env.QBO_CLIENT_SECRET ?? "",
    redirectUri: process.env.QBO_REDIRECT_URI ?? "",
  });

  let token: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    x_refresh_token_expires_in?: number;
  };
  try {
    const authResponse = await oauth.refreshUsingToken(conn.refreshToken);
    token = authResponse.getToken();
  } catch (e) {
    if (isInvalidGrant(e)) {
      throw new QboClientError(
        "QuickBooks refresh token is invalid — reconnect required.",
        { kind: "reconnect_required", cause: e },
      );
    }
    throw new QboClientError("QuickBooks token refresh failed.", {
      kind: "network",
      cause: e,
    });
  }

  const access = token.access_token;
  const refresh = token.refresh_token;
  if (!access || !refresh) {
    throw new QboClientError("QuickBooks refresh returned no tokens.", {
      kind: "unknown",
    });
  }

  const now = Date.now();
  const accessExpiresAt = new Date(
    now + (token.expires_in ?? DEFAULT_ACCESS_TTL_S) * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    now + (token.x_refresh_token_expires_in ?? DEFAULT_REFRESH_TTL_S) * 1000,
  ).toISOString();

  const supabase = createSupabaseAdminClient();
  const { error: persistErr } = await supabase.rpc("qbo_persist_tokens", {
    p_realm_id: conn.realmId,
    p_access_token: access,
    p_refresh_token: refresh,
    p_access_token_expires_at: accessExpiresAt,
    p_refresh_token_expires_at: refreshExpiresAt,
  });
  if (persistErr) {
    throw new QboClientError(
      `qbo_persist_tokens failed: ${persistErr.message}`,
      { kind: "unknown", cause: persistErr },
    );
  }

  return { accessToken: access, realmId: conn.realmId };
}
