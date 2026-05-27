"use server";

/**
 * listCapacityCalendarAction — direct Supabase read of closed_dates +
 * appointment_blocks for the next 90 days, shop-scoped.
 *
 * Returns both row sets so the UI can merge them per-day. NOT a Server
 * Action discriminated union — read-only; throws on error (caller wraps
 * with try/catch + graceful fallback like listRecentUploadsAction does).
 *
 * Why direct Supabase (not orchestrator-mcp): avoids adding a new edge
 * tool + redeploying orchestrator-mcp for what's a simple read. Per D.6
 * design call (Chris 2026-05-27) the trade-off was deliberate. Uses the
 * admin SERVICE_ROLE client; shop_id from resolveAdminShopId — never
 * client-supplied.
 *
 * Per ROUND-2-RESIDUALS R-BL-1: this read is shop-scoped via the WHERE
 * clause below. The block/unblock_appointment_capacity tools the UI
 * calls use the orchestrator's actor-email shop_id resolution (server-
 * derived; client cannot influence). See `./block-appointment-capacity.ts`
 * for the matching verification footnote.
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";

export interface ClosedDateRow {
  id: string;
  closed_date: string; // YYYY-MM-DD
  reason: string | null;
  source: string | null;
  created_at: string;
}

export interface AppointmentBlockRow {
  id: string;
  blocked_date: string; // YYYY-MM-DD
  /** null = whole-day block (per block_appointment_capacity contract). */
  blocked_type: string | null;
  /** null = whole-day block. */
  blocked_time: string | null;
  reason: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CapacityCalendarLoad {
  closed_dates: ClosedDateRow[];
  appointment_blocks: AppointmentBlockRow[];
  /** First day of the window (today, YYYY-MM-DD UTC). */
  start_date: string;
  /** Last day of the window (today + 89, YYYY-MM-DD UTC). */
  end_date: string;
  days_ahead: number;
}

async function impl(): Promise<CapacityCalendarLoad> {
  await requireAdmin(); // auth gate — actor identity isn't used in the query, but the gate IS
  const shopId = resolveAdminShopId();

  // 90-day forward window from today (UTC). The calendar strip renders
  // one row per day so the user can scan the next quarter at a glance.
  const today = new Date();
  // Pin to UTC midnight to match the closed_date / blocked_date column
  // types (Postgres DATE, no timezone).
  const startUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const start = new Date(startUtcMs);
  const end = new Date(startUtcMs + 89 * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().split("T")[0]!;
  const endDate = end.toISOString().split("T")[0]!;

  const supabase = createSupabaseAdminClient();

  // Run both queries in parallel.
  const [closedDatesRes, appointmentBlocksRes] = await Promise.all([
    supabase
      .from("closed_dates")
      .select("id, closed_date, reason, source, created_at")
      .eq("shop_id", shopId)
      .gte("closed_date", startDate)
      .lte("closed_date", endDate)
      .order("closed_date", { ascending: true }),
    supabase
      .from("appointment_blocks")
      .select(
        "id, blocked_date, blocked_type, blocked_time, reason, created_by_name, created_at",
      )
      .eq("shop_id", shopId)
      .gte("blocked_date", startDate)
      .lte("blocked_date", endDate)
      .order("blocked_date", { ascending: true }),
  ]);

  if (closedDatesRes.error) {
    throw new Error(
      `Failed to read closed_dates: ${closedDatesRes.error.message}`,
    );
  }
  if (appointmentBlocksRes.error) {
    throw new Error(
      `Failed to read appointment_blocks: ${appointmentBlocksRes.error.message}`,
    );
  }

  return {
    closed_dates: (closedDatesRes.data ?? []) as ClosedDateRow[],
    appointment_blocks: (appointmentBlocksRes.data ?? []) as AppointmentBlockRow[],
    start_date: startDate,
    end_date: endDate,
    days_ahead: 90,
  };
}

export const listCapacityCalendarAction = wrapAdminAction(
  "listCapacityCalendar",
  impl,
  {},
);
