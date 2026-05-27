"use server";

/**
 * exportClosedDatesAction — fetch current state as MD (future-dated only).
 * Thin wrapper; see `./_export-md-helper.ts` for the shared impl.
 *
 * Edge tool filters to future dates only per edge-parity PLAN §7 row 10
 * (past dates immutable; closed_dates_future is the canonical surface).
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerExportAction } from "./_export-md-helper";
import type { SchedulerExportState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerExportState,
  fd: FormData,
): Promise<SchedulerExportState> {
  return executeSchedulerExportAction("export_closed_dates_md", prev, fd);
}

export const exportClosedDatesAction = wrapAdminAction(
  "exportClosedDates",
  impl,
  { orchestratorTool: "export_closed_dates_md" },
);
