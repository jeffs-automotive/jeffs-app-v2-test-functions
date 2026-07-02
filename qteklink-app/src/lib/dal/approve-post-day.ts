/**
 * Bulk approve+post for a business day (daily-JE rework step 4, plan §4/§7) — the LIVE
 * QBO write path at the DAY-CATEGORY grain, guarded by Pattern S (dry-run → scope_hash
 * → execute). A day posts UP TO 3 JournalEntries (sales / payments / fees) — never
 * individual per-RO/payment JEs (Chris: approval is always bulk).
 *
 *   planApproveDay    — build the day's desired category JEs (the same pipeline the
 *                       reconcile uses), diff each against the daily-postings ledger,
 *                       and return the EXACT set of category writes that would happen
 *                       (create / full-replacement update / delete) + a scope_hash bound
 *                       to each category's desired source hash. NO writes.
 *   executeApproveDay — re-derive, RECOMPUTE the hash, reject if it differs (the day
 *                       moved since the admin reviewed). Then per category: enqueue the
 *                       diffed version → approve → post (claim THIS id + lease). The
 *                       poster re-checks staleness at claim; a mismatch releases the row
 *                       back to pending and counts as `stale` (re-approval required).
 *
 * Scope: 'day' = all three categories; 'sale' = the sales JE; 'payment' = the payments
 * + fees JEs. Categories post sequentially but INDEPENDENTLY (QBO writes aren't
 * transactional) — a failed category retries on the next run; the others stand (§4.5).
 * In-flight ('posting') rows are excluded; posted+unchanged categories are no-ops.
 *
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection. No silent
 * failures: per-item errors are counted AND captured to Sentry.
 */
import * as Sentry from "@sentry/nextjs";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { sourceStateHash } from "@/lib/dal/postings";
import { isCosmeticDelta } from "@/lib/daily/je-delta";
import {
  listDailyPostingsForDay,
  enqueueDailyPosting,
  approveDailyPosting,
  dailySourceState,
  type DailyAction,
  type DailyPostingRow,
} from "@/lib/dal/daily-postings";
import { postDailyPostingById, type QboDailyWriteClient, type RebuildDesired } from "@/lib/dal/daily-poster";
import {
  buildDailyJournalEntries,
  type DailyCategory,
  type DailyJournalEntry,
} from "@/lib/daily/daily-je-builder";

export type ApproveScope = "day" | "sale" | "payment";

const SCOPE_CATEGORIES: Record<ApproveScope, DailyCategory[]> = {
  day: ["sales", "payments", "fees"],
  sale: ["sales"],
  payment: ["payments", "fees"],
};

interface CategoryScopeItem {
  category: DailyCategory;
  /** What posting this category needs: create / full-replacement update / delete. */
  action: DailyAction;
  /** The desired category JE (null for a delete — the category emptied). */
  je: DailyJournalEntry | null;
  desiredHash: string;
  /** An existing ledger row to act on (pending → approve → post; approved → post). */
  postingId: string | null;
  rowStatus: "none" | "pending" | "approved";
  amountCents: number;
  /** RO / payment count — the modal's "Sales JE (32 ROs)" label. */
  constituents: number;
}

export interface ApproveDaySummary {
  perCategory: { category: DailyCategory; action: DailyAction; cents: number; constituents: number }[];
  totalCents: number;
  /** The number of QBO JournalEntry writes this approval performs (≤ 3). */
  jeCount: number;
}

function latestByCategory(rows: DailyPostingRow[], category: DailyCategory): {
  latest: DailyPostingRow | null;
  livePosted: DailyPostingRow | null;
} {
  const mine = rows.filter((r) => r.category === category);
  let latest: DailyPostingRow | null = null;
  let latestPosted: DailyPostingRow | null = null;
  for (const r of mine) {
    if (!latest || r.postingVersion > latest.postingVersion) latest = r;
    if (r.status === "posted" && (!latestPosted || r.postingVersion > latestPosted.postingVersion)) latestPosted = r;
  }
  const livePosted = latestPosted && latestPosted.action !== "delete" ? latestPosted : null;
  return { latest, livePosted };
}

