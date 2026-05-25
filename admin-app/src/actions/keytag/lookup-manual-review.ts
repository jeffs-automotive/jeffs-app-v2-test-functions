"use server";

/**
 * lookupManualReview — fetch a manual review by its 6-char code.
 * Form-driven via useActionState.
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { callKeytagTool, OrchestratorClientError } from "@/lib/orchestrator/client";
import type { LookupManualReviewResult } from "@/lib/orchestrator/types";

const formSchema = z.object({
  code: z
    .string()
    .min(7, "Code must be at least 7 characters (e.g., ORP-XXXXXX).")
    .max(20)
    .transform((s) => s.trim().toUpperCase()),
});

export type LookupManualReviewState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | { kind: "result"; data: LookupManualReviewResult }
  | { kind: "error"; message: string };

async function lookupManualReviewImpl(
  _prevState: LookupManualReviewState,
  formData: FormData,
): Promise<LookupManualReviewState> {
  const { email } = await requireAdmin();

  const parsed = formSchema.safeParse({
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const data = await callKeytagTool("lookupManualReview", parsed.data, email);
    return { kind: "result", data };
  } catch (e) {
    return {
      kind: "error",
      message:
        e instanceof OrchestratorClientError
          ? e.message
          : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const lookupManualReviewAction = wrapAdminAction(
  "lookupManualReview",
  lookupManualReviewImpl,
  { orchestratorTool: "lookupManualReview" },
);
