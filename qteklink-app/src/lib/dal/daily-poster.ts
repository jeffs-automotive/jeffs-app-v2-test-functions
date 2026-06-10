/**
 * Daily poster (daily-JE rework step 3, docs/qteklink/daily-je-rework-plan.md §4) —
 * claims ONE approved day-category posting and writes it to QBO. The LIVE financial
 * write sits behind an injectable client; tests run a mock and the first real post
 * stays a deliberate, Chris-gated step.
 *
 * Flow (per posting): requeue expired daily leases → claim by id (lease, SKIP LOCKED)
 * → **STALENESS RECHECK (hard requirement §4.1)**: REBUILD the desired category JE
 * from the latest source and compare hashes — a mismatch releases the row back to
 * PENDING with refreshed content (re-approval required; the money changed) — then by
 * `action`:
 *   create → POST journalentry (stable requestid; QBO dedups)
 *   update → FULL-REPLACEMENT re-send under the live JE's id + current SyncToken
 *   delete → ?operation=delete with {Id, SyncToken} (the category emptied)
 * → mark_daily_posted (records the QBO id + the NEW SyncToken).
 *
 * update/delete read the live JE id + SyncToken from the latest POSTED version row
 * (first-class columns) — a missing target fails CLOSED with a review item, never a
 * blind create (that would duplicate the day). Error classification is shared with
 * the per-RO poster (classifyPostError): throttle/network → retry (back to approved);
 * reconnect/auth/validation/other → failed + a review item with subjectKind 'day'
 * (a daily JE failure concerns the whole day-category, not one RO).
 *
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection; every RPC
 * scopes shop_id + realm_id. No silent failures: DB errors throw; QBO faults recorded.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClient } from "@/lib/qbo/client";
import { QboClientError } from "@/lib/qbo/errors";
import { toQboJournalEntry, type QboJeLineInput } from "@/lib/qbo/journal-entry";
import { upsertReviewItem } from "@/lib/dal/review-items";
import { sourceStateHash } from "@/lib/dal/postings";
import {
  dailySourceState,
  findLatestPostedDaily,
  type DailyAction,
} from "@/lib/dal/daily-postings";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { buildDailyJournalEntries } from "@/lib/daily/daily-je-builder";
import type { DailyCategory, DailyJournalEntry } from "@/lib/daily/daily-je-builder";

/** The minimal QBO write surface the daily poster needs — real QboClient or a mock. */
export interface QboDailyWriteClient {
  create(entity: string, body: unknown, requestId?: string): Promise<unknown>;
  deleteEntity(entity: string, body: unknown, requestId?: string): Promise<unknown>;
}

/** Settings overrides forwarded into buildDayDrafts — MUST match what the enqueuing
 *  caller used, or the rebuilt hash can never equal the enqueued hash (a permanent
 *  stale-refresh loop). Production callers pass none (settings come from the shop row). */
export interface RebuildOpts {
  shopTimezone?: string;
  tireFeeCentsPerTire?: number;
  salesTaxRateBps?: number;
}

/** Rebuild the CURRENT desired category JE (null = the category is empty today) —
 *  injectable so tests don't stand up the whole draft pipeline. */
export type RebuildDesired = (
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
  opts?: RebuildOpts,
) => Promise<DailyJournalEntry | null>;

export type DailyPostOutcome =
  | { status: "no_connection" }
  | { status: "idle" }
  | { status: "posted"; postingId: string; qboJeId: string; action: DailyAction }
  | { status: "stale_refreshed"; postingId: string }
  | { status: "retry"; postingId: string }
  | { status: "failed"; postingId: string; reason: string };

const LEASE_SECONDS = 120;

/** QBO post-error classification (§13): throttle/network retry; reconnect/auth hard-fail
 *  with a reconnect review item; an Entity-mentioning validation fault trips the
 *  ar_entity_rejected guard; anything else is a recorded qbo_error. (Moved from the
 *  retired per-RO poster.) */
