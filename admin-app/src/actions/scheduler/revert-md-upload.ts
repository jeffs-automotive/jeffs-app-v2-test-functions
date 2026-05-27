"use server";

/**
 * revertMdUploadAction — UNIVERSAL revert across all 10 surfaces.
 *
 * Backs `<RevertConfirmDialog>`. Pattern S two-step (dry_run → confirm)
 * same as the catalog uploaders. The orchestrator's `revert_md_upload`
 * tool dispatches to the per-kind handler internally based on the audit
 * row's `snapshot_kind` (see edge-parity PLAN.md §7).
 *
 * Eligibility (per ADR-014 + ADR-007 canonical reason_code enum):
 *   - too_old (>30d), revert_of_revert, already_reverted, snapshot_pruned,
 *     current_state_drift, cannot_safely_verify, etc.
 *   - UI-side disabling via `revert_eligibility.is_revertable` from
 *     list_scheduler_admin_audit_log is a UX hint only; edge inner-RPC is
 *     authoritative.
 *
 * Lost-update warning (plan v0.5 §4):
 *   - The `<RevertConfirmDialog>` UI shows newer-upload list BEFORE the
 *     dry-run dispatches. This action just maps the tool's revert outcome
 *     onto `SchedulerRevertState` for `useActionState`.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type {
  RevertResult,
  SchedulerRevertState,
} from "@/lib/scheduler/types";

const formSchema = z.object({
  upload_id: z.coerce.number().int().positive(),
  dry_run: z.coerce.boolean().optional().default(true),
  expected_confirm_token: z.string().min(1).optional(),
  force_no_after_hash: z.coerce.boolean().optional().default(false),
});

async function revertMdUploadImpl(
  _prev: SchedulerRevertState,
  formData: FormData,
): Promise<SchedulerRevertState> {
  const { email } = await requireAdmin();

  const rawDryRun = formData.get("dry_run");
  const rawForce = formData.get("force_no_after_hash");
  const raw = {
    upload_id: formData.get("upload_id"),
    dry_run:
      rawDryRun === null || rawDryRun === ""
        ? undefined
        : rawDryRun === "false"
        ? false
        : Boolean(rawDryRun),
    expected_confirm_token: (() => {
      const v = formData.get("expected_confirm_token");
      return v === null || v === "" ? undefined : String(v);
    })(),
    force_no_after_hash:
      rawForce === null || rawForce === ""
        ? undefined
        : rawForce === "true",
  };
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  if (parsed.data.dry_run === false && !parsed.data.expected_confirm_token) {
    return {
      kind: "validation_error",
      message:
        "Apply call requires expected_confirm_token from the prior dry_run.",
    };
  }

  let result: RevertResult;
  try {
    result = await callSchedulerTool(
      "revert_md_upload",
      {
        upload_id: parsed.data.upload_id,
        dry_run: parsed.data.dry_run,
        expected_confirm_token: parsed.data.expected_confirm_token,
        force_no_after_hash: parsed.data.force_no_after_hash,
      },
      email,
    );
  } catch (e) {
    return {
      kind: "transport_error",
      message:
        e instanceof OrchestratorClientError
          ? e.message
          : `Unexpected: ${e instanceof Error ? e.message : String(e)}`,
      timestamp: Date.now(),
    };
  }

  // Map the 4 canonical outcomes (ADR-007) to discriminated kinds.
  if (result.outcome === "dry_run_success" && result.confirm_token) {
    return {
      kind: "needs_confirmation",
      args: { upload_id: parsed.data.upload_id },
      confirmation: {
        confirm_token: result.confirm_token,
        restored: result.restored,
        deactivated: result.deactivated,
        deleted: result.deleted,
        attempt_id: result.attempt_id,
      },
      timestamp: Date.now(),
    };
  }

  if (result.outcome === "success" && result.audit_log_id !== null) {
    revalidatePath("/schedulerconfig");
    return {
      kind: "success",
      data: {
        audit_log_id: result.audit_log_id,
        restored: result.restored,
        deactivated: result.deactivated,
        deleted: result.deleted,
        attempt_id: result.attempt_id,
      },
      timestamp: Date.now(),
    };
  }

  // outcome === 'rejected' || 'crashed' → tool_error
  return {
    kind: "tool_error",
    data: {
      message:
        result.error_message ??
        `Revert ${result.outcome} without a structured error message.`,
      reason_code: result.reason_code,
      attempt_id: result.attempt_id,
    },
    timestamp: Date.now(),
  };
}

export const revertMdUploadAction = wrapAdminAction(
  "revertMdUpload",
  revertMdUploadImpl,
  { orchestratorTool: "revert_md_upload" },
);
