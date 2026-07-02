/**
 * Resolution-queue DAL (C7, §8/§9) — the typed review items the reconciliation
 * gate + daily approvals emit, and the human resolves. `upsertReviewItem` refreshes
 * the single OPEN item per (kind, subject) via the SECURITY DEFINER RPC;
 * `listOpenReviewItems` feeds the daily-approvals UI; `resolveReviewItem` closes one.
 *
 * Fat-DAL: pure TS, unit-testable. MULTI-TENANT: shopId server-derived; realmId from
 * the bound connection; `qteklink_review_items` is service_role-only (writes via the
 * RPCs). No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";

export type ReviewSubjectKind = "ro" | "payment" | "mapping_key" | "day";

export interface UpsertReviewItemInput {
  /** Deterministic reason (e.g. 'unmapped', 'tax_mismatch', 'payment_amount_mismatch'). */
  kind: string;
  subjectKind: ReviewSubjectKind;
  /** The RO id / payment id / mapping source_key / business-date the item concerns. */
  subjectRef: string;
  /** Machine context for the UI (amounts, expected-vs-actual, the unmapped key…). */
  detail?: Record<string, unknown>;
}

export interface ReviewItemRow {
  id: string;
  kind: string;
  subjectKind: string;
  subjectRef: string;
  detail: Record<string, unknown>;
  status: string;
  createdAt: string;
}

interface ReviewItemDbRow {
  id: string;
  kind: string;
  subject_kind: string;
  subject_ref: string;
  detail: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

/**
 * Emit (or refresh) the OPEN review item for a (kind, subject). Fails closed when
 * the shop has no connection. Returns the item id. Throws on DB error.
 */
export async function upsertReviewItem(
  shopId: number,
  input: UpsertReviewItemInput,
): Promise<{ id: string }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_upsert_review_item", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_kind: input.kind,
    p_subject_kind: input.subjectKind,
    p_subject_ref: input.subjectRef,
    p_detail: input.detail ?? {},
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_upsert_review_item failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error(`qteklink_upsert_review_item returned a non-uuid result: ${JSON.stringify(data)}`);
  }
  return { id: data };
}

/**
 * List the OPEN review items for a shop's bound realm (oldest first — the daily
 * approvals' work queue). Returns {realmId:null, items:[]} when no connection.
 */
export async function listOpenReviewItems(
  shopId: number,
): Promise<{ realmId: string | null; items: ReviewItemRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, items: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_review_items")
    .select("id, kind, subject_kind, subject_ref, detail, status, created_at")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listOpenReviewItems failed: ${error.message}`);

  const items = ((data ?? []) as ReviewItemDbRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    subjectKind: r.subject_kind,
    subjectRef: r.subject_ref,
    detail: r.detail ?? {},
    status: r.status,
    createdAt: r.created_at,
  }));
  return { realmId, items };
}

/**
 * Batch SYSTEM resolution of OPEN review items whose condition provably cleared
 * (resolution-workflow: reconcile convergence, a successful retry, an accepted
 * variance, a resolved redate). Ids only — the proving predicate lives with the
 * caller. Returns how many items were closed. Throws on DB error.
 */
export async function autoResolveReviewItems(
  shopId: number,
  realmId: string,
  ids: string[],
  resolvedBy: string,
  resolution: Record<string, unknown>,
): Promise<{ resolved: number }> {
  if (ids.length === 0) return { resolved: 0 };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_auto_resolve_review_items", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_ids: ids,
    p_resolved_by: resolvedBy,
    p_resolution: resolution,
  });
  if (error) throw new Error(`qteklink_auto_resolve_review_items failed: ${error.message}`);
  return { resolved: typeof data === "number" ? data : 0 };
}

/**
 * Resolve one OPEN review item (human action). Fails closed when the shop has no
 * connection. Returns whether an open item was closed. Throws on DB error.
 */
export async function resolveReviewItem(
  shopId: number,
  id: string,
  resolution: Record<string, unknown>,
  resolvedBy: string,
): Promise<{ resolved: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_resolve_review_item", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_id: id,
    p_resolution: resolution,
    p_resolved_by: resolvedBy,
  });
  if (error) throw new Error(`qteklink_resolve_review_item failed: ${error.message}`);
  return { resolved: data === true };
}
