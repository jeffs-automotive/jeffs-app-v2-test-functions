/**
 * Pay-summary email renderer + binder — PURE, no I/O, NO sending (plan §5.1–5.3/
 * 5.5/5.7 of docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md;
 * decision #53 — Chris: wrong-recipient protection is "super important").
 *
 * The safety design this module owns:
 *   - §5.1 one employee → one ISOLATED render: input is (one snapshot employee,
 *     one recipient) — no batch templating, no shared render context. Content is
 *     built EXCLUSIVELY from the employee row (recipient.displayName is never
 *     interpolated — it exists so the send layer can log who was addressed).
 *   - §5.2 single-source binding: the employee_id travels inside the payload
 *     end-to-end (`payload.employeeId`).
 *   - §5.3 the render REFUSES a recipient whose employeeId differs from the
 *     payload's (throws — fail closed, loud); {@link assertBinding} re-checks the
 *     same invariant at send time.
 *   - §5.5 human-verifiable content: subject + header lead with the employee's
 *     full name and the period ("Pay summary for Matt Clark — Jun 28 – Jul 11").
 *   - §5.7 BOTH text and html are ALWAYS non-empty — the qteklink-email edge fn
 *     keeps `text` required; `html` is the additive optional field.
 *
 * Design (approved spec direction): austere single-column email-client-safe
 * HTML — presentation tables + inline styles, system fonts, no external assets,
 * burgundy #96003C only as a header rule. Numbers reuse the run-summary row
 * mapping (buildRunSummary) so the email's n/a semantics match the app: null
 * categories are OMITTED, never rendered as $0.00.
 */
import { fmtUsd } from "@/lib/format";
import { buildRunSummary, type EmployeeSheet } from "./summary";
import type { RunTotals, SummaryRow } from "./types";

// ── Contract shapes (plan §5) ──────────────────────────────────────────────────

/** The employee row a summary is rendered FROM — structurally satisfied by a
 *  RunSnapshot employee (SnapshotEmployee ⊇ EmployeeSheet). */
export type PaySummaryEmployee = EmployeeSheet;

/** The recipient row the send layer resolved for the SAME employee_id. */
export interface PaySummaryRecipient {
  employeeId: string;
  email: string;
  displayName: string;
}

export interface PaySummaryPeriod {
  /** ISO dates (run period_start / period_end). */
  periodStart: string;
  periodEnd: string;
}

/** The rendered message. `employeeId` is the §5.2 binding — it must match the
 *  recipient row at send time ({@link assertBinding}) or the send is refused. */
export interface PaySummaryPayload {
  employeeId: string;
  subject: string;
  text: string;
  html: string;
}

// ── The §5.3 binder ────────────────────────────────────────────────────────────

/**
 * The send-time invariant check (plan §5.3): payload-embedded employee_id vs
 * recipient-row employee_id — a mismatch THROWS (send refused; the caller
 * captures to Sentry with both ids). Never sends, never logs — pure guard.
 */
export function assertBinding(
  payload: Pick<PaySummaryPayload, "employeeId">,
  recipient: Pick<PaySummaryRecipient, "employeeId">,
): void {
  if (payload.employeeId !== recipient.employeeId) {
    throw new Error(
      `pay-summary binding violation: payload employee ${payload.employeeId} != recipient employee ${recipient.employeeId} — send refused`,
    );
  }
}

// ── Formatting helpers (pure, deterministic — no Intl/locale dependence) ───────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function fmtDay(iso: string, withYear: boolean): string {
  const d = new Date(Date.parse(`${iso}T00:00:00Z`));
  const base = `${MONTHS[d.getUTCMonth()] ?? "?"} ${d.getUTCDate()}`;
  return withYear ? `${base}, ${d.getUTCFullYear()}` : base;
}

/** "Jun 28 – Jul 11" (subject) / "Jun 28 – Jul 11, 2026" (body); a cross-year
 *  period carries both years everywhere ("Dec 27, 2026 – Jan 9, 2027"). */
