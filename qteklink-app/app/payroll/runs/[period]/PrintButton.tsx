"use client";

/**
 * PrintButton — window.print() from a presentational button (design spec §3c;
 * explicitly allowed as a browser affordance). The page always renders the
 * Summary table for print (`hidden print:block` off the summary tab), so the
 * printed sheet is the per-employee totals regardless of the active tab.
 */
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden="true" />
      Print summary
    </Button>
  );
}
