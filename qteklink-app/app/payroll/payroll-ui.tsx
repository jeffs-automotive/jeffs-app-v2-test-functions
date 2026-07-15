/**
 * payroll-ui — the single page-local shared presentational vocabulary for the
 * whole /payroll module (dashboard + employees + run detail + settings).
 * Consolidates what used to live in three duplicated files (app/payroll/ui.tsx,
 * app/payroll/RunStatusBadge.tsx, app/payroll/runs/[period]/run-ui.tsx) so the
 * provenance + lock/void system is defined in exactly one place. Purely
 * presentational: no data fetching, no actions, no state. Server AND client
 * components import from here (no "use client" — it compiles for both).
 *
 * Provenance system (the spec's core treatment): AutoValue renders a
 * Tekmetric-sourced number as an indigo (--color-auto) chip with a glyph + a
 * source tooltip + an accessible name that names the source ("… from Tekmetric")
 * so color never carries the meaning alone; an overridden value swaps to plain
 * ink + an "overridden" outline badge whose title carries the note. Hand-keyed
 * values are plain foreground text — the chip/no-chip contrast IS the
 * auto-vs-manual distinction.
 *
 * Colors that carry state come from the module tokens in globals.css:
 *   --color-auto* — auto/provenance (indigo); also the "cloned-from" banner.
 *   --color-voided* — the archival/superseded (slate) run state.
 */
import type { ReactNode } from "react";
import { Ban, Link2, Lock, PencilLine, PenLine, TrendingDown } from "lucide-react";
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

