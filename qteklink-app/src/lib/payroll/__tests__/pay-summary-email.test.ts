/**
 * pay-summary-email.ts tests — the plan §5.6 regression locks (docs/qteklink/
 * payroll-pto-employee-mgmt-plan-2026-07-12.md; decision #53): an injected
 * payload/recipient mismatch THROWS (render-time AND send-time binder), two
 * employees rendered side by side show zero cross-contamination, the payload
 * ALWAYS carries non-empty text (and html — §5.7), the subject/header lead with
 * the employee's full name + period (§5.5), the n/a semantics mirror the run
 * summary (null categories omitted, never $0.00), and the HTML is self-contained
 * (no external assets) with escaped interpolations.
 *
 * Sheets come from the REAL computeSheet engine (the summary.test.ts idiom) so
 * the rendered numbers are proven against the actual snapshot shape.
 */
import { describe, expect, it } from "vitest";

import { fmtUsd } from "@/lib/format";
import { computeSheet } from "../calc";
import {
  assertBinding,
  renderPaySummaryEmail,
  type PaySummaryEmployee,
  type PaySummaryPeriod,
  type PaySummaryRecipient,
} from "../pay-summary-email";

// ── Fixtures (real engine output) ──────────────────────────────────────────────

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PERIOD: PaySummaryPeriod = { periodStart: "2026-06-28", periodEnd: "2026-07-11" };

const techSheet = computeSheet(
  "technician",
  {
    config_version: 1,
    pto_balance_hours: 0,
    pto_accrual_hours_per_period: 0,
    hourly_rate_cents: 2500, // $25
    billed_rate_cents: 1200, // $12
  },
  { clock_hours_w1: 45, clock_hours_w2: 40, pto_w1: 4 },
  { billed_hours_w1: 50, billed_hours_w2: 42 },
);

const supportSheet = computeSheet(
  "support",
  { config_version: 1, pto_balance_hours: 0, pto_accrual_hours_per_period: 0, hourly_rate_cents: 1600 },
  { clock_hours_w1: 20, clock_hours_w2: 20 },
  {},
);

const saSheet = computeSheet(
  "service_advisor",
  {
    config_version: 1,
    pto_balance_hours: 0,
    pto_accrual_hours_per_period: 0,
    weekly_salary_cents: 115_384,
    gp_goal_1_cents: 11_500_000,
    gp_goal_2_cents: 12_500_000,
    sales_goal_cents: 25_769_874,
    tier1_pct: 0.005,
    tier2_pct: 0.01,
    tier3_pct: 0.02,
    spiff_amount_cents: 500,
  },
  { clock_hours_w1: 40, clock_hours_w2: 40, holiday_w2: 8 },
  {
    month_sales_cents: 26_149_112,
    month_gp_with_fees_cents: 16_683_522,
    month_gp_without_fees_cents: 15_462_854,
    spiff_count: 39,
  },
);

const TECH: PaySummaryEmployee = {
  employee_id: uuid(1),
  display_name: "Zeta Tech",
  role: "technician",
  family: "technician",
  sheet: techSheet,
};

const SUPPORT: PaySummaryEmployee = {
  employee_id: uuid(2),
  display_name: "Alma Support",
  role: "shop_support",
  family: "support",
  sheet: supportSheet,
};

const ADVISOR: PaySummaryEmployee = {
  employee_id: uuid(3),
  display_name: "Mia Advisor",
  role: "service_manager",
  family: "service_advisor",
  sheet: saSheet,
};

function recipientFor(e: PaySummaryEmployee, email = "person@example.com"): PaySummaryRecipient {
  return { employeeId: e.employee_id, email, displayName: e.display_name };
}

// ── §5.3 binding — fail closed, loud ───────────────────────────────────────────

describe("binding (plan §5.2/§5.3)", () => {
  it("render REFUSES a recipient bound to a different employee (throws before building content)", () => {
    const wrongRecipient = recipientFor(SUPPORT); // Alma's recipient row against Zeta's payload
    expect(() => renderPaySummaryEmail(TECH, wrongRecipient, PERIOD)).toThrow(/binding violation/);
  });

  it("assertBinding throws on mismatch with BOTH ids in the message; passes on match", () => {
    expect(() => assertBinding({ employeeId: uuid(1) }, { employeeId: uuid(2) })).toThrow(
      new RegExp(`${uuid(1)}.*${uuid(2)}`),
    );
    expect(() => assertBinding({ employeeId: uuid(1) }, { employeeId: uuid(1) })).not.toThrow();
  });

  it("the payload carries the employee_id end-to-end and re-verifies at send time", () => {
    const payload = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    expect(payload.employeeId).toBe(TECH.employee_id);
    expect(() => assertBinding(payload, recipientFor(TECH))).not.toThrow();
    expect(() => assertBinding(payload, recipientFor(SUPPORT))).toThrow(/send refused/);
  });
});

// ── §5.1 isolation — zero cross-contamination ──────────────────────────────────

describe("isolation (plan §5.1)", () => {
  it("two employees rendered side by side never leak each other's name or money", () => {
    const a = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    const b = renderPaySummaryEmail(SUPPORT, recipientFor(SUPPORT), PERIOD);
    const aTotal = fmtUsd(techSheet.total_pay_cents);
    const bTotal = fmtUsd(supportSheet.total_pay_cents);
    for (const doc of [a.subject, a.text, a.html]) {
      expect(doc).toContain("Zeta Tech");
      expect(doc).not.toContain("Alma Support");
      expect(doc).not.toContain(bTotal);
    }
    for (const doc of [b.subject, b.text, b.html]) {
      expect(doc).toContain("Alma Support");
      expect(doc).not.toContain("Zeta Tech");
      expect(doc).not.toContain(aTotal);
    }
    expect(a.text).toContain(aTotal);
    expect(b.text).toContain(bTotal);
  });

  it("content comes from the EMPLOYEE row only — a divergent recipient displayName never renders", () => {
    const payload = renderPaySummaryEmail(
      TECH,
      { employeeId: TECH.employee_id, email: "z@example.com", displayName: "WRONG NAME" },
      PERIOD,
    );
    for (const doc of [payload.subject, payload.text, payload.html]) {
      expect(doc).toContain("Zeta Tech");
      expect(doc).not.toContain("WRONG NAME");
    }
  });
});

