/**
 * Mappings DAL (C2) — manage `qteklink_mappings` (Tekmetric source -> QBO
 * account) for a shop's bound realm, and read them back for the UI.
 *
 * Fat-DAL: pure TypeScript (no React / Server Action decorators) so it's
 * unit-testable with Vitest. The thin mapping actions call these AFTER
 * requireQtekUser() + the admin gate.
 *
 * MULTI-TENANT: `shopId` is from the session; the QBO `realmId` is resolved
 * SERVER-SIDE from the bound connection (`resolveRealmForShop`). `qteklink_mappings`
 * is service_role-only with a composite FK -> `qbo_accounts`; writes go through
 * the SECURITY DEFINER `qteklink_set_mapping` / `qteklink_deactivate_mapping`
 * RPCs; a BEFORE-write trigger + table CHECKs enforce role<->account-type compat,
 * reject soft-deleted / inactive / missing accounts, and the kind<->role +
 * system-key rules — on every write path. No silent failures: every DB error throws; a write
 * fails closed when the shop has no connection.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QboClientError } from "@/lib/qbo/errors";
import { resolveRealmForShop } from "@/lib/dal/realm";

export interface MappingRow {
  id: string;
  kind: string;
  sourceKey: string;
  sourceId: string | null;
  qboAccountId: string;
  /** Resolved account name (null if the account row is missing entirely). */
  accountName: string | null;
  accountType: string | null;
  /** True when the mapped account has since been removed (soft-deleted) OR deactivated in QBO — re-map. */
  accountStale: boolean;
  postingRole: string;
  effectiveFrom: string;
}

export interface MappableAccount {
  qboAccountId: string;
  name: string;
  accountType: string | null;
  accountSubType: string | null;
}

export interface SetMappingInput {
  kind: string;
  sourceKey: string;
  sourceId?: string | null;
  qboAccountId: string;
  postingRole: string;
}

interface MappingDbRow {
  id: string;
  kind: string;
  source_key: string;
  source_id: string | null;
  qbo_account_id: string;
  posting_role: string;
  effective_from: string;
}

interface AccountDbRow {
  qbo_account_id: string;
  name: string;
  account_type: string | null;
  active: boolean;
  deleted_at: string | null;
}

/**
 * List the active mappings for a shop, each resolved to its QBO account
 * name/type. Flags a mapping whose account has since been soft-deleted OR
 * deactivated in QBO (the admin should re-map it). Returns {realmId:null, mappings:[]} when the
 * shop has no connection. Throws on any DB error.
 */
export async function listMappings(
  shopId: number,
): Promise<{ realmId: string | null; mappings: MappingRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, mappings: [] };

  const admin = createSupabaseAdminClient();

  const { data: mapData, error: mapErr } = await admin
    .from("qteklink_mappings")
    .select("id, kind, source_key, source_id, qbo_account_id, posting_role, effective_from")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("active", true)
    .order("kind", { ascending: true })
    .order("source_key", { ascending: true });
  if (mapErr) throw new Error(`listMappings (mappings) failed: ${mapErr.message}`);

  // Join account names in TS (the FK is composite; avoid relying on PostgREST
  // embedding). Fetch ALL accounts incl. soft-deleted so a stale mapping still
  // shows its account name + can be flagged.
  const { data: acctData, error: acctErr } = await admin
    .from("qbo_accounts")
    .select("qbo_account_id, name, account_type, active, deleted_at")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId);
  if (acctErr) throw new Error(`listMappings (accounts) failed: ${acctErr.message}`);

  const acctById = new Map<string, AccountDbRow>(
    ((acctData ?? []) as AccountDbRow[]).map((a) => [a.qbo_account_id, a]),
  );

  const mappings: MappingRow[] = ((mapData ?? []) as MappingDbRow[]).map((m) => {
    const acct = acctById.get(m.qbo_account_id);
    return {
      id: m.id,
      kind: m.kind,
      sourceKey: m.source_key,
      sourceId: m.source_id,
      qboAccountId: m.qbo_account_id,
      accountName: acct?.name ?? null,
      accountType: acct?.account_type ?? null,
      accountStale: acct ? acct.deleted_at !== null || acct.active === false : true,
      postingRole: m.posting_role,
      effectiveFrom: m.effective_from,
    };
  });

  return { realmId, mappings };
}

/**
 * Live (non-deleted) COA accounts for the mapping picker. The set_mapping RPC is
 * the authoritative role-compat gate; the UI groups these by account_type so the
 * admin picks a compatible one. Returns [] when the shop has no connection.
 */
export async function listMappableAccounts(
  shopId: number,
): Promise<MappableAccount[]> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return [];

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qbo_accounts")
    .select("qbo_account_id, name, account_type, account_sub_type")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("active", true)
    .is("deleted_at", null)
    .order("account_type", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listMappableAccounts failed: ${error.message}`);

  return (
    (data ?? []) as {
      qbo_account_id: string;
      name: string;
      account_type: string | null;
      account_sub_type: string | null;
    }[]
  ).map((a) => ({
    qboAccountId: a.qbo_account_id,
    name: a.name,
    accountType: a.account_type,
    accountSubType: a.account_sub_type,
  }));
}

/**
 * Upsert one active mapping. Fails closed when the shop has no connection.
 * Role<->account-type compat + account-is-live are enforced inside
 * `qteklink_set_mapping` (it RAISEs P0001 on violation — surfaced as a
 * QboClientError so the action returns a clean message). Returns the new id.
 */
export async function setMapping(
  shopId: number,
  input: SetMappingInput,
): Promise<{ id: string }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", {
      kind: "reconnect_required",
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_set_mapping", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_kind: input.kind,
    p_source_key: input.sourceKey,
    p_source_id: input.sourceId ?? null,
    p_qbo_account_id: input.qboAccountId,
    p_posting_role: input.postingRole,
  });
  if (error) {
    // P0001 = a deliberate business rejection from the RPC (role-incompat,
    // soft-deleted / missing account) — surface its message verbatim. Anything
    // else is an unexpected system error.
    if (error.code === "P0001") {
      throw new QboClientError(error.message, { kind: "unknown" });
    }
    if (error.code === "23505") {
      // source_id reuse / one-active partial-unique race — a config conflict,
      // not a system fault.
      throw new QboClientError(
        "This source or Tekmetric id is already mapped for this kind.",
        { kind: "conflict" },
      );
    }
    throw new Error(`qteklink_set_mapping failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error(
      `qteklink_set_mapping returned a non-uuid result: ${JSON.stringify(data)}`,
    );
  }
  return { id: data };
}

/**
 * Deactivate (unmap) one mapping by id, scoped to the shop's bound realm.
 * Returns whether a currently-active row was deactivated. Fails closed when the
 * shop has no connection. Throws on DB error.
 */
export async function deactivateMapping(
  shopId: number,
  id: string,
): Promise<{ deactivated: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", {
      kind: "reconnect_required",
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_deactivate_mapping", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_id: id,
  });
  if (error) throw new Error(`qteklink_deactivate_mapping failed: ${error.message}`);
  return { deactivated: data === true };
}
