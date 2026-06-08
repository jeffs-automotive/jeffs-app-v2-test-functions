/**
 * Bulk approve+post for a business day (approval-dashboard upgrade, plan §6) — the LIVE
 * QBO write path, guarded by a Pattern-S dry-run → scope_hash → execute:
 *
 *   planApproveDay   — compute the EXACT in-scope set (unenqueued-postable + pending +
 *                      approved postings, in the chosen scope), a scope_hash bound to that
 *                      set's logical identities + amounts + shop/realm/date/scope, and a
 *                      per-type summary. NO writes.
 *   executeApproveDay — re-derive the set, RECOMPUTE the hash, and reject if it differs
 *                      (the day changed since the admin reviewed). Then for each id:
 *                      enqueue(if draft) → approve → scoped post (claim THIS id + lease).
 *                      Partial-failure tolerant + idempotent (already-posted are no-ops).
 *
 * Bulk scope EXCLUDES posting (in-flight, locked) / posted / failed / rejected /
 * needs_resolution — so a mis-click can never double-post an in-flight row or re-sweep a
 * rejected one (plan §3a). MULTI-TENANT: shopId server-derived; realmId from the bound
 * connection; every read/write scopes shop+realm. No silent failures.
 */
import * as Sentry from "@sentry/nextjs";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import {
  listPostingsForDay, enqueuePostingForDraft, approvePosting, sourceStateHash,
  type PostingRow, type PostingDraft,
} from "@/lib/dal/postings";
import { postApprovedPostingById, type QboPostClient } from "@/lib/dal/poster";

export type ApproveScope = "day" | "sale" | "payment";

interface ScopeItem {
  kind: "sale" | "payment";
  tekmetricRoId: number;
  paymentId: number | null;
  amountCents: number;
  status: "draft" | "pending" | "approved";
  postingId: string | null;
  /** present for a 'draft' item — to enqueue at execute. */
  enqueue?: PostingDraft;
}

export interface ApproveDaySummary {
  perType: { type: "sale" | "payment"; count: number; cents: number }[];
  totalCents: number;
  jeCount: number;
}

function debitTotal(lines: { postingType: "Debit" | "Credit"; amountCents: number }[]): number {
  return lines.filter((l) => l.postingType === "Debit").reduce((a, l) => a + (Number.isSafeInteger(l.amountCents) ? l.amountCents : 0), 0);
}
function keepLatest<K>(m: Map<K, PostingRow>, k: K, p: PostingRow): void {
  const cur = m.get(k);
  if (!cur || p.postingVersion > cur.postingVersion) m.set(k, p);
}

