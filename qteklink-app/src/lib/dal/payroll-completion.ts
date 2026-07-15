/**
 * Payroll DAL — completion PTO-entry assembly + the POST-RESPONSE email fan-out
 * (plan §4/§5 of docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md).
 * Internal support module for src/lib/dal/payroll.ts (the public entrypoint's
 * completePayrollRun calls into here) — split out per the ~500-line file policy
 * so payroll.ts does not grow. Import the public surface from "@/lib/dal/payroll".
 *
 * WHY SPLIT (not inlined in payroll.ts): payroll.ts is already at the ~500-line
 * limit; the round-11 completion wiring (entry assembly + the Next 15 after()
 * fan-out) is a cohesive, independently-testable unit that belongs together.
 *
 * (a) assembleCompletionPtoEntries — the p_pto_entries payload that rides INTO
 *     qteklink_payroll_complete_run (plan §4 atomicity C5/C12/C32): fetch the
 *     roster's employee-master rows (the profile columns) + their full rollover
 *     ledgers, then call the pure computeCompletionPtoEntries engine over the
 *     FROZEN snapshot's per-employee paid PTO hours. NOTHING is written here —
 *     the confirm RPC owns balance stamping, the shop lock, and every
 *     idempotency guard. Zero PTO config ⇒ zero entries ⇒ completion behaves
 *     exactly as today (C14).
 *
 * (b) runCompletionEmailFanout — the SEQUENTIAL, NEVER-THROW post-response fan-
 *     out (the caller fires it via Next 15 after(); C15/C26/C27). Order:
 *       1. the completed-run alert (rides the same queue — moved out of the
 *          synchronous path so a shared-Resend-key 429 can't stall the response);
 *       2. the per-employee pay summaries (renderAndSendPaySummaries — one
 *          isolated render + send + atomic claim per pre-inserted pending row);
 *       3. the negative-balance alerts (re-read balances AFTER the confirm
 *          committed — the authoritative post-completion balance; suppressed off
 *          unseeded balances since getPtoBalances only maps employees WITH ledger
 *          rows, plan §3).
 *     Every step swallows its own failure (Sentry) — a bounce must never undo the
 *     already-committed completion. Legitimate empty lists NEVER call
 *     sendQteklinkEmail (N11 — the empty-recipients Sentry warning stays
 *     meaningful for genuinely unconfigured settings lists).
 *
 * MULTI-TENANT: shop-scoped throughout; the send layer re-binds recipient↔payload
 * by employee_id (§5). No silent failures: reads check `error`; send failures are
 * captured to Sentry AND logged on the email-log row (auditable, retryable).
 */
import * as Sentry from "@sentry/nextjs";
import type { RunSnapshot } from "@/lib/payroll/types";
import type { PtoRunLedgerEntry, PtoSettingsSlice, PtoWarning } from "@/lib/payroll/pto";
import {
  fetchEmployeesByIds,
  getPayrollSettings,
  type PayrollActor,
} from "@/lib/dal/payroll-shared";
import {
  getPtoBalances,
  getPtoRolloverLedger,
  projectRunPto,
  ptoFieldsFromEmployee,
  type PtoProjectionInput,
} from "@/lib/dal/payroll-pto";
import {
  completionInputFrom,
  computeCompletionPtoEntries,
  detectMissingPersonalEmails,
  renderAndSendPaySummaries,
  sendNegativeBalanceAlerts,
  type CompletionPtoInput,
  type NegativeBalanceEmployee,
} from "@/lib/dal/payroll-pto-completion";
import { sendPayrollAlert } from "@/lib/dal/payroll-confirm";
import { renderRunSummaryEmail } from "@/lib/payroll/pay-summary-email";

/** The p_pto_entries payload + the non-blocking warnings the completion result
 *  can surface (grandfathered-with-no-dates, etc. — C14, never a throw). */
export interface CompletionPtoPayload {
  entries: PtoRunLedgerEntry[];
  warnings: PtoWarning[];
}

/** Narrow the shop's payroll settings to the pure engine's slice (plan §2d). */
function ptoSettingsSlice(settings: {
  anchor_period_start: string | null;
  pto_tenure_tiers: PtoSettingsSlice["pto_tenure_tiers"];
  pto_rollover_cap_hours: PtoSettingsSlice["pto_rollover_cap_hours"];
}): PtoSettingsSlice {
  return {
    anchor_period_start: settings.anchor_period_start,
    pto_tenure_tiers: settings.pto_tenure_tiers,
    pto_rollover_cap_hours: settings.pto_rollover_cap_hours,
  };
}

