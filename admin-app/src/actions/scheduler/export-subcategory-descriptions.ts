"use server";

/**
 * exportSubcategoryDescriptionsAction — fetch current state as MD.
 *
 * No Pattern S (read-only; no preview/confirm). Returns the MD content +
 * row count. The UI then triggers a browser download via
 * `downloadMdAsFile()` from `@/lib/scheduler/md-file-utils`.
 *
 * Per plan v0.5 §5: export payload cache is invalidated on apply/revert
 * success — the next call here returns the post-apply/post-revert state.
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type {
  SchedulerExportState,
} from "@/lib/scheduler/types";

async function exportSubcategoryDescriptionsImpl(
  _prev: SchedulerExportState,
  _formData: FormData,
): Promise<SchedulerExportState> {
  const { email } = await requireAdmin();

  try {
    const data = await callSchedulerTool(
      "export_subcategory_descriptions_md",
      {},
      email,
    );
    return { kind: "success", data, timestamp: Date.now() };
  } catch (e) {
    return e instanceof OrchestratorClientError
      ? {
          kind: "transport_error",
          message: e.message,
          timestamp: Date.now(),
        }
      : {
          kind: "tool_error",
          data: {
            message: `Unexpected: ${e instanceof Error ? e.message : String(e)}`,
          },
          timestamp: Date.now(),
        };
  }
}

export const exportSubcategoryDescriptionsAction = wrapAdminAction(
  "exportSubcategoryDescriptions",
  exportSubcategoryDescriptionsImpl,
  { orchestratorTool: "export_subcategory_descriptions_md" },
);
