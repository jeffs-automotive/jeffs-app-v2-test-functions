/**
 * Day-attention model (resolution-workflow Part D) — the ONE day-scoped list that the
 * approve-button lock, the "needs attention" banner, and the fix-it page all render.
 * PURE assembly over the day's build + posting ledger + open review items + open
 * payment redates — so the lock and the list can never disagree again (the
 * 2026-06-29 incident was exactly that disagreement).
 *
 * Every item carries the REAL action for its kind (retry/accept a failed posting,
 * fix a mapping, delete a conflicting manual pick, wait-for/approve a redate…) —
 * a note-only "resolve" that changes nothing is reserved for kinds with no
 * systemic action.
 */
import type { DailyPostingRow } from "@/lib/dal/daily-postings";
import type { ReviewItemRow, UpsertReviewItemInput } from "@/lib/dal/review-items";
import type { PaymentRedateRow } from "@/lib/dal/payment-redates";
import type { DailyCategory } from "@/lib/daily/daily-je-builder";

/** The actions a fix-it card can offer (the UI maps these to buttons). */
export type DayAttentionAction =
  | "retry_or_accept"        // failed posting → the Part B Pattern S pair
  | "fix_mapping"            // unmapped → deep-link /mappings?focus=<token>
  | "delete_manual_payment"  // conflicting manual pick → remove it
  | "record_manual_payment"  // a payment needs a method pick
  | "redate_approve"         // late payment → "post it to this day anyway"
  | "resolve_note";          // note-only close (no systemic action exists)

export interface DayAttentionItem {
  /** Stable render key. */
  key: string;
  /** The review kind / synthetic kind ('posting_failed' when no paired item exists). */
  kind: string;
  /** True → counts toward the approve-button lock. */
  blocking: boolean;
  title: string;
  /** Plain-English one-liner for the office user. */
  summary: string;
  /** Raw reason tokens (unmapped keys, gate reasons) for the detail chips. */
  reasons: string[];
  cents: number | null;
  subjectLabel: string | null;
  reviewItemId: string | null;
  postingId: string | null;
  redateId: string | null;
  /** /mappings?focus= tokens (kind|sourceKey) derived from unmapped reasons. */
  mappingTokens: string[];
  /** The conflicting manual pick's id (delete_manual_payment target). */
  manualPaymentId: string | null;
  actions: DayAttentionAction[];
}

export interface DayAttention {
  items: DayAttentionItem[];
  /** Drives the approve-button lock (blocking items only). */
  blockingCount: number;
}

/** Shop-language labels for EVERY kind (audit: 9 of 16 previously rendered raw). */
export const KIND_LABELS: Record<string, string> = {
  unmapped: "Not matched to a QuickBooks account",
  tax_identity: "The RO's tax math doesn't add up",
  tax_high: "Sales tax looks too high",
  negative_component: "A negative amount that shouldn't be negative",
  unbalanced: "The entry doesn't balance (needs engineering)",
  payment_corrupt: "A payment amount looks corrupt",
  snapshot_unparseable: "A repair order couldn't be read — its sale is NOT in the day's totals",
  manual_payment_conflict: "A manual payment pick duplicates a real payment",
  daily_unbalanced: "The day's journal entry doesn't balance (needs engineering)",
  daily_line_cap: "The day's journal entry is too big for QuickBooks (needs engineering)",
  qbo_deposit_locked: "Already deposited in QuickBooks — the update can't be pushed",
  qbo_error: "QuickBooks rejected the posting",
  ar_entity_rejected: "QuickBooks rejected the A/R line",
  reconnect_required: "QuickBooks connection expired during posting",
  missed_ro_webhook: "A repair order never arrived from Tekmetric — its sale is NOT posted",
  posted_je_missing: "A posted journal entry has vanished from QuickBooks",
  late_payment_redate: "Payment came in for an already-posted day",
  posting_failed: "The posting failed",
};

