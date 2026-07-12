/**
 * Dry-run diff builder (round-7 decision #42) — the PURE before→after comparison
 * of two live RunSnapshots. The dry-run DAL (src/lib/dal/payroll-dry-run.ts)
 * captures the run's live snapshot, re-ingests the period from Tekmetric,
 * recomputes fresh, and hands both snapshots here; the modal renders the result.
 *
 * Contract (the decision text): per-employee billed hours w1/w2 (old → new),
 * month derivations (sales, fees, parts, GP with/without fees, QBO tech cost,
 * shop hours, spiff counts), and per-employee total-pay deltas — ONLY fields
 * that actually CHANGED, plus the before/after as-of stamps.
 *
 * Comparison semantics: the EFFECTIVE derived inputs are compared, so an
 * overridden value diffs as unchanged (the override beats both sides — pay
 * genuinely didn't move). null-vs-number counts as a change; null-vs-null does
 * not. No business math here — pure projection of the snapshots' numbers.
 *
 * Typed against a STRUCTURAL view (DryRunSnapshotView) that RunSnapshot
 * satisfies, so the unit tests can feed small synthetic snapshots without
 * assembling full SheetComputations.
 */

export type DryRunDiffKind = "hours" | "cents" | "count";

/** One changed number: `key` is stable/machine, `label` is what the modal prints. */
export interface DryRunDiffField {
  key: string;
  label: string;
  kind: DryRunDiffKind;
  before: number | null;
  after: number | null;
}

/** One employee's changed billed-hours fields (w1/w2 — only the changed weeks). */
export interface DryRunEmployeeHours {
  employeeId: string;
  displayName: string;
  fields: DryRunDiffField[];
}

export interface PayrollDryRunDiff {
  /** Per-technician/foreman billed hours (effective — overrides already applied). */
  techHours: DryRunEmployeeHours[];
  /** Month derivations + per-SA spiff counts (bonus runs; empty otherwise). */
  month: DryRunDiffField[];
  /** Per-employee total pay (key = employee_id, label = display name). */
  payTotals: DryRunDiffField[];
  beforeAsOf: string;
  afterAsOf: string;
  /** False = "Everything is up to date — no differences." */
  changed: boolean;
}

/** What the dry-run DAL returns to the action/UI. */
export interface PayrollDryRunResult {
  diff: PayrollDryRunDiff;
  /** ROs the live Tekmetric re-fetch touched (period + updated-since + bonus passes). */
  rosChecked: number;
}

// ── The structural snapshot view the builder needs (RunSnapshot satisfies it) ──

export interface DryRunSnapshotView {
  employees: ReadonlyArray<{
    employee_id: string;
    display_name: string;
    family: string;
    derived: {
      billed_hours_w1?: number | null;
      billed_hours_w2?: number | null;
      spiff_count?: number | null;
    };
  }>;
  summary: ReadonlyArray<{
    employee_id: string;
    display_name: string;
    total_pay_cents: number;
  }>;
  derived_provenance: { as_of: string } & Record<string, unknown>;
}

// ── Internals ──────────────────────────────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function changedField(
  key: string,
  label: string,
  kind: DryRunDiffKind,
  before: number | null,
  after: number | null,
): DryRunDiffField | null {
  if (before === after) return null;
  return { key, label, kind, before, after };
}

/** The month-derivation keys compared straight out of derived_provenance. */
const MONTH_FIELDS: ReadonlyArray<{ key: string; label: string; kind: DryRunDiffKind }> = [
  { key: "month_sales_cents", label: "Month sales", kind: "cents" },
  { key: "month_fees_cents", label: "Month fees", kind: "cents" },
  { key: "month_parts_cost_cents", label: "Month parts cost", kind: "cents" },
  { key: "month_gp_with_fees_cents", label: "GP with fees", kind: "cents" },
  { key: "month_gp_without_fees_cents", label: "GP without fees", kind: "cents" },
  { key: "month_qbo_tech_cost_cents", label: "QBO technician cost", kind: "cents" },
  { key: "month_shop_billed_hours", label: "Shop billed hours", kind: "hours" },
];

