/**
 * Payroll DAL — dashboard summary reads (ADDITIVE, READ-ONLY). Internal support
 * module for src/lib/dal/payroll.ts (the public entrypoint per the contract module
 * layout), split out to honor the ~500-line file policy. Import the public surface
 * from "@/lib/dal/payroll", not from here.
 *
 * The /payroll dashboard needs each recent run's per-employee SummaryRow set (the
 * last-12-runs card + the per-employee hourly averages). Read-path rule (plan §calc
 * engine): completed/voided runs render EXCLUSIVELY from the frozen snapshot —
 * never recomputed; open runs read through the round-7 #41 LIVE snapshot
 * (getOrComputeLiveSnapshot — served from the display cache when fresh, computed
 * once + stored when stale). The pure aggregation (windowing, averages, exclusion
 * of voided runs) stays in src/lib/payroll/summary.ts — this module only fetches
 * and shapes the rows.
 *
 * MULTI-TENANT: shop-scoped query. No silent failures: the Supabase call checks
 * `error`, and a completed/voided run without a snapshot summary (impossible per
 * the DB CHECK) throws instead of rendering zeros.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { SummaryRowSchema, type SummaryRow } from "@/lib/payroll/types";
import { getOrComputeLiveSnapshot } from "@/lib/dal/payroll-live";
import { RUN_COLS, runFromRow, type PayrollRun, type RunDbRow } from "@/lib/dal/payroll-shared";

export interface PayrollRunWithSummary {
  run: PayrollRun;
  /** Per-employee summary rows — the frozen snapshot's rows for completed/voided
   *  runs (never recomputed), live-computed for open runs. */
  rows: SummaryRow[];
}

/**
 * The most recent runs (any status, newest first) with their SummaryRow sets.
 * Feed the result to the pure summary.ts aggregators (lastCompletedRuns /
 * employeeHourlyAverages / aggregateLastCompletedRuns) for windows + averages —
 * they exclude voided/open runs from every aggregate themselves.
 *
 * Round-12: the per-employee dashboard averages roll the last 26 COMPLETED runs
 * (summary.ts DASHBOARD_WINDOW), so the default fetch is 60 — comfortably above 26
 * so the completed window survives interleaved voided/open rows. The dashboard page
 * passes an explicit limit; this default is the floor for any other caller.
 */
export async function listPayrollRunsWithSummaries(
  shopId: number,
  opts: { limit?: number } = {},
): Promise<PayrollRunWithSummary[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_runs")
    .select(RUN_COLS)
    .eq("shop_id", shopId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 60);
  if (error) throw new Error(`listPayrollRunsWithSummaries failed: ${error.message}`);

  const out: PayrollRunWithSummary[] = [];
  for (const row of (data ?? []) as RunDbRow[]) {
    if (row.status === "open") {
      // Read-through (#41): the same live-snapshot cache the run detail page uses.
      const snapshot = await getOrComputeLiveSnapshot(shopId, row);
      out.push({ run: runFromRow(row), rows: snapshot.summary });
      continue;
    }
    // completed/voided: the frozen snapshot IS the record (DB CHECK guarantees it).
    const summary = (row.snapshot as { summary?: unknown } | null)?.summary;
    if (!Array.isArray(summary)) {
      throw new Error(`payroll DAL: ${row.status} run ${row.id} has no snapshot summary`);
    }
    out.push({ run: runFromRow(row), rows: z.array(SummaryRowSchema).parse(summary) });
  }
  return out;
}
