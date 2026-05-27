"use server";

/**
 * exportConcernCategoryGuidelineAction — fetch one category's guideline as MD.
 * Takes category_slug via FormData.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeConcernCategoryExportAction } from "./_concern-category-export-helper";
import type { SchedulerExportState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerExportState,
  fd: FormData,
): Promise<SchedulerExportState> {
  return executeConcernCategoryExportAction(
    "export_concern_category_guideline_md",
    prev,
    fd,
  );
}

export const exportConcernCategoryGuidelineAction = wrapAdminAction(
  "exportConcernCategoryGuideline",
  impl,
  { orchestratorTool: "export_concern_category_guideline_md" },
);
