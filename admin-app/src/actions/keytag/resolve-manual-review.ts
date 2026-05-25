"use server";

/**
 * resolveManualReview — Server Action.
 *
 * No Pattern A token here — the 6-char code IS the pre-approval. The
 * orchestrator rate-limits to 3 failed attempts per actor per hour.
 *
 * The `choice` arg is category-specific (different options per
 * orphan_release / work_approved_drift / ar_regression / etc.). Some
 * choices require `color` + `tag_number` ("needs_tag_input" flag from
 * lookupManualReview).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import type { ResolveManualReviewToolResult } from "@/lib/orchestrator/types";

const formSchema = z.object({
  code: z
    .string()
    .min(7)
    .max(20)
    .transform((s) => s.trim().toUpperCase()),
  choice: z.string().min(2).max(40),
  color: z.enum(["red", "yellow"]).optional(),
  tag_number: z.coerce.number().int().min(1).max(90).optional(),
  notes: z.string().max(500).optional(),
});

export type ResolveManualReviewState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | { kind: "success"; data: Extract<ResolveManualReviewToolResult, { ok: true }> }
  | { kind: "tool_error"; data: Extract<ResolveManualReviewToolResult, { ok: false }> }
  | { kind: "transport_error"; message: string };

async function resolveManualReviewImpl(
  _prev: ResolveManualReviewState,
  formData: FormData,
): Promise<ResolveManualReviewState> {
  const { email } = await requireAdmin();

  const raw: Record<string, FormDataEntryValue | undefined> = {
    code: formData.get("code") ?? undefined,
    choice: formData.get("choice") ?? undefined,
    color: formData.get("color") ?? undefined,
    tag_number: formData.get("tag_number") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  };
  if (raw.color === "" || raw.color === undefined) delete raw.color;
  if (raw.tag_number === "" || raw.tag_number === undefined) delete raw.tag_number;
  if (raw.notes === "" || raw.notes === undefined) delete raw.notes;

  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const data = await callKeytagTool("resolveManualReview", parsed.data, email);
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

export const resolveManualReviewAction = wrapAdminAction(
  "resolveManualReview",
  resolveManualReviewImpl,
  { orchestratorTool: "resolveManualReview" },
);
