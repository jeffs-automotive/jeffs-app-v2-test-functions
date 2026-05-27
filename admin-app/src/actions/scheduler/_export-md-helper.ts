/**
 * _export-md-helper — shared exporter implementation for all 10 catalog surfaces.
 *
 * Not exported as a Server Action itself (no `"use server"` directive).
 * Each per-surface export Server Action file is a thin wrapper.
 */
import { requireAdmin } from "@/lib/auth";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type {
  SchedulerExportState,
  SchedulerToolName,
} from "@/lib/scheduler/types";

/**
 * Export tool names — the 8 universal ones (excluding the 2 per-category
 * exporters that need an extra `category_slug` arg).
 */
export type UniversalExportToolName = Extract<
  SchedulerToolName,
  | "export_subcategory_descriptions_md"
  | "export_routine_services_md"
  | "export_testing_services_md"
  | "export_subcategory_service_map_md"
  | "export_question_required_facts_md"
  | "export_concern_questions_md"
  | "export_appointment_default_limits_md"
  | "export_closed_dates_md"
>;

export async function executeSchedulerExportAction(
  toolName: UniversalExportToolName,
  _prev: SchedulerExportState,
  _formData: FormData,
): Promise<SchedulerExportState> {
  const { email } = await requireAdmin();

  try {
    const data = await callSchedulerTool(toolName, {}, email);
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
