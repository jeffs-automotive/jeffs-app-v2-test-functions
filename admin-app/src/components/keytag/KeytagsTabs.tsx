"use client";

/**
 * KeytagsTabs — client wrapper around shadcn Tabs that lets us nest
 * Server Component tab content via children props.
 *
 * Why pass content as props rather than rendering inline: the Tabs
 * component is a Client Component (browser-state for active tab), but
 * each tab's content can/should be a Server Component (data fetching
 * + auth gate at the page level). Passing as props preserves the
 * RSC tree boundary.
 */
import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  History,
  LayoutDashboard,
  List,
  RefreshCcw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return (
    <Tabs defaultValue={defaultValue} className="w-full">
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
