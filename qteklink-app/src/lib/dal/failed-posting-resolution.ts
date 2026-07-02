/**
 * Failed-posting resolution (resolution-workflow Part B) — the two human EXITS from a
 * FAILED daily posting, Pattern S guarded (dry-run summary + bound hash → execute):
 *
 *   RETRY  ("I unlinked the deposit — retry now"): failed → approved → post. Same
 *          version, same content, same requestid — the dry-run binds the scope to the
 *          row's source hash and the execute re-verifies it, so only VERIFIED-unchanged
 *          content can re-post (the crash-safe resend contract: if the original write
 *          actually landed, QBO's requestid dedup returns it). The poster's claim-time
 *          staleness recheck stays the last guard.
 *
 *   ACCEPT ("Keep QuickBooks as-is"): failed → accepted (terminal). QuickBooks is
 *          intentionally left as-is; the day stops counting the correction as
 *          needs-attention; the version stays in history. A later REAL source change
 *          still stages v(N+1) (the diff treats accepted like failed/rejected).
 *
 * Both, on success, SYSTEM-close the paired poster-emitted review items for the
 * day-category (qbo_deposit_locked / qbo_error / ar_entity_rejected /
 * reconnect_required) — the queue converges with the ledger instead of lying to the
 * user (the 2026-06-29 incident). Fat-DAL; the thin admin action wraps this.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { sourceStateHash } from "@/lib/dal/postings";
import {
  listDailyPostingsForDay,
  retryDailyPosting,
  acceptDailyVariance,
  dailySourceState,
  type DailyPostingRow,
} from "@/lib/dal/daily-postings";
import { postDailyPostingById } from "@/lib/dal/daily-poster";
import { listOpenReviewItems, autoResolveReviewItems } from "@/lib/dal/review-items";
import { classifyDelta, type ChangeKind } from "@/lib/daily/je-delta";
import { buildDailyJournalEntries, type DailyCategory } from "@/lib/daily/daily-je-builder";

/** The poster-emitted review kinds paired with a failed posting (closed on retry/accept). */
const POSTER_REVIEW_KINDS = new Set(["qbo_deposit_locked", "qbo_error", "ar_entity_rejected", "reconnect_required"]);

export interface FailedPostingPlan {
  ok: true;
  /** 'ready' = the failed row is current (retry + accept both offered); 'stale' = the
   *  day's source has since changed — the normal reconcile/diff owns it now. */
  mode: "ready" | "stale";
  postingId: string;
  businessDate: string;
  category: DailyCategory;
  docNumber: string | null;
  totalCents: number | null;
  constituents: number;
  /** What differs vs the LIVE posted JE (what accept would leave out of QuickBooks). */
  variance: { changeKind: ChangeKind; added: string[]; removed: string[] } | null;
  /** Why the posting failed (the poster's recorded review context, e.g. deposit-locked). */
  scopeHash: string;
}

export type FailedPostingPlanResult =
  | FailedPostingPlan
  | { ok: false; reason: "no_connection" | "not_found" | "not_failed" | "superseded" };

/** Locate the failed row + its day's ledger context. */
async function loadFailedRow(
  shopId: number,
  realmId: string,
  postingId: string,
): Promise<{ row: DailyPostingRow; latest: DailyPostingRow; livePosted: DailyPostingRow | null } | "not_found" | "not_failed" | "superseded"> {
  // The row id doesn't carry its day — list by day requires the date, so fetch the row
  // via the day listing after a direct lookup of its (date, category) from the ledger.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_daily_postings")
    .select("business_date, category")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("id", postingId)
    .limit(1);
  if (error) throw new Error(`loadFailedRow failed: ${error.message}`);
  const head = ((data ?? []) as { business_date: string; category: string }[])[0];
  if (!head) return "not_found";

  const { postings } = await listDailyPostingsForDay(shopId, head.business_date);
  const row = postings.find((p) => p.id === postingId);
  if (!row) return "not_found";
  if (row.status !== "failed") return "not_failed";

  const mine = postings.filter((p) => p.category === row.category);
  const latest = mine.reduce((a, b) => (b.postingVersion > a.postingVersion ? b : a));
  if (latest.id !== row.id) return "superseded"; // a newer version exists — the diff owns it
  const posted = mine
    .filter((p) => p.status === "posted")
    .reduce<DailyPostingRow | null>((a, b) => (!a || b.postingVersion > a.postingVersion ? b : a), null);
  const livePosted = posted && posted.action !== "delete" ? posted : null;
  return { row, latest, livePosted };
}

/**
 * DRY RUN: is the failed row still the day-category's current desired state? Returns
 * the plain-English scope (amount, constituents, what accept leaves out of QBO) + a
 * scope hash binding the execute to THIS row content. No writes.
 */
