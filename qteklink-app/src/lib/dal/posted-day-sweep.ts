/**
 * Posted-day correction sweep (Chris's spec) — keeps QuickBooks matched to Tekmetric
 * AFTER a day has been posted, and tells the office manager what changed.
 *
 * Runs nightly (and after a date-move approval/unapproval). For every business day
 * that has a POSTED daily JE:
 *
 *   1. DETECT DATE MOVES first (`detectDateMoves`): an RO unposted and re-posted to a
 *      DIFFERENT day goes to the posting queue (pending = both days HELD) and the
 *      DATE CHANGE ALERT recipients are emailed. Nothing changes in QBO yet.
 *   2. RE-RECONCILE the day. With the holds applied, any remaining difference is a
 *      real same-day change: an RO unposted (and not re-posted), an RO's totals
 *      edited, a payment voided/refunded late, etc. The diff stages a correction
 *      version (update — or delete when the category emptied).
 *   3. AUTO-POST the correction (approve as "system (auto-correction)" + post). The
 *      poster's claim-time staleness recheck still guards the write. A day-category
 *      that has NEVER been posted is NOT auto-posted — first-time posting stays a
 *      human decision on the Daily approvals page.
 *   4. EMAIL the DAY CORRECTION ALERT recipients what changed: the journal entry
 *      title, which repair orders / payments were added or removed, and the
 *      old → new totals. EXCEPTION (Chris's rule): when the change happened on the
 *      SAME shop-local day the repair order was posted in Tekmetric (same-day
 *      churn — an advisor fixing a mistake during the business day), the
 *      correction still posts but NO email goes out; alerts are only for changes
 *      made on a LATER day.
 *
 * Acknowledged days (approved without posting — Accounting Link's days) have no
 * posted rows, so the sweep never touches or emails about them.
 *
 * Failures are isolated per day-category: a QBO fault on one correction is recorded
 * (review item by the poster + Sentry) and the sweep continues.
 */
import * as Sentry from "@sentry/nextjs";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { getShopSettings } from "@/lib/dal/settings";
import { runDailyReconciliation } from "@/lib/dal/daily-reconcile";
import {
  listDailyPostingsForDay,
  approveDailyPosting,
  type DailyPostingRow,
} from "@/lib/dal/daily-postings";
import { postDailyPostingById, type QboDailyWriteClient } from "@/lib/dal/daily-poster";
import { lookupRoMeta } from "@/lib/dal/ro-lookup";
import type { DailyCategory } from "@/lib/daily/daily-je-builder";
import { detectDateMoves, notifyDateMoves, listDateMoves, approveDateMove, unapproveDateMove } from "@/lib/dal/date-moves";
import { sendQteklinkEmail } from "@/lib/dal/notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fmtUsd } from "@/lib/format";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { RO_SALE_SCAN_EVENT_KINDS } from "@/lib/events/kinds";

export interface SweepDayResult {
  businessDate: string;
  correctionsPosted: number;
  correctionsFailed: number;
}

export interface SweepResult {
  postedDays: number;
  movesDetected: number;
  movesAutoResolved: number;
  days: SweepDayResult[];
}

const SWEEP_LOOKBACK_DAYS = 35;

/** Distinct business days with a POSTED daily row (recent window). */
async function listPostedDays(shopId: number, realmId: string): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - SWEEP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("qteklink_daily_postings")
    .select("business_date")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("status", "posted")
    .gte("business_date", since);
  if (error) throw new Error(`listPostedDays failed: ${error.message}`);
  return [...new Set(((data ?? []) as { business_date: string }[]).map((r) => r.business_date))].sort();
}

/** How a posted JE category changed between its prior posted version and the correction. */
export type ChangeKind = "deleted" | "membership" | "amounts" | "descriptions-only" | "no-change";

/** One category's line in the consolidated per-day correction email. */
export interface CategoryOutcome {
  category: DailyCategory;
  changed: boolean;
  changeKind: ChangeKind;
  docNumber: string | null;
  priorTotalCents: number | null;
  nextTotalCents: number | null;
  added: string[];
  removed: string[];
  /** Sales-only: the change was made on the SAME shop-local day the RO posted (an advisor
   *  fixing a mistake during the business day) — suppressable per Chris's rule. */
  sameDayChurn: boolean;
}

