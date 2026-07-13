"use server";

/**
 * Payroll PTO + employee-management server actions (plan §6 of
 * docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md) — the round-11
 * mutations behind the Employees page PTO/adjust/archive dialogs and the completed
 * run page's "Resend failed summaries" affordance.
 *
 * SAME thin idiom as src/actions/payroll.ts (this module departs from
 * next-safe-action): requireQtekUser() FIRST, admin gate on every mutation, Zod-
 * validate the form input, delegate to the fat PTO DAL (src/lib/dal/payroll-pto*,
 * re-exported through @/lib/dal/payroll), return a typed QboActionResult shaped for
 * React 19 useActionState (prevState, formData). shop_id is ALWAYS the session's —
 * NEVER read from a form field / URL / client payload (multi-tenant rule).
 *
 * The DAL owns the business rules (non-zero + required reason on adjust; profile
 * patch semantics — present=write, JSON null=clear, absent=keep; unarchive clears
 * termination_date server-side; the completed-only resend guard). These wrappers
 * only shape + gate the request.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { emailRx } from "@/lib/validate";
import {
  adjustPto,
  archiveEmployee,
  resendFailedPaySummaries,
  seedInitialBalance,
  sendPtoAdjustmentAlert,
  unarchiveEmployee,
  updateEmployeeProfile,
  type EmployeeProfilePatch,
  type PaySummarySendResult,
} from "@/lib/dal/payroll";
import { qboFailure, type QboActionResult } from "./qbo/result";

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required for payroll changes.", timestamp: Date.now() };
}

function invalid(message: string): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message, timestamp: Date.now() };
}

/** Parse a form field that carries a JSON object (the profile patch). Mirrors the
 *  payroll.ts helper: null/blank ⇒ null; non-object ⇒ throw. */
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

/** A signed, finite, non-zero hours amount within the ledger's fat-finger bound
 *  (|hours| ≤ 500 — the DB CHECK; the DAL re-checks non-zero + finite). */
const signedHoursField = z
  .number({ message: "A numeric hours amount is required." })
  .finite("The hours amount must be a finite number.")
  .refine((v) => v !== 0, "A non-zero hours amount is required.")
  .refine((v) => Math.abs(v) <= 500, "The hours amount must be within ±500.");

// ── Adjust PTO (signed hours + REQUIRED reason) ─────────────────────────────────

type AdjustPtoState = QboActionResult<{ balanceAfterHours: number }>;

