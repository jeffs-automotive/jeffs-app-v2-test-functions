/**
 * Postings DAL (C8b) — enqueue a postable draft into `qteklink_postings` via the
 * desired-vs-posted DIFF (§3): a draft whose subject is already posted UNCHANGED is
 * skipped; a changed one enqueues a new CORRECTION version; an un-posted subject
 * enqueues a new pending v1. Enqueue itself is idempotent (the RPC's logical-identity
 * conflict), so re-running the nightly sync never duplicates. The poster (C8c) consumes
 * the resulting `approved` rows; the source_state_hash here is re-checked at post time.
 *
 * Fat-DAL: pure-ish (the hash is deterministic). MULTI-TENANT: realmId is the caller's
 * bound realm; every query scopes shop_id + realm_id. No silent failures: errors throw.
 */
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";

export interface PostingDraft {
  kind: "sale" | "payment";
  tekmetricRoId: number;
  /** null for a SALE; the Tekmetric payment id for a PAYMENT. */
  paymentId: number | null;
  /** business day (shop-local YYYY-MM-DD). */
  batchDate: string;
  /** the JE TxnDate (shop-local YYYY-MM-DD). */
  txnDate: string;
  /** the built JE (lines + allocation) — persisted into proposed_je. */
  je: unknown;
  /** the deterministic source state the JE was built from — hashed for staleness. */
  sourceState: unknown;
}

export type EnqueueAction = "new" | "correction" | "skip" | "exists";

export interface EnqueueResult {
  action: EnqueueAction;
  postingId: string | null;
  postingVersion: number;
}

/** Recursively key-sorted JSON so the same logical value always hashes the same. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** sha256 of the canonical source state — the staleness fingerprint. */
export function sourceStateHash(sourceState: unknown): string {
  return createHash("sha256").update(stableStringify(sourceState)).digest("hex");
}

/** Deterministic requestid (stable per logical create, reused on retry → QBO dedup).
 *  QBO caps `requestid` at 50 chars, so it's a hash of the logical identity (not the
 *  verbose string, which exceeds 50 for payment ids): `qtl-` + 40 hex = 44 chars. */
function requestIdFor(shopId: number, realmId: string, draft: PostingDraft, version: number): string {
  const identity = `${shopId}:${realmId}:${draft.tekmetricRoId}:${draft.kind}:${draft.paymentId ?? 0}:v${version}`;
  return `qtl-${createHash("sha256").update(identity).digest("hex").slice(0, 40)}`;
}

/** The deterministic private-note marker stamped into the QBO JE (crash detection by query). */
function privateNoteMarker(shopId: number, realmId: string, draft: PostingDraft, version: number): string {
  return `QTL|${shopId}|${realmId}|ro=${draft.tekmetricRoId}|${draft.kind}|pay=${draft.paymentId ?? 0}|v${version}`;
}

interface LatestPostingRow {
  id: string;
  posting_version: number;
  status: string;
  source_state_hash: string;
}

/** The newest posting (max version) for a subject (shop,realm,ro,kind,payment), or null. */
async function findLatestPosting(
  shopId: number,
  realmId: string,
  draft: PostingDraft,
): Promise<LatestPostingRow | null> {
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("qteklink_postings")
    .select("id, posting_version, status, source_state_hash")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("tekmetric_ro_id", draft.tekmetricRoId)
    .eq("kind", draft.kind);
  // payment_id is null for a sale; .is() vs .eq() accordingly.
  q = draft.paymentId == null ? q.is("payment_id", null) : q.eq("payment_id", draft.paymentId);
  const { data, error } = await q.order("posting_version", { ascending: false }).limit(1);
  if (error) throw new Error(`findLatestPosting failed: ${error.message}`);
  return ((data ?? [])[0] as LatestPostingRow | undefined) ?? null;
}

/**
 * Enqueue a postable draft applying the desired-vs-posted diff. Returns the action
 * taken + the posting id/version (postingId is null for a 'skip'). Throws on DB error.
 */