const CATEGORY_ORDER: DailyCategory[] = ["sales", "payments", "fees"];
const CATEGORY_LABEL: Record<DailyCategory, string> = { sales: "Sales", payments: "Payments", fees: "Card fees" };
/** The constituent noun per category (sales = repair orders; payments + fees are per-payment). */
const CONSTITUENT_NOUN: Record<DailyCategory, string> = { sales: "repair orders", payments: "payments", fees: "payments" };

/** account|type|amount signature of a JE's lines, IGNORING description — lets us tell a
 *  descriptions-only correction (line TEXT changed, accounts/amounts identical) from a real
 *  amounts/accounts change. */
function lineSignature(lines: DailyPostingRow["lines"]): string {
  return lines.map((l) => `${l.accountId}|${l.postingType}|${l.amountCents}`).join("\n");
}

/**
 * Classify what changed between a posted prior JE and its posted correction:
 *   deleted          — the category emptied (the JE was removed).
 *   membership       — repair orders / payments were added or removed.
 *   descriptions-only— same constituents + same total + identical account/amount lines, only
 *                      the line DESCRIPTIONS differ (e.g. the JE-line-description feature).
 *   amounts          — same constituents, but the amounts/accounts (and total) changed.
 */
export function classifyChange(
  prior: DailyPostingRow,
  next: DailyPostingRow,
): { changeKind: ChangeKind; added: string[]; removed: string[] } {
  if (next.action === "delete") return { changeKind: "deleted", added: [], removed: [] };
  const priorIds = (next.category === "sales" ? prior.constituents.roIds : prior.constituents.paymentIds).map(String);
  const nextIds = (next.category === "sales" ? next.constituents.roIds : next.constituents.paymentIds).map(String);
  const priorSet = new Set(priorIds);
  const nextSet = new Set(nextIds);
  const added = nextIds.filter((id) => !priorSet.has(id));
  const removed = priorIds.filter((id) => !nextSet.has(id));
  if (added.length || removed.length) return { changeKind: "membership", added, removed };
  // Same constituents: descriptions-only (same total + same account/amount lines) vs amounts.
  const descriptionsOnly =
    prior.totalCents === next.totalCents && lineSignature(prior.lines) === lineSignature(next.lines);
  return { changeKind: descriptionsOnly ? "descriptions-only" : "amounts", added: [], removed: [] };
}

/**
 * The shop-local DAY of the newest Tekmetric posting event among the given ROs —
 * i.e. when this day's repair orders last changed in Tekmetric. Used to spot
 * SAME-DAY churn (change-day == business day → no Day Correction Alert). Returns
 * null when nothing is found (the caller fails OPEN and sends the alert).
 */
