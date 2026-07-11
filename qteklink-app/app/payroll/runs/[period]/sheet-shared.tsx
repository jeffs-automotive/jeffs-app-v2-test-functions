/**
 * Shared context + atoms for the pay-sheet tab (SheetsView + SheetBonusPanels)
 * — split out to honor the ~500-line file policy. SheetCtx carries one
 * employee's frozen/computed snapshot slice plus the edit gates; Override is
 * the single render point for the OverrideEditor pencil (only on open runs
 * for admins, and only when the entry row id is known).
 */
import type { Overrides, SnapshotEmployee } from "@/lib/payroll/types";
import { OverrideEditor, type OverrideKey } from "./OverrideEditor";
import type { MonthProvenanceView } from "../../payroll-ui";

export interface SheetCtx {
  e: SnapshotEmployee;
  entryId: string | null;
  /** Open run + admin — override pencils and goal editors render. */
  editable: boolean;
  bonusOn: boolean;
  bonusMonth: string | null;
  monthProv: MonthProvenanceView;
  leaveProv: { windowRuns: number | null; seededEntries: number | null } | null;
}

export function pcNum(pc: Record<string, unknown>, key: string): number | null {
  const v = pc[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function Override({
  ctx,
  overrideKey,
  label,
  unit,
  allowNegative,
  autoDisplay,
}: {
  ctx: SheetCtx;
  overrideKey: OverrideKey;
  label: string;
  unit: "hours" | "usd" | "count";
  allowNegative?: boolean;
  autoDisplay?: string;
}) {
  if (!ctx.editable || ctx.entryId === null) return null;
  return (
    <OverrideEditor
      entryId={ctx.entryId}
      overrides={ctx.e.overrides as Overrides}
      overrideKey={overrideKey}
      label={`${ctx.e.display_name} ${label}`}
      unit={unit}
      allowNegative={allowNegative}
      autoDisplay={autoDisplay}
    />
  );
}