/** The set that "Approve + post" would act on, + the binding scope_hash + the summary. */
async function computeScope(
  shopId: number,
  realmId: string,
  businessDate: string,
  scope: ApproveScope,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number },
): Promise<{ items: ScopeItem[]; scopeHash: string; summary: ApproveDaySummary }> {
  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
  const { postings } = await listPostingsForDay(shopId, businessDate);

  const salePostingByRo = new Map<number, PostingRow>();
  const paymentPostingByKey = new Map<string, PostingRow>();
  for (const p of postings) {
    if (p.kind === "sale") keepLatest(salePostingByRo, p.tekmetricRoId, p);
    else if (p.kind === "payment" && p.paymentId != null) keepLatest(paymentPostingByKey, `${p.tekmetricRoId}:${p.paymentId}`, p);
  }

  const items: ScopeItem[] = [];

  if (scope === "day" || scope === "sale") {
    for (const draft of rollup.postableSaleDrafts) {
      const ro = draft.snapshot.repairOrderId;
      const posting = salePostingByRo.get(ro);
      if (posting) {
        if (posting.status === "pending" || posting.status === "approved") {
          items.push({ kind: "sale", tekmetricRoId: ro, paymentId: null, amountCents: posting.totalCents ?? debitTotal(draft.je.lines), status: posting.status, postingId: posting.id });
        }
        // posted/posting/failed/rejected/needs_resolution → NOT in bulk scope
      } else {
        const content = { lines: draft.je.lines, docNumber: draft.je.docNumber, txnDate: draft.je.txnDate };
        items.push({
          kind: "sale", tekmetricRoId: ro, paymentId: null, amountCents: debitTotal(draft.je.lines), status: "draft", postingId: null,
          enqueue: { kind: "sale", tekmetricRoId: ro, paymentId: null, batchDate: businessDate, txnDate: draft.je.txnDate, je: content, sourceState: content },
        });
      }
    }
  }

  if (scope === "day" || scope === "payment") {
    for (const pje of rollup.postablePaymentDrafts) {
      const payId = Number(pje.paymentId);
      // A manual pick (UUID id) or a payment with no RO can't form a posting identity — skip (deferred).
      if (pje.repairOrderId == null || !Number.isSafeInteger(payId)) continue;
      const posting = paymentPostingByKey.get(`${pje.repairOrderId}:${payId}`);
      if (posting) {
        if (posting.status === "pending" || posting.status === "approved") {
          items.push({ kind: "payment", tekmetricRoId: pje.repairOrderId, paymentId: payId, amountCents: posting.totalCents ?? debitTotal(pje.lines), status: posting.status, postingId: posting.id });
        }
      } else {
        const content = { lines: pje.lines, docNumber: pje.docNumber, txnDate: pje.txnDate };
        items.push({
          kind: "payment", tekmetricRoId: pje.repairOrderId, paymentId: payId, amountCents: debitTotal(pje.lines), status: "draft", postingId: null,
          enqueue: { kind: "payment", tekmetricRoId: pje.repairOrderId, paymentId: payId, batchDate: businessDate, txnDate: pje.txnDate, je: content, sourceState: content },
        });
      }
    }
  }

  // Deterministic order → a stable hash. Bind to logical identity + amount (NOT status, so
  // a benign enqueue between dry-run and execute doesn't spuriously reject) + scope context.
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.tekmetricRoId - b.tekmetricRoId || (a.paymentId ?? 0) - (b.paymentId ?? 0));
  const scopeHash = sourceStateHash({
    shop: shopId, realm: realmId, date: businessDate, scope,
    items: items.map((i) => ({ k: i.kind, ro: i.tekmetricRoId, pay: i.paymentId, amt: i.amountCents })),
  });

  const saleItems = items.filter((i) => i.kind === "sale");
  const payItems = items.filter((i) => i.kind === "payment");
  const summary: ApproveDaySummary = {
    perType: [
      { type: "sale", count: saleItems.length, cents: saleItems.reduce((a, i) => a + i.amountCents, 0) },
      { type: "payment", count: payItems.length, cents: payItems.reduce((a, i) => a + i.amountCents, 0) },
    ],
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

/** DRY-RUN: what "Approve + post" would do. No writes. */
export async function planApproveDay(
  shopId: number,
  businessDate: string,
  scope: ApproveScope,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<ApproveDayPlan> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, scopeHash: "", summary: { perType: [], totalCents: 0, jeCount: 0 } };
  const { scopeHash, summary } = await computeScope(shopId, realmId, businessDate, scope, opts);
  return { realmId, scopeHash, summary };
}

export interface ApproveDayResult {
  ok: boolean;
  reason?: "no_connection" | "scope_changed";
  posted: number;
  failed: number;
  skipped: number;
  scopeHash: string;
}

/**
 * EXECUTE: re-derive the scope, verify the hash matches what the admin confirmed, then
 * enqueue→approve→scoped-post each id. Partial-failure tolerant; idempotent.
 */
export async function executeApproveDay(
  shopId: number,
  businessDate: string,
  scope: ApproveScope,
  expectedScopeHash: string,
  approvedBy: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
  deps: { client?: QboPostClient } = {},
): Promise<ApproveDayResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { ok: false, reason: "no_connection", posted: 0, failed: 0, skipped: 0, scopeHash: "" };

  const { items, scopeHash } = await computeScope(shopId, realmId, businessDate, scope, opts);
  if (scopeHash !== expectedScopeHash) {
    return { ok: false, reason: "scope_changed", posted: 0, failed: 0, skipped: 0, scopeHash };
  }

  let posted = 0, failed = 0, skipped = 0;
  for (const item of items) {
    try {
      let postingId = item.postingId;
      if (item.status === "draft" && item.enqueue) {
        const enq = await enqueuePostingForDraft(shopId, realmId, item.enqueue);
        postingId = enq.postingId;
        if (!postingId) { skipped++; continue; } // already-posted-unchanged 'skip' → nothing to do
      }
      if (!postingId) { skipped++; continue; }
      // Approve (pending/draft → approved); a no-op if a concurrent path already approved it.
      if (item.status !== "approved") await approvePosting(shopId, postingId, approvedBy);
      const outcome = await postApprovedPostingById(shopId, postingId, deps);
      if (outcome.status === "posted") posted++;
      else if (outcome.status === "idle" || outcome.status === "no_connection") skipped++;
      else failed++; // retry / failed / deferred
    } catch (e) {
      failed++; // an infra error on one id never aborts the batch…
      // …but a per-id failure in a LIVE financial write must be visible, not just counted.
      Sentry.captureException(e, {
        tags: { qteklink_action: "approveAndPostDay", shop_id: String(shopId), realm_id: realmId },
        extra: { postingId: item.postingId, tekmetricRoId: item.tekmetricRoId, kind: item.kind },
      });
    }
  }
  return { ok: true, posted, failed, skipped, scopeHash };
}
