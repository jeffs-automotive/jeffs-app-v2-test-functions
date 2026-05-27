"use server";

/**
 * uploadConcernCategoryAction — Pattern S upload for one category's
 * subcategories + questions (upload_concern_category_md).
 * Takes category_slug via FormData (caller sets it).
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeConcernCategoryUploadAction } from "./_concern-category-helper";
import type { SchedulerUploadState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  return executeConcernCategoryUploadAction(
    "upload_concern_category_md",
    prev,
    formData,
  );
}

export const uploadConcernCategoryAction = wrapAdminAction(
  "uploadConcernCategory",
  impl,
  { orchestratorTool: "upload_concern_category_md" },
);
