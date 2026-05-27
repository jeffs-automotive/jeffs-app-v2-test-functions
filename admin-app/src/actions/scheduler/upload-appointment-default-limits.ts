"use server";

/**
 * uploadAppointmentDefaultLimitsAction — Pattern S upload for appointment_default_limits.
 * Thin wrapper; see `./_upload-md-helper.ts` for the Pattern S flow.
 *
 * Post edge-parity E5 this is a full Pattern S surface — was legacy
 * one-shot prior to 2026-05-26 commit 4443d77.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerUploadAction } from "./_upload-md-helper";
import type { SchedulerUploadState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  return executeSchedulerUploadAction(
    "upload_appointment_default_limits_md",
    prev,
    formData,
  );
}

export const uploadAppointmentDefaultLimitsAction = wrapAdminAction(
  "uploadAppointmentDefaultLimits",
  impl,
  { orchestratorTool: "upload_appointment_default_limits_md" },
);