const TECH_FAMILIES: readonly string[] = ["technician", "shop_foreman"];

type EmployeeView = DryRunSnapshotView["employees"][number];

/**
 * Diff two live snapshots of the SAME run. Employees are matched by employee_id
 * (union of both sides — a side that lacks the employee contributes null, so a
 * roster drift mid-dry-run still reports honestly instead of crashing).
 */
export function buildDryRunDiff(
  before: DryRunSnapshotView,
  after: DryRunSnapshotView,
): PayrollDryRunDiff {
  const beforeEmp = new Map(before.employees.map((e) => [e.employee_id, e]));
  const afterEmp = new Map(after.employees.map((e) => [e.employee_id, e]));
  const employeeIds = [...new Set([...beforeEmp.keys(), ...afterEmp.keys()])];
  const nameOf = (id: string) =>
    afterEmp.get(id)?.display_name ?? beforeEmp.get(id)?.display_name ?? "(unknown employee)";
  const familyOf = (id: string) => afterEmp.get(id)?.family ?? beforeEmp.get(id)?.family ?? "";

  // ── Per-tech billed hours (effective derived inputs) ──
  const techHours: DryRunEmployeeHours[] = [];
  for (const id of employeeIds) {
    if (!TECH_FAMILIES.includes(familyOf(id))) continue;
    const b = beforeEmp.get(id);
    const a = afterEmp.get(id);
    const week = (e: EmployeeView | undefined, wk: 1 | 2) =>
      numOrNull(wk === 1 ? e?.derived.billed_hours_w1 : e?.derived.billed_hours_w2);
    const fields = [
      changedField("billed_hours_w1", "Billed hours W1", "hours", week(b, 1), week(a, 1)),
      changedField("billed_hours_w2", "Billed hours W2", "hours", week(b, 2), week(a, 2)),
    ].filter((f): f is DryRunDiffField => f !== null);
    if (fields.length > 0) techHours.push({ employeeId: id, displayName: nameOf(id), fields });
  }

  // ── Month derivations (loose provenance) + per-SA spiff counts ──
  const bProv = before.derived_provenance as Record<string, unknown>;
  const aProv = after.derived_provenance as Record<string, unknown>;
  const month = MONTH_FIELDS.map((f) =>
    changedField(f.key, f.label, f.kind, numOrNull(bProv[f.key]), numOrNull(aProv[f.key])),
  ).filter((f): f is DryRunDiffField => f !== null);
  for (const id of employeeIds) {
    if (familyOf(id) !== "service_advisor") continue;
    const f = changedField(
      `spiff_count:${id}`,
      `Spiffs — ${nameOf(id)}`,
      "count",
      numOrNull(beforeEmp.get(id)?.derived.spiff_count),
      numOrNull(afterEmp.get(id)?.derived.spiff_count),
    );
    if (f) month.push(f);
  }

  // ── Per-employee total pay ──
  const beforePay = new Map(before.summary.map((r) => [r.employee_id, r.total_pay_cents]));
  const afterPay = new Map(after.summary.map((r) => [r.employee_id, r.total_pay_cents]));
  const payIds = [...new Set([...beforePay.keys(), ...afterPay.keys()])];
  const payTotals = payIds
    .map((id) =>
      changedField(id, nameOf(id), "cents", beforePay.get(id) ?? null, afterPay.get(id) ?? null),
    )
    .filter((f): f is DryRunDiffField => f !== null);

  return {
    techHours,
    month,
    payTotals,
    beforeAsOf: before.derived_provenance.as_of,
    afterAsOf: after.derived_provenance.as_of,
    changed: techHours.length > 0 || month.length > 0 || payTotals.length > 0,
  };
}
