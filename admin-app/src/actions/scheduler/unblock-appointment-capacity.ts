"use server";

/**
 * unblockAppointmentCapacityAction — remove a block on appointment_blocks.
 *
 * Match must be EXACT per the edge tool contract:
 * - to remove a full-day block, omit both type and time
 * - to remove a specific 8 AM waiter block, pass type='waiter' + time='08:00'
 *
 * Per ROUND-2-RESIDUALS R-BL-1: same shop_id-from-session-only guarantee
 * as the block action; the orchestrator derives shop_id server-side.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type { UnblockAppointmentCapacityArgs } from "@/lib/scheduler/types";

const formSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  type: z.enum(["waiter", "dropoff"]).optional(),
  time: z.enum(["08:00", "09:00"]).optional(),
});

export type UnblockAppointmentCapacityState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | {
      kind: "success";
      data: { removed: number; date: string };
      timestamp: number;
    }
  | { kind: "tool_error"; data: { message: string }; timestamp: number }
  | { kind: "transport_error"; message: string; timestamp: number };

async function impl(
  _prev: UnblockAppointmentCapacityState,
  formData: FormData,
): Promise<UnblockAppointmentCapacityState> {
  const { email } = await requireAdmin();

  const raw = {
    date: formData.get("date") ?? "",
    type: formData.get("type") || undefined,
    time: formData.get("time") || undefined,
  };
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const args: UnblockAppointmentCapacityArgs = parsed.data;
    const data = await callSchedulerTool(
      "unblock_appointment_capacity",
      args,
      email,
    );
    revalidatePath("/schedulerconfig");
    return {
      kind: "success",
      data: { removed: data.removed ?? 0, date: parsed.data.date },
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

export const unblockAppointmentCapacityAction = wrapAdminAction(
  "unblockAppointmentCapacity",
  impl,
  { orchestratorTool: "unblock_appointment_capacity" },
);
