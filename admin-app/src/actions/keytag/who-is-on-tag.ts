"use server";

/**
 * whoIsOnTag — lookup which RO (if any) currently holds a specific tag.
 * Form-driven via useActionState.
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { callKeytagTool, OrchestratorClientError } from "@/lib/orchestrator/client";
import type { WhoIsOnTagResult } from "@/lib/orchestrator/types";

const formSchema = z.object({
  color: z.enum(["red", "yellow"]),
  tag_number: z.coerce.number().int().min(1).max(90),
});

export type WhoIsOnTagState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | { kind: "result"; data: WhoIsOnTagResult }
  | { kind: "error"; message: string };

async function whoIsOnTagImpl(
  _prevState: WhoIsOnTagState,
  formData: FormData,
): Promise<WhoIsOnTagState> {
  const { email } = await requireAdmin();

  const parsed = formSchema.safeParse({
    color: formData.get("color"),
    tag_number: formData.get("tag_number"),
  });
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const data = await callKeytagTool("whoIsOnTag", parsed.data, email);
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

export const whoIsOnTagAction = wrapAdminAction(
  "whoIsOnTag",
  whoIsOnTagImpl,
  { orchestratorTool: "whoIsOnTag" },
);
