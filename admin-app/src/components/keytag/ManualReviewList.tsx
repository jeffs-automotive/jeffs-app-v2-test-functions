"use client";

/**
 * ManualReviewList — scannable, expandable list of manual reviews.
 *
 * Each row is a native <details> disclosure: collapsed it shows the code,
 * key tag, RO#, a one-line summary, and an open/resolved badge; expanded it
 * shows the full issue + (for open reviews) the inline resolve flow.
 *
 * Deep-link: when `deepLinkCode` matches a row (from an email's
 * ?review=CODE link), that row renders open and scrolls into view.
 *
 * Functional wiring only — visual polish is applied later per the design spec.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatEastern } from "@/lib/format-time";
import type { ManualReviewListItem } from "@/lib/orchestrator/types";
import { TagBadge } from "./TagBadge";
import { ResolveManualReviewForm } from "./ResolveManualReviewForm";

export interface ManualReviewListProps {
  items: ManualReviewListItem[];
  /** Review code to auto-expand + scroll to (from an email link). */
  deepLinkCode: string | null;
}

export function ManualReviewList({ items, deepLinkCode }: ManualReviewListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
        <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No reviews to show.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Nothing matches the current filter. Toggle “Show completed” or clear the search to see more.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.code}>
          <ManualReviewRow item={item} autoOpen={deepLinkCode === item.code} />
        </li>
      ))}
    </ul>
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
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [autoOpen]);

  const resolved = !!item.resolved_at;

  return (
    <details
      ref={ref}
      open={autoOpen}
      className="group overflow-hidden rounded-lg border border-border bg-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="font-mono text-sm font-semibold">{item.code}</span>
        {item.tag_color && item.tag_number !== null ? (
          <TagBadge color={item.tag_color} number={item.tag_number} size="sm" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {item.ro_number ? `#${item.ro_number}` : "—"}
        </span>
        <span className="hidden flex-1 truncate text-sm text-muted-foreground sm:block">
          {item.issue_summary}
        </span>
        {resolved ? (
          <Badge variant="secondary" className="ml-auto gap-1 shrink-0 sm:ml-0">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Resolved
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="ml-auto shrink-0 border-amber-500 text-amber-700 sm:ml-0"
          >
            Open
          </Badge>
        )}
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {item.category.replace(/_/g, " ")} · issued {formatEastern(item.issued_at)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {item.issue_summary}
          </p>
        </div>

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
          <ResolveManualReviewForm
            code={item.code}
            options={item.options}
            onResolved={() => router.refresh()}
          />
        )}
      </div>
    </details>
  );
}
