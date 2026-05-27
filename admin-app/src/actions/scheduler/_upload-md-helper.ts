/**
 * _upload-md-helper — shared Pattern S upload implementation for all 10
 * catalog surfaces.
 *
 * Not exported as a Server Action itself (no `"use server"` directive).
 * Each per-surface Server Action file is a thin wrapper that:
 *   1. wraps with wrapAdminAction (so Sentry tags get the per-surface name)
 *   2. delegates to executeSchedulerUploadAction(toolName, prev, fd)
 *
 * Centralizes the Pattern S flow:
 *   - requireAdmin() → actor_email (NEVER from form field)
 *   - Zod validation
 *   - md-file-utils.validateMdContent server-side defense
 *   - Apply-path requires expected_confirm_token
 *   - callSchedulerTool dispatch
 *   - Tool result → SchedulerUploadState adapter (plan v0.5 §5)
 *   - revalidatePath on success (plan v0.5 §5 refresh contract)
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import { validateMdContent } from "@/lib/scheduler/md-file-utils";
import type {
  SchedulerToolName,
  SchedulerUploadState,
  UploadResult,
} from "@/lib/scheduler/types";

const formSchema = z.object({
  md_content: z.string().min(1, "MD content is required"),
  dry_run: z.coerce.boolean().optional().default(true),
  expected_confirm_token: z.string().min(1).optional(),
});

/**
 * Tool names that match the Pattern S universal upload shape (md_content +
 * dry_run + expected_confirm_token). The 8 catalog uploaders excluding the
 * 2 concern-per-category ones that need an extra `category_slug` arg.
 */
export type UniversalUploadToolName = Extract<
  SchedulerToolName,
  | "upload_subcategory_descriptions_md"
  | "upload_routine_services_md"
  | "upload_testing_services_md"
  | "upload_subcategory_service_map_md"
  | "upload_question_required_facts_md"
  | "upload_concern_questions_md"
  | "upload_appointment_default_limits_md"
  | "upload_closed_dates_md"
>;

export async function executeSchedulerUploadAction(
  toolName: UniversalUploadToolName,
  _prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  // 1. Auth gate — extracts actor_email from session ONLY.
  const { email } = await requireAdmin();

  // 2. Form parse + Zod validate.
  const rawDryRun = formData.get("dry_run");
  const raw = {
    md_content: formData.get("md_content") ?? "",
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
  };
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  // 3. Server-side last-line defense on MD content (size, UTF-8, non-empty).
  const contentCheck = validateMdContent(parsed.data.md_content);
  if (!contentCheck.ok) {
    return {
      kind: "validation_error",
      message: contentCheck.message,
      field: "md_content",
    };
  }

  // 4. Apply path requires token (plan §5 idempotency contract).
  if (parsed.data.dry_run === false && !parsed.data.expected_confirm_token) {
    return {
      kind: "validation_error",
      message:
        "Apply call requires expected_confirm_token from the prior dry_run.",
    };
  }

  // 5. Dispatch to orchestrator.
  let toolResult: UploadResult;
  try {
    toolResult = await callSchedulerTool(
      toolName,
      {
        md_content: parsed.data.md_content,
        dry_run: parsed.data.dry_run,
        expected_confirm_token: parsed.data.expected_confirm_token,
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

  // 6. Map tool result → discriminated union (plan §5 adapter contract).
  if (!toolResult.ok) {
    return {
      kind: "tool_error",
      data: {
        message:
          toolResult.error_message ??
          "Upload failed without a structured error message.",
        reason_code: toolResult.reason_code,
      },
      timestamp: Date.now(),
    };
  }

  if (toolResult.dry_run === true && toolResult.confirm_token) {
    return {
      kind: "needs_confirmation",
      args: { md_content: parsed.data.md_content },
      confirmation: {
        confirm_token: toolResult.confirm_token,
        diff_summary: toolResult.diff_summary,
        rows_added: toolResult.rows_added,
        rows_modified: toolResult.rows_modified,
        rows_deactivated: toolResult.rows_deactivated,
        validation_warnings: toolResult.validation_warnings,
      },
      timestamp: Date.now(),
    };
  }

  // Apply success — refresh the page-level cached data per plan §5.
  if (toolResult.audit_log_id !== undefined) {
    revalidatePath("/schedulerconfig");
    return {
      kind: "success",
      data: {
        audit_log_id: toolResult.audit_log_id,
        rows_added: toolResult.rows_added,
        rows_modified: toolResult.rows_modified,
        rows_deactivated: toolResult.rows_deactivated,
        duplicate_upload: toolResult.duplicate_upload,
        table_name: toolResult.table_name,
      },
      timestamp: Date.now(),
    };
  }

  // Unexpected shape — surface as tool error so the UX has something to show.
  return {
    kind: "tool_error",
    data: {
      message:
        "Upload returned ok=true but the response shape didn't match dry_run-or-apply expectations.",
    },
    timestamp: Date.now(),
  };
}
