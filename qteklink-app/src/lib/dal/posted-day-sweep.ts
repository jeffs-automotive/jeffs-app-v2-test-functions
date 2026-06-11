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
import { detectDateMoves, notifyDateMoves } from "@/lib/dal/date-moves";
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

function describeIds(label: string, ids: (string | number)[]): string | null {
  if (ids.length === 0) return null;
  return `  ${label}: ${ids.join(", ")}`;
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

/** Plain-language "what changed" for one applied correction (prior posted vs new). */
export function describeCorrection(prior: DailyPostingRow, next: DailyPostingRow): { subject: string; text: string } {
  const kindLabel = next.category === "sales" ? "repair orders" : "payments";
  const priorIds = next.category === "sales" ? prior.constituents.roIds : prior.constituents.paymentIds;
  const nextIds = next.category === "sales" ? next.constituents.roIds : next.constituents.paymentIds;
  const priorSet = new Set(priorIds.map(String));
  const nextSet = new Set(nextIds.map(String));
  const added = nextIds.map(String).filter((id) => !priorSet.has(id));
  const removed = priorIds.map(String).filter((id) => !nextSet.has(id));

  const lines = [
    `A day that was already posted to QuickBooks has changed, and QTekLink updated the journal entry to match Tekmetric.`,
    ``,
    `  Journal entry: ${next.docNumber ?? prior.docNumber ?? `${next.businessDate} (${next.category})`}`,
    `  Day:           ${next.businessDate}`,
    next.action === "delete"
      ? `  Change:        the journal entry was DELETED (nothing left to post for this day)`
      : `  New total:     ${fmtUsd(next.totalCents ?? 0)} (was ${fmtUsd(prior.totalCents ?? 0)})`,
  ];
  const addedLine = describeIds(`Added ${kindLabel}`, added);
  const removedLine = describeIds(`Removed ${kindLabel}`, removed);
  if (addedLine) lines.push(addedLine);
  if (removedLine) lines.push(removedLine);
  if (!addedLine && !removedLine && next.action !== "delete") {
    lines.push(`  Changed:       amounts only (the same ${kindLabel}, different totals)`);
  }
  lines.push(
    ``,
    `Please double-check the entry in QuickBooks. If something looks wrong, open the`,
    `day on the QTekLink Daily approvals page to see the full breakdown.`,
  );
  return {
    subject: `QTekLink Day Correction Alert: ${next.docNumber ?? next.businessDate} was updated in QuickBooks`,
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
  for (const category of ["sales", "payments", "fees"] as const) {
    const mine = postings.filter((p) => p.category === category);
    const pending = mine.filter((p) => p.status === "pending").sort((a, b) => b.postingVersion - a.postingVersion)[0];
    const prior = mine.filter((p) => p.status === "posted").sort((a, b) => b.postingVersion - a.postingVersion)[0];
    if (!pending || !prior) continue; // no staged correction, or never posted (human gate)

    try {
      await approveDailyPosting(shopId, pending.id, "system (auto-correction)");
      const outcome = await postDailyPostingById(shopId, pending.id, deps);
      if (outcome.status === "posted") {
        posted++;
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
        if (sameDayChurn) {
          console.log(JSON.stringify({
            level: "info", surface: "posted-day-sweep", shop_id: shopId,
            msg: "correction posted; Day Correction Alert suppressed (same-day churn)",
            business_date: businessDate, category, posting_id: pending.id,
          }));
        } else {
          const { subject, text } = describeCorrection(prior, pending);
          await sendQteklinkEmail({ to: correctionTo, subject, text });
        }
      } else if (outcome.status === "stale_refreshed") {
        // the day moved again mid-flight — the next sweep pass picks it up.
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      Sentry.captureException(e, {
        tags: { qteklink_cron: "posted-day-sweep", shop_id: String(shopId) },
        extra: { businessDate, category, postingId: pending.id },
      });
    }
  }
  return { businessDate, correctionsPosted: posted, correctionsFailed: failed };
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
