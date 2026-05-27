"use server";

/**
 * findOrphanCustomersAction — read-only scan for stale appointments
 * (last_synced_at >24h + deleted_at IS NULL = likely Tekmetric deletions
 * the sync missed).
 *
 * One-shot read — NOT Pattern S. Form input: optional lookback_days
 * (1-180, default 30). Returns the orphans list + count; UI renders a
 * results table.
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type { FindOrphanCustomersState } from "@/lib/scheduler/types";

const formSchema = z.object({
  lookback_days: z.coerce.number().int().min(1).max(180).optional(),
});

async function impl(
  _prev: FindOrphanCustomersState,
  formData: FormData,
): Promise<FindOrphanCustomersState> {
  const { email } = await requireAdmin();

  const raw = {
    lookback_days: formData.get("lookback_days") ?? undefined,
  };
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "tool_error",
      data: {
        message:
          "Invalid lookback_days — must be an integer between 1 and 180.",
      },
      timestamp: Date.now(),
    };
  }

  try {
    const data = await callSchedulerTool(
      "find_orphan_customers",
      parsed.data.lookback_days !== undefined
        ? { lookback_days: parsed.data.lookback_days }
        : {},
      email,
    );
    return { kind: "success", data, timestamp: Date.now() };
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

export const findOrphanCustomersAction = wrapAdminAction(
  "findOrphanCustomers",
  impl,
  { orchestratorTool: "find_orphan_customers" },
);
