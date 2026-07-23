// _shared/tekbridge/refresh.ts
//
// Server-side session refresh. Tekmetric's internal API exposes
// `GET /api/token/shop/{shopId}` which, given a STILL-VALID x-auth-token,
// returns a FRESH ~16h token — no password, no reCAPTCHA, no browser
// (confirmed live 2026-07-21, in-browser + via pg_net from the datacenter).
//
// So the bot needs a human login exactly ONCE to bootstrap the first token; a
// cron then calls refreshBotJwt() on a schedule (< the 16h expiry) to keep the
// chain alive indefinitely, fully server-side. If the chain ever breaks (missed
// window / Tekmetric invalidated the session), the refresh throws and the
// caller alerts a human to re-bootstrap.
//
// Lives in its own module (not session.ts) so the client↔session import graph
// stays acyclic: client.ts imports session.ts; refresh.ts imports BOTH.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tekbridgeJson } from "./client.ts";
import { getBotJwt, jwtExpiresAt, setBotJwt } from "./session.ts";

export interface RefreshResult {
  expiresAt: string;
  previousExpiresAt: string | null;
}

/**
 * Refresh the bot session token. Reads the current token, calls the refresh
 * endpoint with it, stores the fresh token + updates health. Throws:
 *   - TekbridgeSessionError("no_session") if Vault has no token (never bootstrapped)
 *   - TekbridgeSessionError("expired")    if the current token is already dead (chain broke)
 *   - Error                                if the refresh endpoint returns no usable token
 */
export async function refreshBotJwt(
  sb: SupabaseClient,
  shopId: number,
): Promise<RefreshResult> {
  // Fail fast with a typed no_session/expired if the current token is missing/dead.
  const current = await getBotJwt(sb);
  const prevExp = jwtExpiresAt(current);

  const resp = await tekbridgeJson<{ token?: string }>(
    sb,
    `/token/shop/${shopId}`,
    { shopId },
  );

  const newToken = resp?.token;
  if (typeof newToken !== "string" || newToken.split(".").length !== 3) {
    throw new Error(
      `tekbridge refreshBotJwt: refresh endpoint returned no usable token (keys: ${
        resp && typeof resp === "object" ? Object.keys(resp).join(",") : typeof resp
      })`,
    );
  }

  const { expiresAt } = await setBotJwt(sb, newToken, shopId);
  return {
    expiresAt,
    previousExpiresAt: prevExp ? new Date(prevExp * 1000).toISOString() : null,
  };
}