/** Hours for display: 1–2 decimals ("40.0", "3.75"). Run-detail default. */
export function fmtHours(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Hours pinned to exactly one decimal ("40.0", "3.8"). Dashboard roster idiom. */
export function fmtHoursFixed1(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Signed hours for the PTO ledger's "± hours" column and the Adjust preview:
 * "+3.50" / "−1.25" / "0.00". The magnitude uses fmtHours (2dp min-1); the sign
 * glyph is an explicit U+2212 minus for negatives (matching the DryRun fmtDelta
 * convention) and a "+" for positives; zero stays unsigned.
 */
export function fmtSignedHours(h: number): string {
  if (h < 0) return `−${fmtHours(Math.abs(h))}`;
  if (h > 0) return `+${fmtHours(h)}`;
  return fmtHours(0);
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

/** "2026" or "2026–27" when a period straddles New Year. */
export function periodYears(startIso: string, endIso: string): string {
  const y1 = startIso.slice(0, 4);
  const y2 = endIso.slice(0, 4);
  return y1 === y2 ? y1 : `${y1}–${y2.slice(2)}`;
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

// ── Role / family / leave-rate labels ─────────────────────────────────────────

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

/** String-keyed alias for callers that hold a raw role string (dashboard roster). */
export const ROLE_LABELS: Record<string, string> = ROLE_LABEL;

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

// ── Table idiom constants (the breakdown page's shared treatment) ─────────────

/** The breakdown page's right-aligned numeric-cell idiom. */
export const numCell = "px-3 py-2 text-right tabular-nums";

/** The breakdown page's table-header treatment. */
export const headerCls =
  "bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:px-3 [&_th]:py-2";

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
    cls: "border-[color:var(--color-voided-border)] bg-[color:var(--color-voided-bg)] text-[color:var(--color-voided)]",
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
 * AutoValue — an auto-tracked (Tekmetric/derived) number. Indigo (--color-auto)
 * chip + glyph + source tooltip + an accessible name naming the provenance. When
 * overridden: plain ink, PencilLine glyph, and an "overridden" badge whose title
 * carries the note. NEVER mutates — any override affordance is a sibling the
 * caller renders.
 *
 * Accessible-name API (spec §Shared primitives #1 + addendum a11y): pass `label`
 * (what the number is, e.g. "Billed hours") + `valueText` (the value read aloud,
 * e.g. "42.5") to get an explicit aria-label "Billed hours 42.5, from Tekmetric"
 * — provenance in the accessible name, not color alone. Without them the visible
 * children plus an sr-only "from Tekmetric" still carry the provenance.
 */
export function AutoValue({
  children,
  source,
  label,
  valueText,
  overridden = false,
  overrideNote,
  className,
}: {
  children: ReactNode;
  /** Tooltip naming the source + the window it was bucketed to. */
  source: string;
  /** What the number is (e.g. "Billed hours") — composed into the accessible name. */
  label?: string;
  /** The value read aloud (e.g. "42.5") — composed into the accessible name. */
  valueText?: string;
  overridden?: boolean;
  /** Shown as the overridden badge's title (the override's note). */
  overrideNote?: string;
  className?: string;
}) {
  // Explicit accessible name when the caller names the number + value; the
  // provenance ("from Tekmetric" / "overridden") is always part of it.
  const ariaLabel =
    label !== undefined && valueText !== undefined
      ? `${label} ${valueText}, ${overridden ? "manually overridden" : "from Tekmetric"}`
      : undefined;

  if (overridden) {
    return (
      <span
        className={cn("inline-flex items-center gap-1 tabular-nums text-foreground", className)}
        aria-label={ariaLabel}
      >
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
        "inline-flex items-center gap-1 rounded-md bg-[color:var(--color-auto-bg)] px-1.5 py-0.5 tabular-nums text-[color:var(--color-auto)] ring-1 ring-[color:var(--color-auto-border)]",
        className,
      )}
      title={source}
      aria-label={ariaLabel}
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
        <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--color-auto-bg)] px-1.5 py-0.5 text-[color:var(--color-auto)] ring-1 ring-[color:var(--color-auto-border)]">
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

/** "n/a" with the reason in title + accessible name — never a misleading $0.00. */
export function NotApplicable({ reason }: { reason: string }) {
  return (
    <span className="text-muted-foreground" title={reason} aria-label={`n/a — ${reason}`}>
      n/a
    </span>
  );
}

// ── PTO balance state (the deficit treatment) ─────────────────────────────────

/**
 * PtoBalance — an hours balance with the one PTO-negative state color. A
 * positive/zero balance is plain tabular-nums ink (color never means "good");
 * only a NEGATIVE balance gets the amber-red deficit chip (--color-pto-negative*)
 * so "this person will owe hours" reads at a glance and identically on the
 * employee card, the Adjust preview, the dry-run modal, the completion dialog,
 * and the ledger. The chip never carries meaning by color alone: a leading "−"
 * sign, a TrendingDown glyph, and an explicit accessible name ("… negative — X
 * hour deficit") all say "deficit". Never renders "$" — hours 2dp via fmtHours.
 *
 * Prop: { hours; label? }. Pure formatting; no business logic.
 */
export function PtoBalance({ hours, label }: { hours: number; label?: string }) {
  if (hours >= 0) {
    return (
      <span className="tabular-nums text-foreground" aria-label={label}>
        {fmtHours(hours)} hrs
      </span>
    );
  }
  const deficit = Math.abs(hours);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-[color:var(--color-pto-negative-bg)] px-1.5 py-0.5 tabular-nums text-[color:var(--color-pto-negative)] ring-1 ring-[color:var(--color-pto-negative-border)]"
      aria-label={`PTO balance ${fmtHours(hours)} hours, negative — ${fmtHours(deficit)} hour deficit`}
    >
      <TrendingDown className="size-3 shrink-0" aria-hidden="true" />
      −{fmtHours(deficit)} hrs
    </span>
  );
}

/**
 * DeficitNotice — the reusable amber-red inline alert box (PTO-negative palette),
 * shared by the dry-run PTO section, the completion dialog, and the Adjust
 * preview. role="alert" so the deficit is announced. Mirrors the shape of
 * CompleteRunButton's red role="alert" box but in the PTO-negative hue so a
 * balance deficit reads distinctly from the unsaved-entries *error*.
 */
export function DeficitNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-[color:var(--color-pto-negative-border)] bg-[color:var(--color-pto-negative-bg)] p-3 text-sm text-[color:var(--color-pto-negative)]"
    >
      {children}
    </div>
  );
}

// ── Loose-provenance safe readers (derived_provenance allows extra keys) ───────

export interface MonthProvenanceView {
  /** Round-9 #45: DISPLAY month sales = Σ(totalSales − taxes) — fees stay in.
   *  (Pre-#45 frozen snapshots carry the old after-fees figure; display it as
   *  stored — frozen runs are never recomputed.) */
  salesCents: number | null;
  gpWithFeesCents: number | null;
  gpWithoutFeesCents: number | null;
  partsCostCents: number | null;
  /** Fallback-path only (#38); null when the QBO tech-cost composition ran. */
  laborPayProratedCents: number | null;
  shopHours: number | null;
  roCount: number | null;
  salesGoalCents: number | null;
  salesGoalSource: string | null;
  /** Round-5 #38: 'qbo_tech_cost' | 'computed' | null (pre-#38 snapshots). */
  gpSource: string | null;
  qboTechCostCents: number | null;
  qboTechCostAccount: string | null;
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
    gpSource: typeof rec["month_gp_source"] === "string" ? rec["month_gp_source"] : null,
    qboTechCostCents: numAt(rec, "month_qbo_tech_cost_cents"),
    qboTechCostAccount:
      typeof rec["month_qbo_tech_cost_account"] === "string" ? rec["month_qbo_tech_cost_account"] : null,
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
