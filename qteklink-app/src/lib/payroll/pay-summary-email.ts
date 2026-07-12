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
import type { SummaryRow } from "./types";

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
