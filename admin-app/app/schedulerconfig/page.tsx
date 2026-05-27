/**
 * /schedulerconfig — D.3 landed 2026-05-27 (all 5 V2 catalog tabs live).
 *
 * Per plan v0.5 §9 build order:
 *   - D.1 ✅ types + md-file-utils + orchestrator types
 *   - D.2 ✅ Subcategory descriptions END-TO-END (pilot)
 *   - D.3 ✅ Routine + testing + sub-map + req-facts tabs (this commit)
 *   - D.4-D.7 — 3 ex-legacy-now-Pattern-S tabs + concerns-per-cat +
 *     closed-dates calendar + Operations
 *
 * RSC fetches all 5 recent-uploads lists in parallel via Promise.all so the
 * page renders in one round-trip, not five sequential ones.
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
import { uploadRoutineServicesAction } from "@/actions/scheduler/upload-routine-services";
import { exportRoutineServicesAction } from "@/actions/scheduler/export-routine-services";
import { uploadTestingServicesAction } from "@/actions/scheduler/upload-testing-services";
import { exportTestingServicesAction } from "@/actions/scheduler/export-testing-services";
import { uploadSubcategoryServiceMapAction } from "@/actions/scheduler/upload-subcategory-service-map";
import { exportSubcategoryServiceMapAction } from "@/actions/scheduler/export-subcategory-service-map";
import { uploadQuestionRequiredFactsAction } from "@/actions/scheduler/upload-question-required-facts";
import { exportQuestionRequiredFactsAction } from "@/actions/scheduler/export-question-required-facts";
import type {
  AuditLogEntry,
  SchedulerAdminSurface,
} from "@/lib/scheduler/types";

export const dynamic = "force-dynamic"; // No static caching — admin surface mutates live state

interface PerSurfaceLoad {
  rows: AuditLogEntry[];
  error: string | null;
}

async function loadRecentUploads(
  surface: SchedulerAdminSurface,
): Promise<PerSurfaceLoad> {
  try {
    const result = await listRecentUploadsAction({ surface, limit: 10 });
    return { rows: result.rows, error: null };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export default async function SchedulerConfigPage() {
  const { email } = await requireAdmin();

  // Fetch all 5 V2 catalog tabs' recent-uploads lists in parallel — one
  // round-trip instead of five sequential ones. Each call degrades to
  // `error: <msg>` so one slow surface can't block the page.
  const [
    subDescLoad,
    routineLoad,
    testingLoad,
    subMapLoad,
    reqFactsLoad,
  ] = await Promise.all([
    loadRecentUploads("subcategory_descriptions"),
    loadRecentUploads("routine_services"),
    loadRecentUploads("testing_services"),
    loadRecentUploads("subcategory_service_map"),
    loadRecentUploads("question_required_facts"),
  ]);

  return (
    <AppShell email={email}>
      <PageHeader
        title="Scheduler config"
        description="Edit predefined-data catalog. Two-step apply. Revert within 30 days. All 10 surfaces share Pattern S."
      />

      <SchedulerConfigTabs
        defaultValue="sub-desc"
        subDesc={
          <TabBody load={subDescLoad} label="Subcategory descriptions">
            <CatalogEditorTab
              surface="subcategory_descriptions"
              surfaceLabel="Subcategory descriptions"
              uploadAction={uploadSubcategoryDescriptionsAction}
              exportAction={exportSubcategoryDescriptionsAction}
              recentUploads={subDescLoad.rows}
              exportFilenameBase="subcategory-descriptions"
              currentStateSummary={
                <>
                  Stage-1 classifier metadata: description, positive/negative
                  examples, synonyms — per <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{`<category>/<slug>`}</code> composite.
                </>
              }
            />
          </TabBody>
        }
        routine={
          <TabBody load={routineLoad} label="Routine services">
            <CatalogEditorTab
              surface="routine_services"
              surfaceLabel="Routine services"
              uploadAction={uploadRoutineServicesAction}
              exportAction={exportRoutineServicesAction}
              recentUploads={routineLoad.rows}
              exportFilenameBase="routine-services"
              currentStateSummary="Service catalog with concern-category attribution + pricing."
            />
          </TabBody>
        }
        testing={
          <TabBody load={testingLoad} label="Testing services">
            <CatalogEditorTab
              surface="testing_services"
              surfaceLabel="Testing services"
              uploadAction={uploadTestingServicesAction}
              exportAction={exportTestingServicesAction}
              recentUploads={testingLoad.rows}
              exportFilenameBase="testing-services"
              currentStateSummary="Diagnostic/testing service catalog with starting prices."
            />
          </TabBody>
        }
        subMap={
          <TabBody load={subMapLoad} label="Subcategory service map">
            <CatalogEditorTab
              surface="subcategory_service_map"
              surfaceLabel="Subcategory service map"
              uploadAction={uploadSubcategoryServiceMapAction}
              exportAction={exportSubcategoryServiceMapAction}
              recentUploads={subMapLoad.rows}
              exportFilenameBase="subcategory-service-map"
              currentStateSummary="Maps the 14 concern subcategories → eligible testing service keys."
            />
          </TabBody>
        }
        reqFacts={
          <TabBody load={reqFactsLoad} label="Question required facts">
            <CatalogEditorTab
              surface="question_required_facts"
              surfaceLabel="Question required facts"
              uploadAction={uploadQuestionRequiredFactsAction}
              exportAction={exportQuestionRequiredFactsAction}
              recentUploads={reqFactsLoad.rows}
              exportFilenameBase="question-required-facts"
              currentStateSummary="Required ExtractedFacts slot names per concern question (gates stage-3 'answered' check)."
            />
          </TabBody>
        }
      />
    </AppShell>
  );
}

/**
 * Graceful fallback when the recent-uploads fetch fails. Upload/Export still
 * work — only the audit panel is affected — so render the full tab body
 * either way; show a small banner above if the fetch errored.
 */
function TabBody({
  load,
  label,
  children,
}: {
  load: PerSurfaceLoad;
  label: string;
  children: React.ReactNode;
}) {
  if (load.error) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            Couldn&apos;t load recent uploads for {label}.
          </p>
          <p className="mt-1 text-xs text-foreground">{load.error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Upload + export still work below — only the &ldquo;Recent uploads&rdquo; panel is affected.
          </p>
        </div>
        {children}
      </div>
    );
  }
  return <>{children}</>;
}
