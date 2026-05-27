"use server";

/**
 * uploadSubcategoryDescriptionsAction — Pattern S two-step (dry-run → confirm).
 *
 * Maps the edge `upload_subcategory_descriptions_md` tool's wire shape onto
 * the React-state-ergonomic `SchedulerUploadState` discriminated union per
 * plan v0.5 §5 adapter contract.
 *
 * Auth boundary (plan v0.5 §5):
 *   - actor_email comes from requireAdmin() session — NEVER from a form field
 *   - Client-set X-Actor-Email headers are NOT honored (this is a Server
 *     Action, not a fetch handler; client can't set request headers anyway)
 *
 * Pattern S two-step:
 *   - dry_run=true (preview): tool returns { dry_run: true, confirm_token,
 *     diff_summary, rows_* }. We map to `{ kind: "needs_confirmation" }`.
 *   - dry_run=false (apply) + expected_confirm_token: tool returns
 *     { dry_run: false, audit_log_id, rows_* }. We map to `{ kind: "success" }`.
 *
 * Refresh contract (plan v0.5 §5 + §4 step 6):
 *   - On success: revalidatePath('/schedulerconfig') invalidates the
 *     current-state summary + recent-uploads list cached at the Server
 *     Component layer.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import { validateMdContent } from "@/lib/scheduler/md-file-utils";
import type {
  SchedulerUploadState,
  UploadResult,
} from "@/lib/scheduler/types";

const formSchema = z.object({
  md_content: z.string().min(1, "MD content is required"),
  dry_run: z.coerce.boolean().optional().default(true),
  expected_confirm_token: z.string().min(1).optional(),
});

async function uploadSubcategoryDescriptionsImpl(
  _prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  // 1. Auth gate — extracts actor_email from session ONLY.
  const { email } = await requireAdmin();

  // 2. Form parse + Zod validate.
  const rawDryRun = formData.get("dry_run");
  const raw = {
    md_content: formData.get("md_content") ?? "",
    // Treat missing or empty string as undefined so default (true) applies.
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

  // 3. Client-side-style MD content validation (size, UTF-8, non-empty) —
  //    server-side last-line defense even though browser already ran it.
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
      "upload_subcategory_descriptions_md",
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

export const uploadSubcategoryDescriptionsAction = wrapAdminAction(
  "uploadSubcategoryDescriptions",
  uploadSubcategoryDescriptionsImpl,
  { orchestratorTool: "upload_subcategory_descriptions_md" },
);