async function latestRoChangeDay(
  shopId: number,
  realmId: string,
  roIds: number[],
  tz: string,
): Promise<string | null> {
  if (roIds.length === 0) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_events")
    .select("tekmetric_event_at, received_at")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("event_kind", [...RO_SALE_SCAN_EVENT_KINDS])
    .in("tekmetric_ro_id", roIds)
    .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestRoChangeDay failed: ${error.message}`);
  const r = (data ?? [])[0] as { tekmetric_event_at: string | null; received_at: string } | undefined;
  if (!r) return null;
  return toShopLocalDate(r.tekmetric_event_at ?? r.received_at, tz);
}

/**
 * Replace each outcome's added/removed CONSTITUENT IDS with human RO numbers, IN PLACE — a DB
 * id must NEVER appear in an employee email (Chris's rule: RO# / customer / vehicle only, ids
 * are DB-only). Sales constituents are RO ids; payment/fee constituents are payment ids
 * (resolved through their RO). Best-effort: an unresolvable id renders "RO (number unavailable)"
 * rather than leaking the id. Throws only on a DB error.
 */
export async function resolveConstituentLabels(
  shopId: number,
  realmId: string | null,
  outcomes: CategoryOutcome[],
): Promise<void> {
  const saleRoIds = new Set<number>();
  const paymentIds = new Set<string>();
  for (const o of outcomes) {
    for (const id of [...o.added, ...o.removed]) {
      if (o.category === "sales") {
        const n = Number(id);
        if (Number.isSafeInteger(n)) saleRoIds.add(n);
      } else {
        paymentIds.add(id);
      }
    }
  }
  if (!realmId || (saleRoIds.size === 0 && paymentIds.size === 0)) return;

  // payment id → its RO id (the payment-state projection).
  const paymentToRo = new Map<string, number>();
  if (paymentIds.size > 0) {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("qteklink_payment_state")
      .select("payment_id, repair_order_id")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .in("payment_id", [...paymentIds].map(Number).filter((n) => Number.isSafeInteger(n)));
    if (error) throw new Error(`resolveConstituentLabels (payment_state) failed: ${error.message}`);
    for (const r of (data ?? []) as { payment_id: number | string; repair_order_id: number | string | null }[]) {
      const ro = Number(r.repair_order_id);
      if (Number.isSafeInteger(ro)) paymentToRo.set(String(r.payment_id), ro);
    }
  }

  const roIds = [...new Set([...saleRoIds, ...paymentToRo.values()])];
  const roMeta = roIds.length > 0 ? await lookupRoMeta(shopId, realmId, roIds) : new Map<number, { repairOrderNumber: string | null }>();
  const labelForRo = (ro: number | undefined): string => {
    const num = ro != null ? roMeta.get(ro)?.repairOrderNumber : null;
    return num ? `RO ${num}` : "RO (number unavailable)";
  };
  for (const o of outcomes) {
    const toLabel = (id: string): string =>
      o.category === "sales" ? labelForRo(Number(id)) : labelForRo(paymentToRo.get(id));
    o.added = o.added.map(toLabel);
    o.removed = o.removed.map(toLabel);
  }
}

/**
 * The ONE consolidated Day Correction email for a day (Chris's spec): lists EVERY JE
 * category that has a posted entry, HIGHLIGHTS what changed (and how), and shows the
 * unchanged ones as context — so the office manager gets a single email per day, not one
 * per journal entry. The caller only sends it when at least one category changed.
 *
 * NOTE: the added/removed values must already be human RO labels (resolveConstituentLabels) —
 * this function never renders a raw DB id.
 */
export function describeDayCorrections(
  businessDate: string,
  outcomes: CategoryOutcome[],
): { subject: string; text: string } {
  const lines: string[] = [
    `Some journal entries for a day already posted to QuickBooks have changed, and QTekLink updated them to match Tekmetric.`,
    ``,
    `  Day: ${businessDate}`,
    ``,
  ];
  for (const o of outcomes) {
    const label = CATEGORY_LABEL[o.category];
    const noun = CONSTITUENT_NOUN[o.category];
    const doc = o.docNumber ? `  (${o.docNumber})` : "";
    if (o.changed) {
      lines.push(`  >> ${label} — CHANGED${doc}`);
      if (o.changeKind === "deleted") {
        lines.push(`     The journal entry was DELETED (nothing left to post for this day).`);
      } else if (o.changeKind === "membership") {
        lines.push(`     New total: ${fmtUsd(o.nextTotalCents ?? 0)} (was ${fmtUsd(o.priorTotalCents ?? 0)})`);
        if (o.added.length) lines.push(`     Added: ${o.added.join(", ")}`);
        if (o.removed.length) lines.push(`     Removed: ${o.removed.join(", ")}`);
      } else if (o.changeKind === "descriptions-only") {
        lines.push(`     Wording only: the line descriptions were updated. The ${noun} and the total (${fmtUsd(o.nextTotalCents ?? 0)}) are unchanged.`);
      } else {
        lines.push(`     New total: ${fmtUsd(o.nextTotalCents ?? 0)} (was ${fmtUsd(o.priorTotalCents ?? 0)}) — the same ${noun}, with updated amounts.`);
      }
    } else {
      lines.push(`     ${label} — no change${doc}`);
      if (o.nextTotalCents != null) lines.push(`     Total: ${fmtUsd(o.nextTotalCents)}`);
    }
    lines.push(``);
  }
  lines.push(
    `Please double-check these entries in QuickBooks. If something looks wrong, open the`,
    `day on the QTekLink Daily approvals page to see the full breakdown.`,
  );
  return {
    subject: `QTekLink Day Correction Alert: ${businessDate} journal entries updated in QuickBooks`,
    text: lines.join("\n"),
  };
}

/**
 * Apply staged corrections for ONE day: every PENDING version whose category has a
 * posted prior gets approved (system) + posted, and the Day Correction Alert list
 * is emailed the diff — UNLESS the change is same-day churn (the day's repair
 * orders last changed in Tekmetric ON the business day itself: an advisor fixing a
 * mistake during the day; Chris's rule — post quietly, alert only for changes made
 * on a later day). First-time (never-posted) categories are left for human
 * approval.
 */
export async function applyDayCorrections(
  shopId: number,
  businessDate: string,
  deps: { client?: QboDailyWriteClient } = {},
): Promise<SweepDayResult> {
  const { postings } = await listDailyPostingsForDay(shopId, businessDate);
  const { realmId, settings } = await getShopSettings(shopId);
  const correctionTo = settings.dayCorrectionAlertEmails;

  let posted = 0;
  let failed = 0;
  // Collect a per-category outcome (changed or not) so the day sends ONE consolidated email
  // listing all three JE entries (Chris's spec), instead of one email per category.
  const outcomes: CategoryOutcome[] = [];
  let postedCorrections = 0;
  let churnSuppressable = 0;

  for (const category of CATEGORY_ORDER) {
    const mine = postings.filter((p) => p.category === category);
    const prior = mine.filter((p) => p.status === "posted").sort((a, b) => b.postingVersion - a.postingVersion)[0];
    if (!prior) continue; // never posted (first-time human gate) — no QBO JE to report on

    const pending = mine.filter((p) => p.status === "pending").sort((a, b) => b.postingVersion - a.postingVersion)[0];

    // A category with a posted prior but no applied correction is unchanged CONTEXT in the email.
    const pushNoChange = () =>
      outcomes.push({
        category, changed: false, changeKind: "no-change", docNumber: prior.docNumber,
        priorTotalCents: prior.totalCents, nextTotalCents: prior.totalCents, added: [], removed: [], sameDayChurn: false,
      });

    if (!pending) { pushNoChange(); continue; } // no staged correction → unchanged

    try {
      await approveDailyPosting(shopId, pending.id, "system (auto-correction)");
      const outcome = await postDailyPostingById(shopId, pending.id, deps);
      if (outcome.status === "posted") {
        posted++;
        postedCorrections++;
        // Same-day churn check (sales only — the rule is about repair orders). A
        // lookup failure fails OPEN: better a spurious alert than a silent one.
        let sameDayChurn = false;
        if (category === "sales" && realmId) {
          try {
            const roIds = [...new Set([...prior.constituents.roIds, ...pending.constituents.roIds])].map(Number);
            sameDayChurn = (await latestRoChangeDay(shopId, realmId, roIds, settings.shopTimezone)) === businessDate;
          } catch (e) {
            Sentry.captureException(e, {
              tags: { qteklink_cron: "posted-day-sweep", shop_id: String(shopId) },
              extra: { businessDate, category, step: "same-day-churn-check (failing open: alert sent)" },
            });
          }
        }
        if (sameDayChurn) churnSuppressable++;
        const { changeKind, added, removed } = classifyChange(prior, pending);
        outcomes.push({
          category, changed: true, changeKind, docNumber: pending.docNumber ?? prior.docNumber,
          priorTotalCents: prior.totalCents, nextTotalCents: pending.totalCents, added, removed, sameDayChurn,
        });
      } else if (outcome.status === "stale_refreshed") {
        // the day moved again mid-flight — the next sweep pass picks it up; unchanged this run.
        pushNoChange();
      } else {
        failed++;
        pushNoChange(); // the live QBO JE is still the prior — show it as unchanged context
      }
    } catch (e) {
      failed++;
      pushNoChange();
      Sentry.captureException(e, {
        tags: { qteklink_cron: "posted-day-sweep", shop_id: String(shopId) },
        extra: { businessDate, category, postingId: pending.id },
      });
    }
  }

  // ONE email per day. Suppress the WHOLE day only when EVERY posted correction was same-day
  // churn (an advisor fixing a mistake during the business day — post quietly); a single
  // later-day change OR any non-sales correction forces the alert, and the email lists ALL
  // categories so nothing is hidden when we do send.
  const anyChanged = outcomes.some((o) => o.changed);
  const suppressWholeDay = postedCorrections > 0 && churnSuppressable === postedCorrections;
  if (anyChanged && !suppressWholeDay) {
    await resolveConstituentLabels(shopId, realmId, outcomes); // ids → RO# (never a DB id in email)
    const { subject, text } = describeDayCorrections(businessDate, outcomes);
    await sendQteklinkEmail({ to: correctionTo, subject, text });
  } else if (anyChanged && suppressWholeDay) {
    console.log(JSON.stringify({
      level: "info", surface: "posted-day-sweep", shop_id: shopId,
      msg: "day correction posted; Day Correction Alert suppressed (same-day churn)",
      business_date: businessDate,
    }));
  }
  return { businessDate, correctionsPosted: posted, correctionsFailed: failed };
}

/**
 * Apply an office-manager decision on a date-move queue item: find the move via
 * `listDateMoves`, flip it (approve a PENDING move / unapprove an APPROVED one), then
 * for BOTH the original and new day re-reconcile + auto-post the staged corrections so
 * the RO moves between the two days' journal entries (or flips back on unapprove).
 *
 *   approve   — requires the move to be `pending`; the holds lift.
 *   unapprove — requires the move to be `approved`; the holds re-engage.
 *
 * Returns `not_found` when the move isn't in the required state (or the RPC reports it
 * didn't flip — a concurrent change). The approval/unapproval IS the consent: this
 * touches QuickBooks.
 *
 * Home note: this lives HERE (posted-day-sweep) rather than in date-moves to stay
 * cycle-safe — the sweep already imports date-moves and owns `applyDayCorrections`; the
 * reverse import (date-moves → posted-day-sweep) would create an import cycle.
 */
export async function applyDateMoveDecision(
  shopId: number,
  id: string,
  decision: "approve" | "unapprove",
  actor: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const requiredStatus = decision === "approve" ? "pending" : "approved";

  // Find the move (for its two dates) BEFORE flipping it.
  const { open } = await listDateMoves(shopId);
  const move = open.find((m) => m.id === id && m.status === requiredStatus);
  if (!move) return { ok: false, reason: "not_found" };

  const flipped =
    decision === "approve"
      ? (await approveDateMove(shopId, id, actor)).approved
      : (await unapproveDateMove(shopId, id, actor)).unapproved;
  if (!flipped) return { ok: false, reason: "not_found" };

  // The decision IS the consent: re-reconcile + auto-post corrections for BOTH days
  // (original then new) so the RO moves between the two days' journal entries.
  for (const day of [move.originalBusinessDate, move.newBusinessDate]) {
    await runDailyReconciliation(shopId, day);
    await applyDayCorrections(shopId, day);
  }
  return { ok: true };
}

/**
 * The nightly sweep: detect date moves (+ notify), then re-reconcile every posted day
 * and auto-post the staged corrections (+ notify the office manager per change).
 */
export async function sweepPostedDays(
  shopId: number,
  deps: { client?: QboDailyWriteClient } = {},
): Promise<SweepResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { postedDays: 0, movesDetected: 0, movesAutoResolved: 0, days: [] };
  const { settings } = await getShopSettings(shopId);

  // 1. Date moves first — they install the holds the re-reconcile must respect.
  const detect = await detectDateMoves(shopId, realmId, settings.shopTimezone);
  await notifyDateMoves(shopId, detect.newOrChangedMoves);

  // 2-4. Re-reconcile + auto-post corrections per posted day.
  const days: SweepDayResult[] = [];
  for (const businessDate of await listPostedDays(shopId, realmId)) {
    try {
      await runDailyReconciliation(shopId, businessDate);
      days.push(await applyDayCorrections(shopId, businessDate, deps));
    } catch (e) {
      days.push({ businessDate, correctionsPosted: 0, correctionsFailed: 1 });
      Sentry.captureException(e, {
        tags: { qteklink_cron: "posted-day-sweep", shop_id: String(shopId) },
        extra: { businessDate },
      });
    }
  }
  return {
    postedDays: days.length,
    movesDetected: detect.newOrChangedMoves.length,
    movesAutoResolved: detect.autoResolved,
    days,
  };
}