function fmtPeriodRange(period: PaySummaryPeriod, style: "subject" | "body"): string {
  const sameYear = period.periodStart.slice(0, 4) === period.periodEnd.slice(0, 4);
  if (!sameYear) return `${fmtDay(period.periodStart, true)} – ${fmtDay(period.periodEnd, true)}`;
  const range = `${fmtDay(period.periodStart, false)} – ${fmtDay(period.periodEnd, false)}`;
  return style === "body" ? `${range}, ${period.periodEnd.slice(0, 4)}` : range;
}

function fmtHrs(hours: number): string {
  return `${hours} hrs`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// ── Content lines (mirrors the run-summary table's n/a semantics) ──────────────

interface SummaryLine {
  label: string;
  hours: number | null;
  amountCents: number | null;
}

/** Reg/OT always; billed + incentive/bonus/spiffs when the row carries them
 *  (family-dependent); leave categories only when hours were paid. */
function buildLines(row: SummaryRow): SummaryLine[] {
  const lines: SummaryLine[] = [
    { label: "Regular", hours: row.reg_hours, amountCents: row.reg_pay_cents },
    { label: "Overtime", hours: row.ot_hours, amountCents: row.ot_pay_cents },
  ];
  if (row.billed_hours !== null || row.billed_pay_cents !== null) {
    lines.push({ label: "Billed", hours: row.billed_hours, amountCents: row.billed_pay_cents });
  }
  if (row.bonus_cents !== null) lines.push({ label: "Bonus", hours: null, amountCents: row.bonus_cents });
  if (row.spiff_cents !== null) lines.push({ label: "Spiffs", hours: null, amountCents: row.spiff_cents });
  if (row.incentive_cents !== null) {
    lines.push({ label: "Incentive", hours: null, amountCents: row.incentive_cents });
  }
  const leave: Array<[string, number, number | null]> = [
    ["PTO", row.pto_hours, row.pto_pay_cents],
    ["Holiday", row.holiday_hours, row.holiday_pay_cents],
    ["Bereavement", row.bereavement_hours, row.bereavement_pay_cents],
    ["Training", row.training_hours, row.training_pay_cents],
  ];
  for (const [label, hours, payCents] of leave) {
    if (hours > 0) lines.push({ label, hours, amountCents: payCents });
  }
  return lines;
}

function lineText(line: SummaryLine): string {
  const parts: string[] = [];
  if (line.hours !== null) parts.push(fmtHrs(line.hours));
  if (line.amountCents !== null) parts.push(fmtUsd(line.amountCents));
  return `${line.label}: ${parts.join(" — ")}`;
}

// ── Renderers ──────────────────────────────────────────────────────────────────

function renderText(name: string, periodLine: string, lines: SummaryLine[], totalCents: number): string {
  return [
    `Pay summary for ${name}`,
    `Pay period ${periodLine}`,
    "",
    ...lines.map(lineText),
    "",
    `Total pay: ${fmtUsd(totalCents)}`,
  ].join("\n");
}

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const CELL = `font-family:${FONT};font-size:14px;line-height:20px;color:#26211b;padding:6px 0;`;

function renderHtml(name: string, periodLine: string, lines: SummaryLine[], totalCents: number): string {
  const safeName = escapeHtml(name);
  const rows = lines
    .map(
      (line) =>
        `<tr>` +
        `<td style="${CELL}">${escapeHtml(line.label)}</td>` +
        `<td align="right" style="${CELL}color:#6b6257;white-space:nowrap;">${line.hours === null ? "" : escapeHtml(fmtHrs(line.hours))}</td>` +
        `<td align="right" style="${CELL}white-space:nowrap;">${line.amountCents === null ? "" : escapeHtml(fmtUsd(line.amountCents))}</td>` +
        `</tr>`,
    )
    .join("");
  const totalRow =
    `<tr>` +
    `<td style="${CELL}border-top:1px solid #d8d2c9;font-weight:700;padding-top:12px;">Total pay</td>` +
    `<td style="${CELL}border-top:1px solid #d8d2c9;padding-top:12px;"></td>` +
    `<td align="right" style="${CELL}border-top:1px solid #d8d2c9;font-weight:700;padding-top:12px;white-space:nowrap;">${escapeHtml(fmtUsd(totalCents))}</td>` +
    `</tr>`;
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay summary for ${safeName}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f2ee;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3ded6;">` +
    `<tr><td style="padding:28px 32px 0;">` +
    `<div style="font-family:${FONT};font-size:20px;line-height:26px;font-weight:700;color:#26211b;">Pay summary for ${safeName}</div>` +
    `<div style="font-family:${FONT};font-size:14px;line-height:20px;color:#6b6257;padding-top:4px;">Pay period ${escapeHtml(periodLine)}</div>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 32px 0;"><div style="height:3px;background:#96003C;font-size:0;line-height:0;">&nbsp;</div></td></tr>` +
    `<tr><td style="padding:16px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${totalRow}</table></td></tr>` +
    `<tr><td style="padding:8px 32px 28px;">` +
    `<div style="font-family:${FONT};font-size:12px;line-height:18px;color:#8a8177;">This is your individual pay summary for the period shown above. Questions? Reply to this email.</div>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/**
 * Render ONE employee's pay-summary email (plan §5). Pure: (snapshot employee,
 * recipient, run period) in → `{ employeeId, subject, text, html }` out, text
 * AND html always non-empty. THROWS (fail closed) when the recipient's
 * employeeId does not match the employee row — the §5.3 invariant, enforced at
 * render time as well as send time.
 */
export function renderPaySummaryEmail(
  employee: PaySummaryEmployee,
  recipient: PaySummaryRecipient,
  period: PaySummaryPeriod,
): PaySummaryPayload {
  // §5.2/§5.3: refuse a cross-wired recipient BEFORE any content is built.
  assertBinding({ employeeId: employee.employee_id }, recipient);
  const row = buildRunSummary([employee]).rows[0];
  if (row === undefined) {
    // Structurally unreachable (buildRunSummary maps 1:1) — fail closed, loud.
    throw new Error(`pay-summary render: no summary row for employee ${employee.employee_id}`);
  }
  const lines = buildLines(row);
  const name = employee.display_name;
  return {
    employeeId: employee.employee_id,
    subject: `Pay summary for ${name} — ${fmtPeriodRange(period, "subject")}`,
    text: renderText(name, fmtPeriodRange(period, "body"), lines, row.total_pay_cents),
    html: renderHtml(name, fmtPeriodRange(period, "body"), lines, row.total_pay_cents),
  };
}

// ── Run-level summary email (the "completed" alert, Chris 2026-07-12) ────────────
// The completed-run alert to the settings `completed` list carries the WHOLE run's
// summary — the two blocks from the Summary page (the per-employee table + the
// Run totals card), styled like the individual pay summaries. It is a RUN-LEVEL
// admin summary (every employee in one message to the admin list) — distinct from
// the per-employee pay summaries, so no §5 per-recipient binding applies here.

/** Number → a compact hours string ("80", "55.05"). */
function h(n: number): string {
  return String(n);
}
const DASH = "—";
function moneyOrDash(cents: number | null): string {
  return cents === null ? DASH : fmtUsd(cents);
}
function hoursOrDash(n: number | null): string {
  return n === null ? DASH : h(n);
}

export interface RunSummaryEmailInput {
  period: PaySummaryPeriod;
  /** snapshot.summary — one row per employee (already sorted by the DAL). */
  rows: SummaryRow[];
  /** snapshot.summary_totals — the Run totals card block (null on old snapshots). */
  totals: RunTotals | null;
  /** Completion metadata lines (completed by/at, bonus, "locked read-only"). */
  metaLines: string[];
  shopId?: number;
}

/** A short role label for the email (no client ROLE_LABEL import — pure lib). */
function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function runText(input: RunSummaryEmailInput): string {
  const periodLine = fmtPeriodRange(input.period, "body");
  const out: string[] = [`Payroll summary — pay period ${periodLine}`, ""];
  for (const r of input.rows) {
    const bits = [
      `Reg ${h(r.reg_hours)}h`,
      r.ot_hours > 0 ? `OT ${h(r.ot_hours)}h` : null,
      r.incentive_cents !== null ? `Incentive ${fmtUsd(r.incentive_cents)}` : null,
    ].filter((b): b is string => b !== null);
    out.push(`${r.display_name} (${roleLabel(r.role)}) — Total ${fmtUsd(r.total_pay_cents)}  [${bits.join(", ")}]`);
  }
  const t = input.totals;
  if (t) {
    out.push("", "Run totals:", `  Total pay: ${fmtUsd(t.total_pay_cents)}`);
    out.push(`  Regular pay: ${fmtUsd(t.reg_pay_cents)}   Overtime pay: ${fmtUsd(t.ot_pay_cents)}   Incentive: ${moneyOrDash(t.incentive_pay_cents)}`);
    out.push(`  Regular hrs: ${h(t.reg_hours)}   OT hrs: ${h(t.ot_hours)}   Billed hrs: ${hoursOrDash(t.billed_hours)}`);
    out.push(`  Cost per clock hour: ${t.cost_per_clock_hour_cents === null ? DASH : `${fmtUsd(t.cost_per_clock_hour_cents)}/hr`}   Cost per billed hour: ${t.cost_per_billed_hour_cents === null ? DASH : `${fmtUsd(t.cost_per_billed_hour_cents)}/hr`}`);
  }
  if (input.metaLines.length > 0) out.push("", ...input.metaLines);
  return out.join("\n");
}

const TH = `font-family:${FONT};font-size:11px;line-height:14px;color:#8a8177;text-transform:uppercase;letter-spacing:0.03em;padding:6px 8px;text-align:right;`;
const TD = `font-family:${FONT};font-size:13px;line-height:18px;color:#26211b;padding:6px 8px;text-align:right;white-space:nowrap;`;

function runTableHtml(rows: SummaryRow[]): string {
  const head =
    `<tr>` +
    `<th style="${TH}text-align:left;">Employee</th>` +
    `<th style="${TH}">Reg hrs</th><th style="${TH}">OT hrs</th><th style="${TH}">Incentive</th>` +
    `<th style="${TH}">PTO</th><th style="${TH}">Training</th><th style="${TH}">Holiday</th>` +
    `<th style="${TH}">Bereave.</th><th style="${TH}">Total</th>` +
    `</tr>`;
  const leaveCell = (hours: number, payCents: number | null): string => {
    const top = hours === 0 ? DASH : h(hours);
    const bottom = payCents === null ? DASH : fmtUsd(payCents);
    return `<td style="${TD}"><div>${escapeHtml(top)}</div><div style="color:#8a8177;font-size:11px;">${escapeHtml(bottom)}</div></td>`;
  };
  const body = rows
    .map(
      (r) =>
        `<tr style="border-top:1px solid #eee7dd;">` +
        `<td style="${TD}text-align:left;white-space:normal;"><span style="font-weight:600;">${escapeHtml(r.display_name)}</span> <span style="color:#8a8177;font-size:11px;">${escapeHtml(roleLabel(r.role))}</span></td>` +
        `<td style="${TD}">${escapeHtml(h(r.reg_hours))}</td>` +
        `<td style="${TD}">${r.ot_hours === 0 ? DASH : escapeHtml(h(r.ot_hours))}</td>` +
        `<td style="${TD}">${r.incentive_cents === null ? DASH : escapeHtml(fmtUsd(r.incentive_cents))}</td>` +
        leaveCell(r.pto_hours, r.pto_pay_cents) +
        leaveCell(r.training_hours, r.training_pay_cents) +
        leaveCell(r.holiday_hours, r.holiday_pay_cents) +
        leaveCell(r.bereavement_hours, r.bereavement_pay_cents) +
        `<td style="${TD}font-weight:700;">${escapeHtml(fmtUsd(r.total_pay_cents))}</td>` +
        `</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${head}${body}</table>`;
}

function totalsGroupHtml(title: string, items: Array<[string, string]>): string {
  const cells = items
    .map(
      ([label, value]) =>
        `<td style="font-family:${FONT};padding:6px 10px 6px 0;vertical-align:top;">` +
        `<div style="font-size:11px;color:#8a8177;">${escapeHtml(label)}</div>` +
        `<div style="font-size:14px;font-weight:600;color:#26211b;white-space:nowrap;">${escapeHtml(value)}</div>` +
        `</td>`,
    )
    .join("");
  return (
    `<div style="font-family:${FONT};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#8a8177;padding:12px 0 2px;">${escapeHtml(title)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`
  );
}

function runTotalsHtml(t: RunTotals): string {
  const pay = totalsGroupHtml("Pay", [
    ["Total pay", fmtUsd(t.total_pay_cents)],
    ["Regular pay", fmtUsd(t.reg_pay_cents)],
    ["Overtime pay", fmtUsd(t.ot_pay_cents)],
    ["Incentive", moneyOrDash(t.incentive_pay_cents)],
    ["PTO pay", moneyOrDash(t.pto_pay_cents)],
    ["Holiday pay", moneyOrDash(t.holiday_pay_cents)],
    ["Bereavement pay", moneyOrDash(t.bereavement_pay_cents)],
    ["Training pay", moneyOrDash(t.training_pay_cents)],
  ]);
  const hours = totalsGroupHtml("Hours", [
    ["Regular", h(t.reg_hours)],
    ["Overtime", h(t.ot_hours)],
    ["PTO", h(t.pto_hours)],
    ["Holiday", h(t.holiday_hours)],
    ["Bereavement", h(t.bereavement_hours)],
    ["Training", h(t.training_hours)],
    ["Billed", hoursOrDash(t.billed_hours)],
  ]);
  const metrics = totalsGroupHtml("Metrics", [
    ["Cost per clock hour", t.cost_per_clock_hour_cents === null ? DASH : `${fmtUsd(t.cost_per_clock_hour_cents)}/hr`],
    ["Cost per billed hour", t.cost_per_billed_hour_cents === null ? DASH : `${fmtUsd(t.cost_per_billed_hour_cents)}/hr`],
  ]);
  return pay + hours + metrics;
}

function runHtml(input: RunSummaryEmailInput): string {
  const periodLine = fmtPeriodRange(input.period, "body");
  const table = input.rows.length > 0
    ? runTableHtml(input.rows)
    : `<div style="font-family:${FONT};font-size:14px;color:#6b6257;">No employees on this run.</div>`;
  const totals = input.totals ? runTotalsHtml(input.totals) : "";
  const meta = input.metaLines.length > 0
    ? `<tr><td style="padding:4px 32px 24px;"><div style="font-family:${FONT};font-size:12px;line-height:18px;color:#8a8177;">${input.metaLines.map((l) => escapeHtml(l)).join("<br>")}</div></td></tr>`
    : "";
  return (
    `<!DOCTYPE html>` +
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payroll summary</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f2ee;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border:1px solid #e3ded6;">` +
    `<tr><td style="padding:28px 32px 0;">` +
    `<div style="font-family:${FONT};font-size:20px;line-height:26px;font-weight:700;color:#26211b;">Payroll summary</div>` +
    `<div style="font-family:${FONT};font-size:14px;line-height:20px;color:#6b6257;padding-top:4px;">Pay period ${escapeHtml(periodLine)}</div>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 32px 0;"><div style="height:3px;background:#96003C;font-size:0;line-height:0;">&nbsp;</div></td></tr>` +
    // Card 1 — the per-employee summary table.
    `<tr><td style="padding:16px 20px 4px;">${table}</td></tr>` +
    // Card 2 — the Run totals card.
    (totals
      ? `<tr><td style="padding:8px 32px 8px;"><div style="border-top:1px solid #e3ded6;padding-top:8px;"><div style="font-family:${FONT};font-size:15px;font-weight:700;color:#26211b;">Run totals</div>${totals}</div></td></tr>`
      : "") +
    meta +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/**
 * Render the run-level "completed" summary email (Chris 2026-07-12): the Summary
 * page's two blocks — the per-employee table + the Run totals card — in the
 * individual pay-summary style, for the settings `completed` alert list. Pure;
 * returns text (fallback) + html, both non-empty.
 */
export function renderRunSummaryEmail(input: RunSummaryEmailInput): { text: string; html: string } {
  return { text: runText(input), html: runHtml(input) };
}
