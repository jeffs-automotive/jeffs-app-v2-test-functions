"use server";

/**
 * assignKeytagToRo — Server Action.
 *
 * Two modes:
 *   - Auto-assign: only ro_number supplied → orchestrator picks next
 *     round-robin tag, no confirmation needed
 *   - Force-assign: ro_number + color + tag_number → Pattern A
 *     confirmation required (first call returns scope_summary + token;
 *     second call with token applies)
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
  type AssignKeytagToRoArgs,
  type AssignKeytagResult,
  type ConfirmationRequiredResult,
} from "@/lib/orchestrator/types";

const formSchema = z
  .object({
    ro_number: z.coerce.number().int().positive(),
    color: z.enum(["red", "yellow"]).optional(),
    tag_number: z.coerce.number().int().min(1).max(90).optional(),
    confirmation_token: z.string().uuid().optional(),
  })
  .refine(
    (v) => (v.color === undefined) === (v.tag_number === undefined),
    {
      message: "Specify BOTH color and tag number to force-assign, or NEITHER for auto-assign.",
    },
  );

export type AssignKeytagState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | {
      kind: "needs_confirmation";
      args: AssignKeytagToRoArgs;
      confirmation: ConfirmationRequiredResult["confirmation"];
      message: string;
    }
  | {
      kind: "success";
      data: Extract<AssignKeytagResult, { ok: true }>;
    }
  | {
      kind: "tool_error";
      data: Extract<AssignKeytagResult, { ok: false; error_code: string }>;
    }
  | { kind: "transport_error"; message: string };

async function assignKeytagImpl(
  _prev: AssignKeytagState,
  formData: FormData,
): Promise<AssignKeytagState> {
  const { email } = await requireAdmin();

  const raw: Record<string, FormDataEntryValue | undefined> = {
    ro_number: formData.get("ro_number") ?? undefined,
    color: formData.get("color") ?? undefined,
    tag_number: formData.get("tag_number") ?? undefined,
    confirmation_token: formData.get("confirmation_token") ?? undefined,
  };
  // Strip empty optionals so refine can detect "neither supplied"
  if (raw.color === "" || raw.color === undefined) delete raw.color;
  if (raw.tag_number === "" || raw.tag_number === undefined) delete raw.tag_number;
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
    const data = await callKeytagTool("assignKeytagToRo", parsed.data, email);

    if (isConfirmationRequired(data)) {
      // Pattern A first-call return
      const { confirmation_token: _ignore, ...args } = parsed.data;
      return {
        kind: "needs_confirmation",
        args,
        confirmation: data.confirmation,
        message: data.message,
      };
    }
    if (data.ok) {
      // No revalidatePath("/keytags") here. The board updates optimistically
      // (BoardClient.onResolved splices the assigned row out) and reconverges
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

export const assignKeytagAction = wrapAdminAction(
  "assignKeytagToRo",
  assignKeytagImpl,
  { orchestratorTool: "assignKeytagToRo" },
);