/** Plain-English guidance per kind — what the user should actually DO. */
export const KIND_HELP: Record<string, string> = {
  unmapped: "Match the item to a QuickBooks account on the Mappings page — this clears itself once mapped.",
  tax_identity: "Fix the repair order's tax in Tekmetric; this clears itself on the next check.",
  tax_high: "Check the RO's tax in Tekmetric — if it's genuinely right, tell Chris; otherwise fix it there and this clears itself.",
  negative_component: "A sale component is negative in Tekmetric — fix the RO there; this clears itself.",
  unbalanced: "This is a system problem, not a data-entry problem — flag it to support.",
  payment_corrupt: "The payment's amount isn't a valid money value — fix or void it in Tekmetric; this clears itself.",
  snapshot_unparseable: "The day can post WITHOUT this sale, so don't trust the totals until it's fixed — re-save the RO in Tekmetric or flag support.",
  manual_payment_conflict: "A real payment arrived for this RO after a manual pick was recorded. Delete the manual pick — the real payment posts on its own.",
  daily_unbalanced: "This is a system problem — the day can't post this entry. Flag it to support.",
  daily_line_cap: "Too many lines for one QuickBooks entry — flag it to support (the day may need splitting).",
  qbo_deposit_locked:
    "QuickBooks locks a journal entry once its money is swept into a deposit. Either open QuickBooks, unlink (or delete) that deposit, then press \"I unlinked the deposit — retry now\" — or press \"Keep QuickBooks as-is\" to leave it (the difference stays recorded here).",
  qbo_error: "Retry the posting; if it keeps failing, the error text below says why (flag support if unclear).",
  ar_entity_rejected: "A mapped account isn't compatible with QuickBooks A/R rules — re-check the mapping, then retry.",
  reconnect_required: "Reconnect QuickBooks from the home page, then press retry.",
  missed_ro_webhook: "Tekmetric never sent this repair order. Flag support — the sale is missing from QuickBooks until it's backfilled.",
  posted_je_missing: "Someone deleted this entry in QuickBooks. Flag support — the books no longer match what was posted.",
  late_payment_redate:
    "Void this payment in Tekmetric and take it again on a different day — QTekLink clears this automatically once that happens. (Or press \"Post to this day anyway\" to force it into the posted day.)",
};

/** Map an unmapped-reason token to the /mappings picker token (kind|sourceKey). */
export function mappingTokenForReason(reason: string): string | null {
  const [head, ...rest] = reason.split(":");
  const key = rest.join(":").trim();
  switch (head) {
    case "fee": return key ? `fee|${key}` : null;
    case "part_category": return key && !["unknown", "unweighted"].includes(key) ? `part_category|${key}` : null;
    case "payment_type": return key ? `payment_type|${key}` : null;
    case "noncash_payment_type": return key ? `noncash_payment_type|${key}` : null;
    case "labor": return "labor|Labor";
    case "sublet": return "sublet|Sublet";
    case "sales_tax_payable": return "tax|Sales Tax";
    case "tire_fee_payable": return "tax|Tire Tax";
    case "accounts_receivable": return "system|accounts_receivable";
    case "undeposited_funds": return "system|undeposited_funds";
    case "cc_fee": return "system|cc_fee";
    case "store_credit": return "system|store_credit";
    default: return null;
  }
}

function reasonsOf(detail: Record<string, unknown> | undefined): string[] {
  const r = detail?.reasons;
  return Array.isArray(r) ? r.map(String) : [];
}

export interface AssembleDayAttentionInput {
  businessDate: string;
  /** The day's CURRENT gate failures + pre-build extras (this run's emissions). */
  emittedItems: UpsertReviewItemInput[];
  /** ALL versions/statuses for the day (the posting ledger). */
  postings: DailyPostingRow[];
  /** The shop's OPEN review items (matched by kind+subject to the day). */
  openItems: ReviewItemRow[];
  /** OPEN payment redates for this day. */
  openRedates: PaymentRedateRow[];
}

const CATEGORY_LABEL: Record<DailyCategory, string> = { sales: "Sales", payments: "Payments", fees: "Card fees" };
/** Poster kinds that pair with a failed posting version. */
const POSTER_KINDS = new Set(["qbo_deposit_locked", "qbo_error", "ar_entity_rejected", "reconnect_required"]);
/** Emitted kinds that block the day (money can't post / totals can't be trusted). */
const NON_BLOCKING_EMITTED = new Set(["manual_payment_conflict"]);

