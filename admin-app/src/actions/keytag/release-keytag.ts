"use server";

/**
 * releaseKeytagFromRo — Server Action.
 * Pattern A confirmation always required for A/R-status tags (and
 * always for WIP-status releases per the orchestrator's current
 * default — let the orchestrator decide).
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import {
  isConfirmationRequired,
  type ReleaseKeytagFromRoArgs,
  type ReleaseKeytagResult,
  type ConfirmationRequiredResult,
} from "@/lib/orchestrator/types";

const formSchema = z.object({
  ro_number: z.coerce.number().int().positive(),
  confirmation_token: z.string().uuid().optional(),
});

export type ReleaseKeytagState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | {
      kind: "needs_confirmation";
      args: ReleaseKeytagFromRoArgs;
      confirmation: ConfirmationRequiredResult["confirmation"];
      message: string;
    }
  | {
      kind: "success";
      data: Extract<ReleaseKeytagResult, { ok: true }>;
    }
  | {
      kind: "tool_error";
      data: Extract<ReleaseKeytagResult, { ok: false; error_code: string }>;
    }
  | { kind: "transport_error"; message: string };

async function releaseKeytagImpl(
  _prev: ReleaseKeytagState,
  formData: FormData,
): Promise<ReleaseKeytagState> {
  const { email } = await requireAdmin();

  const raw: Record<string, FormDataEntryValue | undefined> = {
    ro_number: formData.get("ro_number") ?? undefined,
    confirmation_token: formData.get("confirmation_token") ?? undefined,
  };
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
    const data = await callKeytagTool("releaseKeytagFromRo", parsed.data, email);

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
      // No revalidatePath("/keytags") here. The board updates optimistically
      // (BoardClient.onResolved splices the released row out) and reconverges
      // via the 15s LiveBoardPoller. Revalidating this force-dynamic, six-tab
      // page re-rendered every tab inside the action response, so
      // useActionState's isPending stayed true for the whole RSC re-render —
      // the post-success "continually loads" spin (2026-06-24 board-release-fix).
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

export const releaseKeytagAction = wrapAdminAction(
  "releaseKeytagFromRo",
  releaseKeytagImpl,
  { orchestratorTool: "releaseKeytagFromRo" },
);
