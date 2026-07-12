"use server";

/**
 * Payroll server actions — thin (the QTekLink pattern): requireQtekUser() FIRST,
 * admin gate on every mutation, Zod-validate the form input, delegate to the fat
 * payroll DAL (src/lib/dal/payroll.ts), return a typed QboActionResult. Shaped for
 * React 19 useActionState (prevState, formData). One action per DAL mutation +
 * refreshPayrollTekmetricDataAction (mirror-ingest range mode for the run period,
 * plus the bonus month when the slider is on).
 *
 * The Pattern S complete/void dance (dry-run → state hash → token → confirm) runs
 * entirely SERVER-SIDE inside the DAL — the UI dialog is the human confirmation
 * surface; these actions are invoked once, after the user confirms.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import {
  completePayrollRun,
  createPayrollRun,
  discoverAndMergePayrollCategories,
  dryRunPayrollRefresh,
  listTekmetricEmployees,
  refreshRunTekmetricData,
  syncPayrollRunRoster,
  updatePayrollEntriesBatch,
  updatePayrollEntry,
  updatePayrollRun,
  updatePayrollSettings,
  upsertPayrollEmployee,
  voidPayrollRun,
  type PayrollDryRunResult,
  type PayrollEntryPatch,
  type PayrollRefreshResult,
  type PayrollSettings,
} from "@/lib/dal/payroll";
import { OverridesSchema, ROLES, SpiffCategorySchema } from "@/lib/payroll/types";
import { emailRx } from "@/lib/validate";
import { qboFailure, type QboActionResult } from "./qbo/result";

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required for payroll changes.", timestamp: Date.now() };
}

function invalid(message: string): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message, timestamp: Date.now() };
}

/** Parse a form field that carries a JSON object (pay_config, patch, categories). */
function parseJsonObject(raw: FormDataEntryValue | null, field: string): Record<string, unknown> | null {
  if (raw === null || typeof raw !== "string" || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${field} is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

const uuidField = (label: string) => z.string().uuid(`A valid ${label} is required.`);
const isoDateField = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be an ISO date (YYYY-MM-DD).`);

// ── Employees ──────────────────────────────────────────────────────────────────

const UpsertEmployeeSchema = z.object({
  employeeId: z.string().uuid().optional(),
  displayName: z.string().trim().min(1, "A display name is required.").max(200),
  role: z.enum(ROLES),
  tekmetricEmployeeId: z.coerce.number().int().positive().optional(),
  archived: z.boolean(),
});

type UpsertEmployeeState = QboActionResult<{ employeeId: string }>;

async function upsertPayrollEmployeeImpl(
  _prev: UpsertEmployeeState | null,
  formData: FormData,
): Promise<UpsertEmployeeState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const archivedRaw = formData.get("archived");
    const parsed = UpsertEmployeeSchema.safeParse({
      employeeId: formData.get("employee_id") || undefined,
      displayName: formData.get("display_name"),
      role: formData.get("role"),
      tekmetricEmployeeId: formData.get("tekmetric_employee_id") || undefined,
      archived: archivedRaw === "on" || archivedRaw === "true",
    });
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid employee input.");

    let payConfig: Record<string, unknown> | null;
    try {
      payConfig = parseJsonObject(formData.get("pay_config"), "pay_config");
    } catch (e) {
      return invalid(e instanceof Error ? e.message : "pay_config is not valid JSON.");
    }
    if (!payConfig) return invalid("A pay configuration is required.");

    const employeeId = await upsertPayrollEmployee(
      shopId,
      {
        employeeId: parsed.data.employeeId ?? null,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
        tekmetricEmployeeId: parsed.data.tekmetricEmployeeId ?? null,
        payConfig,
        archived: parsed.data.archived,
      },
      { userId, label: email },
    );
    return { ok: true, data: { employeeId }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const upsertPayrollEmployeeAction = wrapQtekAction("payrollUpsertEmployee", upsertPayrollEmployeeImpl);

// ── Runs ───────────────────────────────────────────────────────────────────────

type CreateRunState = QboActionResult<{ runId: string }>;

async function createPayrollRunImpl(_prev: CreateRunState | null, formData: FormData): Promise<CreateRunState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = isoDateField("Period start").safeParse(formData.get("period_start"));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid period start.");

    const runId = await createPayrollRun(shopId, parsed.data, { userId, label: email });
    return { ok: true, data: { runId }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const createPayrollRunAction = wrapQtekAction("payrollCreateRun", createPayrollRunImpl);

type SyncRosterState = QboActionResult<{ added: string[]; removed: string[] }>;

async function syncPayrollRosterImpl(_prev: SyncRosterState | null, formData: FormData): Promise<SyncRosterState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = uuidField("run id").safeParse(formData.get("run_id"));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid run id.");

    const data = await syncPayrollRunRoster(shopId, parsed.data, { userId, label: email });
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const syncPayrollRosterAction = wrapQtekAction("payrollSyncRoster", syncPayrollRosterImpl);

/** Action-level shape gate for the entry patch (the DAL + RPC re-validate). */
const EntryPatchSchema = z
  .object({
    clock_hours_w1: z.number().min(0).max(120).nullable(),
    clock_hours_w2: z.number().min(0).max(120).nullable(),
    pto_w1: z.number().min(0).max(120).nullable(),
    pto_w2: z.number().min(0).max(120).nullable(),
    holiday_w1: z.number().min(0).max(120).nullable(),
    holiday_w2: z.number().min(0).max(120).nullable(),
    bereavement_w1: z.number().min(0).max(120).nullable(),
    bereavement_w2: z.number().min(0).max(120).nullable(),
    training_w1: z.number().min(0).max(120).nullable(),
    training_w2: z.number().min(0).max(120).nullable(),
    manual_incentive_cents: z.number().int().min(0).max(5_000_000).nullable(),
    overrides: OverridesSchema,
    pay_config: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict();

type UpdateEntryState = QboActionResult<{ updated: true }>;

async function updatePayrollEntryImpl(_prev: UpdateEntryState | null, formData: FormData): Promise<UpdateEntryState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = uuidField("entry id").safeParse(formData.get("run_employee_id"));
    if (!id.success) return invalid(id.error.issues[0]?.message ?? "Invalid entry id.");

    let raw: Record<string, unknown> | null;
    try {
      raw = parseJsonObject(formData.get("patch"), "patch");
    } catch (e) {
      return invalid(e instanceof Error ? e.message : "patch is not valid JSON.");
    }
    if (!raw || Object.keys(raw).length === 0) return invalid("Nothing to update.");
    const patch = EntryPatchSchema.safeParse(raw);
    if (!patch.success) return invalid(patch.error.issues[0]?.message ?? "Invalid entry patch.");

    await updatePayrollEntry(shopId, id.data, patch.data as PayrollEntryPatch, { userId, label: email });
    return { ok: true, data: { updated: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updatePayrollEntryAction = wrapQtekAction("payrollUpdateEntry", updatePayrollEntryImpl);

// ── Round-8 #43: the entry grid's ONE-Save atomic batch ────────────────────────

/** Batch patches carry ONLY the grid's fields (hours + manual incentive) — the
 *  pay_config / overrides editors keep their single-entry action (the DAL rejects
 *  them in a batch too; this schema just fails earlier with a cleaner message). */
const EntryBatchRowPatchSchema = EntryPatchSchema.omit({ overrides: true, pay_config: true });
const EntryBatchSchema = z
  .array(
    z
      .object({
        run_employee_id: z.string().uuid("Each batch row needs a valid entry id."),
        patch: EntryBatchRowPatchSchema,
      })
      .strict(),
  )
  .min(1, "Nothing to update.");

type UpdateEntriesState = QboActionResult<{ updated: number }>;

async function updatePayrollEntriesImpl(
  _prev: UpdateEntriesState | null,
  formData: FormData,
): Promise<UpdateEntriesState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const runId = uuidField("run id").safeParse(formData.get("run_id"));
    if (!runId.success) return invalid(runId.error.issues[0]?.message ?? "Invalid run id.");

    const raw = formData.get("patches");
    if (typeof raw !== "string" || raw.trim().length === 0) return invalid("Nothing to update.");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return invalid("patches is not valid JSON.");
    }
    const patches = EntryBatchSchema.safeParse(parsedJson);
    if (!patches.success) return invalid(patches.error.issues[0]?.message ?? "Invalid entry patches.");
    if (patches.data.some((p) => Object.keys(p.patch).length === 0)) {
      return invalid("Nothing to update for one of the rows.");
    }

    const { updated } = await updatePayrollEntriesBatch(
      shopId,
      runId.data,
      patches.data.map((p) => ({
        runEmployeeId: p.run_employee_id,
        patch: p.patch as PayrollEntryPatch,
      })),
      { userId, label: email },
    );
    return { ok: true, data: { updated }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updatePayrollEntriesAction = wrapQtekAction("payrollUpdateEntries", updatePayrollEntriesImpl);

type UpdateRunState = QboActionResult<{ updated: true }>;

async function updatePayrollRunImpl(_prev: UpdateRunState | null, formData: FormData): Promise<UpdateRunState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = uuidField("run id").safeParse(formData.get("run_id"));
    if (!id.success) return invalid(id.error.issues[0]?.message ?? "Invalid run id.");
    const bonusRaw = formData.get("bonus_period");
    if (bonusRaw !== "on" && bonusRaw !== "true" && bonusRaw !== "false" && bonusRaw !== null) {
      return invalid("bonus_period must be a boolean.");
    }

    // Only the submitted fields enter the patch: the toggle sends bonus_period,
    // the month picker (round-5 #33) sends bonus_month — never both implied.
    const patch: { bonusPeriod?: boolean; bonusMonth?: string } = {};
    if (bonusRaw !== null) patch.bonusPeriod = bonusRaw === "on" || bonusRaw === "true";
    const monthRaw = formData.get("bonus_month");
    if (monthRaw !== null) {
      const month = z
        .string()
        .regex(/^\d{4}-\d{2}-01$/, "The bonus month must be a YYYY-MM-01 date.")
        .safeParse(monthRaw);
      if (!month.success) return invalid(month.error.issues[0]?.message ?? "Invalid bonus month.");
      patch.bonusMonth = month.data;
    }
    if (patch.bonusPeriod === undefined && patch.bonusMonth === undefined) {
      return invalid("Nothing to update.");
    }

    await updatePayrollRun(shopId, id.data, patch, { userId, label: email });
    return { ok: true, data: { updated: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updatePayrollRunAction = wrapQtekAction("payrollUpdateRun", updatePayrollRunImpl);



type CompleteRunState = QboActionResult<{ completed: true }>;

async function completePayrollRunImpl(_prev: CompleteRunState | null, formData: FormData): Promise<CompleteRunState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = uuidField("run id").safeParse(formData.get("run_id"));
    if (!id.success) return invalid(id.error.issues[0]?.message ?? "Invalid run id.");

    const data = await completePayrollRun(shopId, id.data, { userId, label: email });
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const completePayrollRunAction = wrapQtekAction("payrollCompleteRun", completePayrollRunImpl);

type VoidRunState = QboActionResult<{ voided: true; cloneRunId: string }>;

async function voidPayrollRunImpl(_prev: VoidRunState | null, formData: FormData): Promise<VoidRunState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = uuidField("run id").safeParse(formData.get("run_id"));
    if (!id.success) return invalid(id.error.issues[0]?.message ?? "Invalid run id.");
    const reason = z
      .string()
      .trim()
      .min(1, "A void reason is required.")
      .max(1000)
      .safeParse(formData.get("reason"));
    if (!reason.success) return invalid(reason.error.issues[0]?.message ?? "A void reason is required.");

    const data = await voidPayrollRun(shopId, id.data, reason.data, { userId, label: email });
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const voidPayrollRunAction = wrapQtekAction("payrollVoidRun", voidPayrollRunImpl);

// ── Settings ───────────────────────────────────────────────────────────────────

/** A comma-separated recipient list: "" clears it; every entry must be an address. */
const emailListField = (which: string) =>
  z
    .string()
    .trim()
    .max(1000)
    .refine(
      (v) => v.split(",").map((e) => e.trim()).filter(Boolean).every((e) => emailRx.test(e)),
      `${which} recipients must be valid email addresses, separated by commas.`,
    )
    .optional();

/** One PTO tenure-tier entry (plan §2d). The ladder-level invariants (sorted,
 *  unique min_years, must-include-0-when-non-empty) are enforced by the DAL's
 *  assertPtoTenureTiers + the SQL validator — this just shapes each element. */
const PtoTenureTierField = z
  .object({
    min_years: z.number().int().min(0),
    hours_per_period: z.number().min(0),
  })
  .strict();

const SettingsFieldsSchema = z.object({
  anchorPeriodStart: isoDateField("Anchor period start").optional(),
  voidCloneAlertEmails: emailListField("Void alert"),
  completedAlertEmails: emailListField("Completed alert"),
  // Round-11 PTO alert lists — INDEPENDENT top-level payroll keys (plan §10.1,
  // C25). Unlike the legacy void_clone/completed pair, these do NOT travel
  // together: a tiers/rollover save carries no email field; an email-list save
  // carries no tiers. Each is its own optional whole-replace patch below.
  ptoAdjustmentAlertEmails: emailListField("PTO adjustment alert"),
  ptoNegativeAlertAdminEmails: emailListField("PTO negative-balance alert"),
});

type UpdateSettingsState = QboActionResult<{ payroll: PayrollSettings }>;

async function updatePayrollSettingsImpl(
  _prev: UpdateSettingsState | null,
  formData: FormData,
): Promise<UpdateSettingsState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = SettingsFieldsSchema.safeParse({
      anchorPeriodStart: formData.get("anchor_period_start") || undefined,
      voidCloneAlertEmails:
        formData.get("void_clone_alert_emails") == null ? undefined : String(formData.get("void_clone_alert_emails")),
      completedAlertEmails:
        formData.get("completed_alert_emails") == null ? undefined : String(formData.get("completed_alert_emails")),
      ptoAdjustmentAlertEmails:
        formData.get("pto_adjustment_alert_emails") == null
          ? undefined
          : String(formData.get("pto_adjustment_alert_emails")),
      ptoNegativeAlertAdminEmails:
        formData.get("pto_negative_alert_admin_emails") == null
          ? undefined
          : String(formData.get("pto_negative_alert_admin_emails")),
    });
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid payroll settings.");

    let spiffCategories: z.infer<typeof SpiffCategorySchema>[] | undefined;
    const spiffRaw = formData.get("spiff_categories");
    if (spiffRaw !== null && String(spiffRaw).trim().length > 0) {
      let json: unknown;
      try {
        json = JSON.parse(String(spiffRaw));
      } catch {
        return invalid("spiff_categories is not valid JSON.");
      }
      const cats = z.array(SpiffCategorySchema).safeParse(json);
      if (!cats.success) return invalid(cats.error.issues[0]?.message ?? "Invalid spiff categories.");
      spiffCategories = cats.data;
    }

    // Round-11 PTO tiers — a JSON array like spiff_categories (the tiers editor
    // submits it). Absent field = leave unchanged; the DAL re-validates the
    // sorted/unique/0-tier ladder (assertPtoTenureTiers) before the RPC.
    let ptoTenureTiers: z.infer<typeof PtoTenureTierField>[] | undefined;
    const tiersRaw = formData.get("pto_tenure_tiers");
    if (tiersRaw !== null && String(tiersRaw).trim().length > 0) {
      let json: unknown;
      try {
        json = JSON.parse(String(tiersRaw));
      } catch {
        return invalid("pto_tenure_tiers is not valid JSON.");
      }
      const tiers = z.array(PtoTenureTierField).safeParse(json);
      if (!tiers.success) return invalid(tiers.error.issues[0]?.message ?? "Invalid PTO tiers.");
      ptoTenureTiers = tiers.data;
    }

    // Round-11 rollover cap — empty string clears it to null (unlimited); any
    // other value must be a number ≥ 0. Absent field = leave unchanged.
    let ptoRolloverCapHours: number | null | undefined;
    const capRaw = formData.get("pto_rollover_cap_hours");
    if (capRaw !== null) {
      const capStr = String(capRaw).trim();
      if (capStr.length === 0) {
        ptoRolloverCapHours = null;
      } else {
        const cap = z.coerce.number().min(0).safeParse(capStr);
        if (!cap.success) return invalid("The PTO rollover cap must be a number ≥ 0 (or empty for unlimited).");
        ptoRolloverCapHours = cap.data;
      }
    }

    const toList = (v: string | undefined) =>
      v === undefined ? undefined : v.split(",").map((e) => e.trim()).filter(Boolean);
    const voidList = toList(parsed.data.voidCloneAlertEmails);
    const completedList = toList(parsed.data.completedAlertEmails);
    const ptoAdjustmentList = toList(parsed.data.ptoAdjustmentAlertEmails);
    const ptoNegativeList = toList(parsed.data.ptoNegativeAlertAdminEmails);

    const patch: Partial<PayrollSettings> = {};
    if (parsed.data.anchorPeriodStart !== undefined) patch.anchor_period_start = parsed.data.anchorPeriodStart;
    if (spiffCategories !== undefined) patch.spiff_categories = spiffCategories;
    if (voidList !== undefined || completedList !== undefined) {
      // The DAL replaces alert_emails WHOLE — the settings form must always carry
      // both fields ("" clears a list), like the QBO settings page idiom.
      if (voidList === undefined || completedList === undefined) {
        return invalid('Both alert-email lists must be submitted together (send "" to clear one).');
      }
      patch.alert_emails = { void_clone: voidList, completed: completedList };
    }
    // The two PTO alert lists are INDEPENDENT top-level keys (C25) — each its own
    // whole-replace patch; they do NOT travel together with each other or with the
    // legacy pair.
    if (ptoTenureTiers !== undefined) patch.pto_tenure_tiers = ptoTenureTiers;
    if (ptoRolloverCapHours !== undefined) patch.pto_rollover_cap_hours = ptoRolloverCapHours;
    if (ptoAdjustmentList !== undefined) patch.pto_adjustment_alert_emails = ptoAdjustmentList;
    if (ptoNegativeList !== undefined) patch.pto_negative_alert_admin_emails = ptoNegativeList;
    if (Object.keys(patch).length === 0) return invalid("Nothing to update.");

    const payroll = await updatePayrollSettings(shopId, patch);
    return { ok: true, data: { payroll }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updatePayrollSettingsAction = wrapQtekAction("payrollUpdateSettings", updatePayrollSettingsImpl);

// ── Tekmetric refresh + category discovery ─────────────────────────────────────

type RefreshState = QboActionResult<{
  rosUpserted: number;
  bonusMonthRosUpserted: number | null;
  newCategories: string[];
}>;

async function refreshPayrollTekmetricDataImpl(_prev: RefreshState | null, formData: FormData): Promise<RefreshState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = uuidField("run id").safeParse(formData.get("run_id"));
    if (!id.success) return invalid(id.error.issues[0]?.message ?? "Invalid run id.");

    const result: PayrollRefreshResult = await refreshRunTekmetricData(shopId, id.data);
    return {
      ok: true,
      data: {
        rosUpserted: result.period.rosUpserted,
        bonusMonthRosUpserted: result.bonusMonth?.rosUpserted ?? null,
        newCategories: result.newCategories,
      },
      timestamp: Date.now(),
    };
  } catch (e) {
    return qboFailure(e);
  }
}
export const refreshPayrollTekmetricDataAction = wrapQtekAction(
  "payrollRefreshTekmetricData",
  refreshPayrollTekmetricDataImpl,
);

/**
 * Round-7 #42 dry run: live Tekmetric re-fetch for the period (+ bonus month)
 * → fresh recompute (committed) → structured before/after diff for the modal.
 * Admin + open runs only (the DAL re-enforces open-run-only).
 */
type DryRunState = QboActionResult<PayrollDryRunResult>;

async function dryRunPayrollImpl(_prev: DryRunState | null, formData: FormData): Promise<DryRunState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = uuidField("run id").safeParse(formData.get("run_id"));
    if (!id.success) return invalid(id.error.issues[0]?.message ?? "Invalid run id.");

    const data = await dryRunPayrollRefresh(shopId, id.data);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const dryRunPayrollAction = wrapQtekAction("payrollDryRun", dryRunPayrollImpl);

type DiscoverState = QboActionResult<{ added: string[] }>;

async function discoverPayrollCategoriesImpl(
  _prev: DiscoverState | null,
  _formData: FormData,
): Promise<DiscoverState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const data = await discoverAndMergePayrollCategories(shopId);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const discoverPayrollCategoriesAction = wrapQtekAction(
  "payrollDiscoverCategories",
  discoverPayrollCategoriesImpl,
);

// ── Tekmetric employee picker (read-only; loads on demand from the add/edit form) ──

export type TekmetricEmployeeOption = {
  id: number;
  name: string;
  roleName: string | null;
};
type ListTekEmployeesState = QboActionResult<{ employees: TekmetricEmployeeOption[] }>;

async function listTekmetricEmployeesImpl(
  _prev: ListTekEmployeesState | null,
  _formData: FormData,
): Promise<ListTekEmployeesState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const employees = await listTekmetricEmployees(shopId);
    return {
      ok: true,
      data: {
        employees: employees.map((e) => ({
          id: e.id,
          name: [e.firstName, e.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || `#${e.id}`,
          roleName: e.employeeRole?.name ?? null,
        })),
      },
      timestamp: Date.now(),
    };
  } catch (e) {
    return qboFailure(e);
  }
}
export const listTekmetricEmployeesAction = wrapQtekAction(
  "payrollListTekmetricEmployees",
  listTekmetricEmployeesImpl,
);