/**
 * (a) Build the run's p_pto_entries from the FROZEN completion snapshot. For
 * EVERY roster employee in the snapshot: the pure engine emits an accrual
 * (gated by archive/termination/eligibility), a usage (for ANY paid PTO hours
 * regardless of archive/termination — C37), and a rollover_forfeit candidate
 * (the RPC enforces at-most-once under the shop lock — C33). Zero-hour rows are
 * never emitted ⇒ zero PTO configuration yields an empty array ⇒ the confirm RPC
 * writes no ledger rows and completion is byte-identical to today (C14).
 *
 * Reads the employee-master rows (the §2a profile columns) + each employee's
 * full rollover ledger; never writes. The snapshot's per-employee `sheet.pto_hours`
 * is the usage basis (§5 single-source: the frozen numbers, not a live re-read).
 */
export async function assembleCompletionPtoEntries(
  shopId: number,
  snapshot: RunSnapshot,
): Promise<CompletionPtoPayload> {
  const employeeIds = snapshot.employees.map((e) => e.employee_id);
  if (employeeIds.length === 0) return { entries: [], warnings: [] };

  const [{ payroll: settings }, masters, rolloverByEmployee] = await Promise.all([
    getPayrollSettings(shopId),
    fetchEmployeesByIds(shopId, employeeIds),
    getPtoRolloverLedger(shopId, employeeIds),
  ]);

  const inputs: CompletionPtoInput[] = [];
  for (const snapEmp of snapshot.employees) {
    const master = masters.get(snapEmp.employee_id);
    // A roster employee absent from the master table cannot be profiled — the
    // engine gates accrual (no start_date) yet must still ledger any paid PTO
    // usage; skip only when there is truly nothing to write. In practice the
    // completion snapshot is built from the master rows, so this is defensive.
    if (master === undefined) continue;
    inputs.push(
      completionInputFrom(
        { employee_id: snapEmp.employee_id, sheet: snapEmp.sheet },
        master,
        rolloverByEmployee.get(snapEmp.employee_id) ?? [],
      ),
    );
  }

  return computeCompletionPtoEntries(inputs, ptoSettingsSlice(settings), {
    period_start: snapshot.run.period_start,
    period_end: snapshot.run.period_end,
  });
}

/** The completion DIALOG's advisory PTO data (plan §4 / #53.3 + #59), fed to
 *  CompleteRunButton: the roster employees with NO personal_email (they won't
 *  get a pay summary → the dialog relabels its confirm to "Skip emails & mark
 *  complete") and those PROJECTED negative after this run (an advisory deficit
 *  notice — negatives are allowed, never blocks). */
export interface CompletionDialogPto {
  missingPersonalEmail: string[];
  projectedNegative: { employeeId: string; displayName: string; deficitHours: number }[];
}

/**
 * Build the completion dialog's advisory PTO lists from the CURRENT snapshot +
 * ledger — NO Tekmetric re-fetch (that is the dry run's job). Reuses the exact
 * projection assembly the dry run uses (projectRunPto over the frozen/live
 * snapshot's paid PTO hours + current balances), so the dialog and the dry-run
 * preview agree. Display-only (N4): the authoritative balances are stamped
 * inside the completion transaction. Empty roster / zero PTO config ⇒ empty
 * lists ⇒ the dialog shows no PTO notices and the confirm label stays
 * "Mark complete".
 */
export async function getCompletionDialogPto(
  shopId: number,
  snapshot: RunSnapshot,
): Promise<CompletionDialogPto> {
  const employeeIds = snapshot.employees.map((e) => e.employee_id);
  if (employeeIds.length === 0) return { missingPersonalEmail: [], projectedNegative: [] };

  const [{ payroll: settings }, masters, balances, rolloverByEmployee] = await Promise.all([
    getPayrollSettings(shopId),
    fetchEmployeesByIds(shopId, employeeIds),
    getPtoBalances(shopId, employeeIds),
    getPtoRolloverLedger(shopId, employeeIds),
  ]);

  // masters holds exactly the roster (fetched by the snapshot's ids).
  const missingPersonalEmail = detectMissingPersonalEmails([...masters.values()]).map(
    (m) => m.displayName,
  );

  const inputs: PtoProjectionInput[] = [];
  for (const snapEmp of snapshot.employees) {
    const master = masters.get(snapEmp.employee_id);
    if (master === undefined) continue;
    inputs.push({
      employee: ptoFieldsFromEmployee(master),
      displayName: snapEmp.display_name,
      snapshotPtoHours: snapEmp.sheet.pto_hours,
      currentBalanceHours: balances.get(snapEmp.employee_id) ?? 0,
      rolloverLedger: rolloverByEmployee.get(snapEmp.employee_id) ?? [],
    });
  }

  const { projections } = projectRunPto(
    inputs,
    {
      anchor_period_start: settings.anchor_period_start,
      pto_tenure_tiers: settings.pto_tenure_tiers,
      pto_rollover_cap_hours: settings.pto_rollover_cap_hours,
    },
    { period_start: snapshot.run.period_start, period_end: snapshot.run.period_end },
  );
  const projectedNegative = projections
    .filter((p) => p.projectedBalanceHours < 0)
    .map((p) => ({
      employeeId: p.employeeId,
      displayName: p.displayName,
      deficitHours: Math.abs(p.projectedBalanceHours),
    }));

  return { missingPersonalEmail, projectedNegative };
}

