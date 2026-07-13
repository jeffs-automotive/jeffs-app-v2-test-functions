/**
 * Payroll PTO DAL — ledger reads, dry-run projections, and the initial/adjustment
 * + employee-profile writes (plan §2a/§2b/§3 of
 * docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md). Internal support
 * module for src/lib/dal/payroll.ts (the public entrypoint) — split per the
 * ~500-line file policy. Import the public surface from "@/lib/dal/payroll".
 *
 * The completion-time entry builder + email fan-out live in the sibling
 * ./payroll-pto-completion.ts (also ~500-line policy).
 *
 * WRITE surfaces here go through the round-11 RPCs (migration 20260712200000):
 *   - qteklink_payroll_adjust_pto      — kinds initial/adjustment ONLY; stamps the
 *     running balance under the per-shop ledger advisory lock (C13). Run-driven
 *     kinds (accrual/usage/rollover_forfeit/void_reversal) are NEVER written here —
 *     they ride inside complete_run/void_run.
 *   - qteklink_payroll_update_employee_profile — patch semantics for the nine new
 *     profile columns (present=write, JSON null=clear, absent=keep) + p_archived
 *     (false auto-clears termination_date server-side).
 *
 * READ surfaces: the ledger is the SINGLE balance truth — balance = the last
 * balance_after_hours (RPC-stamped), NOT a client-side re-sum. Projections thread
 * the CURRENT ledger balance + the pure pto.ts engine + entered PTO hours.
 *
 * MULTI-TENANT: every read/write is shop-scoped; the RPCs re-check ownership
 * server-side. No silent failures: every Supabase call checks `error`; a P0001
 * (deliberate RAISE) surfaces as QboClientError(kind: validation) via throwRpc.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QboClientError } from "@/lib/qbo/errors";
import {
  buildEmployeeRunPtoEntries,
  type PtoEmployeeFields,
  type PtoLedgerEntryForRollover,
  type PtoRunPeriod,
  type PtoSettingsSlice,
  type PtoWarning,
} from "@/lib/payroll/pto";
import { throwRpc, toNum, type PayrollActor, type PayrollEmployee } from "@/lib/dal/payroll-shared";

// ── Ledger row shapes (read surface) ───────────────────────────────────────────

/** The ledger kinds, mirroring the qteklink_payroll_pto_ledger CHECK. */
export type PtoLedgerKind =
  | "initial"
  | "accrual"
  | "usage"
  | "adjustment"
  | "rollover_forfeit"
  | "void_reversal";

/** One ledger row as the activity page renders it (newest first). Money is never
 *  stored on the ledger — hours only (N14). */
export interface PtoLedgerEntry {
  id: string;
  employeeId: string;
  runId: string | null;
  kind: PtoLedgerKind;
  /** Signed hours (accrual +, usage/forfeit/void −, adjustment either way). */
  hours: number;
  /** RPC-stamped running balance after this row. */
  balanceAfterHours: number;
  reason: string | null;
  reversesLedgerId: string | null;
  boundaryYear: number | null;
  createdAt: string;
  createdByLabel: string;
}

interface PtoLedgerDbRow {
  id: string;
  shop_id: number;
  employee_id: string;
  run_id: string | null;
  kind: string;
  hours: number | string;
  balance_after_hours: number | string;
  reason: string | null;
  reverses_ledger_id: string | null;
  boundary_year: number | string | null;
  created_at: string;
  created_by_label: string;
}

const LEDGER_COLS =
  "id, shop_id, employee_id, run_id, kind, hours, balance_after_hours, reason, reverses_ledger_id, boundary_year, created_at, created_by_label";

const LEDGER_KINDS: readonly PtoLedgerKind[] = [
  "initial",
  "accrual",
  "usage",
  "adjustment",
  "rollover_forfeit",
  "void_reversal",
];

function ledgerFromRow(r: PtoLedgerDbRow): PtoLedgerEntry {
  const kind = r.kind as PtoLedgerKind;
  if (!LEDGER_KINDS.includes(kind)) {
    throw new Error(`payroll PTO DAL: unexpected ledger kind "${r.kind}"`);
  }
  return {
    id: r.id,
    employeeId: r.employee_id,
    runId: r.run_id,
    kind,
    hours: toNum(r.hours, "ledger.hours") ?? 0,
    balanceAfterHours: toNum(r.balance_after_hours, "ledger.balance_after_hours") ?? 0,
    reason: r.reason,
    reversesLedgerId: r.reverses_ledger_id,
    boundaryYear: toNum(r.boundary_year, "ledger.boundary_year"),
    createdAt: r.created_at,
    createdByLabel: r.created_by_label,
  };
}

