"use client";

/**
 * SchedulerConfigTabs — top-level Tabs router for /schedulerconfig.
 *
 * Per plan v0.5 §3 — 10 surface tabs total (9 catalog + 1 Operations).
 * D.2 pilot only wires the Subcategory descriptions tab; D.3-D.7 fill in
 * the rest. The other tabs render a "coming soon" stub for now so the
 * tab strip is fully visible.
 *
 * Why client wrapper: shadcn Tabs is a Client Component (browser state for
 * active tab). Tab CONTENT can be a Server Component passed as a prop —
 * same pattern as KeytagsTabs.
 */
import type { ReactNode } from "react";
import {
  CalendarX,
  CheckSquare,
  Clipboard,
  ClipboardList,
  FileCheck,
  HelpCircle,
  LayoutList,
  ListChecks,
  MessageSquare,
  Settings,
  Wrench,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "sub-desc", label: "Sub-desc", icon: ClipboardList },
  { value: "routine", label: "Routine", icon: Wrench },
  { value: "testing", label: "Testing", icon: FileCheck },
  { value: "sub-map", label: "Sub-map", icon: LayoutList },
  { value: "req-facts", label: "Req-facts", icon: ListChecks },
  { value: "concerns-flat", label: "Concerns-flat", icon: HelpCircle },
  { value: "concerns-per-cat", label: "Concerns-per-cat", icon: MessageSquare },
  { value: "appt-limits", label: "Appt limits", icon: Clipboard },
  { value: "closed-dates", label: "Closed dates", icon: CalendarX },
  { value: "operations", label: "Operations", icon: Settings },
] as const;

export interface SchedulerConfigTabsProps {
  defaultValue?: string;
  /** D.2 pilot — populated by the page-level RSC. */
  subDesc: ReactNode;
  /** D.3-D.7 — stubs for now. */
  routine?: ReactNode;
  testing?: ReactNode;
  subMap?: ReactNode;
  reqFacts?: ReactNode;
  concernsFlat?: ReactNode;
  concernsPerCat?: ReactNode;
  apptLimits?: ReactNode;
  closedDates?: ReactNode;
  operations?: ReactNode;
}

const Stub = ({ name }: { name: string }) => (
  <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
    <CheckSquare className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
    <p className="font-medium">{name}</p>
    <p className="mt-1 text-xs">Coming after D.2 pilot lands. Plan §9 build order.</p>
  </div>
);

export function SchedulerConfigTabs({
  defaultValue = "sub-desc",
  subDesc,
  routine,
  testing,
  subMap,
  reqFacts,
  concernsFlat,
  concernsPerCat,
  apptLimits,
  closedDates,
  operations,
}: SchedulerConfigTabsProps) {
  return (
    <Tabs defaultValue={defaultValue} className="w-full">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="sub-desc" className="mt-6">
        {subDesc}
      </TabsContent>
      <TabsContent value="routine" className="mt-6">
        {routine ?? <Stub name="Routine services" />}
      </TabsContent>
      <TabsContent value="testing" className="mt-6">
        {testing ?? <Stub name="Testing services" />}
      </TabsContent>
      <TabsContent value="sub-map" className="mt-6">
        {subMap ?? <Stub name="Subcategory service map" />}
      </TabsContent>
      <TabsContent value="req-facts" className="mt-6">
        {reqFacts ?? <Stub name="Question required facts" />}
      </TabsContent>
      <TabsContent value="concerns-flat" className="mt-6">
        {concernsFlat ?? <Stub name="Concern questions (flat)" />}
      </TabsContent>
      <TabsContent value="concerns-per-cat" className="mt-6">
        {concernsPerCat ?? <Stub name="Concerns per-category" />}
      </TabsContent>
      <TabsContent value="appt-limits" className="mt-6">
        {apptLimits ?? <Stub name="Appointment default limits" />}
      </TabsContent>
      <TabsContent value="closed-dates" className="mt-6">
        {closedDates ?? <Stub name="Closed dates" />}
      </TabsContent>
      <TabsContent value="operations" className="mt-6">
        {operations ?? <Stub name="Operations" />}
      </TabsContent>
    </Tabs>
  );
}
