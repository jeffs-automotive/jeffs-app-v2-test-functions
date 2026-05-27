"use server";

/**
 * exportConcernQuestionsAction — fetch current state as MD.
 * Thin wrapper; see `./_export-md-helper.ts` for the shared impl.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerExportAction } from "./_export-md-helper";
import type { SchedulerExportState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerExportState,
  fd: FormData,
): Promise<SchedulerExportState> {
  return executeSchedulerExportAction("export_concern_questions_md", prev, fd);
}

export const exportConcernQuestionsAction = wrapAdminAction(
  "exportConcernQuestions",
  impl,
  { orchestratorTool: "export_concern_questions_md" },
);
