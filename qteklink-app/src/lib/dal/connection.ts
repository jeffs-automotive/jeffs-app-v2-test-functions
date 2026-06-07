/**
 * QBO connection management DAL — the soft disconnect (the connect/reconnect flow
 * lives in the qbo-oauth-callback edge function; see app/qbo/connect).
 *
 * `disconnectQbo` best-effort REVOKES the refresh token at Intuit, then calls the
 * SECURITY DEFINER `qbo_disconnect` RPC which tombstones the Vault token secrets +
 * expires the connection row — KEEPING the realm binding + COA + mappings (soft).
 * Reconnecting the same company re-seeds the tokens and resumes.
 *
 * MULTI-TENANT: `shopId` is server-derived; `realmId` from the bound connection
 * (`resolveRealmForShop`). Token access stays server-side (service_role). The
 * Intuit revoke is best-effort — an already-invalid grant simply no-ops, and the
 * RPC neutralizes the local copy regardless, so a revoke failure is non-fatal.
 */
import OAuthClient from "intuit-oauth";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { loadConnection } from "@/lib/qbo/tokens";
import { resolveQboEnvironment } from "@/lib/qbo/config";

export interface DisconnectResult {
  /** null when the shop had no connection (nothing to do). */
  realmId: string | null;
  /** Whether the Intuit-side token revoke succeeded (best-effort). */
  revoked: boolean;
}

/** Soft-disconnect QuickBooks for a shop's bound realm. Throws on a DB/RPC error. */
export async function disconnectQbo(shopId: number): Promise<DisconnectResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, revoked: false };

  // Best-effort revoke at Intuit (kills the grant on their side). An already-dead
  // token throws here — non-fatal, because the RPC tombstones the local copy.
  let revoked = false;
  try {
    const conn = await loadConnection(realmId);
    const refreshToken = conn?.refreshToken;
    if (refreshToken && refreshToken !== "__disconnected__") {
      const oauth = new OAuthClient({
        environment: resolveQboEnvironment(),
        clientId: process.env.QBO_CLIENT_ID ?? "",
        clientSecret: process.env.QBO_CLIENT_SECRET ?? "",
        redirectUri: process.env.QBO_REDIRECT_URI ?? "",
      });
      await oauth.revoke({ refresh_token: refreshToken });
      revoked = true;
    }
  } catch (e) {
    // Non-fatal: revoke commonly fails on an already-invalid token. Log (no Sentry —
    // this is expected) and continue; the RPC below still neutralizes the local copy.
    console.warn(
      JSON.stringify({
        level: "warning",
        surface: "qteklink-disconnect",
        msg: "Intuit token revoke failed (non-fatal — local token is tombstoned regardless)",
        shop_id: shopId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qbo_disconnect", { p_realm_id: realmId });
  if (error) throw new Error(`qbo_disconnect failed: ${error.message}`);

  return { realmId, revoked };
}
