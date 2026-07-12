/**
 * Payroll DAL — the round-7 #42 DRY RUN. Internal support module for
 * src/lib/dal/payroll.ts (the public entrypoint re-exports dryRunPayrollRefresh)
 * — split out per the ~500-line file policy.
 *
 * One admin click, four steps, all server-side:
 *   (a) BEFORE = the run's CURRENT live numbers (getOrComputeLiveSnapshot — the
 *       fresh cache, or one compute if stale; either way "what the screen shows").
 *   (b) LIVE re-fetch from Tekmetric via the range-mode mirror ingest:
 *       the period's posted-date window PLUS an updated-since pass
 *       (updatedDateStart = period_start — catches completed-but-unposted ROs the
 *       #39 hours basis buckets), PLUS the bonus month's posted window when the
 *       slider is on. API contract (tested 2026-07-11): page size hard-capped at
 *       100, NO batch-by-ids param, unknown params SILENTLY IGNORED — the ingest
 *       passes only supported filters.
 *   (c) Mark EVERY open run of the shop stale (the mirror moved under all of
 *       them), then recompute + store THIS run's live snapshot FRESH
 *       (freshQbo — the QBO 6010 tech cost is re-fetched, never the < 6h memo).
 *       The recompute COMMITS the refreshed numbers: the modal's Accept only
 *       acknowledges + navigates; Cancel keeps the refreshed numbers too.
 *   (d) Return the structured before→after diff (pure builder in
 *       src/lib/payroll/dry-run-diff.ts) — only changed fields + as-of stamps.
 *
 * MULTI-TENANT: shopId comes from the caller's session; fetchRunGuarded asserts
 * run ownership before anything runs. Failures PROPAGATE — the user explicitly
 * asked for this check; a half-applied dry run must be visible (the stale flags
 * set in (c) guarantee the next read/nightly reconciles regardless).
 */
import { QboClientError } from "@/lib/qbo/errors";
import { monthDateRange } from "@/lib/payroll/derive";
import { runMirrorIngest } from "@/lib/payroll/mirror-ingest";
import {
  buildDryRunDiff,
  type DryRunPtoProjection,
  type PayrollDryRunResult,
} from "@/lib/payroll/dry-run-diff";
import type { RunSnapshot } from "@/lib/payroll/types";
import { fetchEmployeesByIds, getPayrollSettings, fetchRunGuarded } from "@/lib/dal/payroll-shared";
import {
  getOrComputeLiveSnapshot,
  markPayrollOpenRunsStale,
  recomputeAndStoreLiveSnapshot,
} from "@/lib/dal/payroll-live";
import {
  getPtoBalances,
  getPtoRolloverLedger,
  projectRunPto,
  ptoFieldsFromEmployee,
  type PtoProjectionInput,
} from "@/lib/dal/payroll-pto";

export type { PayrollDryRunResult };

export async function dryRunPayrollRefresh(
  shopId: number,
  runId: string,
): Promise<PayrollDryRunResult> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "open") {
    throw new QboClientError(
      `This run is ${run.status} — only open runs can be dry-run checked.`,
      { kind: "validation" },
    );
  }

  // (a) BEFORE: the numbers the screen currently shows.
  const before = await getOrComputeLiveSnapshot(shopId, run);

  // (b) Live Tekmetric re-fetch: period posted window + updated-since, then the
  // bonus month's posted window (money rollups stay posted-basis there).
  const period = await runMirrorIngest(
    { shopId },
    {
      mode: "range",
      postedDateStart: run.period_start,
      postedDateEnd: run.period_end,
      updatedDateStart: run.period_start,
    },
  );
  let bonusRosUpserted = 0;
  if (run.bonus_period && run.bonus_month) {
    const { start, end } = monthDateRange(run.bonus_month.slice(0, 7));
    const bonus = await runMirrorIngest(
      { shopId },
      { mode: "range", postedDateStart: start, postedDateEnd: end },
    );
    bonusRosUpserted = bonus.rosUpserted;
  }

  // (c) Invalidate every open run (shared mirror), recompute THIS one fresh.
  await markPayrollOpenRunsStale(shopId);
  const after = await recomputeAndStoreLiveSnapshot(shopId, runId, { freshQbo: true });
  if (after === null) {
    // The run completed/voided in the race window — nothing was applied to it
    // (the store RPC only writes open runs); the mirror refresh itself stands.
    throw new QboClientError(
      "This run is no longer open — the dry run refreshed the Tekmetric mirror but did not change this run.",
      { kind: "validation" },
    );
  }

  // (d) The structured diff (before/after both parsed RunSnapshots).
  // (e) Round-11 (plan §4): the PTO projection — a NEW OPTIONAL SIBLING of the
  //     diff. buildDryRunDiff + PayrollDryRunDiff + `changed` + every existing
  //     diff key stay BYTE-IDENTICAL (C16/C21); PTO rides alongside, never
  //     inside, the diff, and nothing PTO enters the snapshot (N3).
  return {
    diff: buildDryRunDiff(before, after),
    rosChecked: period.rosUpserted + bonusRosUpserted,
    pto: await projectPtoForDryRun(shopId, after),
  };
}

/**
 * Compute the per-employee PTO projections for the previewed run (plan §4 dry-run
 * contract). Reads the AFTER snapshot's per-employee paid PTO hours (sheet.pto_hours),
 * each employee's current ledger balance + rollover ledger, and the profile columns,
 * then threads them through the pure pto.ts engine (projectRunPto). Returns
 * `undefined` for an empty roster (the modal omits the section); otherwise the
 * per-employee projections (an empty-ish/zero projection still renders so a
 * deficit can surface next to "no Tekmetric differences"). Never mutates the
 * snapshot and never enters the diff.
 */
async function projectPtoForDryRun(
  shopId: number,
  after: RunSnapshot,
): Promise<DryRunPtoProjection[] | undefined> {
  const employeeIds = after.employees.map((e) => e.employee_id);
  if (employeeIds.length === 0) return undefined;

  const [{ payroll: settings }, masters, balances, rolloverByEmployee] = await Promise.all([
    getPayrollSettings(shopId),
    fetchEmployeesByIds(shopId, employeeIds),
    getPtoBalances(shopId, employeeIds),
    getPtoRolloverLedger(shopId, employeeIds),
  ]);

  const inputs: PtoProjectionInput[] = [];
  for (const snapEmp of after.employees) {
    const master = masters.get(snapEmp.employee_id);
    if (master === undefined) continue; // defensive — the snapshot is built from masters
    inputs.push({
      employee: ptoFieldsFromEmployee(master),
      displayName: snapEmp.display_name,
      snapshotPtoHours: snapEmp.sheet.pto_hours,
      currentBalanceHours: balances.get(snapEmp.employee_id) ?? 0,
      rolloverLedger: rolloverByEmployee.get(snapEmp.employee_id) ?? [],
    });
  }
  if (inputs.length === 0) return undefined;

  const { projections } = projectRunPto(
    inputs,
    {
      anchor_period_start: settings.anchor_period_start,
      pto_tenure_tiers: settings.pto_tenure_tiers,
      pto_rollover_cap_hours: settings.pto_rollover_cap_hours,
    },
    { period_start: after.run.period_start, period_end: after.run.period_end },
  );
  return projections;
}
