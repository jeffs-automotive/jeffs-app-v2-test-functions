"use server";

/**
 * uploadRoutineServicesAction — Pattern S upload for routine_services.
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
    "upload_routine_services_md",
    prev,
    formData,
  );
}

export const uploadRoutineServicesAction = wrapAdminAction(
  "uploadRoutineServices",
  impl,
  { orchestratorTool: "upload_routine_services_md" },
);
