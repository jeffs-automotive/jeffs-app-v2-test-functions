/**
 * QTekLink poster (C8c) — claims one APPROVED posting and writes it to QBO as a
 * JournalEntry. The QBO call is the LIVE financial write; it's behind an injectable
 * client (`deps.client`) so tests run against a mock and the first real post stays a
 * deliberate, gated step. NO auto-post wiring here — a caller (cron/action) drives it.
 *
 * Flow (one posting per call): requeue expired leases → claim (lease, SKIP LOCKED) →
 * build the QBO JE from the stored proposed_je → client.create('journalentry', …,
 * the STABLE requestid) → mark_posted (+ record the SALE JE id/SyncToken in ro_state).
 * Error handling (§13):
 *   - throttle / network         → retryable: mark_failed(retryable) → re-queued to approved
 *   - reconnect_required / auth   → HARD: mark_failed + a 'reconnect_required' review item
 *   - validation mentioning Entity→ 'ar_entity_rejected' review item (the §13 guard)
 *   - any other QBO fault         → 'qbo_error' review item, mark_failed
 * A CORRECTION (version > 1) needs the JE-UPDATE flow (prior JE id + SyncToken) which
 * is a documented follow-up — it is NEVER posted as a new JE (that would duplicate);
 * it's deferred to the queue.
 *
 * DEFERRED (noted): the §3 post-time source_state_hash RE-CHECK (rebuild-vs-latest →
 * stale → rebuild) — the approve→post window is short + human-reviewed; tracked for C8.
 *
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection; every RPC
 * scopes shop_id+realm_id. No silent failures: DB errors throw; QBO faults are recorded.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClient } from "@/lib/qbo/client";
import { QboClientError } from "@/lib/qbo/errors";
import { toQboJournalEntry, type QboJeLineInput } from "@/lib/qbo/journal-entry";
import { upsertReviewItem } from "@/lib/dal/review-items";
import { upsertRoState } from "@/lib/dal/ro-state";

/** The minimal QBO surface the poster needs — real QboClient or a test mock. */
export interface QboPostClient {
  create(entity: string, body: unknown, requestId?: string): Promise<unknown>;
}

export type PostOutcome =
  | { status: "no_connection" }
  | { status: "idle" }
  | { status: "posted"; postingId: string; qboJeId: string }
  | { status: "retry"; postingId: string }
  | { status: "failed"; postingId: string; reason: string }
  | { status: "deferred"; postingId: string; reason: string };

const LEASE_SECONDS = 120;

interface ClaimedPosting {
  id: string;
  tekmetric_ro_id: number | string;
  payment_id: number | string | null;
  kind: string;
  txn_date: string;
  posting_version: number;
  proposed_je: {
    je?: { lines?: QboJeLineInput[]; docNumber?: string; txnDate?: string };
    marker?: string;
    source_state_hash?: string;
  } | null;
  requestid: string;
}

function classifyPostError(e: unknown): { retry: boolean; reviewKind: string | null } {
  if (e instanceof QboClientError) {
    if (e.kind === "throttle" || e.kind === "network") return { retry: true, reviewKind: null };
    if (e.kind === "reconnect_required" || e.kind === "auth") return { retry: false, reviewKind: "reconnect_required" };
    if (e.kind === "validation" && /entity/i.test(`${e.message} ${e.detail ?? ""}`)) {
      return { retry: false, reviewKind: "ar_entity_rejected" };
    }
    return { retry: false, reviewKind: "qbo_error" };
  }
  return { retry: false, reviewKind: "qbo_error" };
}

/** The subject (RO for a sale, payment for a payment) a posting's review item attaches to. */
function subjectOf(row: ClaimedPosting): { subjectKind: "ro" | "payment"; subjectRef: string } {
  return row.kind === "sale"
    ? { subjectKind: "ro", subjectRef: String(row.tekmetric_ro_id) }
    : { subjectKind: "payment", subjectRef: String(row.payment_id) };
}

/**
 * Post the next APPROVED posting for a shop. Returns the outcome. The QBO write is
 * mocked via `deps.client` in tests; in production it's a real QboClient bound to the
 * shop's realm. Throws only on a DB/infra failure (QBO faults are recorded, not thrown).
 */