export async function planFailedPostingResolution(
  shopId: number,
  postingId: string,
): Promise<FailedPostingPlanResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { ok: false, reason: "no_connection" };

  const loaded = await loadFailedRow(shopId, realmId, postingId);
  if (typeof loaded === "string") return { ok: false, reason: loaded };
  const { row, livePosted } = loaded;

  // Rebuild the desired category JE (the same pipeline the reconcile/poster use).
  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, row.businessDate);
  const rollup = rollupDay(row.businessDate, sales, payments.map((p) => p.je), gateSettings);
  const bundle = buildDailyJournalEntries(row.businessDate, rollup.postableSaleDrafts, rollup.postablePaymentDrafts);
  const desiredHash = sourceStateHash(dailySourceState(row.category, row.businessDate, bundle[row.category]));

  const mode: FailedPostingPlan["mode"] = desiredHash === row.sourceStateHash ? "ready" : "stale";
  const variance = livePosted
    ? classifyDelta(row.category, livePosted, { ...row, isDelete: row.action === "delete" })
    : null;

  return {
    ok: true,
    mode,
    postingId: row.id,
    businessDate: row.businessDate,
    category: row.category,
    docNumber: row.docNumber,
    totalCents: row.totalCents,
    constituents: row.constituents.roIds.length + row.constituents.paymentIds.length,
    variance,
    scopeHash: sourceStateHash({ resolve: row.id, hash: row.sourceStateHash }),
  };
}

export interface FailedPostingExecuteResult {
  ok: boolean;
  reason?: "no_connection" | "not_found" | "not_failed" | "superseded" | "scope_changed" | "post_failed";
  outcome?: "posted" | "accepted" | "stale_refreshed" | "failed";
  resolvedReviewItems?: number;
}

/**
 * EXECUTE the confirmed choice. Re-loads + re-verifies the scope hash (the row can't
 * have changed since the admin reviewed), then:
 *   retry  → qteklink_retry_daily_posting (failed→approved) → postDailyPostingById.
 *   accept → qteklink_accept_daily_variance (failed→accepted).
 * On success, system-closes the paired poster review items for `${date}:${category}`.
 */
export async function executeFailedPostingResolution(
  shopId: number,
  postingId: string,
  choice: "retry" | "accept",
  expectedScopeHash: string,
  actor: string,
): Promise<FailedPostingExecuteResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { ok: false, reason: "no_connection" };

  const loaded = await loadFailedRow(shopId, realmId, postingId);
  if (typeof loaded === "string") return { ok: false, reason: loaded };
  const { row } = loaded;

  const scopeHash = sourceStateHash({ resolve: row.id, hash: row.sourceStateHash });
  if (scopeHash !== expectedScopeHash) return { ok: false, reason: "scope_changed" };

  if (choice === "accept") {
    const { accepted } = await acceptDailyVariance(shopId, row.id, actor);
    if (!accepted) return { ok: false, reason: "not_failed" }; // raced away from 'failed'
    const resolved = await closePosterItems(shopId, realmId, row, actor, { action: "variance_accepted" });
    return { ok: true, outcome: "accepted", resolvedReviewItems: resolved };
  }

  // retry
  const { retried } = await retryDailyPosting(shopId, row.id, actor);
  if (!retried) return { ok: false, reason: "not_failed" }; // raced away from 'failed'
  const outcome = await postDailyPostingById(shopId, row.id);
  if (outcome.status === "posted") {
    const resolved = await closePosterItems(shopId, realmId, row, actor, { action: "retried", qboJeId: outcome.qboJeId ?? null });
    return { ok: true, outcome: "posted", resolvedReviewItems: resolved };
  }
  if (outcome.status === "stale_refreshed") return { ok: true, outcome: "stale_refreshed", resolvedReviewItems: 0 };
  // The poster recorded the failure (fresh review item + failed status) — surface it.
  return { ok: false, reason: "post_failed", outcome: "failed" };
}

/** Close the OPEN poster-emitted review items paired with this day-category. */
async function closePosterItems(
  shopId: number,
  realmId: string,
  row: DailyPostingRow,
  actor: string,
  resolution: Record<string, unknown>,
): Promise<number> {
  const { items } = await listOpenReviewItems(shopId);
  const subjectRef = `${row.businessDate}:${row.category}`;
  const ids = items
    .filter((i) => POSTER_REVIEW_KINDS.has(i.kind) && i.subjectKind === "day" && i.subjectRef === subjectRef)
    .map((i) => i.id);
  const { resolved } = await autoResolveReviewItems(shopId, realmId, ids, `system (${actor})`, resolution);
  return resolved;
}
