// back-office-dashboard-data — the digest/dashboard snapshot builder.
//
// One source of truth for the numbers shown in BOTH the daily-digest email
// (back-office-daily-report) and the qteklink-app Back Office Dashboard tab: the headline
// counts come from the back_office_dashboard_counts RPC (so the email and the in-app tab
// never disagree), and the open/stale item lists are read here. The app's DAL mirrors these
// shapes (parity kept by tests — the keytag no-drift pattern).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface BackOfficeDigestItem {
  id: string;
  kind: string;
  status: string;
  ro_number: string | null;
  bill_no: string | null;
  vendor_name: string | null;
  title: string | null;
  bo_notes: string | null;
  created_at: string;
  last_activity_at: string;
  days_open: number;
  is_stale: boolean;
}

export interface BackOfficeDigestData {
  openCount: number;
  closedThisMonth: number;
  staleCount: number;
  openItems: BackOfficeDigestItem[]; // all non-verified, oldest first
  staleItems: BackOfficeDigestItem[]; // stale subset, most days-open first
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysOpen(createdAt: string, nowMs: number): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((nowMs - created) / DAY_MS));
}

interface IssueRow {
  id: string;
  kind: string;
  status: string;
  ro_number: string | null;
  bill_no: string | null;
  vendor_name: string | null;
  title: string | null;
  bo_notes: string | null;
  created_at: string;
  last_activity_at: string;
}

/**
 * Build the digest snapshot for one shop. `staleHours` + `monthStartYmd` come from the
 * shop's settings/timezone (resolved by the caller). `nowMs` is injected for determinism.
 */
export async function buildBackOfficeDigestData(
  sb: SupabaseClient,
  shopId: number,
  staleHours: number,
  monthStartYmd: string,
  nowMs: number,
): Promise<BackOfficeDigestData> {
  const { data: countsRaw, error: countsErr } = await sb.rpc("back_office_dashboard_counts", {
    p_shop_id: shopId,
    p_month_start: monthStartYmd,
    p_stale_hours: staleHours,
  });
  if (countsErr) throw new Error(`back_office_dashboard_counts failed: ${countsErr.message}`);
  const counts = (countsRaw ?? {}) as { open_count?: number; closed_this_month?: number; stale_count?: number };

  const { data: rows, error: rowsErr } = await sb
    .from("back_office_issues")
    .select("id, kind, status, ro_number, bill_no, vendor_name, title, bo_notes, created_at, last_activity_at")
    .eq("shop_id", shopId)
    .neq("status", "verified")
    .order("created_at", { ascending: true });
  if (rowsErr) throw new Error(`buildBackOfficeDigestData (issues) failed: ${rowsErr.message}`);

  const staleCutoffMs = nowMs - staleHours * 60 * 60 * 1000;
  const openItems: BackOfficeDigestItem[] = (rows ?? []).map((raw) => {
    const r = raw as IssueRow;
    const lastMs = new Date(r.last_activity_at).getTime();
    const isStale = Number.isFinite(lastMs) && lastMs < staleCutoffMs;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      ro_number: r.ro_number,
      bill_no: r.bill_no,
      vendor_name: r.vendor_name,
      title: r.title,
      bo_notes: r.bo_notes,
      created_at: r.created_at,
      last_activity_at: r.last_activity_at,
      days_open: daysOpen(r.created_at, nowMs),
      is_stale: isStale,
    };
  });

  const staleItems = openItems.filter((i) => i.is_stale).sort((a, b) => b.days_open - a.days_open);

  return {
    openCount: counts.open_count ?? openItems.length,
    closedThisMonth: counts.closed_this_month ?? 0,
    staleCount: counts.stale_count ?? staleItems.length,
    openItems,
    staleItems,
  };
}

/** First day of the current month in the shop timezone, as YYYY-MM-DD. */
export function monthStartYmd(tz: string, nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(nowMs));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}-01`;
}

/** The shop-local YYYY-MM-DD (for the Resend idempotency key). */
export function shopLocalYmd(tz: string, nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(nowMs));
}