/**
 * (b) The POST-RESPONSE email fan-out for a COMPLETED run (plan §4/§5). Fired by
 * completePayrollRun via Next 15 after() — SEQUENTIAL (the Resend key is shared
 * with the live money-path alerts; a parallel burst 429s them) and NEVER-THROW
 * (the completion already committed; a bounce must not undo it). Each step
 * captures its own failure so a later step still runs.
 *
 * `alertLines` is the completed-run alert body the caller already composed
 * (moved here so the whole email workload rides ONE post-response queue).
 */
export async function runCompletionEmailFanout(
  shopId: number,
  snapshot: RunSnapshot,
  alertSubject: string,
  alertLines: string[],
): Promise<void> {
  const runId = snapshot.run.run_id;
  const period = { periodStart: snapshot.run.period_start, periodEnd: snapshot.run.period_end };

  // 1. The completed-run alert (sendPayrollAlert already never-throws). Chris
  //    2026-07-12: this alert carries the WHOLE run's summary — the Summary
  //    page's two blocks (per-employee table + Run totals card), styled like the
  //    individual pay summaries. HTML from the frozen snapshot; the alertLines
  //    metadata rides as the text fallback + the html footer.
  try {
    const runSummary = renderRunSummaryEmail({
      period,
      rows: snapshot.summary ?? [],
      totals: snapshot.summary_totals ?? null,
      metaLines: alertLines,
    });
    await sendPayrollAlert(shopId, "completed", alertSubject, runSummary.text.split("\n"), runSummary.html);
  } catch (e) {
    // sendPayrollAlert never throws, but the render (+ .split) is unguarded — a throw
    // here would reject the after() callback and skip steps 2-3, stranding the
    // pre-inserted pay-summary rows `pending` (unrecoverable via resend, which only
    // requeues `failed`). Swallow-then-capture, exactly like steps 2/3 below.
    Sentry.captureException(e, {
      tags: { surface: "qteklink-payroll-completion-fanout", step: "completed_alert", shop_id: String(shopId) },
      extra: { runId },
    });
  }

  // 2. Per-employee pay summaries (renderAndSendPaySummaries never throws — it
  //    finalizes each pre-inserted pending row through the atomic claim RPC).
  try {
    await renderAndSendPaySummaries(shopId, snapshot);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "qteklink-payroll-completion-fanout", step: "pay_summaries", shop_id: String(shopId) },
      extra: { runId },
    });
  }

  // 3. Negative-balance alerts (plan §4 + N4). Re-read the AUTHORITATIVE
  //    post-completion balances: getPtoBalances only maps employees WITH ≥ 1
  //    ledger row, so unseeded employees are inherently excluded (no spam off
  //    unseeded balances — plan §3). A negative balance implies ledger rows
  //    exist, so map-present + balance < 0 IS the genuinely-negative, ledgered
  //    set. Employee display name + personal email come from the frozen snapshot
  //    + the master rows (single-source binding).
  try {
    const employeeIds = snapshot.employees.map((e) => e.employee_id);
    if (employeeIds.length > 0) {
      const [{ payroll: settings }, balances, masters] = await Promise.all([
        getPayrollSettings(shopId),
        getPtoBalances(shopId, employeeIds),
        fetchEmployeesByIds(shopId, employeeIds),
      ]);
      const negatives: NegativeBalanceEmployee[] = [];
      for (const snapEmp of snapshot.employees) {
        const balance = balances.get(snapEmp.employee_id);
        if (balance === undefined || balance >= 0) continue; // unseeded or non-negative
        negatives.push({
          employeeId: snapEmp.employee_id,
          displayName: snapEmp.display_name,
          personalEmail: masters.get(snapEmp.employee_id)?.personalEmail ?? null,
          balanceHours: balance,
        });
      }
      if (negatives.length > 0) {
        await sendNegativeBalanceAlerts(
          shopId,
          runId,
          period,
          negatives,
          settings.pto_negative_alert_admin_emails,
        );
      }
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "qteklink-payroll-completion-fanout", step: "negative_alerts", shop_id: String(shopId) },
      extra: { runId },
    });
  }
}

/** Re-export the actor type so callers can stay on the "@/lib/dal/payroll" path. */
export type { PayrollActor };
