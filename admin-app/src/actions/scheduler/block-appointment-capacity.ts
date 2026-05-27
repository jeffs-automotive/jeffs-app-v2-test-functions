"use server";

/**
 * blockAppointmentCapacityAction — block a day (or slot) on appointment_blocks.
 *
 * Per ROUND-2-RESIDUALS R-BL-1 verification:
 *   The underlying `block_appointment_capacity` tool input schema accepts
 *   { date, type?, time?, reason? } and DOES NOT accept shop_id — the
 *   orchestrator derives shop_id server-side from the actor email (via
 *   the X-Actor-Email header → admin context lookup). This Server Action
 *   strips any client-supplied form field that's not in the allowed
 *   shape (Zod whitelist), so even if a malicious form added shop_id,
 *   it would be ignored downstream. No cross-shop hijack surface.
 *
 * For Phase 1 the UI only supports whole-day blocks (no per-type / per-
 * time granularity); the helper still passes type/time through if set in
 * the form so future granular UX is unblocked.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type { BlockAppointmentCapacityArgs } from "@/lib/scheduler/types";

const formSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  type: z.enum(["waiter", "dropoff"]).optional(),
  time: z.enum(["08:00", "09:00"]).optional(),
  reason: z.string().max(500).optional(),
});

export type BlockAppointmentCapacityState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | {
      kind: "success";
      data: { block_id?: string | number | null; date: string };
      timestamp: number;
    }
  | { kind: "tool_error"; data: { message: string }; timestamp: number }
  | { kind: "transport_error"; message: string; timestamp: number };

async function impl(
  _prev: BlockAppointmentCapacityState,
  formData: FormData,
): Promise<BlockAppointmentCapacityState> {
  const { email } = await requireAdmin();

  const raw = {
    date: formData.get("date") ?? "",
    type: formData.get("type") || undefined,
    time: formData.get("time") || undefined,
    reason: formData.get("reason") || undefined,
  };
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const args: BlockAppointmentCapacityArgs = parsed.data;
    const data = await callSchedulerTool(
      "block_appointment_capacity",
      args,
      email,
    );
    revalidatePath("/schedulerconfig");
    return {
      kind: "success",
      data: { block_id: data.block_id ?? null, date: parsed.data.date },
      timestamp: Date.now(),
    };
  } catch (e) {
    return e instanceof OrchestratorClientError
      ? {
          kind: "transport_error",
          message: e.message,
          timestamp: Date.now(),
        }
      : {
          kind: "tool_error",
          data: {
            message: `Unexpected: ${e instanceof Error ? e.message : String(e)}`,
          },
          timestamp: Date.now(),
        };
  }
}

export const blockAppointmentCapacityAction = wrapAdminAction(
  "blockAppointmentCapacity",
  impl,
  { orchestratorTool: "block_appointment_capacity" },
);
