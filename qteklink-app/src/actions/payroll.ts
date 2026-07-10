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
  refreshRunTekmetricData,
  syncPayrollRunRoster,
  updatePayrollEntry,
  updatePayrollRun,
  updatePayrollSettings,
  upsertPayrollEmployee,
  voidPayrollRun,
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

    await updatePayrollRun(
      shopId,
      id.data,
      { bonusPeriod: bonusRaw === "on" || bonusRaw === "true" },
      { userId, label: email },
    );
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

const SettingsFieldsSchema = z.object({
  anchorPeriodStart: isoDateField("Anchor period start").optional(),
  voidCloneAlertEmails: emailListField("Void alert"),
  completedAlertEmails: emailListField("Completed alert"),
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

    const toList = (v: string | undefined) =>
      v === undefined ? undefined : v.split(",").map((e) => e.trim()).filter(Boolean);
    const voidList = toList(parsed.data.voidCloneAlertEmails);
    const completedList = toList(parsed.data.completedAlertEmails);

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
