/**
 * /schedulerconfig — D.4 landed 2026-05-27 (8 of 10 catalog tabs live).
 *
 * Per plan v0.5 §9 build order:
 *   - D.1 ✅ types + md-file-utils + orchestrator types
 *   - D.2 ✅ Subcategory descriptions END-TO-END (pilot)
 *   - D.3 ✅ Routine + testing + sub-map + req-facts
 *   - D.4 ✅ Concerns-flat + appt-limits + closed-dates MD path (this commit)
 *   - D.5 — Concerns-per-category (needs category picker + sub-surface picker)
 *   - D.6 — Closed-dates inline block/unblock calendar (additive to D.4)
 *   - D.7 — Operations tab
 *
 * RSC fetches all 8 recent-uploads lists in parallel via Promise.all so the
 * page renders in one round-trip.
 *
 * Auth gate: requireAdmin() — actor_email derived server-side, never from
 * client.
 */
import { requireAdmin } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SchedulerConfigTabs } from "@/components/scheduler/SchedulerConfigTabs";
import { CatalogEditorTab } from "@/components/scheduler/CatalogEditorTab";
import { ConcernsPerCategoryTab } from "@/components/scheduler/ConcernsPerCategoryTab";
import { OperationsTab } from "@/components/scheduler/OperationsTab";
import { CapacityCalendarStrip } from "@/components/scheduler/CapacityCalendarStrip";
import {
  listCapacityCalendarAction,
  type CapacityCalendarLoad,
} from "@/actions/scheduler/list-capacity-calendar";
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
import { uploadConcernQuestionsAction } from "@/actions/scheduler/upload-concern-questions";
import { exportConcernQuestionsAction } from "@/actions/scheduler/export-concern-questions";
import { uploadAppointmentDefaultLimitsAction } from "@/actions/scheduler/upload-appointment-default-limits";
import { exportAppointmentDefaultLimitsAction } from "@/actions/scheduler/export-appointment-default-limits";
import { uploadClosedDatesAction } from "@/actions/scheduler/upload-closed-dates";
import { exportClosedDatesAction } from "@/actions/scheduler/export-closed-dates";
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

interface CapacityCalendarFetch {
  load: CapacityCalendarLoad | null;
  error: string | null;
}

async function loadCapacityCalendar(): Promise<CapacityCalendarFetch> {
  try {
    const load = await listCapacityCalendarAction();
    return { load, error: null };
  } catch (e) {
    return {
      load: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export default async function SchedulerConfigPage() {
  const { email } = await requireAdmin();

  // Fetch all 10 catalog tabs' recent-uploads lists in parallel — one
  // round-trip instead of ten sequential ones. Each call degrades to
  // `error: <msg>` so one slow surface can't block the page.
  //
  // concern_subcategories + concern_category_guidelines are the underlying
  // audit-log surfaces for the Concerns-per-category tab's Questions and
  // Guidelines sub-surfaces respectively.
  const [
    subDescLoad,
    routineLoad,
    testingLoad,
    subMapLoad,
    reqFactsLoad,
    concernsFlatLoad,
    apptLimitsLoad,
    closedDatesLoad,
    perCatQuestionsLoad,
    perCatGuidelinesLoad,
    capacityCalendar,
  ] = await Promise.all([
    loadRecentUploads("subcategory_descriptions"),
    loadRecentUploads("routine_services"),
    loadRecentUploads("testing_services"),
    loadRecentUploads("subcategory_service_map"),
    loadRecentUploads("question_required_facts"),
    loadRecentUploads("concern_questions"),
    loadRecentUploads("appointment_default_limits"),
    loadRecentUploads("closed_dates"),
    loadRecentUploads("concern_subcategories"),
    loadRecentUploads("concern_category_guidelines"),
    loadCapacityCalendar(),
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
        concernsFlat={
          <TabBody load={concernsFlatLoad} label="Concern questions (flat)">
            <CatalogEditorTab
              surface="concern_questions"
              surfaceLabel="Concern questions (flat)"
              uploadAction={uploadConcernQuestionsAction}
              exportAction={exportConcernQuestionsAction}
              recentUploads={concernsFlatLoad.rows}
              exportFilenameBase="concern-questions-flat"
              currentStateSummary="Whole-table flat upload of concern_questions across all 14 categories. For per-category iteration use the Concerns-per-cat tab (coming in D.5)."
            />
          </TabBody>
        }
        apptLimits={
          <TabBody load={apptLimitsLoad} label="Appointment default limits">
            <CatalogEditorTab
              surface="appointment_default_limits"
              surfaceLabel="Appointment default limits"
              uploadAction={uploadAppointmentDefaultLimitsAction}
              exportAction={exportAppointmentDefaultLimitsAction}
              recentUploads={apptLimitsLoad.rows}
              exportFilenameBase="appointment-default-limits"
              currentStateSummary="Per-day-of-week default appointment capacity limits. Composite PK (shop_id, day_of_week)."
            />
          </TabBody>
        }
        closedDates={
          <div className="space-y-8">
            <TabBody load={closedDatesLoad} label="Closed dates">
              <CatalogEditorTab
                surface="closed_dates"
                surfaceLabel="Closed dates"
                uploadAction={uploadClosedDatesAction}
                exportAction={exportClosedDatesAction}
                recentUploads={closedDatesLoad.rows}
                exportFilenameBase="closed-dates"
                currentStateSummary={
                  <>
                    Future-dated full-day closures (past dates immutable). For ad-hoc
                    per-day appointment blocks (with optional reason text) see the
                    capacity calendar below.
                  </>
                }
              />
            </TabBody>
            <div>
              <h2 className="mb-2 text-base font-semibold">
                Per-day capacity (next 90 days)
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Shows merged state from <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">closed_dates</code> (read-only here; manage via MD path above) and{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">appointment_blocks</code> (ad-hoc per-day blocks managed here).
              </p>
              {capacityCalendar.error || !capacityCalendar.load ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    Couldn&apos;t load capacity calendar.
                  </p>
                  <p className="mt-1 text-xs text-foreground">
                    {capacityCalendar.error ?? "Unknown error."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    The MD-upload path above still works for managing closed_dates.
                  </p>
                </div>
              ) : (
                <CapacityCalendarStrip load={capacityCalendar.load} />
              )}
            </div>
          </div>
        }
        concernsPerCat={
          // Errors on EITHER sub-surface's audit-log fetch are surfaced
          // jointly above the picker; both lists are passed in and the
          // active sub-surface picks one.
          (() => {
            const combinedError =
              perCatQuestionsLoad.error ?? perCatGuidelinesLoad.error;
            if (combinedError) {
              return (
                <div className="space-y-4">
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <p className="font-medium text-destructive">
                      Couldn&apos;t load recent uploads for Concerns-per-category.
                    </p>
                    <p className="mt-1 text-xs text-foreground">{combinedError}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Picker + upload + export still work below — only the
                      &ldquo;Recent uploads&rdquo; panel is affected.
                    </p>
                  </div>
                  <ConcernsPerCategoryTab
                    questionsRecentUploads={perCatQuestionsLoad.rows}
                    guidelinesRecentUploads={perCatGuidelinesLoad.rows}
                  />
                </div>
              );
            }
            return (
              <ConcernsPerCategoryTab
                questionsRecentUploads={perCatQuestionsLoad.rows}
                guidelinesRecentUploads={perCatGuidelinesLoad.rows}
              />
            );
          })()
        }
        operations={<OperationsTab />}
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
