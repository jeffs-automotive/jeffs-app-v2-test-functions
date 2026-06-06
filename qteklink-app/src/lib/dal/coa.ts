/**
 * Chart-of-Accounts DAL (C1) — pull the connected QBO company's accounts into
 * the `qbo_accounts` mirror, and read it back for the UI.
 *
 * Fat-DAL: pure TypeScript (no React / Server Action decorators) so it's
 * unit-testable with Vitest. The thin `refreshCoaAction` calls these AFTER
 * requireQtekUser().
 *
 * MULTI-TENANT: `shopId` is from the session; the QBO `realmId` is resolved
 * SERVER-SIDE from the connection BOUND to that shop (`qbo_resolve_realm_for_shop`)
 * — never "the most recent global connection". The `qbo_accounts` table is
 * service_role-only with a composite FK `(shop_id, realm_id)` → `qbo_connections`,
 * so the DB refuses cross-shop rows. No silent failures: every QBO and DB error
 * throws, and a truncated page fails closed.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QboClient } from "@/lib/qbo/client";
import { QboClientError } from "@/lib/qbo/errors";
import { accountSchema, type QboAccount } from "@/lib/qbo/entities";

interface AccountQueryResponse {
  QueryResponse?: { Account?: unknown[] };
}

/** Map a validated QBO Account onto the `qbo_accounts_sync` JSON row shape. */
function toSyncRow(a: QboAccount) {
  return {
    qbo_account_id: a.Id ?? "",
    name: a.Name,
    fully_qualified_name: a.FullyQualifiedName ?? null,
    account_type: a.AccountType ?? null,
    account_sub_type: a.AccountSubType ?? null,
    classification: a.Classification ?? null,
    active: a.Active,
  };
}

/**
 * Resolve the QBO realm BOUND to this shop (multi-tenant safety — never a
 * global "most recent" lookup). Returns null when the shop has no connection.
 */
async function resolveRealmForShop(shopId: number): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qbo_resolve_realm_for_shop", {
    p_shop_id: shopId,
  });
  if (error) {
    throw new Error(`qbo_resolve_realm_for_shop failed: ${error.message}`);
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * Pull the connected company's accounts (active + inactive) and upsert them into
 * `qbo_accounts` for (shopId, realmId). Returns the realm + the rows synced.
 * Throws (FAIL CLOSED) on: no connection for the shop, a truncated page, a
 * malformed RPC result, or any QBO/DB error.
 */
export async function syncQboAccounts(
  shopId: number,
): Promise<{ realmId: string; synced: number }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", {
      kind: "reconnect_required",
    });
  }

  const client = new QboClient({ realmId });
  const resp = await client.query<AccountQueryResponse>(
    "SELECT * FROM Account WHERE Active IN (true, false) MAXRESULTS 1000",
  );
  const raw = resp.QueryResponse?.Account ?? [];

  // Fail closed on truncation: 1000 is QBO's page cap, so a full page means the
  // COA is likely larger and this sync would be a partial mirror reported as a
  // success. STARTPOSITION pagination is a future task.
  if (raw.length >= 1000) {
    throw new QboClientError(
      "QuickBooks returned the 1000-account page cap; COA pagination is required before a chart this large can sync.",
      { kind: "unknown" },
    );
  }

  // Runtime-validate every account against accountSchema — don't trust the shape
  // on the strength of a TypeScript generic. Malformed accounts are dropped +
  // logged (no silent failure), not mis-stored.
  const rows: ReturnType<typeof toSyncRow>[] = [];
  let dropped = 0;
  for (const item of raw) {
    const parsed = accountSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const row = toSyncRow(parsed.data);
    if (row.qbo_account_id.length > 0 && row.name.trim().length > 0) {
      rows.push(row);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(
      JSON.stringify({
        level: "warning",
        surface: "qteklink-coa",
        msg: "Dropped malformed QBO accounts during COA sync.",
        shop_id: shopId,
        realm_id: realmId,
        dropped,
      }),
    );
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qbo_accounts_sync", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_accounts: rows,
  });
  if (error) {
    throw new Error(`qbo_accounts_sync failed: ${error.message}`);
  }
  if (typeof data !== "number") {
    throw new Error(
      `qbo_accounts_sync returned a non-numeric result: ${JSON.stringify(data)}`,
    );
  }
  return { realmId, synced: data };
}

export interface CoaSummary {
  realmId: string | null;
  count: number;
  lastSyncedAt: string | null;
}

/**
 * Dashboard summary for a shop: the realm, mirrored account count, and last sync
 * time — read from `qbo_coa_sync_state` so "never synced" (no row → null time)
 * is distinguishable from "synced, 0 accounts". Throws on a DB error.
 */
export async function getCoaSummary(shopId: number): Promise<CoaSummary> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    return { realmId: null, count: 0, lastSyncedAt: null };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qbo_coa_sync_state")
    .select("last_synced_at, account_count")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .maybeSingle();
  if (error) {
    throw new Error(`getCoaSummary failed: ${error.message}`);
  }
  const row = data as { last_synced_at: string; account_count: number } | null;
  return {
    realmId,
    count: row?.account_count ?? 0,
    lastSyncedAt: row?.last_synced_at ?? null,
  };
}