// ── Ledger reads (the single balance truth) ────────────────────────────────────

/**
 * The full ledger history for one employee, NEWEST FIRST (the activity page's
 * order). Shop-scoped. Empty array when the employee has no ledger rows yet.
 */
export async function getPtoLedger(shopId: number, employeeId: string): Promise<PtoLedgerEntry[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_pto_ledger")
    .select(LEDGER_COLS)
    .eq("shop_id", shopId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(`payroll PTO DAL: ledger fetch failed: ${error.message}`);
  return ((data ?? []) as PtoLedgerDbRow[]).map(ledgerFromRow);
}

/**
 * The employee's CURRENT PTO balance = the last (most recent) row's
 * balance_after_hours (the RPC-stamped running total — never a client re-sum).
 * 0 hours when the employee has no ledger rows yet (unseeded).
 */
export async function getPtoBalance(shopId: number, employeeId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_pto_ledger")
    .select("balance_after_hours, created_at, id")
    .eq("shop_id", shopId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`payroll PTO DAL: balance fetch failed: ${error.message}`);
  const row = (data ?? [])[0] as { balance_after_hours: number | string } | undefined;
  if (row === undefined) return 0;
  return toNum(row.balance_after_hours, "balance_after_hours") ?? 0;
}

/**
 * Current balances for a SET of employees in one shop-scoped query (the run
 * projection + completion paths). Returns a Map keyed by employee_id; an
 * employee with no ledger rows is ABSENT from the map (caller defaults to 0).
 * Uses the newest-per-employee balance_after_hours.
 */
export async function getPtoBalances(
  shopId: number,
  employeeIds: string[],
): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();
  const admin = createSupabaseAdminClient();
  // created_at ASC + id ASC so the LAST write for each employee wins the reduce.
  const { data, error } = await admin
    .from("qteklink_payroll_pto_ledger")
    .select("employee_id, balance_after_hours, created_at, id")
    .eq("shop_id", shopId)
    .in("employee_id", employeeIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`payroll PTO DAL: balances fetch failed: ${error.message}`);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ employee_id: string; balance_after_hours: number | string }>) {
    out.set(r.employee_id, toNum(r.balance_after_hours, "balance_after_hours") ?? 0);
  }
  return out;
}

/**
 * The full rollover-attribution ledger for a set of employees (the pure engine's
 * carryover input). Returns a Map employee_id → entries in the engine's shape
 * (signed hours + the run's period_end for run-linked rows, created_at otherwise).
 * `run_period_end` comes from the joined run row; initial/adjustment rows carry
 * null and bucket by created_at inside pto.ts (attributionYear).
 */
