/**
 * Payroll DAL (contract: docs/qteklink/payroll-contract.md §dal/payroll.ts) — the
 * PUBLIC entrypoint over the qteklink_payroll_* SECURITY DEFINER RPCs + the pure
 * engine (src/lib/payroll/*). Split per the ~500-line file policy:
 *   - payroll-shared.ts     — row shapes, coercers, guarded fetchers, settings READ;
 *   - payroll-compute.ts    — run computation assembly + the RunSnapshot v1 builder;
 *   - payroll-leave-rate.ts — the tech/foreman leave-rate basis (round-3 #24);
 *   - payroll-employees.ts  — employees CRUD + the pay_config write-through (#26);
 *   - THIS file             — runs list/detail/create/roster/patches, settings write
 *                             + new-category discovery, the Pattern S complete/void
 *                             orchestration, email alerts, per-run Tekmetric refresh.
 *                             Everything public re-exports from here.
 *
 * Pattern S (complete/void): the WHOLE dance runs server-side in one call —
 * RPC dry-run → state_hash → issue single-use token bound to it → confirm call;
 * the RPC recomputes the hash inside the transaction and aborts on drift, and the
 * completion snapshot is server-computed (never client-supplied).
 *
 * MULTI-TENANT: shopId comes from the caller's session (requireQtekUser) and every
 * run/entry RPC is preceded by a shop-ownership check (the RPCs key on bare uuids).
 * No silent failures: every Supabase call checks `error`; P0001 (deliberate RAISE)
 * surfaces as QboClientError(kind: validation) so actions show the business message.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendQteklinkEmail } from "@/lib/dal/notify";
import { QboClientError } from "@/lib/qbo/errors";
import { isIsoDate } from "@/lib/format";
import { z } from "zod";
import { discoverNewCategories, monthDateRange } from "@/lib/payroll/derive";
import {
  familyForRole,
  parsePayConfig,
  OverridesSchema,
  RoleSchema,
  SpiffCategorySchema,
  type Role,
  type SpiffCategory,
} from "@/lib/payroll/types";
import { runMirrorIngest, type MirrorIngestResult } from "@/lib/payroll/mirror-ingest";
import {
  DEFAULT_PAYROLL_SETTINGS,
  HOUR_KEYS,
  RUN_COLS,
  fetchEmployeesByIds,
  fetchRunEntries,
  fetchRunGuarded,
  getPayrollSettings,
  normalizeOverrides,
  runFromRow,
  sheetEntriesFromRow,
  throwRpc,
  type PayrollActor,
  type PayrollAlertEmails,
  type PayrollEmployee,
  type PayrollEntryPatch,
  type PayrollHourKey,
  type PayrollRun,
  type PayrollSettings,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";
import { buildOpenRunSnapshot, computePayrollRun, type PayrollRunComputation } from "@/lib/dal/payroll-compute";
import {
  listPayrollEmployees,
  upsertPayrollEmployee,
  writeThroughEmployeePayConfig,
  type UpsertPayrollEmployeeInput,
} from "@/lib/dal/payroll-employees";
import type { Family, Overrides, SheetEntries } from "@/lib/payroll/types";

// ── Public surface re-exports (the contract path is "@/lib/dal/payroll") ───────

export { DEFAULT_PAYROLL_SETTINGS, getPayrollSettings, computePayrollRun };
export { listPayrollEmployees, upsertPayrollEmployee };
// Read-only Tekmetric employee list for the add/edit form's ID picker
// (GET /employees via the tekmetric client; shop-scoped, no writes).
export { listEmployees as listTekmetricEmployees } from "@/lib/tekmetric/client";
export type { TekmetricEmployee } from "@/lib/tekmetric/client";
export { listPayrollRunsWithSummaries } from "@/lib/dal/payroll-summaries";
export type { PayrollRunWithSummary } from "@/lib/dal/payroll-summaries";
export type { PayrollActor, PayrollAlertEmails, PayrollEmployee, PayrollEntryPatch };
export type { PayrollHourKey, PayrollRun, PayrollRunComputation, PayrollSettings };
export type { UpsertPayrollEmployeeInput };

// ── Settings write + new-category discovery ────────────────────────────────────

/**
 * Partial-update the payroll settings object: read-modify-write of the WHOLE
 * `payroll` JSONB through qteklink_upsert_settings (p_payroll replaces when
 * non-null; every other param stays NULL = unchanged — the existing idiom).
 */
