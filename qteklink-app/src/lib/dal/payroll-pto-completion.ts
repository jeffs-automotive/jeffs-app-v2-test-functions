/**
 * Payroll PTO DAL — completion-time entry builder + the pay-summary / negative-
 * balance email fan-out (plan §4/§5 of
 * docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md). Internal support
 * module for src/lib/dal/payroll.ts — split from ./payroll-pto.ts per the
 * ~500-line file policy. Import the public surface from "@/lib/dal/payroll".
 *
 * (e) computeCompletionPtoEntries: the accrual/usage/rollover_forfeit payloads
 *     that ride INTO qteklink_payroll_complete_run as p_pto_entries — a pure-ish
 *     orchestration around the pto.ts engine (usage for EVERY employee with paid
 *     PTO hours incl. archived/terminated; accrual gated; forfeit as a candidate,
 *     the RPC enforces at-most-once under the shop lock). NOTHING is written here.
 *
 * (f) Email orchestration (plan §4/§5) — runs POST-response (the action fires it
 *     via Next 15 after()); it NEVER throws into the money path:
 *     - renderAndSendPaySummaries: one ISOLATED render per employee
 *       (renderPaySummaryEmail + assertBinding), SEQUENTIAL sends (the Resend key
 *       is shared with the live money-path alerts — a parallel burst 429s them),
 *       each finalized through the atomic claim RPC (pending→sent / pending→failed).
 *       A payload/recipient mismatch REFUSES the send and logs `failed` with both
 *       ids (§5.3 — fail closed, loud). One log row per (run, employee) — the rows
 *       were pre-inserted inside the completion transaction (§2c).
 *     - sendNegativeBalanceAlerts: employee personal email + the admin list, each a
 *       logged pto_negative row.
 *     - detectMissingPersonalEmails: the #53.3 skip list (employees on the roster
 *       with no personal_email). Legitimate skips write skipped_no_email rows (done
 *       in the completion transaction) and NEVER call sendQteklinkEmail (N11 — its
 *       empty-recipients Sentry warning stays meaningful for genuinely unconfigured
 *       lists).
 *
 * MULTI-TENANT: shop-scoped throughout; the send layer re-binds recipient↔payload
 * by employee_id. No silent failures: reads check `error`; send failures are
 * captured to Sentry AND logged `failed` on the email row (auditable, retryable).
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendQteklinkEmail } from "@/lib/dal/notify";
import {
  assertBinding,
  renderPaySummaryEmail,
  type PaySummaryPeriod,
  type PaySummaryRecipient,
} from "@/lib/payroll/pay-summary-email";
import {
  buildEmployeeRunPtoEntries,
  type PtoEmployeeFields,
  type PtoLedgerEntryForRollover,
  type PtoRunLedgerEntry,
  type PtoRunPeriod,
  type PtoSettingsSlice,
  type PtoWarning,
} from "@/lib/payroll/pto";
import { RunSnapshotSchema, type RunSnapshot, type SnapshotEmployee } from "@/lib/payroll/types";
import { fetchRunGuarded, type PayrollEmployee } from "@/lib/dal/payroll-shared";
import { QboClientError } from "@/lib/qbo/errors";
import { ptoFieldsFromEmployee } from "@/lib/dal/payroll-pto";

// ── (e) completion entry builder ────────────────────────────────────────────────

/** Everything one employee contributes to p_pto_entries — the engine input. */
export interface CompletionPtoInput {
  employee: PtoEmployeeFields;
  /** Paid PTO hours from the FROZEN snapshot (sheet.pto_hours) — usage basis. */
  snapshotPtoHours: number;
  /** The employee's full ledger history (rollover carryover input). */
  rolloverLedger: readonly PtoLedgerEntryForRollover[];
}

/** The p_pto_entries payload + the non-blocking warnings the completion result
 *  surfaces (grandfathered-with-no-dates, etc. — C14, never a throw). */
export interface CompletionPtoEntries {
  entries: PtoRunLedgerEntry[];
  warnings: PtoWarning[];
}

