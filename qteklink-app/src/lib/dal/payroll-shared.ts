/**
 * Payroll DAL — shared row shapes, coercers, guarded fetchers, and the payroll
 * settings READ path. Internal support module for src/lib/dal/payroll.ts (the
 * public entrypoint per the contract module layout) and payroll-compute.ts —
 * split out to honor the ~500-line file policy. Import the public surface from
 * "@/lib/dal/payroll", not from here.
 *
 * MULTI-TENANT: every fetch here is shop-scoped; fetchRunGuarded is the
 * ownership check that precedes every RPC keyed on a bare uuid.
 * No silent failures: every Supabase call checks `error`; P0001 (deliberate
 * RAISE) surfaces as QboClientError(kind: validation).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";
import { z } from "zod";
import {
  OverridesSchema,
  RoleSchema,
  SheetEntriesSchema,
  SpiffCategorySchema,
  type Overrides,
  type Role,
  type RunStatus,
  type SheetEntries,
  type SpiffCategory,
} from "@/lib/payroll/types";

// ── Public shapes (re-exported by payroll.ts) ──────────────────────────────────

/** Who performed the mutation (from the requireQtekUser session). */
export interface PayrollActor {
  userId: string;
  label: string;
}

export interface PayrollEmployee {
  id: string;
  shopId: number;
  displayName: string;
  role: Role;
  tekmetricEmployeeId: number | null;
  tekmetricIdType: "technician" | "service_writer" | null;
  /** Raw pay_config JSONB (untagged DB shape — validate with parsePayConfig). */
  payConfig: Record<string, unknown>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRun {
  id: string;
  shopId: number;
  periodStart: string;
  periodEnd: string;
  status: RunStatus;
  bonusPeriod: boolean;
  bonusMonth: string | null;
  completedAt: string | null;
  completedByLabel: string | null;
  voidedAt: string | null;
  voidedByLabel: string | null;
  voidReason: string | null;
  clonedFromRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const HOUR_KEYS = [
  "clock_hours_w1",
  "clock_hours_w2",
  "pto_w1",
  "pto_w2",
  "holiday_w1",
  "holiday_w2",
  "bereavement_w1",
  "bereavement_w2",
  "training_w1",
  "training_w2",
] as const;
export type PayrollHourKey = (typeof HOUR_KEYS)[number];

/** Whitelisted entry patch — mirrors qteklink_payroll_update_entry exactly. */
export type PayrollEntryPatch = Partial<Record<PayrollHourKey, number | null>> & {
  manual_incentive_cents?: number | null;
  overrides?: Overrides;
  pay_config?: Record<string, unknown>;
};

// ── Payroll settings (qteklink_settings.payroll JSONB — contract §settings) ────

export interface PayrollAlertEmails {
  void_clone: string[];
  completed: string[];
}

export interface PayrollSettings {
  /** ISO date the bi-weekly cadence anchors on (2026-06-28 for Jeff's); null = unset. */
  anchor_period_start: string | null;
  spiff_categories: SpiffCategory[];
  alert_emails: PayrollAlertEmails;
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  anchor_period_start: null,
  spiff_categories: [],
  alert_emails: { void_clone: [], completed: [] },
};

const PayrollSettingsDbSchema = z.object({
  anchor_period_start: z.string().nullish(),
  spiff_categories: z.array(SpiffCategorySchema).nullish(),
  alert_emails: z
    .object({
      void_clone: z.array(z.string()).nullish(),
      completed: z.array(z.string()).nullish(),
    })
    .nullish(),
});

function normalizePayrollSettings(raw: unknown): PayrollSettings {
  if (raw === null || raw === undefined) return { ...DEFAULT_PAYROLL_SETTINGS };
  const parsed = PayrollSettingsDbSchema.parse(raw);
  return {
    anchor_period_start: parsed.anchor_period_start ?? null,
    spiff_categories: parsed.spiff_categories ?? [],
    alert_emails: {
      void_clone: parsed.alert_emails?.void_clone ?? [],
      completed: parsed.alert_emails?.completed ?? [],
    },
  };
}

/** Read the shop's payroll settings (defaults when unconfigured / no connection). */
export async function getPayrollSettings(
  shopId: number,
): Promise<{ realmId: string | null; payroll: PayrollSettings }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, payroll: { ...DEFAULT_PAYROLL_SETTINGS } };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_settings")
    .select("payroll")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .limit(1);
  if (error) throw new Error(`getPayrollSettings failed: ${error.message}`);
  const row = (data ?? [])[0] as { payroll: unknown } | undefined;
  return { realmId, payroll: normalizePayrollSettings(row?.payroll) };
}

