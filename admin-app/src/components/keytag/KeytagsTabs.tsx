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
  ArrowLeftRight,
  CheckCircle2,
  History,
  List,
  RefreshCcw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface KeytagsTabsProps {
  defaultValue?: string;
  live: ReactNode;
  assignRelease: ReactNode;
  postedRevert: ReactNode;
  reconcile: ReactNode;
  manualReviews: ReactNode;
  auditHistory: ReactNode;
}

export function KeytagsTabs({
  defaultValue = "live",
  live,
  assignRelease,
  postedRevert,
  reconcile,
  manualReviews,
  auditHistory,
}: KeytagsTabsProps) {
  return (
    <Tabs defaultValue={defaultValue} className="w-full">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
        <TabsTrigger value="live" className="gap-1.5">
          <List className="h-3.5 w-3.5" aria-hidden="true" />
          Live state
        </TabsTrigger>
        <TabsTrigger value="assign-release" className="gap-1.5">
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
          Assign / Release
        </TabsTrigger>
        <TabsTrigger value="posted-revert" className="gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Posted / Revert
        </TabsTrigger>
        <TabsTrigger value="reconcile" className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reconcile
        </TabsTrigger>
        <TabsTrigger value="manual-reviews" className="gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Manual reviews
        </TabsTrigger>
        <TabsTrigger value="audit" className="gap-1.5">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Audit history
        </TabsTrigger>
      </TabsList>

      <TabsContent value="live" className="mt-6">
        {live}
      </TabsContent>
      <TabsContent value="assign-release" className="mt-6">
        {assignRelease}
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