/**
 * Assemble the run's p_pto_entries: for EVERY roster employee, the engine emits
 * an accrual (gated), a usage (for ANY paid PTO hours regardless of
 * archive/termination — C37), and a rollover_forfeit candidate. Zero-hour rows are
 * never emitted, so a zero-PTO-config run yields an empty array ⇒ completion
 * behaves exactly as today (C14). PURE — the caller supplies balances/ledger.
 */
export function computeCompletionPtoEntries(
  inputs: readonly CompletionPtoInput[],
  settings: PtoSettingsSlice,
  run: PtoRunPeriod,
): CompletionPtoEntries {
  const entries: PtoRunLedgerEntry[] = [];
  const warnings: PtoWarning[] = [];
  for (const input of inputs) {
    const computed = buildEmployeeRunPtoEntries(
      {
        employee: input.employee,
        snapshot_pto_hours: input.snapshotPtoHours,
        ledger_entries: input.rolloverLedger,
      },
      settings,
      run,
    );
    entries.push(...computed.entries);
    warnings.push(...computed.warnings);
  }
  return { entries, warnings };
}

/** Adapt a completed run's SnapshotEmployee + the employee master row into the
 *  completion input. `snapshotPtoHours` is the frozen sheet's paid PTO. */
export function completionInputFrom(
  snapshotEmployee: Pick<SnapshotEmployee, "employee_id" | "sheet">,
  master: PayrollEmployee,
  rolloverLedger: readonly PtoLedgerEntryForRollover[],
): CompletionPtoInput {
  return {
    employee: ptoFieldsFromEmployee(master),
    snapshotPtoHours: snapshotEmployee.sheet.pto_hours,
    rolloverLedger,
  };
}

// ── (f) email orchestration ─────────────────────────────────────────────────────

/** A pre-inserted pay_summary email-log row (born in the completion transaction). */
interface PaySummaryLogRow {
  id: string;
  employee_id: string;
  recipient: string;
  status: "pending" | "sent" | "failed" | "skipped_no_email";
}

const PAY_SUMMARY_LOG_COLS = "id, employee_id, recipient, status";

/** Read the run's pay_summary email-log rows (§2c pre-inserts). Shop-scoped. */
async function fetchPaySummaryLog(shopId: number, runId: string): Promise<PaySummaryLogRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_email_log")
    .select(PAY_SUMMARY_LOG_COLS)
    .eq("shop_id", shopId)
    .eq("run_id", runId)
    .eq("kind", "pay_summary");
  if (error) {
    throw new Error(`payroll PTO DAL: pay-summary log fetch failed: ${error.message}`);
  }
  return (data ?? []) as PaySummaryLogRow[];
}

/** Atomic claim: pending→sent / pending→failed / failed→pending. Returns true on
 *  success; NEVER throws (a lost claim race / already-terminal row just logs). */
async function transitionEmail(
  emailId: string,
  toStatus: "sent" | "failed" | "pending",
  fields: { recipient?: string; subject?: string; detail?: string } = {},
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_payroll_transition_email", {
    p_email_id: emailId,
    p_to_status: toStatus,
    p_recipient: fields.recipient ?? null,
    p_subject: fields.subject ?? null,
    p_detail: fields.detail ?? null,
  });
  if (error) {
    // A racing finalizer already flipped the row, or it is terminal — visible via
    // the log row's status; capture but never throw into the (post-commit) caller.
    Sentry.captureMessage(
      `qteklink-payroll-pay-summary: email ${emailId} ${toStatus} transition rejected (${error.message})`,
      "warning",
    );
    return false;
  }
  return true;
}

export interface PaySummarySendResult {
  attempted: number;
  sent: number;
  failed: number;
  /** Rows that were pre-inserted skipped_no_email (untouched here). */
  skipped: number;
}

