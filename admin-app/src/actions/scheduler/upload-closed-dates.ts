"use server";

/**
 * uploadClosedDatesAction — Pattern S upload for closed_dates (MD path).
 * Thin wrapper; see `./_upload-md-helper.ts` for the Pattern S flow.
 *
 * Per plan v0.5 §7 the closed-dates tab ALSO surfaces per-day inline
 * block/unblock actions (D.6), which use different tools
 * (block_appointment_capacity / unblock_appointment_capacity) and are
 * one-shot soft-confirm, NOT Pattern S. This action handles only the
 * bulk MD path (row 9a).
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerUploadAction } from "./_upload-md-helper";
import type { SchedulerUploadState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerUploadState,
  formData: FormData,
): Promise<SchedulerUploadState> {
  return executeSchedulerUploadAction(
    "upload_closed_dates_md",
    prev,
    formData,
  );
}

export const uploadClosedDatesAction = wrapAdminAction(
  "uploadClosedDates",
  impl,
  { orchestratorTool: "upload_closed_dates_md" },
);