export async function enqueuePostingForDraft(
  shopId: number,
  realmId: string,
  draft: PostingDraft,
): Promise<EnqueueResult> {
  const hash = sourceStateHash(draft.sourceState);
  const latest = await findLatestPosting(shopId, realmId, draft);

  let version: number;
  let action: EnqueueAction;
  if (!latest) {
    version = 1;
    action = "new";
  } else if (latest.status === "posted") {
    if (latest.source_state_hash === hash) {
      // already posted, unchanged → nothing to do.
      return { action: "skip", postingId: null, postingVersion: latest.posting_version };
    }
    version = latest.posting_version + 1; // the source changed → a correction supersedes it.
    action = "correction";
  } else {
    // an un-posted row already exists for this subject — enqueue is idempotent at its
    // version (no-op); a state change before posting is caught by the poster's hash
    // re-check at post time (§3), which rebuilds. Report 'exists'.
    version = latest.posting_version;
    action = "exists";
  }

  const admin = createSupabaseAdminClient();
  const proposedJe = {
    je: draft.je,
    marker: privateNoteMarker(shopId, realmId, draft, version),
    source_state_hash: hash,
  };
  const { data, error } = await admin.rpc("qteklink_enqueue_posting", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_batch_date: draft.batchDate,
    p_tekmetric_ro_id: draft.tekmetricRoId,
    p_payment_id: draft.paymentId,
    p_kind: draft.kind,
    p_txn_date: draft.txnDate,
    p_posting_version: version,
    p_proposed_je: proposedJe,
    p_source_state_hash: hash,
    p_requestid: requestIdFor(shopId, realmId, draft, version),
    p_recon_status: "pass",
  });
  if (error) throw new Error(`qteklink_enqueue_posting failed: ${error.message}`);
  if (typeof data !== "string") {
    throw new Error(`qteklink_enqueue_posting returned a non-uuid result: ${JSON.stringify(data)}`);
  }
  return { action, postingId: data, postingVersion: version };
}

// ─── Approval-queue reads + transitions (the C8c approval UI consumes these) ─────

export interface PostingRow {
  id: string;
  kind: string;
  tekmetricRoId: number;
  paymentId: number | null;
  status: string;
  postingVersion: number;
  txnDate: string;
  batchDate: string;
  qboJeId: string | null;
  docNumber: string | null;
  /** Σ debit cents from the proposed JE (the posting's gross) — null if no lines. */
  totalCents: number | null;
  createdAt: string;
}

interface PostingListDbRow {
  id: string;
  kind: string;
  tekmetric_ro_id: number | string;
  payment_id: number | string | null;
  status: string;
  posting_version: number;
  txn_date: string;
  batch_date: string;
  qbo_je_id: string | null;
  proposed_je: { je?: { lines?: { postingType?: string; amountCents?: number }[]; docNumber?: string } } | null;
  created_at: string;
}

const OPEN_POSTING_STATUSES = ["pending", "approved", "posting", "failed", "needs_resolution"];

/** List a shop's postings (default: the OPEN/actionable ones) for the approval UI. */
export async function listPostings(
  shopId: number,
  opts: { statuses?: string[] } = {},
): Promise<{ realmId: string | null; postings: PostingRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, postings: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_postings")
    .select("id, kind, tekmetric_ro_id, payment_id, status, posting_version, txn_date, batch_date, qbo_je_id, proposed_je, created_at")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("status", opts.statuses ?? OPEN_POSTING_STATUSES)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPostings failed: ${error.message}`);

  const postings = ((data ?? []) as PostingListDbRow[]).map((r) => {
    const lines = r.proposed_je?.je?.lines ?? [];
    const totalCents = lines
      .filter((l) => l.postingType === "Debit")
      .reduce((a, l) => a + (Number.isSafeInteger(l.amountCents) ? (l.amountCents as number) : 0), 0);
    return {
      id: r.id,
      kind: r.kind,
      tekmetricRoId: Number(r.tekmetric_ro_id),
      paymentId: r.payment_id == null ? null : Number(r.payment_id),
      status: r.status,
      postingVersion: r.posting_version,
      txnDate: r.txn_date,
      batchDate: r.batch_date,
      qboJeId: r.qbo_je_id,
      docNumber: r.proposed_je?.je?.docNumber ?? null,
      totalCents: lines.length > 0 ? totalCents : null,
      createdAt: r.created_at,
    };
  });
  return { realmId, postings };
}

/** Approve a pending posting (the human gate). Fails closed when no connection. */
export async function approvePosting(shopId: number, id: string, approvedBy: string): Promise<{ approved: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_approve_posting", { p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_approved_by: approvedBy });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_approve_posting failed: ${error.message}`);
  }
  return { approved: data === true };
}

/** Reject a pending/approved posting. Fails closed when no connection. */
export async function rejectPosting(shopId: number, id: string, rejectedBy: string): Promise<{ rejected: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_reject_posting", { p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_rejected_by: rejectedBy });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_reject_posting failed: ${error.message}`);
  }
  return { rejected: data === true };
}
