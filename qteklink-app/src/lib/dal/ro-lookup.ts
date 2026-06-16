/**
 * RO-metadata lookup — the human `repairOrderNumber` + `customerId` per Tekmetric RO id,
 * for ROs whose sale isn't in the current day's snapshots (paid on a different day). Two
 * sources, newest-first; a later row only fills a field an earlier row left null:
 *   1. qteklink_events posting events (webhooks live since 2026-06-11), then
 *   2. the keytag webhook firehose (any RO event body — capturing since 2026-05-09).
 * The keytag firehose predates the shop_id column, so the body-level `shopId` is REQUIRED
 * to match (every Tekmetric RO payload carries it). Throws on DB error (fail closed).
 *
 * Shared by getDayBreakdown (RO numbers for the payments tab) and the daily JE build
 * (day-drafts enrichment: RO number + customer for the line descriptions).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { RO_SALE_SCAN_EVENT_KINDS } from "@/lib/events/kinds";

export interface RoMeta {
  repairOrderNumber: string | null;
  customerId: number | null;
}

interface RoEventRow {
  tekmetric_ro_id: number | string;
  raw_body: { data?: { repairOrderNumber?: unknown; customerId?: unknown; shopId?: unknown } } | null;
}

function toSafePositiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Harvest repairOrderNumber + customerId from event rows (newest-first; first non-null per
 *  FIELD wins, so a later row can still fill a field an earlier one left null). A row whose
 *  body shopId doesn't match is skipped entirely — never harvest across shops. */
function harvest(rows: RoEventRow[], shopId: number, out: Map<number, RoMeta>): void {
  for (const r of rows) {
    const ro = Number(r.tekmetric_ro_id);
    if (!Number.isSafeInteger(ro)) continue;
    if (Number(r.raw_body?.data?.shopId) !== shopId) continue;
    const cur = out.get(ro) ?? { repairOrderNumber: null, customerId: null };
    if (cur.repairOrderNumber == null) {
      const n = r.raw_body?.data?.repairOrderNumber;
      if (typeof n === "string" || typeof n === "number") cur.repairOrderNumber = String(n);
    }
    if (cur.customerId == null) {
      const c = toSafePositiveInt(r.raw_body?.data?.customerId);
      if (c != null) cur.customerId = c;
    }
    out.set(ro, cur);
  }
}

export async function lookupRoMeta(
  shopId: number,
  realmId: string,
  roIds: number[],
): Promise<Map<number, RoMeta>> {
  const out = new Map<number, RoMeta>();
  const unique = [...new Set(roIds.filter((n) => Number.isSafeInteger(n)))];
  if (unique.length === 0) return out;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_events")
    .select("tekmetric_ro_id, raw_body")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("event_kind", [...RO_SALE_SCAN_EVENT_KINDS])
    .in("tekmetric_ro_id", unique)
    .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false });
  if (error) throw new Error(`lookupRoMeta (qteklink_events) failed: ${error.message}`);
  harvest((data ?? []) as RoEventRow[], shopId, out);

  // ROs still missing EITHER field → the keytag firehose (older ROs / pre-qteklink events).
  const incomplete = unique.filter((ro) => {
    const m = out.get(ro);
    return !m || m.repairOrderNumber == null || m.customerId == null;
  });
  if (incomplete.length > 0) {
    const { data: kd, error: ke } = await admin
      .from("keytag_webhook_events")
      .select("tekmetric_ro_id, raw_body")
      .in("tekmetric_ro_id", incomplete)
      .order("received_at", { ascending: false })
      .limit(500);
    if (ke) throw new Error(`lookupRoMeta (keytag fallback) failed: ${ke.message}`);
    harvest((kd ?? []) as RoEventRow[], shopId, out);
  }
  return out;
}