export async function getPtoRolloverLedger(
  shopId: number,
  employeeIds: string[],
): Promise<Map<string, PtoLedgerEntryForRollover[]>> {
  const out = new Map<string, PtoLedgerEntryForRollover[]>();
  if (employeeIds.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_pto_ledger")
    .select("employee_id, hours, created_at, run:run_id(period_end)")
    .eq("shop_id", shopId)
    .in("employee_id", employeeIds);
  if (error) throw new Error(`payroll PTO DAL: rollover ledger fetch failed: ${error.message}`);
  for (const r of (data ?? []) as Array<{
    employee_id: string;
    hours: number | string;
    created_at: string;
    run: { period_end: string } | { period_end: string }[] | null;
  }>) {
    // PostgREST embeds a to-one relationship as an object OR (older/typed) a
    // single-element array — normalize both.
    const runObj = Array.isArray(r.run) ? (r.run[0] ?? null) : r.run;
    const list = out.get(r.employee_id) ?? [];
    list.push({
      hours: toNum(r.hours, "rollover.hours") ?? 0,
      run_period_end: runObj?.period_end ?? null,
      created_at: r.created_at,
    });
    out.set(r.employee_id, list);
  }
  return out;
}

// ── Projections (dry-run PTO section — plan §3/§4.dry-run) ──────────────────────

/** One employee's projected PTO for a run (the dry-run PTO sibling field + the
 *  completion dialog's still-negative notice — plan §4). */
export interface EmployeePtoProjection {
  employeeId: string;
  displayName: string;
  currentBalanceHours: number;
  accrualHours: number;
  /** Positive magnitude of the paid PTO decrement (0 = none). */
  usageHours: number;
  /** current + accrual − usage (plan §3). */
  projectedBalanceHours: number;
}

/** Everything the projection needs for ONE employee. `snapshotPtoHours` is the
 *  paid PTO hours the run's frozen/live snapshot carries (sheet.pto_hours). */
export interface PtoProjectionInput {
  employee: PtoEmployeeFields;
  displayName: string;
  snapshotPtoHours: number;
  currentBalanceHours: number;
  rolloverLedger: readonly PtoLedgerEntryForRollover[];
}

/**
 * Project each employee's PTO for a completing/previewing run — pure orchestration
 * around the pto.ts engine (buildEmployeeRunPtoEntries owns accrual gating, usage
 * for EVERY employee with paid PTO hours incl. archived/terminated, and forfeit).
 * The projected balance intentionally omits the rollover forfeit: the dry-run
 * surface shows accrual/usage against the current balance (the deficit warning);
 * the authoritative forfeit is applied inside the completion transaction (§4).
 * NEVER reads the DB — the DAL fetchers above supply balances + ledger.
 */
export function projectRunPto(
  inputs: readonly PtoProjectionInput[],
  settings: PtoSettingsSlice,
  run: PtoRunPeriod,
): { projections: EmployeePtoProjection[]; warnings: PtoWarning[] } {
  const projections: EmployeePtoProjection[] = [];
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
    projections.push({
      employeeId: input.employee.employee_id,
      displayName: input.displayName,
      currentBalanceHours: input.currentBalanceHours,
      accrualHours: computed.accrual_hours,
      usageHours: computed.usage_hours,
      projectedBalanceHours:
        Math.round((input.currentBalanceHours + computed.accrual_hours - computed.usage_hours) * 100) / 100,
    });
    warnings.push(...computed.warnings);
  }
  return { projections, warnings };
}

/** Adapt a PayrollEmployee (the read surface) into the pure engine's field shape. */
export function ptoFieldsFromEmployee(e: PayrollEmployee): PtoEmployeeFields {
  return {
    employee_id: e.id,
    display_name: e.displayName,
    archived: e.archivedAt !== null,
    start_date: e.startDate,
    termination_date: e.terminationDate,
    pto_grandfathered: e.ptoGrandfathered,
    pto_tenure_credit_date: e.ptoTenureCreditDate,
    full_time: e.fullTime,
  };
}

// ── Writes: initial balance + adjustment (kinds initial/adjustment ONLY) ────────

export interface AdjustPtoResult {
  ledgerId: string;
  balanceAfterHours: number;
}

function adjustResultFrom(data: unknown, fn: string): AdjustPtoResult {
  const row = data as { ledger_id?: unknown; balance_after_hours?: unknown } | null;
  if (!row || typeof row.ledger_id !== "string") {
    throw new Error(`${fn} returned no ledger id`);
  }
  return {
    ledgerId: row.ledger_id,
    balanceAfterHours: toNum(row.balance_after_hours as number | string, "balance_after_hours") ?? 0,
  };
}

/**
 * Adjust an employee's PTO balance (kind='adjustment'): SIGNED hours + a REQUIRED
 * non-blank reason (the RPC re-checks both). Stamps the running balance under the
 * shop ledger advisory lock. Returns the new ledger id + balance.
 */
