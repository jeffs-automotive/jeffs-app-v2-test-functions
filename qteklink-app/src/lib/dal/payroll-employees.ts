/**
 * Payroll DAL — employees CRUD (qteklink_payroll_upsert_employee) + the round-3
 * decision #26 pay_config WRITE-THROUGH. Internal support module for
 * src/lib/dal/payroll.ts (the public entrypoint per the contract module layout),
 * split out to honor the ~500-line file policy. Import the public surface from
 * "@/lib/dal/payroll", not from here.
 *
 * MULTI-TENANT: every fetch/RPC here is shop-scoped. No silent failures: every
 * Supabase call checks `error`; P0001 surfaces as QboClientError(kind: validation).
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QboClientError } from "@/lib/qbo/errors";
import { familyForRole, parsePayConfig, RoleSchema, type Role } from "@/lib/payroll/types";
import {
  EMPLOYEE_COLS,
  employeeFromRow,
  fetchEmployeesByIds,
  throwRpc,
  type EmployeeDbRow,
  type PayrollActor,
  type PayrollEmployee,
} from "@/lib/dal/payroll-shared";

export interface UpsertPayrollEmployeeInput {
  /** null/undefined = create. */
  employeeId?: string | null;
  displayName: string;
  role: Role;
  tekmetricEmployeeId: number | null;
  payConfig: Record<string, unknown>;
  archived: boolean;
}

export async function listPayrollEmployees(
  shopId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<PayrollEmployee[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("qteklink_payroll_employees")
    .select(EMPLOYEE_COLS)
    .eq("shop_id", shopId)
    .order("display_name", { ascending: true });
  if (!opts.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`listPayrollEmployees failed: ${error.message}`);
  return ((data ?? []) as EmployeeDbRow[]).map(employeeFromRow);
}

/**
 * Create / update / archive an employee. pay_config is Zod-validated per the role's
 * family HERE (and again in the RPC — the contract's dual validation). rates_w2 is a
 * per-RUN override only and is rejected at the employee level.
 */
export async function upsertPayrollEmployee(
  shopId: number,
  input: UpsertPayrollEmployeeInput,
  actor: PayrollActor,
): Promise<string> {
  const role = RoleSchema.parse(input.role);
  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 200) {
    throw new QboClientError("A display name (1–200 characters) is required.", { kind: "validation" });
  }
  if (
    input.tekmetricEmployeeId !== null &&
    (!Number.isInteger(input.tekmetricEmployeeId) || input.tekmetricEmployeeId <= 0)
  ) {
    throw new QboClientError("The Tekmetric employee id must be a positive integer.", { kind: "validation" });
  }
  if (Object.prototype.hasOwnProperty.call(input.payConfig, "rates_w2")) {
    throw new QboClientError("rates_w2 is a per-run override — it cannot be saved on the employee.", {
      kind: "validation",
    });
  }
  parsePayConfig(familyForRole(role), input.payConfig);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_upsert_employee", {
    p_shop_id: shopId,
    p_employee_id: input.employeeId ?? null,
    p_display_name: displayName,
    p_role: role,
    p_tekmetric_employee_id: input.tekmetricEmployeeId,
    p_pay_config: input.payConfig,
    p_archived: input.archived,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_upsert_employee", error);
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("qteklink_payroll_upsert_employee returned no employee id");
  }
  return data;
}

/**
 * Keys whose value differs between the entry's previous and new run pay_config
 * (`rates_w2` excluded — run-scoped, never written through). Pay-config values are
 * JSON scalars apart from rates_w2, so JSON.stringify equality is exact.
 */
function changedPayConfigKeys(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  keys.delete("rates_w2");
  return [...keys].filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

/**
 * Round-3 decision #26 — propagate a run-level pay_config patch to the employee
 * master. Only the keys the run edit actually CHANGED (diffed against the entry's
 * PREVIOUS pay_config, minus the run-scoped `rates_w2`) are merged onto the
 * employee's CURRENT master config — replacing the master wholesale would silently
 * revert any master field edited independently since the run was created (lost
 * update), and the stale values would then prefill every future run. Applied via a
 * SEPARATE qteklink_payroll_upsert_employee call so BOTH audit trails exist (entry
 * old→new per key + the employee upsert row). Skipped when nothing changed, and
 * when the employee's CURRENT role family no longer matches the run's
 * role_snapshot family — the run-shaped keys cannot validate against the new
 * family (surfaced to Sentry, never silent).
 */
export async function writeThroughEmployeePayConfig(
  shopId: number,
  employeeId: string,
  roleSnapshot: Role,
  runPayConfig: Record<string, unknown>,
  previousRunPayConfig: Record<string, unknown>,
  actor: PayrollActor,
): Promise<void> {
  const changedKeys = changedPayConfigKeys(previousRunPayConfig, runPayConfig);
  if (changedKeys.length === 0) return; // no-op / rates_w2-only edit — nothing to propagate
  const employees = await fetchEmployeesByIds(shopId, [employeeId]);
  const emp = employees.get(employeeId);
  if (!emp) {
    // FK-impossible in practice — fail loud rather than silently dropping the merge.
    throw new Error(`payroll DAL: pay_config write-through found no employee ${employeeId}`);
  }
  if (familyForRole(emp.role) !== familyForRole(roleSnapshot)) {
    Sentry.captureMessage("payroll pay_config write-through skipped: role family changed", {
      level: "warning",
      tags: { surface: "qteklink-payroll" },
      extra: { employeeId, runRole: roleSnapshot, currentRole: emp.role },
    });
    return;
  }
  const masterConfig: Record<string, unknown> = { ...emp.payConfig };
  delete masterConfig.rates_w2; // run-scoped only — never on the master (defensive)
  for (const key of changedKeys) {
    if (Object.prototype.hasOwnProperty.call(runPayConfig, key)) masterConfig[key] = runPayConfig[key];
    else delete masterConfig[key]; // key dropped by the run edit (e.g. same-family reshape)
  }
  await upsertPayrollEmployee(
    shopId,
    {
      employeeId,
      displayName: emp.displayName,
      role: emp.role,
      tekmetricEmployeeId: emp.tekmetricEmployeeId,
      payConfig: masterConfig,
      archived: emp.archivedAt !== null,
    },
    actor,
  );
}