/**
 * Render + send the per-employee pay summaries for a COMPLETED run (plan §5).
 * SEQUENTIAL (shared Resend limit). For each PENDING pay_summary log row:
 *   1. resolve the SnapshotEmployee by employee_id (single-source binding, §5.2);
 *   2. render one ISOLATED message (renderPaySummaryEmail — refuses a cross-wired
 *      recipient at render time; assertBinding re-checks at send time, §5.3);
 *   3. send via sendQteklinkEmail (html + text);
 *   4. finalize the log row pending→sent (with subject) or pending→failed.
 * A binding mismatch or render throw ⇒ the row is logged `failed` (fail closed,
 * loud — Sentry error with both ids) and the send is REFUSED. NEVER throws into
 * the caller (post-response fan-out — a bounce must not undo the completion).
 * `skipped_no_email` rows are left exactly as pre-inserted (N11 — never sent).
 */
export async function renderAndSendPaySummaries(
  shopId: number,
  snapshot: RunSnapshot,
): Promise<PaySummarySendResult> {
  const period: PaySummaryPeriod = {
    periodStart: snapshot.run.period_start,
    periodEnd: snapshot.run.period_end,
  };
  const byId = new Map<string, SnapshotEmployee>();
  for (const e of snapshot.employees) byId.set(e.employee_id, e);

  let logRows: PaySummaryLogRow[];
  try {
    logRows = await fetchPaySummaryLog(shopId, snapshot.run.run_id);
  } catch (e) {
    // The rows exist (born in-transaction); a read failure here means we cannot
    // finalize — surface loudly, leaving rows stuck-pending (visible, retryable).
    Sentry.captureException(e, {
      tags: { surface: "qteklink-payroll-pay-summary", shop_id: String(shopId) },
    });
    return { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const result: PaySummarySendResult = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of logRows) {
    if (row.status === "skipped_no_email") {
      result.skipped += 1;
      continue;
    }
    if (row.status !== "pending") continue; // sent (terminal) / failed (retried explicitly elsewhere)
    result.attempted += 1;

    const employee = byId.get(row.employee_id);
    if (employee === undefined) {
      // The frozen snapshot lacks this employee — cannot render; fail loud.
      Sentry.captureMessage(
        `qteklink-payroll-pay-summary: run ${snapshot.run.run_id} has a pay_summary row for employee ${row.employee_id} absent from the snapshot`,
        "error",
      );
      await transitionEmail(row.id, "failed", {
        detail: "employee not present in the completed run snapshot",
      });
      result.failed += 1;
      continue;
    }

    const recipient: PaySummaryRecipient = {
      employeeId: row.employee_id,
      email: row.recipient,
      displayName: employee.display_name,
    };

    try {
      // §5.3 send-time invariant (belt-and-suspenders alongside the render guard).
      assertBinding({ employeeId: employee.employee_id }, recipient);
      const payload = renderPaySummaryEmail(employee, recipient, period);
      assertBinding(payload, recipient);

      const ok = await sendQteklinkEmail({
        to: [recipient.email],
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      if (ok) {
        await transitionEmail(row.id, "sent", { recipient: recipient.email, subject: payload.subject });
        result.sent += 1;
      } else {
        await transitionEmail(row.id, "failed", {
          recipient: recipient.email,
          subject: payload.subject,
          detail: "edge function reported a non-2xx or unconfigured transport",
        });
        result.failed += 1;
      }
    } catch (e) {
      // Binding violation or render error (§5.3/§5.6) — fail closed, loud, audited.
      Sentry.captureException(e, {
        tags: { surface: "qteklink-payroll-pay-summary", shop_id: String(shopId) },
        extra: { emailId: row.id, employeeId: row.employee_id, recipientEmployeeId: recipient.employeeId },
      });
      await transitionEmail(row.id, "failed", {
        detail: e instanceof Error ? e.message.slice(0, 300) : "render/binding failure",
      });
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Resend the FAILED pay summaries for a COMPLETED run (plan §2c/§5, C27 — the
 * "Resend failed summaries" affordance). The only retry path: for each `failed`
 * pay_summary log row, atomically claim it failed→pending (the sole legal
 * back-transition; `sent` stays terminal), then re-run the isolated per-employee
 * send. The frozen snapshot is the render source (completed runs are immutable),
 * so the recipient↔payload binding is identical to the completion-time send.
 *
 * Shop-scoped ownership is re-checked via fetchRunGuarded; a non-completed run
 * RAISEs a QboClientError (pay_summary rows exist only for completed runs — a
 * resend against an open/voided run is a user error, surfaced cleanly). The
 * failed→pending claims run under the same never-throw claim helper; a row that
 * races to `sent` between the fetch and the flip is simply left terminal.
 * Returns the send tally from the re-run (attempted/sent/failed over the rows
 * that were successfully re-queued).
 */
export async function resendFailedPaySummaries(
  shopId: number,
  runId: string,
): Promise<PaySummarySendResult> {
  const runRow = await fetchRunGuarded(shopId, runId);
  if (runRow.status !== "completed") {
    throw new QboClientError(
      `This run is ${runRow.status} — pay summaries can only be resent for a completed run.`,
      { kind: "validation" },
    );
  }

  // Reclaim every failed pay_summary row → pending (failed is the ONLY back-
  // transition; the claim helper never throws — a raced/terminal row is skipped).
  // Done BEFORE parsing the (heavy) frozen snapshot so a clean no-op (nothing was
  // failed) short-circuits without recomputing anything.
  let logRows: PaySummaryLogRow[];
  try {
    logRows = await fetchPaySummaryLog(shopId, runId);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "qteklink-payroll-pay-summary-resend", shop_id: String(shopId) },
    });
    throw new QboClientError("Could not load the run's email log to resend.", { kind: "validation" });
  }
  let requeued = 0;
  for (const row of logRows) {
    if (row.status !== "failed") continue; // sent (terminal) / pending / skipped_no_email untouched
    const ok = await transitionEmail(row.id, "pending");
    if (ok) requeued += 1;
  }
  if (requeued === 0) {
    // Nothing was in a resendable state — a clean no-op (not an error: the caller
    // may click "Resend" after a prior resend already succeeded).
    return { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  }

  // The frozen snapshot governs a completed run (never recomputed) — the same
  // render source as the completion-time send (period + per-employee sheets).
  // Re-run the isolated per-employee send over the (now-pending) rows.
  const snapshot = RunSnapshotSchema.parse(runRow.snapshot);
  return renderAndSendPaySummaries(shopId, snapshot);
}

// ── Missing-personal-email detection (the #53.3 skip list) ─────────────────────

export interface MissingEmailEmployee {
  employeeId: string;
  displayName: string;
}

/**
 * The roster employees with NO personal_email — the completion dialog's skip list
 * (#53.3). Pure over the employee master rows (no I/O). A blank/whitespace email
 * counts as missing. The completion transaction pre-inserts skipped_no_email rows
 * for exactly these; this list drives the dialog's "Skip emails & mark complete"
 * relabel + the completion result.
 */
export function detectMissingPersonalEmails(
  employees: readonly Pick<PayrollEmployee, "id" | "displayName" | "personalEmail">[],
): MissingEmailEmployee[] {
  const out: MissingEmailEmployee[] = [];
  for (const e of employees) {
    if (e.personalEmail === null || e.personalEmail.trim().length === 0) {
      out.push({ employeeId: e.id, displayName: e.displayName });
    }
  }
  return out;
}

// ── Negative-balance alerts (plan §4 — employee personal email + admin list) ───

/** One employee whose PTO balance is negative after completion (advisory alert). */
export interface NegativeBalanceEmployee {
  employeeId: string;
  displayName: string;
  personalEmail: string | null;
  balanceHours: number;
}

export interface NegativeAlertResult {
  employeeEmailsSent: number;
  adminAlertSent: boolean;
}

function fmtHrs(hours: number): string {
  return `${hours} hrs`;
}

/**
 * Send the negative-balance alerts (plan §4 + N4): one alert per affected employee
 * to their personal email (a pto_negative log row), plus ONE roll-up to the admin
 * list. SEQUENTIAL (shared Resend limit — rides the same queue as the pay
 * summaries). Employees with no personal email are skipped for the personal alert
 * (they still appear in the admin roll-up). NEVER throws into the caller.
 *
 * `alertSuppressed` (per employee) lets the caller enforce "no spam off unseeded
 * balances" (plan §3 — negatives suppressed until ≥ 1 ledger row); the caller
 * passes only genuinely-negative, ledgered employees.
 */
export async function sendNegativeBalanceAlerts(
  shopId: number,
  runId: string,
  period: PaySummaryPeriod,
  employees: readonly NegativeBalanceEmployee[],
  adminEmails: readonly string[],
): Promise<NegativeAlertResult> {
  const result: NegativeAlertResult = { employeeEmailsSent: 0, adminAlertSent: false };
  if (employees.length === 0) return result;

  const periodLabel = `${period.periodStart} to ${period.periodEnd}`;

  // Per-employee personal alerts (sequential).
  for (const e of employees) {
    const to = e.personalEmail?.trim();
    if (!to) continue; // no personal email → covered by the admin roll-up only
    const subject = `Your PTO balance is negative — ${periodLabel}`;
    const text = [
      `Hi ${e.displayName},`,
      "",
      `After the payroll run for ${periodLabel}, your PTO balance is ${fmtHrs(e.balanceHours)}.`,
      "A negative balance means more PTO was used than accrued. Please reach out to the office with any questions.",
    ].join("\n");
    const ok = await sendQteklinkEmail({ to: [to], subject, text });
    await logNonSummaryEmail(shopId, {
      kind: "pto_negative",
      recipient: to,
      subject,
      status: ok ? "sent" : "failed",
      runId,
      employeeId: e.employeeId,
      detail: ok ? null : "edge function reported a non-2xx or unconfigured transport",
    });
    if (ok) result.employeeEmailsSent += 1;
  }

  // One admin roll-up (§2d pto_negative_alert_admin_emails). Legitimate empty list
  // ⇒ NEVER call sendQteklinkEmail (N11) and NEVER log a row — nothing to audit.
  const admins = adminEmails.map((a) => a.trim()).filter((a) => a.length > 0);
  if (admins.length > 0) {
    const subject = `PTO negative-balance alert — ${periodLabel}`;
    const text = [
      `Payroll run for ${periodLabel} left ${employees.length} employee(s) with a negative PTO balance:`,
      "",
      ...employees.map((e) => `- ${e.displayName}: ${fmtHrs(e.balanceHours)}`),
    ].join("\n");
    const ok = await sendQteklinkEmail({ to: admins, subject, text });
    await logNonSummaryEmail(shopId, {
      kind: "pto_negative",
      recipient: admins.join(", "),
      subject,
      status: ok ? "sent" : "failed",
      runId,
      employeeId: null,
      detail: ok ? null : "edge function reported a non-2xx or unconfigured transport",
    });
    result.adminAlertSent = ok;
  }
  return result;
}

/** Insert a pto_adjustment / pto_negative email-log row (the two NON-completion
 *  kinds; log_email REFUSES pay_summary). NEVER throws into the caller — a logging
 *  failure on a post-commit alert must not surface as a failed action. */
async function logNonSummaryEmail(
  shopId: number,
  input: {
    kind: "pto_adjustment" | "pto_negative";
    recipient: string;
    subject: string;
    status: "sent" | "failed";
    runId: string | null;
    employeeId: string | null;
    detail: string | null;
  },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_payroll_log_email", {
    p_shop: shopId,
    p_kind: input.kind,
    p_recipient: input.recipient,
    p_subject: input.subject,
    p_status: input.status,
    p_run: input.runId,
    p_employee: input.employeeId,
    p_detail: input.detail,
  });
  if (error) {
    Sentry.captureMessage(
      `qteklink-payroll-email-log: failed to log ${input.kind} row (${error.message})`,
      "warning",
    );
  }
}