/** PURE: assemble the day's attention list. */
export function assembleDayAttention(input: AssembleDayAttentionInput): DayAttention {
  const { businessDate, emittedItems, postings, openItems, openRedates } = input;
  const items: DayAttentionItem[] = [];
  const dayPrefix = `${businessDate}:`;

  const openByKey = new Map(openItems.map((i) => [`${i.kind}|${i.subjectKind}|${i.subjectRef}`, i]));

  // ── 1. FAILED latest versions per category → the Part B retry/accept card ──
  const latestByCategory = new Map<DailyCategory, DailyPostingRow>();
  for (const p of postings) latestByCategory.set(p.category, p); // ordered version-asc
  for (const [category, row] of latestByCategory.entries()) {
    if (row.status !== "failed") continue;
    // Pair with the poster's review item when it's still open (title + error text).
    const paired = [...POSTER_KINDS].map((k) => openByKey.get(`${k}|day|${dayPrefix}${category}`)).find(Boolean);
    const kind = paired?.kind ?? "posting_failed";
    const qboError = typeof paired?.detail?.qboError === "string" ? String(paired.detail.qboError) : null;
    items.push({
      key: `failed:${row.id}`,
      kind,
      blocking: true,
      title: KIND_LABELS[kind] ?? KIND_LABELS.posting_failed!,
      summary: qboError ?? `The ${CATEGORY_LABEL[category].toLowerCase()} update for ${businessDate} did not reach QuickBooks.`,
      reasons: [],
      cents: row.totalCents,
      subjectLabel: `${CATEGORY_LABEL[category]} — ${row.docNumber ?? businessDate}`,
      reviewItemId: paired?.id ?? null,
      postingId: row.id,
      redateId: null,
      mappingTokens: [],
      manualPaymentId: null,
      actions: ["retry_or_accept"],
    });
  }

  // ── 2. This run's gate failures + pre-build extras (the CURRENT truth) ──
  for (const e of emittedItems) {
    const open = openByKey.get(`${e.kind}|${e.subjectKind}|${e.subjectRef}`);
    const reasons = reasonsOf(e.detail as Record<string, unknown> | undefined);
    const tokens = [...new Set(reasons.map(mappingTokenForReason).filter((t): t is string => t !== null))];
    const docNumber = typeof (e.detail as Record<string, unknown> | undefined)?.docNumber === "string"
      ? String((e.detail as Record<string, unknown>).docNumber)
      : null;
    const manualPaymentId = typeof (e.detail as Record<string, unknown> | undefined)?.manualPaymentId === "string"
      ? String((e.detail as Record<string, unknown>).manualPaymentId)
      : null;
    const actions: DayAttentionAction[] =
      e.kind === "manual_payment_conflict" && manualPaymentId ? ["delete_manual_payment"]
        : tokens.length > 0 ? ["fix_mapping"]
          : ["resolve_note"];
    items.push({
      key: `gate:${e.kind}:${e.subjectKind}:${e.subjectRef}`,
      kind: e.kind,
      blocking: !NON_BLOCKING_EMITTED.has(e.kind),
      title: KIND_LABELS[e.kind] ?? e.kind,
      summary: KIND_HELP[e.kind] ?? "",
      reasons,
      cents: null,
      subjectLabel: docNumber ?? `${e.subjectKind} ${e.subjectRef}`,
      reviewItemId: open?.id ?? null,
      postingId: null,
      redateId: null,
      mappingTokens: tokens,
      manualPaymentId,
      actions,
    });
  }

  // ── 3. Open late-payment redates (informational — the day is already posted) ──
  for (const r of openRedates) {
    const who = r.roNumber ? `RO ${r.roNumber}${r.customerName ? ` (${r.customerName})` : ""}` : (r.customerName ?? "unattached payment");
    items.push({
      key: `redate:${r.id}`,
      kind: "late_payment_redate",
      blocking: false,
      title: KIND_LABELS.late_payment_redate!,
      summary: `Void this payment and take it on a different day — ${businessDate} is already posted to QuickBooks. QTekLink clears this automatically once it's re-dated.`,
      reasons: [],
      cents: r.amountCents,
      subjectLabel: who,
      reviewItemId: null,
      postingId: null,
      redateId: r.status === "pending" ? r.id : null,
      mappingTokens: [],
      manualPaymentId: null,
      actions: r.status === "pending" ? ["redate_approve"] : [],
    });
  }

  return { items, blockingCount: items.filter((i) => i.blocking).length };
}
