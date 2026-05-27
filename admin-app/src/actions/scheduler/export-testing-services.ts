"use server";

/**
 * exportTestingServicesAction — fetch current state as MD.
 * Thin wrapper; see `./_export-md-helper.ts` for the shared impl.
 */
import { wrapAdminAction } from "@/lib/instrument-action";
import { executeSchedulerExportAction } from "./_export-md-helper";
import type { SchedulerExportState } from "@/lib/scheduler/types";

async function impl(
  prev: SchedulerExportState,
  fd: FormData,
): Promise<SchedulerExportState> {
  return executeSchedulerExportAction("export_testing_services_md", prev, fd);
}

export const exportTestingServicesAction = wrapAdminAction(
  "exportTestingServices",
  impl,
  { orchestratorTool: "export_testing_services_md" },
);
