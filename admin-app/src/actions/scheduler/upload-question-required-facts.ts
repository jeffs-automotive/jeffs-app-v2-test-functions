"use server";

/**
 * uploadQuestionRequiredFactsAction — Pattern S upload for question_required_facts.
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
    "upload_question_required_facts_md",
    prev,
    formData,
  );
}

export const uploadQuestionRequiredFactsAction = wrapAdminAction(
  "uploadQuestionRequiredFacts",
  impl,
  { orchestratorTool: "upload_question_required_facts_md" },
);