/** The category writes "Approve + post" would perform + the binding scope_hash. */
async function computeScope(
  shopId: number,
  realmId: string,
  businessDate: string,
  scope: ApproveScope,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number },
): Promise<{ items: CategoryScopeItem[]; scopeHash: string; summary: ApproveDaySummary }> {
  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
  const bundle = buildDailyJournalEntries(businessDate, rollup.postableSaleDrafts, rollup.postablePaymentDrafts);
  const { postings } = await listDailyPostingsForDay(shopId, businessDate);

  const items: CategoryScopeItem[] = [];
  for (const category of SCOPE_CATEGORIES[scope]) {
    const je = bundle[category];
    // An unbalanced/over-cap bundle never enters the approve scope (the reconcile layer
    // raises its review item; enqueue would refuse it anyway).
    if (je && (!je.balanced || je.overLineCap)) continue;

    const { latest, livePosted } = latestByCategory(postings, category);
    const action: DailyAction | null = je ? (livePosted ? "update" : "create") : livePosted ? "delete" : null;
    if (!action) continue; // nothing desired, nothing live

    const desiredHash = sourceStateHash(dailySourceState(category, businessDate, je));
    if (latest?.status === "acknowledged") continue; // Accounting Link's day — never post
    if (latest?.status === "posted" && latest.sourceStateHash === desiredHash) continue; // done
    if (latest?.status === "posting") continue; // in flight — locked
    // PARITY with the enqueue diff (resolution-workflow Part C): a terminal-state
    // latest (failed/rejected/accepted/needs_resolution) with UNCHANGED content, and
    // any cosmetic-only delta vs the live posted JE, would be SKIPPED by execute —
    // so the dry-run modal must not promise the write (the 6/29 modal/execute
    // disagreement: "replaces the posted JE" → "skipped 1").
    if (
      latest &&
      (latest.status === "failed" || latest.status === "rejected" ||
       latest.status === "accepted" || latest.status === "needs_resolution") &&
      latest.sourceStateHash === desiredHash
    ) continue;
    if (
      je && livePosted &&
      (livePosted.sourceStateHash === desiredHash ||
        isCosmeticDelta(category, livePosted, {
          docNumber: je.docNumber, txnDate: je.txnDate, constituents: je.constituents, lines: je.lines,
        }))
    ) continue;

    items.push({
      category,
      action,
      je,
      desiredHash,
      postingId: latest && (latest.status === "pending" || latest.status === "approved") ? latest.id : null,
      rowStatus: latest?.status === "approved" ? "approved" : latest?.status === "pending" ? "pending" : "none",
      amountCents: je ? je.totalDebitsCents : 0,
      constituents: je ? je.constituents.roIds.length + je.constituents.paymentIds.length : 0,
    });
  }

  // Bind the hash to each category's EXACT desired content (not just amounts) + context.
  const scopeHash = sourceStateHash({
    shop: shopId, realm: realmId, date: businessDate, scope,
    items: items.map((i) => ({ c: i.category, a: i.action, h: i.desiredHash })),
  });

  const summary: ApproveDaySummary = {
    perCategory: items.map((i) => ({ category: i.category, action: i.action, cents: i.amountCents, constituents: i.constituents })),
    totalCents: items.reduce((a, i) => a + i.amountCents, 0),
    jeCount: items.length,
  };
  return { items, scopeHash, summary };
}

export interface ApproveDayPlan {
  realmId: string | null;
  scopeHash: string;
  summary: ApproveDaySummary;
}

/** DRY-RUN: what "Approve + post" would write. No writes. */
export async function planApproveDay(
  shopId: number,
  businessDate: string,
  scope: ApproveScope,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<ApproveDayPlan> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, scopeHash: "", summary: { perCategory: [], totalCents: 0, jeCount: 0 } };
  const { scopeHash, summary } = await computeScope(shopId, realmId, businessDate, scope, opts);
  return { realmId, scopeHash, summary };
}

export interface ApproveDayResult {
  ok: boolean;
  reason?: "no_connection" | "scope_changed";
  posted: number;
  failed: number;
  skipped: number;
  /** Categories whose source moved between approve and post — released back to pending
   *  with fresh content; the admin re-reviews (the §4.1 claim-time recheck). */
  stale: number;
  scopeHash: string;
}

/**
 * EXECUTE: re-derive the scope, verify the hash matches what the admin confirmed, then
 * per category: enqueue (diff) → approve → post. Partial-failure tolerant; idempotent.
 */
export async function executeApproveDay(
  shopId: number,
  businessDate: string,
  scope: ApproveScope,
  expectedScopeHash: string,
  approvedBy: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
  deps: { client?: QboDailyWriteClient; rebuild?: RebuildDesired } = {},
): Promise<ApproveDayResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { ok: false, reason: "no_connection", posted: 0, failed: 0, skipped: 0, stale: 0, scopeHash: "" };

  const { items, scopeHash } = await computeScope(shopId, realmId, businessDate, scope, opts);
  if (scopeHash !== expectedScopeHash) {
    return { ok: false, reason: "scope_changed", posted: 0, failed: 0, skipped: 0, stale: 0, scopeHash };
  }

  let posted = 0, failed = 0, skipped = 0, stale = 0;
  for (const item of items) {
    try {
      let postingId = item.postingId;
      if (item.rowStatus !== "approved") {
        // The diff creates the right version / refreshes the pending slot / returns the
        // existing one. 'frozen' (approved by a concurrent path) still yields the id —
        // posting it is exactly right (the poster re-checks at claim).
        const enq = await enqueueDailyPosting(shopId, realmId, businessDate, item.category, item.je);
        if (!enq.postingId || enq.enqueueAction === "blocked" || enq.enqueueAction === "skip"
            || enq.enqueueAction === "noop" || enq.enqueueAction === "withdrawn"
            || enq.enqueueAction === "obsoleted") {
          skipped++;
          continue;
        }
        postingId = enq.postingId;
        if (enq.enqueueAction !== "frozen") await approveDailyPosting(shopId, postingId, approvedBy);
      }
      if (!postingId) { skipped++; continue; }

      // Forward the SAME settings overrides used to compute this scope — the poster's
      // claim-time rebuild must hash identically or every post would stale-refresh.
      const outcome = await postDailyPostingById(shopId, postingId, deps, opts);
      if (outcome.status === "posted") posted++;
      else if (outcome.status === "stale_refreshed") stale++;
      else if (outcome.status === "idle" || outcome.status === "no_connection") skipped++;
      else failed++; // retry / failed
    } catch (e) {
      failed++; // an infra error on one category never aborts the others…
      // …but a per-category failure in a LIVE financial write must be visible.
      Sentry.captureException(e, {
        tags: { qteklink_action: "approveAndPostDay", shop_id: String(shopId), realm_id: realmId },
        extra: { postingId: item.postingId, category: item.category, businessDate },
      });
    }
  }
  return { ok: true, posted, failed, skipped, stale, scopeHash };
}
