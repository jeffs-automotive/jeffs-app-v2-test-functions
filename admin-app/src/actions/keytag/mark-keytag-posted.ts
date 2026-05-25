"use server";

/**
 * markKeytagPosted — Server Action.
 * Pattern A confirmation always required.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import {
  isConfirmationRequired,
  type MarkKeytagPostedArgs,
  type MarkKeytagPostedResult,
  type ConfirmationRequiredResult,
} from "@/lib/orchestrator/types";

const formSchema = z.object({
  ro_number: z.coerce.number().int().positive(),
  posted_at: z.string().datetime().optional(),
  confirmation_token: z.string().uuid().optional(),
});

export type MarkKeytagPostedState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | {
      kind: "needs_confirmation";
      args: MarkKeytagPostedArgs;
      confirmation: ConfirmationRequiredResult["confirmation"];
      message: string;
    }
  | {
      kind: "success";
      data: Extract<MarkKeytagPostedResult, { ok: true }>;
    }
  | {
      kind: "tool_error";
      data: Extract<MarkKeytagPostedResult, { ok: false; error_code: string }>;
    }
  | { kind: "transport_error"; message: string };

async function markKeytagPostedImpl(
  _prev: MarkKeytagPostedState,
  formData: FormData,
): Promise<MarkKeytagPostedState> {
  const { email } = await requireAdmin();

  const raw: Record<string, FormDataEntryValue | undefined> = {
    ro_number: formData.get("ro_number") ?? undefined,
    posted_at: formData.get("posted_at") ?? undefined,
    confirmation_token: formData.get("confirmation_token") ?? undefined,
  };
  if (raw.posted_at === "" || raw.posted_at === undefined) delete raw.posted_at;
  if (raw.confirmation_token === "" || raw.confirmation_token === undefined)
    delete raw.confirmation_token;

  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const data = await callKeytagTool("markKeytagPosted", parsed.data, email);

    if (isConfirmationRequired(data)) {
      const { confirmation_token: _i, ...args } = parsed.data;
      return {
        kind: "needs_confirmation",
        args,
        confirmation: data.confirmation,
        message: data.message,
      };
    }
    if (data.ok) {
      revalidatePath("/keytags");
      return { kind: "success", data };
    }
    return { kind: "tool_error", data };
  } catch (e) {
    return {
      kind: "transport_error",
      message:
        e instanceof OrchestratorClientError
          ? e.message
          : `Unexpected: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const markKeytagPostedAction = wrapAdminAction(
  "markKeytagPosted",
  markKeytagPostedImpl,
  { orchestratorTool: "markKeytagPosted" },
);
