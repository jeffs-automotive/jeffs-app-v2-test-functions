/**
 * _concern-category-export-helper — shared exporter for the 2
 * concern-per-category surfaces. Takes category_slug from FormData.
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type {
  SchedulerExportState,
  SchedulerToolName,
  ExportConcernCategoryArgs,
} from "@/lib/scheduler/types";

export type ConcernCategoryExportToolName = Extract<
  SchedulerToolName,
  "export_concern_category_md" | "export_concern_category_guideline_md"
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
});

export async function executeConcernCategoryExportAction(
  toolName: ConcernCategoryExportToolName,
  _prev: SchedulerExportState,
  formData: FormData,
): Promise<SchedulerExportState> {
  const { email } = await requireAdmin();

  const parsed = formSchema.safeParse({
    category_slug: formData.get("category_slug") ?? "",
  });
  if (!parsed.success) {
    return {
      kind: "tool_error",
      data: {
        message:
          "Missing or invalid category_slug. Expected one of the 14 concern categories.",
      },
      timestamp: Date.now(),
    };
  }

  const args: ExportConcernCategoryArgs = {
    category_slug: parsed.data.category_slug,
  };

  try {
    const data = await callSchedulerTool(toolName, args, email);
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