// ── §5.5 subject/header + §5.7 non-empty text/html ─────────────────────────────

describe("subject, header, and the always-non-empty contract (plan §5.5/§5.7)", () => {
  it('subject leads with full name + period: "Pay summary for Zeta Tech — Jun 28 – Jul 11"', () => {
    const payload = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    expect(payload.subject).toBe("Pay summary for Zeta Tech — Jun 28 – Jul 11");
  });

  it("the body header restates name + period with the year", () => {
    const payload = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    expect(payload.text).toContain("Pay summary for Zeta Tech");
    expect(payload.text).toContain("Pay period Jun 28 – Jul 11, 2026");
    expect(payload.html).toContain("Pay period Jun 28 – Jul 11, 2026");
  });

  it("a Dec/Jan straddle period carries both years", () => {
    const payload = renderPaySummaryEmail(TECH, recipientFor(TECH), {
      periodStart: "2026-12-27",
      periodEnd: "2027-01-09",
    });
    expect(payload.subject).toBe("Pay summary for Zeta Tech — Dec 27, 2026 – Jan 9, 2027");
    expect(payload.text).toContain("Dec 27, 2026 – Jan 9, 2027");
  });

  it("text AND html are non-empty even for an all-zero sheet (the edge fn requires text)", () => {
    const zeroSheet = computeSheet(
      "support",
      { config_version: 1, pto_balance_hours: 0, pto_accrual_hours_per_period: 0, hourly_rate_cents: 1600 },
      {},
      {},
    );
    const zero: PaySummaryEmployee = {
      employee_id: uuid(9),
      display_name: "New Hire",
      role: "office_support",
      family: "support",
      sheet: zeroSheet,
    };
    const payload = renderPaySummaryEmail(zero, recipientFor(zero), PERIOD);
    expect(payload.text.trim().length).toBeGreaterThan(0);
    expect(payload.html.trim().length).toBeGreaterThan(0);
    expect(payload.text).toContain("Total pay: $0.00");
  });
});

// ── Content: n/a semantics mirror the run summary ──────────────────────────────

describe("content lines (run-summary n/a parity)", () => {
  it("technician: billed line present; total matches the sheet", () => {
    const { text } = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    expect(text).toContain("Regular: 80 hrs — $2,000.00");
    expect(text).toContain("Overtime: 5 hrs — $187.50");
    expect(text).toContain("Billed: 92 hrs — $1,104.00");
    expect(text).toContain("PTO: 4 hrs — $100.00");
    expect(text).toContain(`Total pay: ${fmtUsd(techSheet.total_pay_cents)}`);
  });

  it('support with NO manual incentive: no "Incentive" line (null is omitted, never $0.00)', () => {
    const { text } = renderPaySummaryEmail(SUPPORT, recipientFor(SUPPORT), PERIOD);
    expect(text).not.toContain("Incentive");
    expect(text).not.toContain("Billed");
    expect(text).toContain(`Total pay: ${fmtUsd(supportSheet.total_pay_cents)}`);
  });

  it("salaried advisor: leave hours render WITHOUT pay (hours-only line); bonus + spiffs surface", () => {
    const { text } = renderPaySummaryEmail(ADVISOR, recipientFor(ADVISOR), PERIOD);
    expect(text).toContain("Holiday: 8 hrs");
    expect(text).not.toContain("Holiday: 8 hrs —"); // pay is null for salaried — no amount
    expect(text).toContain(`Bonus: ${fmtUsd(saSheet.bonus_cents ?? 0)}`);
    expect(text).toContain(`Spiffs: ${fmtUsd(saSheet.spiff_cents ?? 0)}`);
  });

  it("zero-hour leave categories are omitted entirely", () => {
    const { text } = renderPaySummaryEmail(SUPPORT, recipientFor(SUPPORT), PERIOD);
    expect(text).not.toContain("Bereavement");
    expect(text).not.toContain("Training");
    expect(text).not.toContain("Holiday");
  });
});

// ── HTML safety: self-contained + escaped ──────────────────────────────────────

describe("html document", () => {
  it("is self-contained: no external assets, images, or links", () => {
    const { html } = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("http");
    expect(html).not.toContain("href=");
  });

  it("escapes interpolated employee data", () => {
    const spicy: PaySummaryEmployee = { ...TECH, display_name: `Bob & "Ann" <O'Neil>` };
    const { html, text } = renderPaySummaryEmail(spicy, recipientFor(spicy), PERIOD);
    expect(html).toContain("Bob &amp; &quot;Ann&quot; &lt;O&#39;Neil&gt;");
    expect(html).not.toContain("<O'Neil>");
    expect(text).toContain(`Bob & "Ann" <O'Neil>`); // text stays literal
  });

  it("uses the burgundy header rule and system fonts only", () => {
    const { html } = renderPaySummaryEmail(TECH, recipientFor(TECH), PERIOD);
    expect(html).toContain("background:#96003C");
    expect(html).toContain("-apple-system");
  });
});
