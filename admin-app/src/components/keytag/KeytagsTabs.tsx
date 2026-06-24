"use client";

/**
 * KeytagsTabs — client wrapper around the Tabs primitive that lets us nest
 * Server Component tab content via children props.
 *
 * The active tab is URL-synced (?tab=) so a reload keeps the user on their
 * current tab instead of resetting to Dashboard (2026-06-24 board-release-fix).
 * On a tab click we persist the value with window.history.replaceState — NOT
 * router.replace — so switching tabs never re-runs the six tab Server
 * Components on this force-dynamic page (replaceState updates the URL + stays
 * in sync with the Next router without a navigation, and keeps the back button
 * clean). The first paint is seeded from `defaultValue` (which the page already
 * computed from ?tab=), so client + server agree (no hydration mismatch).
 *
 * Why pass content as props rather than rendering inline: each tab's content
 * can/should be a Server Component (data fetching + auth gate at the page
 * level). Passing as props preserves the RSC tree boundary.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  History,
  LayoutDashboard,
  List,
  RefreshCcw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_VALUES = [
  "dashboard",
  "live",
  "posted-revert",
  "reconcile",
  "manual-reviews",
  "audit",
] as const;

export interface KeytagsTabsProps {
  defaultValue?: string;
  dashboard: ReactNode;
  live: ReactNode;
  postedRevert: ReactNode;
  reconcile: ReactNode;
  manualReviews: ReactNode;
  auditHistory: ReactNode;
}

export function KeytagsTabs({
  defaultValue = "dashboard",
  dashboard,
  live,
  postedRevert,
  reconcile,
  manualReviews,
  auditHistory,
}: KeytagsTabsProps) {
  // Seed from the server-computed defaultValue (the page validated ?tab= →
  // defaultValue), so the first client paint matches the server. Controlled
  // thereafter so a tab change persists into the URL.
  const [value, setValue] = useState(defaultValue);

  // Follow the server-computed tab on client navigations that change ?tab=
  // (the audit / manual-review filter forms router.push their own tab). A plain
  // tab click updates the URL via replaceState below — NOT a Next navigation —
  // so defaultValue is unchanged and this effect doesn't fight the click.
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleValueChange = useCallback((next: string) => {
    if (!(TAB_VALUES as readonly string[]).includes(next)) return;
    setValue(next);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", next);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
    }
  }, []);

  return (
    <Tabs
      value={value}
      onValueChange={(next) => handleValueChange(next as string)}
      className="w-full"
    >
      <TabsList
        variant="line"
        className="flex h-auto w-full flex-wrap justify-start gap-x-1 border-b border-border"
      >
        <TabsTrigger value="dashboard" className="gap-1.5 data-active:after:bg-primary">
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
          Dashboard
        </TabsTrigger>
        <TabsTrigger value="live" className="gap-1.5 data-active:after:bg-primary">
          <List className="h-3.5 w-3.5" aria-hidden="true" />
          Board
        </TabsTrigger>
        <TabsTrigger value="posted-revert" className="gap-1.5 data-active:after:bg-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Posted / Revert
        </TabsTrigger>
        <TabsTrigger value="reconcile" className="gap-1.5 data-active:after:bg-primary">
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reconcile
        </TabsTrigger>
        <TabsTrigger value="manual-reviews" className="gap-1.5 data-active:after:bg-primary">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Manual reviews
        </TabsTrigger>
        <TabsTrigger value="audit" className="gap-1.5 data-active:after:bg-primary">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Audit history
        </TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="mt-6">
        {dashboard}
      </TabsContent>
      <TabsContent value="live" className="mt-6">
        {live}
      </TabsContent>
      <TabsContent value="posted-revert" className="mt-6">
        {postedRevert}
      </TabsContent>
      <TabsContent value="reconcile" className="mt-6">
        {reconcile}
      </TabsContent>
      <TabsContent value="manual-reviews" className="mt-6">
        {manualReviews}
      </TabsContent>
      <TabsContent value="audit" className="mt-6">
        {auditHistory}
      </TabsContent>
    </Tabs>
  );
}
