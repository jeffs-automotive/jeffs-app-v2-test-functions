"use server";

/**
 * uploadSubcategoryDescriptionsAction — Pattern S two-step (dry-run → confirm).
 *
 * Thin wrapper around the universal `executeSchedulerUploadAction` helper.
 * See `./_upload-md-helper.ts` for the Pattern S flow shape + adapter
 * contract.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerUploadAction } from "./_upload-md-helper";
import type { SchedulerUploadState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  return executeSchedulerUploadAction(
    "upload_subcategory_descriptions_md",
    prev,
    formData,
  );
}

export const uploadSubcategoryDescriptionsAction = wrapAdminAction(
  "uploadSubcategoryDescriptions",
  impl,
  { orchestratorTool: "upload_subcategory_descriptions_md" },
);
