"use server";

/**
 * runBulkReconcile — Server Action.
 *
 * No Pattern A confirmation (this tool is read-equivalent in normal use;
 * we surface a UI-level "are you sure?" before invoking instead).
 *
 * 60s timeout — runBulkReconcile routinely takes 5-30s when there's
 * actual Tekmetric drift to resolve.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import type { RunBulkReconcileResult } from "@/lib/orchestrator/types";

const formSchema = z.object({
  dry_run: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.string()])
    .optional()
    .transform((v) => v === "on" || v === "true"),
  overwrite: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.string()])
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export type RunBulkReconcileState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | { kind: "success"; data: RunBulkReconcileResult }
  | { kind: "transport_error"; message: string };

async function runBulkReconcileImpl(
  _prev: RunBulkReconcileState,
  formData: FormData,
): Promise<RunBulkReconcileState> {
  const { email } = await requireAdmin();

  const parsed = formSchema.safeParse({
    dry_run: formData.get("dry_run") ?? undefined,
    overwrite: formData.get("overwrite") ?? undefined,
  });
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const data = await callKeytagTool(
      "runBulkReconcile",
      parsed.data,
      email,
      { timeoutMs: 60_000 },
    );
    revalidatePath("/keytags");
    return { kind: "success", data };
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

export const runBulkReconcileAction = wrapAdminAction(
  "runBulkReconcile",
  runBulkReconcileImpl,
  { orchestratorTool: "runBulkReconcile" },
);
