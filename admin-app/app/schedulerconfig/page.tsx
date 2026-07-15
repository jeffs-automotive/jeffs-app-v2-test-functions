/**
 * /schedulerconfig — DIRECT WEBFORMS (sub-feature A, 2026-07-02).
 *
 * Rewrite per docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md:
 * the MD-upload/Pattern-S/orchestrator pipeline is retired. Every tab renders
 * LIVE table data (read-dal, service-role reads behind requireAdmin) and
 * mutates through the direct SECURITY DEFINER RPCs (write-dal + thin
 * actions) which commit the change + its audit row atomically with
 * updated_at staleness protection.
 *
 * RSC fetches every tab's data in ONE parallel round; mutations
 * revalidatePath + router.refresh() re-run this fetch.
 *
 * Auth gate: requireAdmin() — actor identity derived server-side, never
 * from the client.
 */
import { requireAdmin } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/shell/AppShell";

import { DirectConfigTabs } from "@/components/scheduler/direct/DirectConfigTabs";
import ServicesDirectTab from "@/components/scheduler/direct/ServicesDirectTab";
import { SubcategoriesDirectTab } from "@/components/scheduler/direct/SubcategoriesDirectTab";
import { QuestionsDirectTab } from "@/components/scheduler/direct/QuestionsDirectTab";
import { GuidelinesDirectTab } from "@/components/scheduler/direct/GuidelinesDirectTab";
import { LimitsDirectTab } from "@/components/scheduler/direct/LimitsDirectTab";
import { ClosedDatesDirectTab } from "@/components/scheduler/direct/ClosedDatesDirectTab";
import { TypesDirectTab } from "@/components/scheduler/direct/TypesDirectTab";
import { TemplatesDirectTab } from "@/components/scheduler/direct/TemplatesDirectTab";
import { CardTextDirectTab } from "@/components/scheduler/direct/CardTextDirectTab";
import { OperationsDirectTab } from "@/components/scheduler/direct/OperationsDirectTab";
import { RecentChangesList } from "@/components/scheduler/direct/RecentChangesList";

import {
  findOrphans,
  listAppointmentBlocks,
  listAppointmentLimits,
  listAppointmentTypes,
  listAuditLog,
  listCardText,
  listClosedDates,
  listGuidelines,
  listMessageTemplates,
  listQuestions,
  listRoutineServices,
  listSubcategories,
  listTestingServices,
} from "@/lib/scheduler/read-dal";

export const dynamic = "force-dynamic"; // admin surface mutates live state

export default async function SchedulerConfigPage() {
  const { email } = await requireAdmin();

  const todayYmd = new Date().toISOString().slice(0, 10);
  const [
    routine,
    testing,
    subcategories,
    questions,
    guidelines,
    limits,
    closedDates,
    blocks,
    types,
    templates,
    cardText,
    orphans,
    audit,
  ] = await Promise.all([
    listRoutineServices(),
    listTestingServices(),
    listSubcategories(),
    listQuestions(),
    listGuidelines(),
    listAppointmentLimits(),
    listClosedDates(todayYmd),
    listAppointmentBlocks(todayYmd),
    listAppointmentTypes(),
    listMessageTemplates(),
    listCardText(),
    findOrphans(30),
    listAuditLog({ limit: 30 }),
  ]);

  return (
    <AppShell email={email}>
      <PageHeader
        eyebrow="Configuration"
        title="Scheduler config"
        description="Live scheduler catalog, capacity, appointment types, and customer messages — edits apply immediately and are audited."
      />
      <DirectConfigTabs
        slots={{
          services: <ServicesDirectTab routine={routine} testing={testing} />,
          types: <TypesDirectTab types={types} />,
          templates: <TemplatesDirectTab templates={templates} types={types} />,
          cardtext: <CardTextDirectTab rows={cardText} />,
          subcategories: (
            <SubcategoriesDirectTab
              subcategories={subcategories}
              testingServices={testing}
            />
          ),
          questions: (
            <QuestionsDirectTab subcategories={subcategories} questions={questions} />
          ),
          guidelines: <GuidelinesDirectTab guidelines={guidelines} />,
          limits: <LimitsDirectTab limits={limits} />,
          closeddates: (
            <ClosedDatesDirectTab closedDates={closedDates} blocks={blocks} />
          ),
          operations: <OperationsDirectTab orphans={orphans} />,
          history: <RecentChangesList entries={audit} />,
        }}
      />
    </AppShell>
  );
}