export async function updatePayrollSettings(
  shopId: number,
  patch: Partial<PayrollSettings>,
): Promise<PayrollSettings> {
  const { realmId, payroll: current } = await getPayrollSettings(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }
  const next: PayrollSettings = {
    anchor_period_start:
      patch.anchor_period_start !== undefined ? patch.anchor_period_start : current.anchor_period_start,
    spiff_categories: patch.spiff_categories !== undefined ? patch.spiff_categories : current.spiff_categories,
    alert_emails: patch.alert_emails !== undefined ? patch.alert_emails : current.alert_emails,
  };
  if (next.anchor_period_start !== null && !isIsoDate(next.anchor_period_start)) {
    throw new QboClientError("The payroll anchor date must be an ISO date (YYYY-MM-DD).", { kind: "validation" });
  }
  z.array(SpiffCategorySchema).parse(next.spiff_categories);

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_upsert_settings", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_auto_post: null,
    p_settle_window_minutes: null,
    p_shop_timezone: null,
    p_sales_tax_rate_bps: null,
    p_tire_fee_cents: null,
    p_date_change_alert_emails: null,
    p_day_correction_alert_emails: null,
    p_payroll: next,
  });
  if (error) throwRpc("qteklink_upsert_settings", error);
  return next;
}

/**
 * New-category catcher (round-2 decision #15): diff distinct mirror
 * job_category_name values against the known set; append unknowns as
 * { counted: false, multiplier: 1, is_new: true } and surface them to the UI.
 */
export async function discoverAndMergePayrollCategories(shopId: number): Promise<{ added: string[] }> {
  const { realmId, payroll } = await getPayrollSettings(shopId);
  const fresh = await discoverNewCategories(
    shopId,
    payroll.spiff_categories.map((c) => c.name),
  );
  if (fresh.length === 0 || !realmId) return { added: fresh.length === 0 ? [] : fresh };
  const firstSeen = new Date().toISOString();
  const merged: SpiffCategory[] = [
    ...payroll.spiff_categories,
    ...fresh.map((name) => ({ name, counted: false, multiplier: 1, first_seen: firstSeen, is_new: true })),
  ];
  await updatePayrollSettings(shopId, { spiff_categories: merged });
  return { added: fresh };
}

// ── Runs: list / detail / create / roster / patches ────────────────────────────

export async function listPayrollRuns(shopId: number, opts: { limit?: number } = {}): Promise<PayrollRun[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_runs")
    .select(RUN_COLS)
    .eq("shop_id", shopId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 52);
  if (error) throw new Error(`listPayrollRuns failed: ${error.message}`);
  return ((data ?? []) as RunDbRow[]).map(runFromRow);
}

export interface PayrollRunEntry {
  id: string;
  runId: string;
  employeeId: string;
  displayName: string;
  roleSnapshot: Role;
  family: Family;
  tekmetricEmployeeId: number | null;
  tekmetricIdType: "technician" | "service_writer" | null;
  /** Raw run-level pay_config JSONB (rates_w2 allowed here). */
  payConfig: Record<string, unknown>;
  entries: SheetEntries;
  overrides: Overrides;
  updatedAt: string;
}

export interface PayrollRunDetail {
  run: PayrollRun;
  entries: PayrollRunEntry[];
}

