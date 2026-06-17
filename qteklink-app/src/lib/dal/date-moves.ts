/**
 * RO date-move queue DAL (Chris's posting-queue spec) — tracks repair orders that
 * were UNPOSTED in Tekmetric and RE-POSTED TO A DIFFERENT business day while their
 * original day's daily JE is already posted in QuickBooks.
 *
 * Lifecycle (qteklink_ro_date_moves):
 *   pending  — detected; BOTH days are HELD (the original day keeps the RO pinned to
 *              its original-day snapshot, the new day excludes it) until a human
 *              decides. The DATE CHANGE ALERT recipients are emailed.
 *   approved — the office manager accepted the new date: the holds lift and the
 *              correction sweep moves the RO between the two days' JEs.
 *   resolved — the RO was re-posted BACK to its original day in Tekmetric (the
 *              normal fix): no date change ever hits the books.
 *   approved → pending via UNAPPROVE (accidental approval) — the holds re-engage and
 *              the sweep flips the JEs back.
 *
 * DETECTION (`detectDateMoves`) runs in the nightly sweep + on demand (every
 * Posting-queue page load and its "Check again" button — `refreshDateMoves`): for
 * every RO inside a POSTED daily sales JE, look at the RO's newest posting event —
 * if its business day differs from the JE's day, upsert a move (pending) and
 * notify; if it matches again, auto-RESOLVE any open move.
 *
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection; every
 * query scopes shop_id + realm_id. No silent failures: DB errors throw.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";
import { RO_SALE_SCAN_EVENT_KINDS, RO_UNPOST_EVENT_KIND } from "@/lib/events/kinds";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { sendQteklinkEmail } from "@/lib/dal/notify";
import { getShopSettings } from "@/lib/dal/settings";

export type DateMoveStatus = "pending" | "approved" | "resolved";

export interface DateMoveRow {
  id: string;
  tekmetricRoId: number;
  roNumber: string | null;
  originalBusinessDate: string;
  newBusinessDate: string;
  originalTotalCents: number | null;
  newTotalCents: number | null;
  status: DateMoveStatus;
  detectedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  resolvedAt: string | null;
}

interface DateMoveDbRow {
  id: string;
  tekmetric_ro_id: number | string;
  ro_number: string | null;
  original_business_date: string;
  new_business_date: string;
  original_total_cents: number | string | null;
  new_total_cents: number | string | null;
  status: string;
  detected_at: string;
  approved_by: string | null;
  approved_at: string | null;
  resolved_at: string | null;
}

const MOVE_SELECT =
  "id, tekmetric_ro_id, ro_number, original_business_date, new_business_date, original_total_cents, new_total_cents, status, detected_at, approved_by, approved_at, resolved_at";

function intOrNull(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function mapMove(r: DateMoveDbRow): DateMoveRow {
  return {
    id: r.id,
    tekmetricRoId: Number(r.tekmetric_ro_id),
    roNumber: r.ro_number,
    originalBusinessDate: r.original_business_date,
    newBusinessDate: r.new_business_date,
    originalTotalCents: intOrNull(r.original_total_cents),
    newTotalCents: intOrNull(r.new_total_cents),
    status: r.status as DateMoveStatus,
    detectedAt: r.detected_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    resolvedAt: r.resolved_at,
  };
}

/** The queue page's list: open moves first, then recently-resolved (audit trail). */
export async function listDateMoves(
  shopId: number,
): Promise<{ realmId: string | null; open: DateMoveRow[]; recentlyResolved: DateMoveRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, open: [], recentlyResolved: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_ro_date_moves")
    .select(MOVE_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listDateMoves failed: ${error.message}`);

  const rows = ((data ?? []) as DateMoveDbRow[]).map(mapMove);
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return {
    realmId,
    open: rows.filter((m) => m.status === "pending" || m.status === "approved"),
    recentlyResolved: rows.filter((m) => m.status === "resolved" && Date.parse(m.resolvedAt ?? m.detectedAt) >= cutoff),
  };
}

/** PENDING moves only — the holds the day-draft builder applies (pin + exclude). */
export async function listPendingDateMoves(
  shopId: number,
  realmId: string,
): Promise<DateMoveRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_ro_date_moves")
    .select(MOVE_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("status", "pending");
  if (error) throw new Error(`listPendingDateMoves failed: ${error.message}`);
  return ((data ?? []) as DateMoveDbRow[]).map(mapMove);
}

// ─── Detection ────────────────────────────────────────────────────────────────

interface PostedSalesDay {
  businessDate: string;
  roIds: number[];
}

/** Detection window — matches the correction sweep's lookback: a move on a day older
 *  than this is out of correction range anyway, and the floor keeps the query bounded
 *  (PostgREST silently caps responses at max_rows=1000 — an unbounded read would
 *  silently MISS moves once history outgrows it; audit 2026-06-12). */
const DETECT_LOOKBACK_DAYS = 35;
/** Chunk size for `.in(tekmetric_ro_id, …)` scans (bounded URL length + row counts). */
const RO_SCAN_CHUNK = 200;

/** The LIVE posted sales JE per business day (latest posted version, not a delete). */
async function listPostedSalesDays(shopId: number, realmId: string): Promise<PostedSalesDay[]> {
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - DETECT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("qteklink_daily_postings")
    .select("business_date, posting_version, action, constituents")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("category", "sales")
    .eq("status", "posted")
    .gte("business_date", since)
    .order("posting_version", { ascending: true });
  if (error) throw new Error(`listPostedSalesDays failed: ${error.message}`);

  const latestByDay = new Map<string, { version: number; action: string; roIds: number[] }>();
  for (const r of (data ?? []) as { business_date: string; posting_version: number; action: string; constituents: { ro_ids?: number[] } | null }[]) {
    const cur = latestByDay.get(r.business_date);
    if (!cur || r.posting_version > cur.version) {
      latestByDay.set(r.business_date, {
        version: r.posting_version,
        action: r.action,
        roIds: (r.constituents?.ro_ids ?? []).map(Number).filter(Number.isSafeInteger),
      });
    }
  }
  return [...latestByDay.entries()]
    .filter(([, v]) => v.action !== "delete")
    .map(([businessDate, v]) => ({ businessDate, roIds: v.roIds }));
}

export interface DetectResult {
  scannedRos: number;
  newOrChangedMoves: DateMoveRow[];
  autoResolved: number;
}

/**
 * Scan every RO inside a POSTED sales JE against its newest posting event:
 *   newest event on a DIFFERENT day → upsert a pending move (returned when new/changed
 *   so the caller can notify); newest event back ON the original day → auto-resolve
 *   any open move. An UNPOSTED-and-not-reposted RO is NOT a move (the correction
 *   sweep handles its removal).
 */
export async function detectDateMoves(shopId: number, realmId: string, tz: string): Promise<DetectResult> {
  const days = await listPostedSalesDays(shopId, realmId);
  const roToDay = new Map<number, string>();
  for (const d of days) for (const ro of d.roIds) roToDay.set(ro, d.businessDate);
  if (roToDay.size === 0) return { scannedRos: 0, newOrChangedMoves: [], autoResolved: 0 };

  // Newest sale-scan event per RO (chunked batched queries; newest-first wins).
  const admin = createSupabaseAdminClient();
  interface LatestEv { kind: string; postedDate: string | null; roNumber: string | null; totalCents: number | null }
  const latestByRo = new Map<number, LatestEv>();
  const allRoIds = [...roToDay.keys()];
  for (let i = 0; i < allRoIds.length; i += RO_SCAN_CHUNK) {
    const chunk = allRoIds.slice(i, i + RO_SCAN_CHUNK);
    const { data: evRows, error: evErr } = await admin
      .from("qteklink_events")
      .select("tekmetric_ro_id, event_kind, raw_body, received_at")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .in("event_kind", [...RO_SALE_SCAN_EVENT_KINDS])
      .in("tekmetric_ro_id", chunk)
      .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
      .order("received_at", { ascending: false });
    if (evErr) throw new Error(`detectDateMoves (events) failed: ${evErr.message}`);
    for (const r of (evRows ?? []) as { tekmetric_ro_id: number | string; event_kind: string; raw_body: { data?: Record<string, unknown> } | null }[]) {
      const ro = Number(r.tekmetric_ro_id);
      if (latestByRo.has(ro)) continue;
      const d = r.raw_body?.data ?? {};
      const total = typeof d.totalSales === "number" && Number.isSafeInteger(d.totalSales) ? d.totalSales : null;
      latestByRo.set(ro, {
        kind: r.event_kind,
        postedDate: typeof d.postedDate === "string" ? d.postedDate : null,
        roNumber: typeof d.repairOrderNumber === "string" || typeof d.repairOrderNumber === "number" ? String(d.repairOrderNumber) : null,
        totalCents: total,
      });
    }
  }

  // Open moves for auto-resolution lookups.
  const { data: openRows, error: openErr } = await admin
    .from("qteklink_ro_date_moves")
    .select(MOVE_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("status", ["pending", "approved"]);
  if (openErr) throw new Error(`detectDateMoves (open moves) failed: ${openErr.message}`);
  const openByKey = new Map(((openRows ?? []) as DateMoveDbRow[]).map((m) => [`${m.tekmetric_ro_id}:${m.original_business_date}`, mapMove(m)]));

  const newOrChangedMoves: DateMoveRow[] = [];
  let autoResolved = 0;

  for (const [ro, originalDay] of roToDay.entries()) {
    const ev = latestByRo.get(ro);
    if (!ev || ev.kind === RO_UNPOST_EVENT_KIND || !ev.postedDate) continue; // unposted/no-event → the sweep's removal path
    const newDay = toShopLocalDate(ev.postedDate, tz);
    const open = openByKey.get(`${ro}:${originalDay}`);

    if (newDay === originalDay) {
      // Back on its day — auto-resolve an open move (the office manager's "Refresh" path).
      if (open) {
        const { error } = await admin.rpc("qteklink_resolve_date_move", { p_shop_id: shopId, p_realm_id: realmId, p_id: open.id });
        if (error) throw new Error(`qteklink_resolve_date_move failed: ${error.message}`);
        autoResolved++;
      }
      continue;
    }

    // Moved day → upsert (the RPC reports whether anything actually changed).
    const { data, error } = await admin.rpc("qteklink_upsert_date_move", {
      p_shop_id: shopId,
      p_realm_id: realmId,
      p_tekmetric_ro_id: ro,
      p_ro_number: ev.roNumber,
      p_original_business_date: originalDay,
      p_new_business_date: newDay,
      p_original_total_cents: null,
      p_new_total_cents: ev.totalCents,
    });
    if (error) throw new Error(`qteklink_upsert_date_move failed: ${error.message}`);
    const result = (Array.isArray(data) ? data[0] : data) as { id: string; changed: boolean } | undefined;
    if (result?.changed) {
      newOrChangedMoves.push({
        id: result.id,
        tekmetricRoId: ro,
        roNumber: ev.roNumber,
        originalBusinessDate: originalDay,
        newBusinessDate: newDay,
        originalTotalCents: null,
        newTotalCents: ev.totalCents,
        status: "pending",
        detectedAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
        resolvedAt: null,
      });
    }
  }

  return { scannedRos: roToDay.size, newOrChangedMoves, autoResolved };
}

/** Send the DATE CHANGE ALERT (recipients from /settings) for new/changed moves — ONE
 *  consolidated email per run listing EVERY moved RO, not one email per RO (Chris's spec). */
export async function notifyDateMoves(shopId: number, moves: DateMoveRow[]): Promise<void> {
  if (moves.length === 0) return;
  const { settings } = await getShopSettings(shopId);
  const to = settings.dateChangeAlertEmails;

  const header = moves.length === 1
    ? `A repair order was unposted in Tekmetric and posted again on a DIFFERENT day. The original day's journal entry is already in QuickBooks.`
    : `${moves.length} repair orders were unposted in Tekmetric and posted again on DIFFERENT days. The original days' journal entries are already in QuickBooks.`;

  const lines = [header, ``];
  for (const m of moves) {
    const ro = m.roNumber ?? String(m.tekmetricRoId);
    lines.push(
      `  - RO ${ro}`,
      `      Originally posted on: ${m.originalBusinessDate}`,
      `      Now posted on:        ${m.newBusinessDate}`,
    );
    if (m.newTotalCents != null) lines.push(`      Current total:        $${(m.newTotalCents / 100).toFixed(2)}`);
    lines.push(``);
  }
  lines.push(
    `Nothing has changed in QuickBooks yet. Open the QTekLink Posting queue to decide for each:`,
    `  - APPROVE the date change (QTekLink moves the repair order between the two days'`,
    `    journal entries), or`,
    `  - have a service advisor re-post the repair order on the ORIGINAL day in Tekmetric`,
    `    — the queue clears the item on its own the next time it checks.`,
  );

  const subject = moves.length === 1
    ? `QTekLink Date Change Alert: RO ${moves[0]!.roNumber ?? String(moves[0]!.tekmetricRoId)} moved from ${moves[0]!.originalBusinessDate} to ${moves[0]!.newBusinessDate}`
    : `QTekLink Date Change Alert: ${moves.length} repair orders changed dates`;

  await sendQteklinkEmail({ to, subject, text: lines.join("\n") });
}

/**
 * One-shot re-scan: detect (+ auto-resolve fixed items) and send the Date Change
 * Alerts for anything new. Runs on EVERY Posting-queue page load and behind its
 * "Check again" button. Returns null when QuickBooks isn't connected.
 */
export async function refreshDateMoves(shopId: number): Promise<DetectResult | null> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return null;
  const { settings } = await getShopSettings(shopId);
  const detect = await detectDateMoves(shopId, realmId, settings.shopTimezone);
  await notifyDateMoves(shopId, detect.newOrChangedMoves);
  return detect;
}

// ─── Queue actions ────────────────────────────────────────────────────────────

export async function approveDateMove(shopId: number, id: string, approvedBy: string): Promise<{ approved: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_approve_date_move", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_approved_by: approvedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_approve_date_move failed: ${error.message}`);
  }
  return { approved: data === true };
}

export async function unapproveDateMove(shopId: number, id: string, unapprovedBy: string): Promise<{ unapproved: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_unapprove_date_move", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_unapproved_by: unapprovedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_unapprove_date_move failed: ${error.message}`);
  }
  return { unapproved: data === true };
}
