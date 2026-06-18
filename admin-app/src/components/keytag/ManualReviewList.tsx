"use client";

/**
 * ManualReviewList — scannable, expandable list of manual reviews.
 *
 * Each row is a native <details> disclosure: collapsed it shows the code,
 * category, key tag, RO#, a one-line summary, and an open/resolved badge;
 * expanded it shows the full issue + context + (for open reviews) the inline
 * resolve flow. Native <details> gives keyboard/focus/aria for free.
 *
 * Deep-link: when `deepLinkCode` matches a row (from an email's
 * ?review=CODE link), that row renders open and scrolls into view (smooth
 * scroll branched off under prefers-reduced-motion).
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatEastern } from "@/lib/format-time";
import type {
  ManualReviewContext,
  ManualReviewListItem,
} from "@/lib/orchestrator/types";
import { TagBadge } from "./TagBadge";
import { ResolveManualReviewForm } from "./ResolveManualReviewForm";

export interface ManualReviewListProps {
  items: ManualReviewListItem[];
  /** Review code to auto-expand + scroll to (from an email link). */
  deepLinkCode: string | null;
  /** Presentational: tailors the empty state when a search is active. */
  hasQuery?: boolean;
  /** Presentational: tailors the empty state when the completed toggle is on. */
  showCompleted?: boolean;
}

export function ManualReviewList({
  items,
  deepLinkCode,
  hasQuery = false,
  showCompleted = false,
}: ManualReviewListProps) {
  if (items.length === 0) {
    if (hasQuery) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
          <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No reviews match your search</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Try a different code, key tag, or RO number — or clear the search.
          </p>
        </div>
      );
    }
    return (
      <EmptyState
        title={showCompleted ? "No reviews yet" : "No open reviews"}
        subtitle={
          showCompleted
            ? "Nothing has been surfaced for a manual decision."
            : "Nothing needs a manual decision right now."
        }
      />
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {items.map((item) => (
        <ManualReviewRow
          key={item.code}
          item={item}
          autoOpen={deepLinkCode === item.code}
        />
      ))}
    </div>
  );
}

function ManualReviewRow({
  item,
  autoOpen,
}: {
  item: ManualReviewListItem;
  autoOpen: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (autoOpen && ref.current) {
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      ref.current.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "center",
      });
      // Land keyboard focus on the row's summary so the user isn't dropped at
      // the top of the page after a deep-link scroll.
      ref.current.querySelector<HTMLElement>("summary")?.focus();
    }
  }, [autoOpen]);

  const resolved = !!item.resolved_at;

  return (
    <details
      ref={ref}
      id={`review-${item.code}`}
      open={autoOpen}
      className={`group/row ${
        resolved ? "bg-muted/10" : "border-l-2 border-l-amber-400"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/row:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span
          className={`shrink-0 font-mono text-sm font-semibold ${
            resolved ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {item.code}
        </span>
        <Badge
          variant="outline"
          className="hidden shrink-0 text-[10px] font-normal uppercase tracking-wider sm:inline-flex"
        >
          {item.category.replace(/_/g, " ")}
        </Badge>
        {item.tag_color && item.tag_number !== null ? (
          <TagBadge color={item.tag_color} number={item.tag_number} size="sm" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {item.ro_number ? `#${item.ro_number}` : "—"}
        </span>
        <span
          className={`hidden flex-1 truncate text-sm sm:block ${
            resolved ? "text-muted-foreground" : "text-foreground"
          }`}
          title={item.issue_summary}
        >
          {item.issue_summary}
        </span>
        {resolved ? (
          <StatusBadge status="ok" micro className="ml-auto shrink-0 sm:ml-0">
            Resolved
          </StatusBadge>
        ) : (
          <StatusBadge status="warning" micro className="ml-auto shrink-0 sm:ml-0">
            Open
          </StatusBadge>
        )}
        <span className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:block">
          {formatEastern(item.issued_at)}
        </span>
      </summary>

      <div className="space-y-4 border-t border-border bg-muted/20 px-4 py-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {item.category.replace(/_/g, " ")} · issued {formatEastern(item.issued_at)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {item.issue_summary}
          </p>
        </div>

        <ContextList context={item.context} />

        {resolved ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Resolved{" "}
            <span className="font-medium text-foreground">
              {formatEastern(item.resolved_at)}
            </span>{" "}
            with choice{" "}
            <span className="font-mono text-foreground">{item.resolved_choice}</span>
            {item.resolved_by_user_label ? (
              <>
                {" "}
                by <span className="text-foreground">{item.resolved_by_user_label}</span>
              </>
            ) : null}
            .
          </div>
        ) : (
          <div className="border-t border-border pt-4">
            <ResolveManualReviewForm
              code={item.code}
              options={item.options}
              onResolved={() => router.refresh()}
            />
          </div>
        )}
      </div>
    </details>
  );
}

/** Presentational render of the per-category context JSONB as a small dl. */
function ContextList({ context }: { context: ManualReviewContext }) {
  const entries = Object.entries(context).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="text-foreground">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
      <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