/** Run + its entry rows joined with employee identity (sorted by display name). */
export async function getPayrollRun(shopId: number, runId: string): Promise<PayrollRunDetail> {
  const run = await fetchRunGuarded(shopId, runId);
  const rows = await fetchRunEntries(runId);
  const employees = await fetchEmployeesByIds(shopId, rows.map((r) => r.employee_id));
  const entries = rows
    .map((r): PayrollRunEntry => {
      const emp = employees.get(r.employee_id);
      const role = RoleSchema.parse(r.role_snapshot);
      return {
        id: r.id,
        runId: r.run_id,
        employeeId: r.employee_id,
        displayName: emp?.displayName ?? "(deleted employee)",
        roleSnapshot: role,
        family: familyForRole(role),
        tekmetricEmployeeId: emp?.tekmetricEmployeeId ?? null,
        tekmetricIdType: emp?.tekmetricIdType ?? null,
        payConfig: r.pay_config,
        entries: sheetEntriesFromRow(r),
        overrides: normalizeOverrides(r.overrides, `entry ${r.id}`),
        updatedAt: r.updated_at,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { run: runFromRow(run), entries };
}

export async function createPayrollRun(
  shopId: number,
  periodStart: string,
  actor: PayrollActor,
): Promise<string> {
  if (!isIsoDate(periodStart)) {
    throw new QboClientError("The period start must be an ISO date (YYYY-MM-DD).", { kind: "validation" });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_create_run", {
    p_shop_id: shopId,
    p_period_start: periodStart,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_create_run", error);
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("qteklink_payroll_create_run returned no run id");
  }
  return data;
}

export async function syncPayrollRunRoster(
  shopId: number,
  runId: string,
  actor: PayrollActor,
): Promise<{ added: string[]; removed: string[] }> {
  await fetchRunGuarded(shopId, runId);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_sync_run_roster", {
    p_run_id: runId,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_sync_run_roster", error);
  const result = (data ?? {}) as { added?: string[]; removed?: string[] };
  return { added: result.added ?? [], removed: result.removed ?? [] };
}

const hourPatchValue = z.number().min(0).max(120).nullable();
const manualIncentivePatchValue = z.number().int().min(0).max(5_000_000).nullable();

/**
 * Patch one entry row (open runs only — the RPC enforces it). Whitelist + shapes are
 * validated here first so the user sees a clean message, then again in SQL.
 * A pay_config patch ALSO writes through to the employee master (round-3 #26).
 */
export async function updatePayrollEntry(
  shopId: number,
  runEmployeeId: string,
  patch: PayrollEntryPatch,
  actor: PayrollActor,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_run_employees")
    .select("id, shop_id, employee_id, role_snapshot, pay_config")
    .eq("id", runEmployeeId)
    .eq("shop_id", shopId)
    .limit(1);
  if (error) throw new Error(`payroll DAL: entry fetch failed: ${error.message}`);
  const row = (data ?? [])[0] as
    | {
        id: string;
        shop_id: number;
        employee_id: string;
        role_snapshot: string;
        pay_config: Record<string, unknown> | null;
      }
    | undefined;
  if (!row) throw new QboClientError("Payroll entry not found.", { kind: "not_found" });

  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new QboClientError("Nothing to update.", { kind: "validation" });
  }
  const jsonPatch: Record<string, unknown> = {};
  for (const key of keys) {
    if ((HOUR_KEYS as readonly string[]).includes(key)) {
      jsonPatch[key] = hourPatchValue.parse(patch[key as PayrollHourKey]);
    } else if (key === "manual_incentive_cents") {
      jsonPatch[key] = manualIncentivePatchValue.parse(patch.manual_incentive_cents);
    } else if (key === "overrides") {
      jsonPatch[key] = OverridesSchema.parse(patch.overrides);
    } else if (key === "pay_config") {
      const role = RoleSchema.parse(row.role_snapshot);
      // rates_w2 IS allowed at the run level (mid-period rate change).
      jsonPatch[key] = parsePayConfig(familyForRole(role), patch.pay_config);
    } else {
      throw new QboClientError(`"${key}" is not an editable entry field.`, { kind: "validation" });
    }
  }

  const { error: rpcErr } = await admin.rpc("qteklink_payroll_update_entry", {
    p_run_employee_id: runEmployeeId,
    p_patch: jsonPatch,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (rpcErr) throwRpc("qteklink_payroll_update_entry", rpcErr);

  // Round-3 decision #26: a run-level pay_config edit WRITES THROUGH to the employee
  // master (only the keys the edit changed — diffed against the entry's previous
  // pay_config) so future runs prefill the new values. Runs AFTER the entry RPC
  // commits — on failure the entry edit itself already stands, so the error must say
  // exactly that (retrying the same save re-applies both idempotently).
  if ("pay_config" in jsonPatch) {
    try {
      await writeThroughEmployeePayConfig(
        shopId,
        row.employee_id,
        RoleSchema.parse(row.role_snapshot),
        jsonPatch.pay_config as Record<string, unknown>,
        row.pay_config ?? {},
        actor,
      );
    } catch (e) {
      // Half-apply: the entry row COMMITTED; only the copy to the employee master
      // failed. A bare rethrow would read as the whole edit failing — surface the
      // ordering explicitly (and keep it fail-loud: captured to Sentry; business
      // causes ride along, system internals never leak to the browser).
      Sentry.captureException(e, {
        tags: { surface: "qteklink-payroll", step: "pay_config_write_through" },
        extra: { runEmployeeId, employeeId: row.employee_id },
      });
      const cause = e instanceof QboClientError ? ` (${e.message})` : "";
      throw new QboClientError(
        "The entry was saved, but copying the pay config to the employee record failed — " +
          `re-save the same pay config to retry.${cause}`,
        { kind: "validation", cause: e },
      );
    }
  }
}

/** Patch the run itself — bonus_period only (the RPC derives + stores bonus_month). */
export async function updatePayrollRun(
  shopId: number,
  runId: string,
  patch: { bonusPeriod: boolean },
  actor: PayrollActor,
): Promise<void> {
  await fetchRunGuarded(shopId, runId);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_payroll_update_run", {
    p_run_id: runId,
    p_patch: { bonus_period: patch.bonusPeriod },
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_update_run", error);
}

// ── Complete / void orchestration (Pattern S, all server-side) ─────────────────

interface TokenRow {
  token_id: string;
  expires_at: string;
}

async function issueConfirmToken(
  runId: string,
  actionKind: "complete_run" | "void_run",
  scopeHash: string,
  actor: PayrollActor,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_issue_confirm_token", {
    p_run_id: runId,
    p_action_kind: actionKind,
    p_scope_hash: scopeHash,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_issue_confirm_token", error);
  const row = (Array.isArray(data) ? data[0] : data) as TokenRow | undefined;
  if (!row || typeof row.token_id !== "string") {
    throw new Error("qteklink_payroll_issue_confirm_token returned no token");
  }
  return row.token_id;
}

function stateHashFrom(data: unknown, fn: string): string {
  const hash = (data as { state_hash?: unknown } | null)?.state_hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error(`${fn} dry run returned no state_hash`);
  }
  return hash;
}

/** Payroll alert email via the notify idiom. NEVER throws into the caller: by the
 *  time this runs the complete/void already committed — a failed settings read or
 *  send must not make the action look failed. Captured to Sentry instead. */
async function sendPayrollAlert(
  shopId: number,
  list: keyof PayrollAlertEmails,
  subject: string,
  lines: string[],
): Promise<void> {
  try {
    const { payroll } = await getPayrollSettings(shopId);
    await sendQteklinkEmail({ to: payroll.alert_emails[list], subject, text: lines.join("\n") });
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "qteklink-payroll-alert", alert_list: list } });
  }
}

