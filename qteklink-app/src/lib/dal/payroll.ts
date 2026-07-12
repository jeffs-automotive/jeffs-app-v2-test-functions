/**
 * Payroll DAL (contract: docs/qteklink/payroll-contract.md §dal/payroll.ts) — the
 * PUBLIC entrypoint over the qteklink_payroll_* SECURITY DEFINER RPCs + the pure
 * engine (src/lib/payroll/*). Split per the ~500-line file policy:
 *   - payroll-shared.ts     — row shapes, coercers, guarded fetchers, settings READ;
 *   - payroll-compute.ts    — run computation assembly + the RunSnapshot v1 builder;
 *   - payroll-live.ts       — the round-7 #40/#41 LIVE-snapshot substrate (the
 *                             read-through computePayrollRun, mark-stale/store,
 *                             webhook mirror-apply, the < 6h QBO memo);
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
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
import { buildOpenRunSnapshot } from "@/lib/dal/payroll-compute";
import { issueConfirmToken, sendPayrollAlert, stateHashFrom } from "@/lib/dal/payroll-confirm";
import { assembleCompletionPtoEntries, runCompletionEmailFanout } from "@/lib/dal/payroll-completion";
import {
  computePayrollRun,
  markPayrollOpenRunsStale,
  recomputeAndStoreLiveSnapshot,
  refreshLiveSnapshotAfterMutation,
  type PayrollRunComputation,
} from "@/lib/dal/payroll-live";
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
// Round-7 #42: the dry-run check (live Tekmetric re-fetch → fresh recompute → diff).
export { dryRunPayrollRefresh } from "@/lib/dal/payroll-dry-run";
export type { PayrollDryRunResult } from "@/lib/dal/payroll-dry-run";
// Round-8 #43: the entry grid's ONE-Save atomic batch.
export { updatePayrollEntriesBatch } from "@/lib/dal/payroll-entries-batch";
export type { PayrollEntryBatchPatch } from "@/lib/dal/payroll-entries-batch";
// Round-11 (plan §2a/§2b/§3): PTO ledger reads, projections, initial/adjustment +
// employee-profile writes, and the completion entry builder + email fan-out.
export {
  getPtoBalance,
  getPtoBalances,
  getPtoLedger,
  getPtoRolloverLedger,
  projectRunPto,
  ptoFieldsFromEmployee,
  adjustPto,
  seedInitialBalance,
  updateEmployeeProfile,
  archiveEmployee,
  unarchiveEmployee,
} from "@/lib/dal/payroll-pto";
export type {
  AdjustPtoResult,
  EmployeeProfilePatch,
  EmployeePtoProjection,
  PtoLedgerEntry,
  PtoLedgerKind,
  PtoProjectionInput,
} from "@/lib/dal/payroll-pto";
export {
  computeCompletionPtoEntries,
  completionInputFrom,
  detectMissingPersonalEmails,
  renderAndSendPaySummaries,
  resendFailedPaySummaries,
  sendNegativeBalanceAlerts,
} from "@/lib/dal/payroll-pto-completion";
export type {
  CompletionPtoEntries,
  CompletionPtoInput,
  MissingEmailEmployee,
  NegativeAlertResult,
  NegativeBalanceEmployee,
  PaySummarySendResult,
} from "@/lib/dal/payroll-pto-completion";
// Round-11 (plan §4): the completion PTO-entry assembly + the post-response
// email fan-out (the after() workload) — split from THIS file per the ~500-line
// policy; completePayrollRun below calls into them.
export { assembleCompletionPtoEntries, runCompletionEmailFanout } from "@/lib/dal/payroll-completion";
export type { CompletionPtoPayload } from "@/lib/dal/payroll-completion";
export type { PayrollActor, PayrollAlertEmails, PayrollEmployee, PayrollEntryPatch };
export type { PayrollHourKey, PayrollRun, PayrollRunComputation, PayrollSettings };
export type { UpsertPayrollEmployeeInput };

// ── Settings write + new-category discovery ────────────────────────────────────

/**
 * PTO tenure-tier shape guard — mirrors the SQL validator (migration
 * 20260712200000): entries sorted ascending by UNIQUE min_years, and a
 * non-empty ladder MUST start at min_years 0. Empty = valid unconfigured.
 * Validated DAL-side too so the user sees a clean message before the RPC.
 */
