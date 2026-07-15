"use client";

/**
 * Tab switcher for the direct-webform /schedulerconfig (sub-feature A).
 * Pure presentation: the page (RSC) fetches every tab's data via read-dal
 * and passes rendered sections in as slots, so switching tabs is instant
 * and a router.refresh() after any mutation re-fetches everything.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface DirectConfigTabsProps {
  slots: Record<string, React.ReactNode>;
}

const TAB_ORDER: Array<{ key: string; label: string }> = [
  { key: "services", label: "Services" },
  { key: "types", label: "Appointment Types" },
  { key: "templates", label: "Messages" },
  { key: "cardtext", label: "Card Text" },
  { key: "subcategories", label: "Subcategories" },
  { key: "questions", label: "Questions" },
  { key: "guidelines", label: "Guidelines" },
  { key: "limits", label: "Limits" },
  { key: "closeddates", label: "Closed Dates" },
  { key: "operations", label: "Operations" },
  { key: "history", label: "History" },
];

export function DirectConfigTabs({ slots }: DirectConfigTabsProps) {
  return (
    <Tabs defaultValue="services">
      <TabsList className="mb-4 flex-wrap">
        {TAB_ORDER.map((t) => (
          <TabsTrigger key={t.key} value={t.key}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TAB_ORDER.map((t) => (
        <TabsContent key={t.key} value={t.key}>
          {slots[t.key] ?? null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