// ── Small helpers ──────────────────────────────────────────────────────────────

/** P0001 = a deliberate RAISE in the RPC (business rule) → user-facing message. */
export function throwRpc(fn: string, error: { code?: string; message: string }): never {
  if (error.code === "P0001") throw new QboClientError(error.message, { kind: "validation" });
  throw new Error(`${fn} failed: ${error.message}`);
}

/** PostgREST numerics can arrive as number OR string — coerce, fail closed. */
export function toNum(v: number | string | null | undefined, field: string): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`payroll DAL: non-numeric ${field} (${String(v)})`);
  return n;
}

export function normalizeOverrides(raw: unknown, ctx: string): Overrides {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`payroll DAL: ${ctx} overrides is not an object`);
  }
  const out: Record<string, { value: number; note: string }> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as { value?: unknown; note?: unknown } | null;
    if (e === null || typeof e !== "object" || typeof e.value !== "number") {
      throw new Error(`payroll DAL: ${ctx} overrides.${key} is malformed`);
    }
    // note is optional at the SQL layer — normalize to "" for the strict Zod shape.
    out[key] = { value: e.value, note: typeof e.note === "string" ? e.note : "" };
  }
  return OverridesSchema.parse(out);
}

// ── Run rows ───────────────────────────────────────────────────────────────────