export function assertPtoTenureTiers(tiers: PayrollSettings["pto_tenure_tiers"]): void {
  if (tiers.length === 0) return;
  for (const tier of tiers) {
    if (!Number.isInteger(tier.min_years) || tier.min_years < 0) {
      throw new QboClientError("Each PTO tier's minimum years must be a whole number ≥ 0.", { kind: "validation" });
    }
    if (!(tier.hours_per_period >= 0)) {
      throw new QboClientError("Each PTO tier's hours per period must be a number ≥ 0.", { kind: "validation" });
    }
  }
  if (tiers[0]!.min_years !== 0) {
    throw new QboClientError("The PTO tiers must start with a 0-years tier.", { kind: "validation" });
  }
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i]!.min_years <= tiers[i - 1]!.min_years) {
      throw new QboClientError("The PTO tiers must be sorted ascending by unique minimum years.", {
        kind: "validation",
      });
    }
  }
}

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
    // Round-11 PTO keys: each carried through the whole-object rebuild so a patch
    // touching only ONE field never wipes the others (the whole-replace-wipe guard,
    // C1 family). Required-on-the-interface ⇒ tsc fails this literal if a key is
    // dropped.
    pto_tenure_tiers:
      patch.pto_tenure_tiers !== undefined ? patch.pto_tenure_tiers : current.pto_tenure_tiers,
    pto_rollover_cap_hours:
      patch.pto_rollover_cap_hours !== undefined ? patch.pto_rollover_cap_hours : current.pto_rollover_cap_hours,
    pto_adjustment_alert_emails:
      patch.pto_adjustment_alert_emails !== undefined
        ? patch.pto_adjustment_alert_emails
        : current.pto_adjustment_alert_emails,
    pto_negative_alert_admin_emails:
      patch.pto_negative_alert_admin_emails !== undefined
        ? patch.pto_negative_alert_admin_emails
        : current.pto_negative_alert_admin_emails,
  };
  if (next.anchor_period_start !== null && !isIsoDate(next.anchor_period_start)) {
    throw new QboClientError("The payroll anchor date must be an ISO date (YYYY-MM-DD).", { kind: "validation" });
  }
  z.array(SpiffCategorySchema).parse(next.spiff_categories);
  assertPtoTenureTiers(next.pto_tenure_tiers);
  if (next.pto_rollover_cap_hours !== null && !(next.pto_rollover_cap_hours >= 0)) {
    throw new QboClientError("The PTO rollover cap must be a number ≥ 0 (or empty for unlimited).", {
      kind: "validation",
    });
  }

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
  // Round-7 #41: spiff-category edits (multiplier/counted/name) change service-
  // advisor spiff PAY on open runs — invalidate the live-snapshot cache like every
  // other post-commit mutation hook (this direct settings write was the one gap in
  // the invalidation matrix). The settings write already COMMITTED, so a mark
  // failure must not misreport the save as failed: capture + continue (the same
  // sanctioned idiom as refreshLiveSnapshotAfterMutation; the next webhook/edit/
  // nightly mark re-covers it).
  try {
    await markPayrollOpenRunsStale(shopId);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { qteklink_action: "payroll-settings-invalidate", shop_id: String(shopId) },
    });
  }
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
  // Round-7 #41: the roster change invalidates the live snapshot — recompute inline
  // (capture-not-throw inside; the stale flag guarantees a later recompute on failure).
  await refreshLiveSnapshotAfterMutation(shopId, runId);
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
    .select("id, run_id, shop_id, employee_id, role_snapshot, pay_config")
    .eq("id", runEmployeeId)
    .eq("shop_id", shopId)
    .limit(1);
  if (error) throw new Error(`payroll DAL: entry fetch failed: ${error.message}`);
  const row = (data ?? [])[0] as
    | {
        id: string;
        run_id: string;
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

  // Round-7 #41: the committed entry edit invalidates the live snapshot — recompute
  // THIS run inline (reads the fresh rows). Runs BEFORE the write-through below so a
  // write-through failure still refreshed the cache. Capture-not-throw inside.
  await refreshLiveSnapshotAfterMutation(shopId, row.run_id);

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

/**
 * Patch the run itself — bonus_period and/or an explicit bonus_month (round-5 #33:
 * the office-manager escape hatch; first-of-month date). Only the keys present in
 * the patch are sent — the RPC derives the auto month (month before the pay date,
 * i.e. period_end − 1 month) when the slider turns ON without an explicit pick,
 * validates the explicit month, and re-enforces open-run-only.
 */
export async function updatePayrollRun(
  shopId: number,
  runId: string,
  patch: { bonusPeriod?: boolean; bonusMonth?: string },
  actor: PayrollActor,
): Promise<void> {
  const jsonPatch: Record<string, unknown> = {};
  if (patch.bonusPeriod !== undefined) jsonPatch.bonus_period = patch.bonusPeriod;
  if (patch.bonusMonth !== undefined) {
    if (!isIsoDate(patch.bonusMonth) || !patch.bonusMonth.endsWith("-01")) {
      throw new QboClientError("The bonus month must be the first day of a month (YYYY-MM-01).", {
        kind: "validation",
      });
    }
    jsonPatch.bonus_month = patch.bonusMonth;
  }
  if (Object.keys(jsonPatch).length === 0) {
    throw new QboClientError("Nothing to update.", { kind: "validation" });
  }
  await fetchRunGuarded(shopId, runId);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_payroll_update_run", {
    p_run_id: runId,
    p_patch: jsonPatch,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_update_run", error);
  // Round-7 #41: the bonus toggle/month change reshapes the whole derivation —
  // recompute the live snapshot inline (capture-not-throw inside; stale flag backstops).
  await refreshLiveSnapshotAfterMutation(shopId, runId);
}

// ── Complete / void orchestration (Pattern S, all server-side) ─────────────────
// Token/hash helpers + the alert sender live in ./payroll-confirm.ts (file policy).

/**
 * Complete an open run — the full Pattern S dance in one server-side call:
 * RPC dry-run for the state hash FIRST, then build the snapshot (server-computed,
 * never client-supplied), then issue a single-use token bound to the hash and
 * confirm. Ordering matters: the confirm RPC recomputes the hash in-transaction and
 * aborts on any drift after the dry-run — a mid-build edit can never freeze stale.
 *
 * Round-7 #40 INVARIANT: completion NEVER reads the live snapshot (the #41 display
 * cache) — the frozen snapshot is ALWAYS built fresh right here, with a live
 * QBO tech-cost fetch (no memo). Asserted by payroll.test.ts.
 *
 * Round-11 (plan §4): the pure engine's accrual/usage/rollover_forfeit ledger
 * rows ride INTO the confirm RPC as p_pto_entries — a SEPARATE ledger RPC call
 * would be a separate transaction and NOT atomic (C5/C12/C32). The DRY-RUN branch
 * passes NO p_pto_entries so the hash/token Pattern-S flow stays byte-identical;
 * only the confirm call carries them. The action returns `{ completed: true }`
 * the instant confirm commits; the per-employee pay-summary + negative-balance
 * email fan-out runs POST-RESPONSE via Next 15 after() — sequential, never-throw
 * (C15/C26/C27), so a shared-Resend-key 429 can't stall the response.
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
    // Dry-run branch deliberately carries NO p_pto_entries — the Pattern-S
    // preview flow is byte-identical to the pre-round-11 hash/token dance
    // (PTO is advisory-display only and is NOT part of the state hash, so an
    // adjustment cannot invalidate an in-flight completion preview; N3/C16).
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

  // Round-11 §4: the engine's ledger payloads (accrual/usage/rollover_forfeit),
  // computed from the FROZEN snapshot's per-employee paid PTO hours + the master
  // profile columns + each employee's rollover ledger. Zero PTO configuration ⇒
  // an empty array ⇒ the confirm RPC writes no ledger rows and completion is
  // byte-identical to today (C14). Built BEFORE the token so a build failure
  // aborts cleanly without consuming a single-use token.
  const { entries: ptoEntries } = await assembleCompletionPtoEntries(shopId, snapshot);

  const tokenId = await issueConfirmToken(runId, "complete_run", stateHash, actor);

  const { data, error } = await admin.rpc("qteklink_payroll_complete_run", {
    p_run_id: runId,
    p_dry_run: false,
    p_confirm_token: tokenId,
    p_state_hash: stateHash,
    p_snapshot: snapshot,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
    // The confirm call carries the ledger payloads: the RPC inserts them + the
    // pay-summary email-log pre-inserts inside the ONE completion transaction,
    // BEFORE the status flip, under the shop ledger advisory lock (C5/C12/C32).
    p_pto_entries: ptoEntries,
  });
  if (error) throwRpc("qteklink_payroll_complete_run", error);
  if ((data as { completed?: unknown } | null)?.completed !== true) {
    throw new Error("qteklink_payroll_complete_run did not confirm completion");
  }

  // The confirm committed — return to the caller immediately. The whole email
  // workload (the completed-run alert + per-employee pay summaries + negative-
  // balance alerts) runs POST-RESPONSE via Next 15 after(): sequential (shared
  // Resend key) and never-throw (a bounce must not undo the completion).
  const alertLines = [
    `Pay period: ${run.period_start} to ${run.period_end}`,
    freshRun.bonus_period ? `Bonus period: yes (month ${freshRun.bonus_month ?? "?"})` : "Bonus period: no",
    `Completed by: ${actor.label}`,
    `Completed at: ${new Date().toISOString()}`,
    "",
    "The run is now locked read-only in QTekLink (Payroll tab).",
  ];
  after(async () => {
    await runCompletionEmailFanout(
      shopId,
      snapshot,
      `Payroll run completed — ${run.period_start} to ${run.period_end}`,
      alertLines,
    );
  });
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
 * Round-7 #40/#41: the refreshed mirror invalidates every open run's live snapshot;
 * THIS run recomputes immediately with a FRESH QBO tech-cost fetch (never the < 6h
 * memo) — failures propagate (the user asked; a half-refresh must be visible).
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
  await markPayrollOpenRunsStale(shopId);
  await recomputeAndStoreLiveSnapshot(shopId, runId, { freshQbo: true });
  return { period, bonusMonth, newCategories: added };
}