export async function postNextApproved(
  shopId: number,
  deps: { client?: QboPostClient } = {},
): Promise<PostOutcome> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { status: "no_connection" };

  const admin = createSupabaseAdminClient();

  // Crash recovery: re-queue any posting whose lease expired (best-effort).
  const { error: rqErr } = await admin.rpc("qteklink_requeue_expired_leases", { p_shop_id: shopId, p_realm_id: realmId });
  if (rqErr) throw new Error(`postNextApproved (requeue) failed: ${rqErr.message}`);

  // Claim one approved posting (atomic, leased).
  const { data: claimed, error: claimErr } = await admin.rpc("qteklink_claim_posting", {
    p_shop_id: shopId, p_realm_id: realmId, p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) throw new Error(`postNextApproved (claim) failed: ${claimErr.message}`);
  const row = claimed as ClaimedPosting | null;
  if (!row || !row.id) return { status: "idle" };

  const subject = subjectOf(row);

  const markFailed = async (retryable: boolean, response: unknown) => {
    const { error } = await admin.rpc("qteklink_mark_failed", {
      p_shop_id: shopId, p_realm_id: realmId, p_id: row.id, p_retryable: retryable, p_qbo_response: response,
    });
    if (error) throw new Error(`postNextApproved (mark_failed) failed: ${error.message}`);
  };

  // A CORRECTION (version > 1) requires the JE-update flow (not built) — never post it
  // as a new JE. Defer to the queue.
  if (row.posting_version > 1) {
    await markFailed(false, { deferred: "correction_update_flow_not_built" });
    await upsertReviewItem(shopId, { kind: "correction_unsupported", ...subject, detail: { postingId: row.id, version: row.posting_version } });
    return { status: "deferred", postingId: row.id, reason: "correction_update_flow_not_built" };
  }

  // Build the QBO JE from the stored proposed_je.
  const pj = row.proposed_je;
  const je = pj?.je;
  if (!je || !Array.isArray(je.lines) || !je.docNumber || !je.txnDate) {
    await markFailed(false, { error: "malformed_proposed_je" });
    await upsertReviewItem(shopId, { kind: "qbo_error", ...subject, detail: { postingId: row.id, reason: "malformed proposed_je" } });
    return { status: "failed", postingId: row.id, reason: "malformed_proposed_je" };
  }

  let body: Record<string, unknown>;
  try {
    body = toQboJournalEntry({ docNumber: je.docNumber, txnDate: je.txnDate, privateNote: pj.marker ?? "", lines: je.lines });
  } catch (e) {
    await markFailed(false, { error: (e as Error).message });
    await upsertReviewItem(shopId, { kind: "qbo_error", ...subject, detail: { postingId: row.id, reason: (e as Error).message } });
    return { status: "failed", postingId: row.id, reason: "build_failed" };
  }

  // ── LIVE QBO WRITE (mocked via deps.client in tests; gated in production) ──
  const client: QboPostClient = deps.client ?? new QboClient({ realmId });
  try {
    const resp = (await client.create("journalentry", body, row.requestid)) as { JournalEntry?: { Id?: string; SyncToken?: string } };
    const qboJeId = resp?.JournalEntry?.Id;
    if (!qboJeId) {
      // No id back → treat as retryable (don't mark posted without proof it landed).
      await markFailed(true, resp);
      return { status: "retry", postingId: row.id };
    }
    const { error: mpErr } = await admin.rpc("qteklink_mark_posted", {
      p_shop_id: shopId, p_realm_id: realmId, p_id: row.id, p_qbo_je_id: qboJeId, p_qbo_response: resp,
    });
    if (mpErr) throw new Error(`postNextApproved (mark_posted) failed: ${mpErr.message}`);

    // SALE → record the JE id + SyncToken for future corrections/updates.
    if (row.kind === "sale") {
      await upsertRoState(shopId, {
        tekmetricRoId: Number(row.tekmetric_ro_id),
        saleQboJeId: qboJeId,
        saleQboSyncToken: resp?.JournalEntry?.SyncToken ?? "0",
        lastPostedDate: row.txn_date,
        sourceSnapshotHash: pj?.source_state_hash ?? null,
        status: "posted",
      });
    }
    return { status: "posted", postingId: row.id, qboJeId };
  } catch (e) {
    const cls = classifyPostError(e);
    await markFailed(cls.retry, { error: e instanceof Error ? e.message : String(e) });
    if (cls.reviewKind) {
      await upsertReviewItem(shopId, { kind: cls.reviewKind, ...subject, detail: { postingId: row.id, qboError: e instanceof Error ? e.message : String(e) } });
    }
    return cls.retry
      ? { status: "retry", postingId: row.id }
      : { status: "failed", postingId: row.id, reason: cls.reviewKind ?? "qbo_error" };
  }
}