export interface RunDbRow {
  id: string;
  shop_id: number;
  period_start: string;
  period_end: string;
  status: RunStatus;
  bonus_period: boolean;
  bonus_month: string | null;
  snapshot: unknown;
  /** Round-7 #40/#41 DISPLAY CACHE (open runs): the last computed RunSnapshot.
   *  Meaningless once completed/voided — the frozen `snapshot` governs there. */
  live_snapshot: unknown;
  live_snapshot_at: string | null;
  live_snapshot_stale: boolean;
  completed_at: string | null;
  completed_by_label: string | null;
  voided_at: string | null;
  voided_by_label: string | null;
  void_reason: string | null;
  cloned_from_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export const RUN_COLS =
  "id, shop_id, period_start, period_end, status, bonus_period, bonus_month, snapshot, live_snapshot, live_snapshot_at, live_snapshot_stale, completed_at, completed_by_label, voided_at, voided_by_label, void_reason, cloned_from_run_id, created_at, updated_at";

export function runFromRow(r: RunDbRow): PayrollRun {
  return {
    id: r.id,
    shopId: r.shop_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    bonusPeriod: r.bonus_period,
    bonusMonth: r.bonus_month,
    completedAt: r.completed_at,
    completedByLabel: r.completed_by_label,
    voidedAt: r.voided_at,
    voidedByLabel: r.voided_by_label,
    voidReason: r.void_reason,
    clonedFromRunId: r.cloned_from_run_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Fetch a run and assert it belongs to the caller's shop (the RPCs key on bare uuids). */
export async function fetchRunGuarded(shopId: number, runId: string): Promise<RunDbRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_runs")
    .select(RUN_COLS)
    .eq("id", runId)
    .eq("shop_id", shopId)
    .limit(1);
  if (error) throw new Error(`payroll DAL: run fetch failed: ${error.message}`);
  const row = (data ?? [])[0] as RunDbRow | undefined;
  if (!row) throw new QboClientError("Payroll run not found.", { kind: "not_found" });
  return row;
}

// ── Entry rows ─────────────────────────────────────────────────────────────────

export interface EntryDbRow {
  id: string;
  run_id: string;
  shop_id: number;
  employee_id: string;
  role_snapshot: string;
  pay_config: Record<string, unknown>;
  clock_hours_w1: number | string | null;
  clock_hours_w2: number | string | null;
  pto_w1: number | string | null;
  pto_w2: number | string | null;
  holiday_w1: number | string | null;
  holiday_w2: number | string | null;
  bereavement_w1: number | string | null;
  bereavement_w2: number | string | null;
  training_w1: number | string | null;
  training_w2: number | string | null;
  manual_incentive_cents: number | string | null;
  overrides: unknown;
  updated_at: string;
}

export const ENTRY_COLS =
  "id, run_id, shop_id, employee_id, role_snapshot, pay_config, clock_hours_w1, clock_hours_w2, pto_w1, pto_w2, holiday_w1, holiday_w2, bereavement_w1, bereavement_w2, training_w1, training_w2, manual_incentive_cents, overrides, updated_at";

export function sheetEntriesFromRow(r: EntryDbRow): SheetEntries {
  return SheetEntriesSchema.parse({
    clock_hours_w1: toNum(r.clock_hours_w1, "clock_hours_w1"),
    clock_hours_w2: toNum(r.clock_hours_w2, "clock_hours_w2"),
    pto_w1: toNum(r.pto_w1, "pto_w1"),
    pto_w2: toNum(r.pto_w2, "pto_w2"),
    holiday_w1: toNum(r.holiday_w1, "holiday_w1"),
    holiday_w2: toNum(r.holiday_w2, "holiday_w2"),
    bereavement_w1: toNum(r.bereavement_w1, "bereavement_w1"),
    bereavement_w2: toNum(r.bereavement_w2, "bereavement_w2"),
    training_w1: toNum(r.training_w1, "training_w1"),
    training_w2: toNum(r.training_w2, "training_w2"),
    manual_incentive_cents: toNum(r.manual_incentive_cents, "manual_incentive_cents"),
  });
}

export async function fetchRunEntries(runId: string): Promise<EntryDbRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_run_employees")
    .select(ENTRY_COLS)
    .eq("run_id", runId);
  if (error) throw new Error(`payroll DAL: run entries fetch failed: ${error.message}`);
  return (data ?? []) as EntryDbRow[];
}

// ── Employee rows ──────────────────────────────────────────────────────────────

export interface EmployeeDbRow {
  id: string;
  shop_id: number;
  display_name: string;
  role: string;
  tekmetric_employee_id: number | string | null;
  tekmetric_id_type: "technician" | "service_writer" | null;
  pay_config: Record<string, unknown>;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const EMPLOYEE_COLS =
  "id, shop_id, display_name, role, tekmetric_employee_id, tekmetric_id_type, pay_config, archived_at, created_at, updated_at";

export function employeeFromRow(r: EmployeeDbRow): PayrollEmployee {
  return {
    id: r.id,
    shopId: r.shop_id,
    displayName: r.display_name,
    role: RoleSchema.parse(r.role),
    tekmetricEmployeeId: toNum(r.tekmetric_employee_id, "tekmetric_employee_id"),
    tekmetricIdType: r.tekmetric_id_type,
    payConfig: r.pay_config,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function fetchEmployeesByIds(
  shopId: number,
  ids: string[],
): Promise<Map<string, PayrollEmployee>> {
  if (ids.length === 0) return new Map();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_employees")
    .select(EMPLOYEE_COLS)
    .eq("shop_id", shopId)
    .in("id", ids);
  if (error) throw new Error(`payroll DAL: employees fetch failed: ${error.message}`);
  const map = new Map<string, PayrollEmployee>();
  for (const row of (data ?? []) as EmployeeDbRow[]) map.set(row.id, employeeFromRow(row));
  return map;
}
