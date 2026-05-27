"use server";

/**
 * uploadTestingServicesAction — Pattern S upload for testing_services.
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
    "upload_testing_services_md",
    prev,
    formData,
  );
}

export const uploadTestingServicesAction = wrapAdminAction(
  "uploadTestingServices",
  impl,
  { orchestratorTool: "upload_testing_services_md" },
);
