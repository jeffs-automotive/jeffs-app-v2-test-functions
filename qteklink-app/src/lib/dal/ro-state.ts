/**
 * Per-RO SALE projection DAL (C8b) — the last posted SALE JE id + SyncToken (a JE
 * UPDATE is a full balanced re-send under SyncToken, §13) + the source-snapshot hash
 * for the desired-vs-posted diff. SALE only (payments are their own postings).
 * `getRoStateByRo` feeds the diff; `upsertRoState` is the poster's write-back.
 *
 * Fat-DAL: pure TS, unit-testable. MULTI-TENANT: shopId server-derived; realmId from the
 * bound connection; writes via the SECURITY DEFINER RPC. No silent failures: every DB
 * error throws; a non-safe-integer cents read-back fails closed.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";

export interface RoStateRow {
  id: string;
  tekmetricRoId: number;
  roNumber: string | null;
  lastTotalCents: number | null;
  lastPostedDate: string | null;
  sourceSnapshotHash: string | null;
  saleQboJeId: string | null;
  saleQboSyncToken: string | null;
  status: string;
}

export interface UpsertRoStateInput {
  tekmetricRoId: number;
  roNumber?: string | null;
  lastTotalCents?: number | null;
  lastPostedDate?: string | null;
  sourceSnapshotHash?: string | null;
  saleQboJeId?: string | null;
  saleQboSyncToken?: string | null;
  status?: "pending" | "posted" | "needs_resolution" | null;
}

interface RoStateDbRow {
  id: string;
  tekmetric_ro_id: number | string;
  ro_number: string | null;
  last_total_cents: number | string | null;
  last_posted_date: string | null;
  source_snapshot_hash: string | null;
  sale_qbo_je_id: string | null;
  sale_qbo_sync_token: string | null;
  status: string;
}

function safeIntOrNull(v: number | string | null, field: string, roId: number | string): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`getRoStateByRo: RO ${String(roId)} has a non-safe-integer ${field} (${String(v)})`);
  return n;
}

function mapRow(r: RoStateDbRow): RoStateRow {
  return {
    id: r.id,
    tekmetricRoId: safeIntOrNull(r.tekmetric_ro_id, "tekmetric_ro_id", r.tekmetric_ro_id) ?? 0,
    roNumber: r.ro_number,
    lastTotalCents: safeIntOrNull(r.last_total_cents, "last_total_cents", r.tekmetric_ro_id),
    lastPostedDate: r.last_posted_date,
    sourceSnapshotHash: r.source_snapshot_hash,
    saleQboJeId: r.sale_qbo_je_id,
    saleQboSyncToken: r.sale_qbo_sync_token,
    status: r.status,
  };
}

/** The RO's SALE projection (for the desired-vs-posted diff), or null when none yet. */
export async function getRoStateByRo(
  shopId: number,
  tekmetricRoId: number,
): Promise<{ realmId: string | null; roState: RoStateRow | null }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, roState: null };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_ro_state")
    .select("id, tekmetric_ro_id, ro_number, last_total_cents, last_posted_date, source_snapshot_hash, sale_qbo_je_id, sale_qbo_sync_token, status")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("tekmetric_ro_id", tekmetricRoId)
    .limit(1);
  if (error) throw new Error(`getRoStateByRo failed: ${error.message}`);

  const row = (data ?? [])[0] as RoStateDbRow | undefined;
  return { realmId, roState: row ? mapRow(row) : null };
}

/** Upsert the RO's SALE projection (one per shop+realm+RO). Fails closed when the shop
 *  has no connection. Returns the id. Throws on DB error. */
export async function upsertRoState(
  shopId: number,
  input: UpsertRoStateInput,
): Promise<{ id: string }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_upsert_ro_state", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_tekmetric_ro_id: input.tekmetricRoId,
    p_ro_number: input.roNumber ?? null,
    p_last_total_cents: input.lastTotalCents ?? null,
    p_last_posted_date: input.lastPostedDate ?? null,
    p_source_snapshot_hash: input.sourceSnapshotHash ?? null,
    p_sale_qbo_je_id: input.saleQboJeId ?? null,
    p_sale_qbo_sync_token: input.saleQboSyncToken ?? null,
    p_status: input.status ?? null,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_upsert_ro_state failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error(`qteklink_upsert_ro_state returned a non-uuid result: ${JSON.stringify(data)}`);
  }
  return { id: data };
}
