/**
 * _concern-category-helper — shared Pattern S implementation for the 2
 * concern-per-category surfaces (upload_concern_category_md +
 * upload_concern_category_guideline_md).
 *
 * Separate from _upload-md-helper.ts because these tools require an extra
 * `category_slug` arg (the 14-value enum: noise, vibration, …, other).
 * The Server Action reads it from FormData (set by the
 * <ConcernsPerCategoryTab> container before submit).
 *
 * Not exported as a Server Action itself (no `"use server"` directive).
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
  UploadConcernCategoryArgs,
} from "@/lib/scheduler/types";

export type ConcernCategoryToolName = Extract<
  SchedulerToolName,
  "upload_concern_category_md" | "upload_concern_category_guideline_md"
>;

const CATEGORY_ENUM = z.enum([
  "noise",
  "vibration",
  "pulling",
  "smell",
  "smoke",
  "leak",
  "warning_light",
  "performance",
  "electrical",
  "hvac",
  "brakes",
  "steering",
  "tires",
  "other",
]);

const formSchema = z.object({
  category_slug: CATEGORY_ENUM,
  md_content: z.string().min(1, "MD content is required"),
  dry_run: z.coerce.boolean().optional().default(true),
  expected_confirm_token: z.string().min(1).optional(),
});

export async function executeConcernCategoryUploadAction(
  toolName: ConcernCategoryToolName,
  _prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  const { email } = await requireAdmin();

  const rawDryRun = formData.get("dry_run");
  const raw = {
    category_slug: formData.get("category_slug") ?? "",
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

  const contentCheck = validateMdContent(parsed.data.md_content);
  if (!contentCheck.ok) {
    return {
      kind: "validation_error",
      message: contentCheck.message,
      field: "md_content",
    };
  }

  if (parsed.data.dry_run === false && !parsed.data.expected_confirm_token) {
    return {
      kind: "validation_error",
      message:
        "Apply call requires expected_confirm_token from the prior dry_run.",
    };
  }

  const args: UploadConcernCategoryArgs = {
    category_slug: parsed.data.category_slug,
    md_content: parsed.data.md_content,
    dry_run: parsed.data.dry_run,
    expected_confirm_token: parsed.data.expected_confirm_token,
  };

  let toolResult: UploadResult;
  try {
    toolResult = await callSchedulerTool(toolName, args, email);
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

  return {
    kind: "tool_error",
    data: {
      message:
        "Upload returned ok=true but the response shape didn't match dry_run-or-apply expectations.",
    },
    timestamp: Date.now(),
  };
}
