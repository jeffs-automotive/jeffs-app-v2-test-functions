/**
 * /schedulerconfig — D.2 pilot landed 2026-05-27.
 *
 * Per plan v0.5 §9 build order:
 *   - D.1 ✅ types + md-file-utils + orchestrator types
 *   - D.2 ✅ Subcategory descriptions END-TO-END (this page wires it)
 *   - D.3-D.7 — other tabs ship per the plan; placeholders rendered by
 *     <SchedulerConfigTabs> stub-fallback for tabs without provided props
 *
 * RSC fetches:
 *   - Initial recent-uploads list for subcategory_descriptions (10 rows,
 *     30-day window, show both successful + failed). Re-fetched on
 *     router.refresh() after apply/revert per plan §5 refresh contract.
 *
 * Auth gate: requireAdmin() — actor_email derived server-side, never from
 * client.
 */
import { requireAdmin } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SchedulerConfigTabs } from "@/components/scheduler/SchedulerConfigTabs";
import { CatalogEditorTab } from "@/components/scheduler/CatalogEditorTab";
import { listRecentUploadsAction } from "@/actions/scheduler/list-recent-uploads";
import { uploadSubcategoryDescriptionsAction } from "@/actions/scheduler/upload-subcategory-descriptions";
import { exportSubcategoryDescriptionsAction } from "@/actions/scheduler/export-subcategory-descriptions";
import type { AuditLogEntry } from "@/lib/scheduler/types";

export const dynamic = "force-dynamic"; // No static caching — admin surface mutates live state

export default async function SchedulerConfigPage() {
  const { email } = await requireAdmin();

  // Fetch the initial recent-uploads list for the pilot tab.
  // Failure mode: surface the error in the tab body instead of throwing —
  // the user can still try Export / Upload, and we don't want one slow
  // edge call to block the whole page.
  let subDescUploads: AuditLogEntry[] = [];
  let subDescFetchError: string | null = null;
  try {
    const result = await listRecentUploadsAction({
      surface: "subcategory_descriptions",
      limit: 10,
    });
    subDescUploads = result.rows;
  } catch (e) {
    subDescFetchError = e instanceof Error ? e.message : String(e);
  }

  return (
    <AppShell email={email}>
      <PageHeader
        title="Scheduler config"
        description="Edit predefined-data catalog. Two-step apply. Revert within 30 days. All 10 surfaces share Pattern S."
      />

      <SchedulerConfigTabs
        defaultValue="sub-desc"
        subDesc={
          subDescFetchError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">
                Couldn&apos;t load recent uploads for Subcategory descriptions.
              </p>
              <p className="mt-1 text-xs text-foreground">{subDescFetchError}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Upload and export still work — only the &ldquo;Recent uploads&rdquo; panel is affected.
              </p>
            </div>
          ) : (
            <CatalogEditorTab
              surface="subcategory_descriptions"
              surfaceLabel="Subcategory descriptions"
              uploadAction={uploadSubcategoryDescriptionsAction}
              exportAction={exportSubcategoryDescriptionsAction}
              recentUploads={subDescUploads}
              exportFilenameBase="subcategory-descriptions"
              currentStateSummary={
                <>
                  Stage-1 classifier metadata: description, positive/negative
                  examples, synonyms — per <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{`<category>/<slug>`}</code> composite.
                </>
              }
            />
          )
        }
      />
    </AppShell>
  );
}