async function adjustPtoImpl(_prev: AdjustPtoState | null, formData: FormData): Promise<AdjustPtoState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const employeeId = uuidField("employee id").safeParse(formData.get("employee_id"));
    if (!employeeId.success) return invalid(employeeId.error.issues[0]?.message ?? "Invalid employee id.");

    const hours = signedHoursField.safeParse(Number(formData.get("hours")));
    if (!hours.success) return invalid(hours.error.issues[0]?.message ?? "Invalid hours amount.");

    // Reason is REQUIRED for an adjustment (the DAL + the DB CHECK re-enforce it);
    // fail early with a clean message rather than surfacing the RPC RAISE.
    const reason = z
      .string()
      .trim()
      .min(1, "A reason is required for a PTO adjustment.")
      .max(1000)
      .safeParse(formData.get("reason"));
    if (!reason.success) return invalid(reason.error.issues[0]?.message ?? "A reason is required for a PTO adjustment.");

    const result = await adjustPto(shopId, employeeId.data, hours.data, reason.data, { userId, label: email });
    // Plan #58: an accepted adjustment alerts the pto_adjustment_alert_emails list.
    // Post-commit + self-contained never-throw (the ledger already committed — a
    // bounce must not fail the action); no-op when the list is unconfigured.
    await sendPtoAdjustmentAlert(shopId, employeeId.data, hours.data, reason.data, result.balanceAfterHours);
    return { ok: true, data: { balanceAfterHours: result.balanceAfterHours }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const adjustPtoAction = wrapQtekAction("payrollAdjustPto", adjustPtoImpl);

// ── Seed initial PTO balance (signed hours; reason OPTIONAL) ─────────────────────

type SeedBalanceState = QboActionResult<{ balanceAfterHours: number }>;

async function seedInitialBalanceImpl(_prev: SeedBalanceState | null, formData: FormData): Promise<SeedBalanceState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const employeeId = uuidField("employee id").safeParse(formData.get("employee_id"));
    if (!employeeId.success) return invalid(employeeId.error.issues[0]?.message ?? "Invalid employee id.");

    const hours = signedHoursField.safeParse(Number(formData.get("hours")));
    if (!hours.success) return invalid(hours.error.issues[0]?.message ?? "Invalid hours amount.");

    // Reason is OPTIONAL for an initial seed (kind='initial'). A blank/absent field
    // ⇒ undefined ⇒ the DAL sends a null reason.
    const reasonRaw = formData.get("reason");
    let reason: string | undefined;
    if (reasonRaw !== null) {
      const parsed = z.string().trim().max(1000).safeParse(reasonRaw);
      if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid reason.");
      reason = parsed.data.length > 0 ? parsed.data : undefined;
    }

    const result = await seedInitialBalance(shopId, employeeId.data, hours.data, { userId, label: email }, reason);
    return { ok: true, data: { balanceAfterHours: result.balanceAfterHours }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const seedInitialBalanceAction = wrapQtekAction("payrollSeedInitialBalance", seedInitialBalanceImpl);

// ── Employee profile patch (contact/personal/date fields) ───────────────────────

/**
 * The nine editable profile columns (plan §2a). Shape-only here — the RPC is the
 * authority (unknown keys RAISE server-side; emails/dates cast). strictObject so a
 * typo'd key fails LOUD in the action rather than being silently dropped. Every
 * field is optional; `.nullable()` on the clearable columns preserves the JSON-null
 * = CLEAR semantic end-to-end. pto_grandfathered is a boolean (NOT NULL column —
 * no null form).
 */
const nullableStr = (label: string, max = 500) =>
  z.string().trim().max(max, `${label} is too long.`).nullable();
const nullableDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be an ISO date (YYYY-MM-DD).`)
    .nullable();
// Match the sibling action's email idiom (emailRx from @/lib/validate) rather than
// zod's deprecated .email(); a blank string is NOT a valid address — clearing an
// email uses JSON null (the patch-clear semantic), not "".
const nullableEmail = (label: string) =>
  z
    .string()
    .trim()
    .max(320, `${label} is too long.`)
    .refine((v) => emailRx.test(v), `${label} must be a valid address.`)
    .nullable();

const EmployeeProfilePatchSchema = z
  .strictObject({
    work_email: nullableEmail("The work email"),
    personal_email: nullableEmail("The personal email"),
    personal_phone: nullableStr("The personal phone", 50),
    work_phone: nullableStr("The work phone", 50),
    address: nullableStr("The address", 1000),
    start_date: nullableDate("The start date"),
    termination_date: nullableDate("The termination date"),
    pto_grandfathered: z.boolean(),
    pto_tenure_credit_date: nullableDate("The tenure-credit date"),
  })
  .partial();

type UpdateProfileState = QboActionResult<{ updated: true }>;

async function updateEmployeeProfileImpl(
  _prev: UpdateProfileState | null,
  formData: FormData,
): Promise<UpdateProfileState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const employeeId = uuidField("employee id").safeParse(formData.get("employee_id"));
    if (!employeeId.success) return invalid(employeeId.error.issues[0]?.message ?? "Invalid employee id.");

    let raw: Record<string, unknown> | null;
    try {
      raw = parseJsonObject(formData.get("patch"), "patch");
    } catch (e) {
      return invalid(e instanceof Error ? e.message : "patch is not valid JSON.");
    }
    if (!raw || Object.keys(raw).length === 0) return invalid("Nothing to update.");

    const parsed = EmployeeProfilePatchSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid employee profile patch.");
    // Patch semantics ride through untouched: a key present with `null` clears it,
    // an absent key is left unchanged (the DAL's toJsonPatch omits undefined). Zod
    // .partial() drops absent keys, so only submitted fields reach the RPC.
    const patch = parsed.data as EmployeeProfilePatch;
    if (Object.keys(patch).length === 0) return invalid("Nothing to update.");

    await updateEmployeeProfile(shopId, employeeId.data, patch, { userId, label: email });
    return { ok: true, data: { updated: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updateEmployeeProfileAction = wrapQtekAction("payrollUpdateEmployeeProfile", updateEmployeeProfileImpl);

// ── Archive (with termination date) / unarchive ─────────────────────────────────

type ArchiveState = QboActionResult<{ archived: true }>;

async function archiveEmployeeImpl(_prev: ArchiveState | null, formData: FormData): Promise<ArchiveState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const employeeId = uuidField("employee id").safeParse(formData.get("employee_id"));
    if (!employeeId.success) return invalid(employeeId.error.issues[0]?.message ?? "Invalid employee id.");

    const terminationDate = isoDateField("Termination date").safeParse(formData.get("termination_date"));
    if (!terminationDate.success) {
      return invalid(terminationDate.error.issues[0]?.message ?? "A termination date is required to archive.");
    }

    // ONE profile-RPC call: p_patch {termination_date}, p_archived: true (plan §2a).
    await archiveEmployee(shopId, employeeId.data, terminationDate.data, { userId, label: email });
    return { ok: true, data: { archived: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const archiveEmployeeAction = wrapQtekAction("payrollArchiveEmployee", archiveEmployeeImpl);

type UnarchiveState = QboActionResult<{ unarchived: true }>;

async function unarchiveEmployeeImpl(_prev: UnarchiveState | null, formData: FormData): Promise<UnarchiveState> {
  try {
    const { shopId, role, userId, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const employeeId = uuidField("employee id").safeParse(formData.get("employee_id"));
    if (!employeeId.success) return invalid(employeeId.error.issues[0]?.message ?? "Invalid employee id.");

    // ONE profile-RPC call: p_archived: false; the RPC clears termination_date
    // server-side so a rehire accrues again (C8/C23/C36).
    await unarchiveEmployee(shopId, employeeId.data, { userId, label: email });
    return { ok: true, data: { unarchived: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const unarchiveEmployeeAction = wrapQtekAction("payrollUnarchiveEmployee", unarchiveEmployeeImpl);

// ── Resend failed pay summaries (the failed→pending retry path — C27) ────────────

type ResendState = QboActionResult<Pick<PaySummarySendResult, "attempted" | "sent" | "failed">>;

async function resendPaySummariesImpl(_prev: ResendState | null, formData: FormData): Promise<ResendState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const runId = uuidField("run id").safeParse(formData.get("run_id"));
    if (!runId.success) return invalid(runId.error.issues[0]?.message ?? "Invalid run id.");

    // The DAL guards completed-only, reclaims each failed row failed→pending, then
    // re-runs the isolated per-employee send (§2c/§5). Synchronous here (not after())
    // so the user sees the tally — this is an explicit, bounded retry, not the
    // completion-time fan-out.
    const result = await resendFailedPaySummaries(shopId, runId.data);
    return {
      ok: true,
      data: { attempted: result.attempted, sent: result.sent, failed: result.failed },
      timestamp: Date.now(),
    };
  } catch (e) {
    return qboFailure(e);
  }
}
export const resendPaySummariesAction = wrapQtekAction("payrollResendPaySummaries", resendPaySummariesImpl);