export function classifyPostError(e: unknown): { retry: boolean; reviewKind: string | null } {
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

interface ClaimedDailyRow {
  id: string;
  business_date: string;
  category: string;
  posting_version: number;
  action: string;
  source_state_hash: string;
  requestid: string;
  proposed_je: {
    je?: { lines?: QboJeLineInput[]; docNumber?: string | null; txnDate?: string };
    marker?: string;
  } | null;
}

/** The default rebuild: the same pipeline the reconcile uses (drafts → gates → bundle),
 *  with the CALLER's settings overrides forwarded so the hash contract holds. */
const rebuildDesiredFromSource: RebuildDesired = async (shopId, realmId, businessDate, category, opts = {}) => {
  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
  const bundle = buildDailyJournalEntries(businessDate, rollup.postableSaleDrafts, rollup.postablePaymentDrafts);
  return bundle[category];
};

/**
 * Post ONE SPECIFIC approved daily posting by id. 'idle' when not claimable (not
 * approved / already claimed / wrong tenant). Throws only on DB/infra failure.
 * `opts` are the SAME settings overrides the enqueuing caller used (usually none).
 */
export async function postDailyPostingById(
  shopId: number,
  postingId: string,
  deps: { client?: QboDailyWriteClient; rebuild?: RebuildDesired } = {},
  opts: RebuildOpts = {},
): Promise<DailyPostOutcome> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { status: "no_connection" };

  const admin = createSupabaseAdminClient();

  // Crash recovery: re-queue any daily posting whose lease expired.
  const { error: rqErr } = await admin.rpc("qteklink_requeue_expired_daily_leases", {
    p_shop_id: shopId, p_realm_id: realmId,
  });
  if (rqErr) throw new Error(`postDailyPostingById (requeue) failed: ${rqErr.message}`);

  const { data: claimed, error: claimErr } = await admin.rpc("qteklink_claim_daily_posting_by_id", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: postingId, p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) throw new Error(`postDailyPostingById (claim) failed: ${claimErr.message}`);
  const row = claimed as ClaimedDailyRow | null;
  if (!row || !row.id) return { status: "idle" };

  const category = row.category as DailyCategory;
  const businessDate = row.business_date;
  const subject = { subjectKind: "day" as const, subjectRef: `${businessDate}:${category}` };

  const markFailed = async (retryable: boolean, response: unknown) => {
    const { error } = await admin.rpc("qteklink_mark_daily_failed", {
      p_shop_id: shopId, p_realm_id: realmId, p_id: row.id, p_retryable: retryable, p_qbo_response: response,
    });
    if (error) throw new Error(`postDailyPostingById (mark_failed) failed: ${error.message}`);
  };

  // ── STALENESS RECHECK (§4.1 hard requirement): rebuild desired, compare hashes. ──
  // At day grain the approve→post window can absorb new payments/voids/RO edits; a
  // stale daily JE would omit or duplicate source events. A mismatch RELEASES the row
  // back to pending with the fresh content — the human re-approves the changed money.
  const rebuild = deps.rebuild ?? rebuildDesiredFromSource;
  const desired = await rebuild(shopId, realmId, businessDate, category, opts);
  const desiredHash = sourceStateHash(dailySourceState(category, businessDate, desired));
  if (desiredHash !== row.source_state_hash) {
    const livePosted = await findLatestPostedDaily(shopId, realmId, businessDate, category);
    const live = livePosted && livePosted.action !== "delete" ? livePosted : null;
    // Nothing desired + nothing live: there is nothing to delete — refresh as an empty
    // 'create' (a 'delete' would violate the correction-version CHECK on a v1 row and
    // wedge it); the next reconcile's diff WITHDRAWS the empty pending row.
    const freshAction: DailyAction = desired ? (live ? "update" : "create") : live ? "delete" : "create";
    const { error: refErr } = await admin.rpc("qteklink_refresh_daily_posting", {
      p_shop_id: shopId, p_realm_id: realmId, p_id: row.id,
      p_action: freshAction,
      p_proposed_je: {
        je: desired
          ? { lines: desired.lines, docNumber: desired.docNumber, txnDate: desired.txnDate }
          : { lines: [], docNumber: null, txnDate: businessDate },
        marker: row.proposed_je?.marker ?? "",
        source_state_hash: desiredHash,
      },
      p_constituents: desired
        ? { ro_ids: desired.constituents.roIds, payment_ids: desired.constituents.paymentIds }
        : {},
      p_source_state_hash: desiredHash,
    });
    if (refErr) throw new Error(`postDailyPostingById (refresh) failed: ${refErr.message}`);
    return { status: "stale_refreshed", postingId: row.id };
  }

  const action = (row.action as DailyAction) ?? "create";
  const je = row.proposed_je?.je;

  // update/delete need the LIVE JE's id + CURRENT SyncToken (latest posted version).
  let liveTarget: { qboJeId: string; qboSyncToken: string } | null = null;
  if (action === "update" || action === "delete") {
    const livePosted = await findLatestPostedDaily(shopId, realmId, businessDate, category);
    if (!livePosted || livePosted.action === "delete" || !livePosted.qboJeId) {
      await markFailed(false, { error: "update_target_missing" });
      await upsertReviewItem(shopId, { kind: "qbo_error", ...subject, detail: { postingId: row.id, reason: `no live QBO JE to ${action}` } });
      return { status: "failed", postingId: row.id, reason: "update_target_missing" };
    }
    // FAIL CLOSED on a missing stored token — never guess one (a wrong SyncToken is an
    // optimistic-lock gamble; mark_daily_posted records it on every create/update, so
    // its absence on a live posted row is an anomaly a human must look at).
    if (!livePosted.qboSyncToken) {
      await markFailed(false, { error: "sync_token_missing" });
      await upsertReviewItem(shopId, { kind: "qbo_error", ...subject, detail: { postingId: row.id, reason: `live QBO JE ${livePosted.qboJeId} has no stored SyncToken — cannot ${action} safely` } });
      return { status: "failed", postingId: row.id, reason: "sync_token_missing" };
    }
    liveTarget = { qboJeId: livePosted.qboJeId, qboSyncToken: livePosted.qboSyncToken };
  }

  // Build the QBO payload (delete sends {Id, SyncToken} only).
  let body: Record<string, unknown>;
  if (action === "delete") {
    body = { Id: liveTarget!.qboJeId, SyncToken: liveTarget!.qboSyncToken };
  } else {
    if (!je || !Array.isArray(je.lines) || je.lines.length === 0 || !je.docNumber || !je.txnDate) {
      await markFailed(false, { error: "malformed_proposed_je" });
      await upsertReviewItem(shopId, { kind: "qbo_error", ...subject, detail: { postingId: row.id, reason: "malformed proposed_je" } });
      return { status: "failed", postingId: row.id, reason: "malformed_proposed_je" };
    }
    try {
      body = toQboJournalEntry({
        docNumber: je.docNumber,
        txnDate: je.txnDate,
        privateNote: row.proposed_je?.marker ?? "",
        lines: je.lines,
        ...(action === "update" ? { id: liveTarget!.qboJeId, syncToken: liveTarget!.qboSyncToken } : {}),
      });
    } catch (e) {
      await markFailed(false, { error: (e as Error).message });
      await upsertReviewItem(shopId, { kind: "qbo_error", ...subject, detail: { postingId: row.id, reason: (e as Error).message } });
      return { status: "failed", postingId: row.id, reason: "build_failed" };
    }
  }

  // ── LIVE QBO WRITE (mocked via deps.client in tests; gated in production) ──
  const client: QboDailyWriteClient = deps.client ?? new QboClient({ realmId });
  try {
    const resp = (
      action === "delete"
        ? await client.deleteEntity("journalentry", body, row.requestid)
        : await client.create("journalentry", body, row.requestid)
    ) as { JournalEntry?: { Id?: string; SyncToken?: string } };

    // A delete response carries the deleted Id (no SyncToken); create/update carry both.
    const qboJeId = resp?.JournalEntry?.Id ?? (action === "delete" ? liveTarget!.qboJeId : undefined);
    if (!qboJeId) {
      // No id back → treat as retryable (don't mark posted without proof it landed).
      await markFailed(true, resp);
      return { status: "retry", postingId: row.id };
    }
    const { error: mpErr } = await admin.rpc("qteklink_mark_daily_posted", {
      p_shop_id: shopId, p_realm_id: realmId, p_id: row.id,
      p_qbo_je_id: qboJeId,
      p_qbo_sync_token: resp?.JournalEntry?.SyncToken ?? null,
      p_qbo_response: resp,
    });
    if (mpErr) throw new Error(`postDailyPostingById (mark_posted) failed: ${mpErr.message}`);
    return { status: "posted", postingId: row.id, qboJeId, action };
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
