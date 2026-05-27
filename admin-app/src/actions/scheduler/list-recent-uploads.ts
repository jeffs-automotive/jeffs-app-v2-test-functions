"use server";

/**
 * listRecentUploadsAction — read recent scheduler_admin_audit_log rows.
 *
 * Backs `<RecentUploadsList>`. Universal across all 10 surfaces (filter
 * via `surface` arg). Read-only — no Server Action discriminated union
 * needed; just throws on error and returns the typed result on success.
 *
 * Called two ways:
 *   1. Direct invocation from a Server Component (page-level data fetch
 *      on initial render). Throws on error — the page's error.tsx handles.
 *   2. Programmatic refresh from a Client Component after apply/revert
 *      success (via `useTransition` + `startTransition(() =>
 *      router.refresh())`). The page-level revalidatePath fires this.
 *
 * Per plan v0.5 §4 audit-log filter keys table — surface enum matches the
 * canonical `surface_filter` enum per ADR-021.
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { callSchedulerTool } from "@/lib/orchestrator/scheduler-client";
import type {
  ListSchedulerAdminAuditLogResult,
  SchedulerAdminSurface,
} from "@/lib/scheduler/types";

export interface ListRecentUploadsOptions {
  surface: SchedulerAdminSurface;
  limit?: number;
  only_successful?: boolean;
  only_revertable?: boolean;
}

async function listRecentUploadsImpl(
  options: ListRecentUploadsOptions,
): Promise<ListSchedulerAdminAuditLogResult> {
  const { email } = await requireAdmin();
  return callSchedulerTool(
    "list_scheduler_admin_audit_log",
    {
      surface_filter: options.surface,
      limit: options.limit ?? 10,
      only_successful: options.only_successful,
      only_revertable: options.only_revertable,
    },
    email,
  );
}

export const listRecentUploadsAction = wrapAdminAction(
  "listRecentUploads",
  listRecentUploadsImpl,
  { orchestratorTool: "list_scheduler_admin_audit_log" },
);