export async function adjustPto(
  shopId: number,
  employeeId: string,
  hours: number,
  reason: string,
  actor: PayrollActor,
): Promise<AdjustPtoResult> {
  if (!Number.isFinite(hours) || hours === 0) {
    throw new QboClientError("A non-zero adjustment amount is required.", { kind: "validation" });
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new QboClientError("A reason is required for a PTO adjustment.", { kind: "validation" });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_adjust_pto", {
    p_shop: shopId,
    p_employee: employeeId,
    p_kind: "adjustment",
    p_hours: hours,
    p_reason: trimmedReason,
    p_actor: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_adjust_pto", error);
  return adjustResultFrom(data, "qteklink_payroll_adjust_pto");
}

/**
 * Seed an employee's INITIAL PTO balance (kind='initial'): signed hours, reason
 * OPTIONAL (the RPC only requires a reason for adjustments). §8.6 seeding is
 * Chris's manual initial-balance entry ONLY — never reads pay_config.pto_balance_hours
 * (auto-migration would double-count). Returns the new ledger id + balance.
 */
export async function seedInitialBalance(
  shopId: number,
  employeeId: string,
  hours: number,
  actor: PayrollActor,
  reason?: string,
): Promise<AdjustPtoResult> {
  if (!Number.isFinite(hours) || hours === 0) {
    throw new QboClientError("A non-zero initial balance is required.", { kind: "validation" });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_adjust_pto", {
    p_shop: shopId,
    p_employee: employeeId,
    p_kind: "initial",
    p_hours: hours,
    p_reason: reason?.trim() ? reason.trim() : null,
    p_actor: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_adjust_pto", error);
  return adjustResultFrom(data, "qteklink_payroll_adjust_pto");
}

// ── Writes: employee profile (patch semantics) + archive/unarchive ──────────────

/** The editable profile columns (plan §2a + round-12 full_time). Patch semantics:
 *  - a key PRESENT with a value → write it;
 *  - a key PRESENT with `null` → CLEAR it (nullable columns only; pto_grandfathered
 *    AND full_time are NOT NULL, so a boolean is required — null there RAISEs in
 *    the RPC, hence no `| null`);
 *  - a key ABSENT (undefined) → LEAVE UNCHANGED.
 *  We translate `undefined` → omit from the JSON patch, and `null` → JSON null. */
export interface EmployeeProfilePatch {
  work_email?: string | null;
  personal_email?: string | null;
  personal_phone?: string | null;
  work_phone?: string | null;
  address?: string | null;
  start_date?: string | null;
  termination_date?: string | null;
  pto_grandfathered?: boolean;
  pto_tenure_credit_date?: string | null;
  full_time?: boolean;
}

const PROFILE_PATCH_KEYS: readonly (keyof EmployeeProfilePatch)[] = [
  "work_email",
  "personal_email",
  "personal_phone",
  "work_phone",
  "address",
  "start_date",
  "termination_date",
  "pto_grandfathered",
  "pto_tenure_credit_date",
  "full_time",
];

/** Build the SQL p_patch JSONB: absent (undefined) keys are OMITTED (=keep);
 *  explicit null stays null (=clear). */
function toJsonPatch(patch: EmployeeProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_PATCH_KEYS) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

/**
 * Patch the round-11 profile columns via qteklink_payroll_update_employee_profile.
 * `archived` (optional): true/false flips archived_at atomically; false ALSO
 * clears termination_date server-side (C8/C23/C36). Absent `archived` = leave
 * archived state unchanged. At least one of a non-empty patch OR `archived` is
 * required (the RPC RAISEs otherwise).
 */
export async function updateEmployeeProfile(
  shopId: number,
  employeeId: string,
  patch: EmployeeProfilePatch,
  actor: PayrollActor,
  archived?: boolean,
): Promise<void> {
  const jsonPatch = toJsonPatch(patch);
  if (Object.keys(jsonPatch).length === 0 && archived === undefined) {
    throw new QboClientError("Nothing to update.", { kind: "validation" });
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_payroll_update_employee_profile", {
    p_shop: shopId,
    p_employee: employeeId,
    p_patch: jsonPatch,
    p_archived: archived ?? null,
    p_actor: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_update_employee_profile", error);
}

/**
 * Archive an employee with a termination date — ONE profile-RPC call
 * (p_patch {termination_date}, p_archived: true). The archive modal's write.
 */
export async function archiveEmployee(
  shopId: number,
  employeeId: string,
  terminationDate: string,
  actor: PayrollActor,
): Promise<void> {
  await updateEmployeeProfile(shopId, employeeId, { termination_date: terminationDate }, actor, true);
}

/**
 * Unarchive an employee — ONE profile-RPC call (p_archived: false). The RPC
 * auto-clears termination_date so a rehire accrues again (C8/C23/C36); the
 * cleared value is preserved in the audit detail.
 */
export async function unarchiveEmployee(
  shopId: number,
  employeeId: string,
  actor: PayrollActor,
): Promise<void> {
  await updateEmployeeProfile(shopId, employeeId, {}, actor, false);
}
