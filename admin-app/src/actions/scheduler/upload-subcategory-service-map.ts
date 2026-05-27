"use server";

/**
 * uploadSubcategoryServiceMapAction — Pattern S upload for subcategory_service_map.
 * Thin wrapper; see `./_upload-md-helper.ts` for the Pattern S flow.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerUploadAction } from "./_upload-md-helper";
import type { SchedulerUploadState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  return executeSchedulerUploadAction(
    "upload_subcategory_service_map_md",
    prev,
    formData,
  );
}

export const uploadSubcategoryServiceMapAction = wrapAdminAction(
  "uploadSubcategoryServiceMap",
  impl,
  { orchestratorTool: "upload_subcategory_service_map_md" },
);
