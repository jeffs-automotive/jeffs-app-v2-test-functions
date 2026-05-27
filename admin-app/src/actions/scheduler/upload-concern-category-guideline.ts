"use server";

/**
 * uploadConcernCategoryGuidelineAction — Pattern S upload for one category's
 * diagnostic guideline (upload_concern_category_guideline_md).
 * Takes category_slug via FormData.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeConcernCategoryUploadAction } from "./_concern-category-helper";
import type { SchedulerUploadState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  return executeConcernCategoryUploadAction(
    "upload_concern_category_guideline_md",
    prev,
    formData,
  );
}

export const uploadConcernCategoryGuidelineAction = wrapAdminAction(
  "uploadConcernCategoryGuideline",
  impl,
  { orchestratorTool: "upload_concern_category_guideline_md" },
);