/**
 * Complete an open run — the full Pattern S dance in one server-side call:
 * RPC dry-run for the state hash FIRST, then build the snapshot (server-computed,
 * never client-supplied), then issue a single-use token bound to the hash and
 * confirm. Ordering matters: the confirm RPC recomputes the hash in-transaction and
 * aborts on any drift after the dry-run — a mid-build edit can never freeze stale.
 */
export async function completePayrollRun(
  shopId: number,
  runId: string,
  actor: PayrollActor,
): Promise<{ completed: true }> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "open") {
    throw new QboClientError(`This run is ${run.status} — only open runs can be completed.`, {
      kind: "validation",
    });
  }

  const admin = createSupabaseAdminClient();
  const { data: dryData, error: dryErr } = await admin.rpc("qteklink_payroll_complete_run", {
    p_run_id: runId,
    p_dry_run: true,
    p_confirm_token: null,
    p_state_hash: null,
    p_snapshot: null,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (dryErr) throwRpc("qteklink_payroll_complete_run", dryErr);
  const stateHash = stateHashFrom(dryData, "qteklink_payroll_complete_run");

  // Re-fetch AFTER the dry-run so the snapshot is built from run state the hash
  // covers (e.g. a bonus toggle landing between the first fetch and the dry run
  // would otherwise freeze a snapshot computed under stale bonus flags while the
  // hash check still passes). Any run-level change AFTER the hash is either in
  // this fresh row or aborts the confirm on the in-transaction hash recompute.
  const freshRun = await fetchRunGuarded(shopId, runId);
  if (freshRun.status !== "open") {
    throw new QboClientError(`This run is ${freshRun.status} — only open runs can be completed.`, {
      kind: "validation",
    });
  }
  const snapshot = await buildOpenRunSnapshot(shopId, freshRun);

  const tokenId = await issueConfirmToken(runId, "complete_run", stateHash, actor);

  const { data, error } = await admin.rpc("qteklink_payroll_complete_run", {
    p_run_id: runId,
    p_dry_run: false,
    p_confirm_token: tokenId,
    p_state_hash: stateHash,
    p_snapshot: snapshot,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_complete_run", error);
  if ((data as { completed?: unknown } | null)?.completed !== true) {
    throw new Error("qteklink_payroll_complete_run did not confirm completion");
  }

  await sendPayrollAlert(
    shopId,
    "completed",
    `Payroll run completed — ${run.period_start} to ${run.period_end}`,
    [
      `Pay period: ${run.period_start} to ${run.period_end}`,
      freshRun.bonus_period ? `Bonus period: yes (month ${freshRun.bonus_month ?? "?"})` : "Bonus period: no",
      `Completed by: ${actor.label}`,
      `Completed at: ${new Date().toISOString()}`,
      "",
      "The run is now locked read-only in QTekLink (Payroll tab).",
    ],
  );
  return { completed: true };
}

/**
 * Void-and-clone a completed run (round-2 decision #19): same Pattern S dance with
 * kind void_run. The voided run stays frozen forever; the RPC clones every input row
 * into a new open run for the same period with lineage.
 */
export async function voidPayrollRun(
  shopId: number,
  runId: string,
  reason: string,
  actor: PayrollActor,
): Promise<{ voided: true; cloneRunId: string }> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "completed") {
    throw new QboClientError(`This run is ${run.status} — only completed runs can be voided.`, {
      kind: "validation",
    });
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new QboClientError("A void reason is required.", { kind: "validation" });
  }

  const admin = createSupabaseAdminClient();
  const { data: dryData, error: dryErr } = await admin.rpc("qteklink_payroll_void_run", {
    p_run_id: runId,
    p_reason: trimmedReason,
    p_dry_run: true,
    p_confirm_token: null,
    p_state_hash: null,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (dryErr) throwRpc("qteklink_payroll_void_run", dryErr);
  const stateHash = stateHashFrom(dryData, "qteklink_payroll_void_run");

  const tokenId = await issueConfirmToken(runId, "void_run", stateHash, actor);

  const { data, error } = await admin.rpc("qteklink_payroll_void_run", {
    p_run_id: runId,
    p_reason: trimmedReason,
    p_dry_run: false,
    p_confirm_token: tokenId,
    p_state_hash: stateHash,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_void_run", error);
  const result = data as { voided?: unknown; clone_run_id?: unknown } | null;
  if (result?.voided !== true || typeof result.clone_run_id !== "string") {
    throw new Error("qteklink_payroll_void_run did not confirm the void + clone");
  }

  await sendPayrollAlert(
    shopId,
    "void_clone",
    `Payroll run VOIDED — ${run.period_start} to ${run.period_end}`,
    [
      `Pay period: ${run.period_start} to ${run.period_end}`,
      `Voided by: ${actor.label}`,
      `Reason: ${trimmedReason}`,
      `Voided at: ${new Date().toISOString()}`,
      "",
      "A new OPEN run was cloned from the voided run's inputs (same period) —",
      "review and complete it in QTekLink (Payroll tab).",
    ],
  );
  return { voided: true, cloneRunId: result.clone_run_id };
}

// ── Per-run Tekmetric refresh (mirror-ingest range mode) ───────────────────────

export interface PayrollRefreshResult {
  period: MirrorIngestResult;
  bonusMonth: MirrorIngestResult | null;
  newCategories: string[];
}

/**
 * "Refresh Tekmetric data" for one OPEN run: range-mode mirror ingest over the run's
 * period (posted-date window), plus the bonus month when the slider is on, then the
 * new-category catcher. Never touches the incremental watermark (range mode).
 */
export async function refreshRunTekmetricData(shopId: number, runId: string): Promise<PayrollRefreshResult> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "open") {
    throw new QboClientError("Only open runs can be refreshed — completed runs render from their snapshot.", {
      kind: "validation",
    });
  }
  const period = await runMirrorIngest(
    { shopId },
    { mode: "range", postedDateStart: run.period_start, postedDateEnd: run.period_end },
  );
  let bonusMonth: MirrorIngestResult | null = null;
  if (run.bonus_period && run.bonus_month) {
    const { start, end } = monthDateRange(run.bonus_month.slice(0, 7));
    bonusMonth = await runMirrorIngest({ shopId }, { mode: "range", postedDateStart: start, postedDateEnd: end });
  }
  const { added } = await discoverAndMergePayrollCategories(shopId);
  return { period, bonusMonth, newCategories: added };
}
