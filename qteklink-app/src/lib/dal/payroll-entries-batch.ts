/**
 * Payroll DAL — the round-8 #43 ATOMIC BATCH entry save (the entry grid's ONE
 * Save button). Internal support module for src/lib/dal/payroll.ts (the public
 * entrypoint per the contract module layout) — split out per the ~500-line file
 * policy, mirroring payroll-dry-run.ts. Import from "@/lib/dal/payroll".
 *
 * One call = one transaction: qteklink_payroll_update_entries applies every
 * row's changed-keys-only patch through the SAME validator as the single
 * qteklink_payroll_update_entry (the shared apply_entry_patch helper,
 * 20260711220000) and any invalid row rolls back EVERYTHING — the repo's
 * non-atomic-multi-write invariant. After the RPC commits, ONE inline
 * recompute + live-snapshot store runs (the round-7 #41 post-mutation hook).
 *
 * MULTI-TENANT: shopId comes from the caller's session; fetchRunGuarded asserts
 * run ownership before the bare-uuid RPC, and the RPC enforces that every row
 * belongs to THAT run (cross-run smuggling RAISEs). No silent failures: the RPC
 * error is checked; P0001 surfaces as QboClientError(kind: validation).
 */
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QboClientError } from "@/lib/qbo/errors";
import {
  HOUR_KEYS,
  fetchRunGuarded,
  throwRpc,
  type PayrollActor,
  type PayrollEntryPatch,
  type PayrollHourKey,
} from "@/lib/dal/payroll-shared";
import { refreshLiveSnapshotAfterMutation } from "@/lib/dal/payroll-live";

// Same value rules as the single-entry path (updatePayrollEntry in payroll.ts).
const hourPatchValue = z.number().min(0).max(120).nullable();
const manualIncentivePatchValue = z.number().int().min(0).max(5_000_000).nullable();

/** One element of a #43 batch save: a run-employee row + its changed-keys-only patch. */
export interface PayrollEntryBatchPatch {
  runEmployeeId: string;
  patch: PayrollEntryPatch;
}

/**
 * Patch MANY entry rows as ONE ATOMIC batch. Batchable keys = the grid's fields
 * ONLY: the ten hour columns + manual_incentive_cents. pay_config and overrides
 * are deliberately REJECTED here — they keep their single-entry editors
 * (pay_config carries the round-3 #26 write-through, which must never silently
 * fork into a batch path that lacks it).
 */
export async function updatePayrollEntriesBatch(
  shopId: number,
  runId: string,
  patches: PayrollEntryBatchPatch[],
  actor: PayrollActor,
): Promise<{ updated: number }> {
  if (patches.length === 0) {
    throw new QboClientError("Nothing to update.", { kind: "validation" });
  }
  const jsonPatches = patches.map(({ runEmployeeId, patch }) => {
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      throw new QboClientError("Nothing to update for one of the rows.", { kind: "validation" });
    }
    const jsonPatch: Record<string, unknown> = {};
    for (const key of keys) {
      if ((HOUR_KEYS as readonly string[]).includes(key)) {
        jsonPatch[key] = hourPatchValue.parse(patch[key as PayrollHourKey]);
      } else if (key === "manual_incentive_cents") {
        jsonPatch[key] = manualIncentivePatchValue.parse(patch.manual_incentive_cents);
      } else {
        throw new QboClientError(
          `"${key}" cannot be batch-saved — only hour and incentive fields can. ` +
            "Pay config and overrides use their own editors.",
          { kind: "validation" },
        );
      }
    }
    return { run_employee_id: runEmployeeId, patch: jsonPatch };
  });

  // Shop-ownership guard for the bare-uuid RPC; the RPC itself enforces that
  // every row belongs to THIS run (cross-run smuggling RAISEs + rolls back).
  await fetchRunGuarded(shopId, runId);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_update_entries", {
    p_run_id: runId,
    p_patches: jsonPatches,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_update_entries", error);

  // Round-7 #41: ONE inline recompute + live-snapshot store for the WHOLE batch
  // (capture-not-throw inside; the stale flag guarantees a later recompute).
  // Runs BEFORE the return-shape check: the batch COMMITTED once error is null,
  // so the cache must be refreshed even if the count below is malformed.
  await refreshLiveSnapshotAfterMutation(shopId, runId);

  const updated = (data as { updated?: number } | null)?.updated;
  if (typeof updated !== "number") {
    throw new Error("qteklink_payroll_update_entries returned no updated count");
  }
  return { updated };
}
