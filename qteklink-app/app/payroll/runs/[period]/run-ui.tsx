/**
 * Run-detail shared presentational pieces — formatters + the provenance/status
 * vocabulary for /payroll/runs/[period] (design spec §3 + addendum §3). Purely
 * presentational: no data fetching, no actions, no state. Server AND client
 * components import from here (no "use client" — it compiles for both).
 *
 * Provenance system (the spec's core treatment): AutoValue renders a
 * Tekmetric-sourced number as an indigo chip with a glyph + a source tooltip +
 * sr-only "from Tekmetric" (color never carries the meaning alone); an
 * overridden value swaps to plain ink + an "overridden" outline badge whose
 * title carries the note. Hand-keyed values are plain foreground text — the
 * chip/no-chip contrast IS the auto-vs-manual distinction.
 */
import type { ReactNode } from "react";
import { Ban, Link2, Lock, PencilLine, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  DerivedProvenance,
  Family,
  LeaveRateSource,
  Role,
  RunStatus,
} from "@/lib/payroll/types";

// ── Formatters (display-only; money always arrives as integer cents) ──────────

/** Hours for display: 1–2 decimals ("40.0", "3.75"). */
export function fmtHours(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** ISO YYYY-MM-DD → "6-28-26" (the task's M-D-YY period label format). */
export function fmtShortDate(iso: string): string {
  const [y = "", m = "0", d = "0"] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y.slice(2)}`;
}

/** "6-28-26 – 7-11-26". */
export function periodLabel(start: string, end: string): string {
  return `${fmtShortDate(start)} – ${fmtShortDate(end)}`;
}

/** ISO timestamp → "June 28, 2026" (banner dates). */
export function fmtDateLong(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** ISO timestamp → "Jun 28, 2026, 4:05 PM" (the data-as-of line). */
export function fmtAsOf(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** ISO date (any day in the month) → "June 2026". */
export function monthLabel(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const ROLE_LABEL: Record<Role, string> = {
  general_manager: "General Manager",
  service_manager: "Service Manager",
  asst_manager: "Asst Manager",
  office_manager: "Office Manager",
  shop_foreman: "Shop Foreman",
  technician: "Technician",
  shop_support: "Shop Support",
  office_support: "Office Support",
};

export const FAMILY_LABEL: Record<Family, string> = {
  service_advisor: "Service advisor sheet — salary, GP-tier bonus & spiffs",
  office_manager: "Office manager sheet — hourly + monthly sales bonus",
  shop_foreman: "Foreman sheet — technician pay + shop-hours bonus",
  technician: "Technician sheet — clock, OT, billed & efficiency",
  support: "Support sheet — hourly + optional incentive",
};

/** Plain-language label for where a tech/foreman leave rate came from. */
export const LEAVE_RATE_SOURCE_LABEL: Record<LeaveRateSource, string> = {
  history: "average of recent completed runs",
  current_run: "this run's average (no history yet)",
  override: "manual override",
  seed: "seeded starting rate",
  base_rate: "base hourly rate",
};

// ── Status badge (local to payroll — the shared StatusBadge is SnapshotColumn-typed) ──

const RUN_STATUS: Record<RunStatus, { label: string; cls: string; Icon: typeof Lock }> = {
  open: {
    label: "Open",
    cls: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    Icon: PenLine,
  },
  completed: {
    label: "Completed",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    Icon: Lock,
  },
  voided: {
    label: "Voided",
    cls: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
    Icon: Ban,
  },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", s.cls)}>
      <s.Icon aria-hidden="true" />
      {s.label}
    </Badge>
  );
}

// ── The provenance chip ────────────────────────────────────────────────────────

/**
 * AutoValue — an auto-tracked (Tekmetric/derived) number. Indigo chip + glyph +
 * source tooltip + sr-only "from Tekmetric". When overridden: plain ink,
 * PencilLine glyph, and an "overridden" badge whose title carries the note.
 * NEVER mutates — any override affordance is a sibling the caller renders.
 */
export function AutoValue({
  children,
  source,
  overridden = false,
  overrideNote,
  className,
}: {
  children: ReactNode;
  /** Tooltip naming the source + the window it was bucketed to. */
  source: string;
  overridden?: boolean;
  /** Shown as the overridden badge's title (the override's note). */
  overrideNote?: string;
  className?: string;
}) {
  if (overridden) {
    return (
      <span className={cn("inline-flex items-center gap-1 tabular-nums text-foreground", className)}>
        <PencilLine className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        {children}
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title={overrideNote ? `Override note: ${overrideNote}` : "Manually overridden"}
        >
          overridden
        </Badge>
        <span className="sr-only">manually overridden</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 tabular-nums text-indigo-800 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800",
        className,
      )}
      title={source}
    >
      <Link2 className="size-3 shrink-0" aria-hidden="true" />
      {children}
      <span className="sr-only">from Tekmetric</span>
    </span>
  );
}

/** One-line legend shown once per grid/sheet stack (spec §Shared primitives #4). */
export function ProvenanceLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-indigo-800 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800">
          <Link2 className="size-3" aria-hidden="true" />
          12.3
        </span>
        = from Tekmetric (✎ to override)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="rounded-md px-1.5 py-0.5 text-foreground ring-1 ring-border">8.0</span>
        = entered by hand
      </span>
      <span>Totals recompute on save.</span>
    </p>
  );
}

/** Muted em-dash for a value that doesn't apply to this role — never $0.00. */
export function NA({ title = "Not applicable for this role" }: { title?: string }) {
  return (
    <span className="text-muted-foreground" title={title} aria-label={title}>
      —
    </span>
  );
}

// ── Loose-provenance safe readers (derived_provenance allows extra keys) ───────

export interface MonthProvenanceView {
  salesCents: number | null;
  gpWithFeesCents: number | null;
  gpWithoutFeesCents: number | null;
  partsCostCents: number | null;
  laborPayProratedCents: number | null;
  shopHours: number | null;
  roCount: number | null;
  salesGoalCents: number | null;
  salesGoalSource: string | null;
}

function numAt(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Read the bonus-month numbers the snapshot builder tucks into the loose provenance. */
export function readMonthProvenance(p: DerivedProvenance): MonthProvenanceView {
  const rec = p as Record<string, unknown>;
  return {
    salesCents: numAt(rec, "month_sales_cents"),
    gpWithFeesCents: numAt(rec, "month_gp_with_fees_cents"),
    gpWithoutFeesCents: numAt(rec, "month_gp_without_fees_cents"),
    partsCostCents: numAt(rec, "month_parts_cost_cents"),
    laborPayProratedCents: numAt(rec, "month_labor_pay_prorated_cents"),
    shopHours: numAt(rec, "month_shop_billed_hours"),
    roCount: numAt(rec, "month_ro_count"),
    salesGoalCents: numAt(rec, "month_sales_goal_cents"),
    salesGoalSource: typeof rec["month_sales_goal_source"] === "string" ? rec["month_sales_goal_source"] : null,
  };
}

/** Per-employee leave-rate window provenance (technician/shop_foreman only). */
export function readLeaveRateProvenance(
  p: DerivedProvenance,
  employeeId: string,
): { windowRuns: number | null; seededEntries: number | null } | null {
  const rates = (p as Record<string, unknown>)["leave_rates"];
  if (rates === null || typeof rates !== "object" || Array.isArray(rates)) return null;
  const entry = (rates as Record<string, unknown>)[employeeId];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rec = entry as Record<string, unknown>;
  return {
    windowRuns: numAt(rec, "window_runs"),
    seededEntries: numAt(rec, "seeded_entries"),
  };
}
