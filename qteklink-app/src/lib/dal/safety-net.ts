/**
 * The Tekmetric + QBO 2-API completeness safety-net (C8, plan §10) — run by the nightly
 * sync AFTER reconcile. Webhooks carry ~97.8%; this is the ~1–2% net for the rest:
 *
 *   TEKMETRIC completeness — pull the day's POSTED repair orders from the Tekmetric API
 *     (the authoritative list) and flag any that produced NO webhook event in qteklink_events
 *     → 'missed_ro_webhook' review item. Catches an ingestion outage (the 2026-05-26 ~2h gap
 *     lost 8 postings).
 *   QBO landing — query QBO for the day's JournalEntries and flag any posting we marked
 *     'posted' whose qbo_je_id is NOT present → 'posted_je_missing' review item. Catches a JE
 *     deleted in QBO after we posted it.
 *
 * Read-mostly (the only write is upsertReviewItem). Fail-closed: errors throw (a per-shop
 * failure is isolated by the cron). MULTI-TENANT: scoped by shop_id + realm_id throughout.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { utcWindowForLocalDay } from "@/lib/dal/day-drafts";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { upsertReviewItem } from "@/lib/dal/review-items";
import { isIsoDate } from "@/lib/format";
import { RO_POSTING_EVENT_KINDS } from "@/lib/events/kinds";
import { QboClient } from "@/lib/qbo/client";
import { listPostedRepairOrders, TEKMETRIC_POSTED_STATUS_IDS, type TekmetricRepairOrder } from "@/lib/tekmetric/client";

export interface SafetyNetResult {
  tekmetricChecked: number;
  tekmetricGaps: number;
  qboChecked: number;
  qboGaps: number;
}

interface SafetyNetDeps {
  /** Inject the Tekmetric RO list (tests). */
  listPostedRos?: (shopId: number, startIso: string, endIso: string) => Promise<TekmetricRepairOrder[]>;
  /** Inject the QBO query (tests); default queries the shop's bound realm. */
  qboQuery?: (qbl: string) => Promise<unknown>;
}

/** TEKMETRIC completeness: posted ROs with no captured webhook → review items. */
export async function runTekmetricCompletenessCheck(
  shopId: number,
  realmId: string,
  businessDate: string,
  tz: string,
  deps: SafetyNetDeps = {},
): Promise<{ checked: number; gaps: number }> {
  if (!isIsoDate(businessDate)) throw new Error("runTekmetricCompletenessCheck: businessDate must be ISO YYYY-MM-DD");
  const { startIso, endIso } = utcWindowForLocalDay(businessDate);
  const listRos = deps.listPostedRos ?? ((s, a, b) => listPostedRepairOrders(s, a, b));
  const ros = await listRos(shopId, startIso, endIso);

  // Tekmetric ROs that are POSTED (status 5/6) AND whose posted date is exactly this local day.
  const posted = ros.filter(
    (ro) =>
      ro.repairOrderStatusId != null &&
      (TEKMETRIC_POSTED_STATUS_IDS as readonly number[]).includes(ro.repairOrderStatusId) &&
      ro.postedDate != null &&
      toShopLocalDate(ro.postedDate, tz) === businessDate,
  );

  // Our captured posting events (ro_posted / ro_sent_to_ar) in the generous window — match
  // by RO id so a webhook received slightly off the local day still counts as "captured".
  const admin = createSupabaseAdminClient();
  const { data: evRows, error } = await admin
    .from("qteklink_events")
    .select("tekmetric_ro_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("event_kind", [...RO_POSTING_EVENT_KINDS])
    .gte("tekmetric_event_at", startIso)
    .lt("tekmetric_event_at", endIso);
  if (error) throw new Error(`runTekmetricCompletenessCheck (events) failed: ${error.message}`);
  const captured = new Set(((evRows ?? []) as { tekmetric_ro_id: number | string | null }[]).map((r) => Number(r.tekmetric_ro_id)));

  let gaps = 0;
  for (const ro of posted) {
    if (!captured.has(ro.id)) {
      await upsertReviewItem(shopId, {
        kind: "missed_ro_webhook",
        subjectKind: "ro",
        subjectRef: String(ro.id),
        detail: { reason: "posted in Tekmetric but no ro_posted/ro_sent_to_ar webhook was captured", postedDate: ro.postedDate, businessDate },
      });
      gaps++;
    }
  }
  return { checked: posted.length, gaps };
}

interface QboJeRow { Id?: string }

/** QBO landing: postings we marked 'posted' whose JE is NOT in QBO for the day → review items. */
export async function runQboLandingCheck(
  shopId: number,
  realmId: string,
  businessDate: string,
  deps: SafetyNetDeps = {},
): Promise<{ checked: number; gaps: number }> {
  // businessDate is interpolated into the QBL below — it's always a server-computed ISO date,
  // but validate at the boundary so no non-ISO value can ever reach the query string.
  if (!isIsoDate(businessDate)) throw new Error("runQboLandingCheck: businessDate must be ISO YYYY-MM-DD");
  const admin = createSupabaseAdminClient();
  const { data: posts, error } = await admin
    .from("qteklink_postings")
    .select("qbo_je_id, tekmetric_ro_id, kind, payment_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("batch_date", businessDate)
    .eq("status", "posted")
    .not("qbo_je_id", "is", null);
  if (error) throw new Error(`runQboLandingCheck (postings) failed: ${error.message}`);
  const posted = (posts ?? []) as { qbo_je_id: string; tekmetric_ro_id: number | string; kind: string; payment_id: number | string | null }[];
  if (posted.length === 0) return { checked: 0, gaps: 0 };

  // The JE ids QBO actually has for the day's TxnDate.
  const query = deps.qboQuery ?? ((qbl: string) => new QboClient({ realmId }).query(qbl));
  const resp = (await query(`select Id from JournalEntry where TxnDate = '${businessDate}' MAXRESULTS 1000`)) as {
    QueryResponse?: { JournalEntry?: QboJeRow[] };
  };
  const jes = resp?.QueryResponse?.JournalEntry ?? [];
  // If we hit the result cap, JE membership is unreliable (a real JE could be on a later
  // page) — skip flagging rather than emit FALSE 'missing' items. (>1000 JEs/day is unreal
  // for one shop; the guard just makes the check provably false-positive-free.)
  if (jes.length >= 1000) return { checked: posted.length, gaps: 0 };
  const inQbo = new Set(jes.map((j) => String(j.Id)));

  let gaps = 0;
  for (const p of posted) {
    if (!inQbo.has(String(p.qbo_je_id))) {
      await upsertReviewItem(shopId, {
        kind: "posted_je_missing",
        subjectKind: p.kind === "payment" ? "payment" : "ro",
        subjectRef: p.kind === "payment" ? String(p.payment_id) : String(p.tekmetric_ro_id),
        detail: { reason: "marked posted but the JE is not in QuickBooks for this day (deleted?)", qboJeId: p.qbo_je_id, businessDate },
      });
      gaps++;
    }
  }
  return { checked: posted.length, gaps };
}

/** Both halves of the 2-API safety-net. */
export async function runSafetyNet(
  shopId: number,
  realmId: string,
  businessDate: string,
  tz: string,
  deps: SafetyNetDeps = {},
): Promise<SafetyNetResult> {
  const tk = await runTekmetricCompletenessCheck(shopId, realmId, businessDate, tz, deps);
  const qbo = await runQboLandingCheck(shopId, realmId, businessDate, deps);
  return { tekmetricChecked: tk.checked, tekmetricGaps: tk.gaps, qboChecked: qbo.checked, qboGaps: qbo.gaps };
}
