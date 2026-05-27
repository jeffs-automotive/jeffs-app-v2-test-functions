"use server";

/**
 * exportQuestionRequiredFactsAction — fetch current state as MD.
 * Thin wrapper; see `./_export-md-helper.ts` for the shared impl.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerExportAction } from "./_export-md-helper";
import type { SchedulerExportState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerExportState,
  fd: FormData,
): Promise<SchedulerExportState> {
  return executeSchedulerExportAction(
    "export_question_required_facts_md",
    prev,
    fd,
  );
}

export const exportQuestionRequiredFactsAction = wrapAdminAction(
  "exportQuestionRequiredFacts",
  impl,
  { orchestratorTool: "export_question_required_facts_md" },
);
