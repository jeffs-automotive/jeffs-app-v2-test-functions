"use server";

/**
 * runAppointmentsSyncAction — on-demand trigger for the appointments-sync
 * edge function (same job the cron runs every 5 min).
 *
 * One-shot soft-confirm — NOT Pattern S. The form's only optional input is
 * `full_backfill` (default false = incremental delta).
 *
 * Idempotency: the underlying tool is safe to retry. Concurrent runs from
 * the same shop_id are handled by the appointments-sync edge fn itself
 * (it serializes via in-fn locks). Per ROUND-2-RESIDUALS R-IMP-5 the
 * card UI surfaces in-progress state via Button loading prop.
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type { RunAppointmentsSyncState } from "@/lib/scheduler/types";

async function impl(
  _prev: RunAppointmentsSyncState,
  formData: FormData,
): Promise<RunAppointmentsSyncState> {
  const { email } = await requireAdmin();
  const fullBackfill = formData.get("full_backfill") === "true";

  try {
    // Bump the timeout — the appointments-sync function can take
    // 10-30 seconds depending on the Tekmetric API.
    const data = await callSchedulerTool(
      "run_appointments_sync",
      { full_backfill: fullBackfill },
      email,
      { timeoutMs: 60_000 },
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

export const runAppointmentsSyncAction = wrapAdminAction(
  "runAppointmentsSync",
  impl,
  { orchestratorTool: "run_appointments_sync" },
);
