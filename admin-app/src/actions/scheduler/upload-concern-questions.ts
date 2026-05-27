"use server";

/**
 * uploadConcernQuestionsAction — Pattern S upload for concern_questions (flat).
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
    "upload_concern_questions_md",
    prev,
    formData,
  );
}

export const uploadConcernQuestionsAction = wrapAdminAction(
  "uploadConcernQuestions",
  impl,
  { orchestratorTool: "upload_concern_questions_md" },
);
