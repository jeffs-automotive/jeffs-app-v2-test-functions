/**
 * ManualReviewsTab — Server Component.
 *
 * Lists keytag manual reviews (open by default; completed when toggled) with
 * a search bar (code / key tag / RO#) and expandable rows. Reads filters from
 * the URL (?q=, ?show_completed=, ?review=) and fetches via the
 * listManualReviews orchestrator tool.
 *
 * Deep-link: an email's ?review=CODE link always lands — if that review isn't
 * in the current (e.g. open-only) result set, we fetch it specifically and
 * surface it at the top so the link never dead-ends.
 */
import { AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getManualReviews } from "@/lib/keytag/read-dal";
import type {
  ListManualReviewsResult,
  ManualReviewListItem,
} from "@/lib/orchestrator/types";
import { ManualReviewSearch } from "./ManualReviewSearch";
import { ManualReviewList } from "./ManualReviewList";

export interface ManualReviewsTabProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export async function ManualReviewsTab({
  searchParams,
}: ManualReviewsTabProps) {
  const showCompleted =
    searchParams.show_completed === "1" || searchParams.show_completed === "true";
  const q = typeof searchParams.q === "string" ? searchParams.q : "";
  const reviewCode =
    typeof searchParams.review === "string"
      ? searchParams.review.trim().toUpperCase()
      : null;

  let result: ListManualReviewsResult | null = null;
  let error: string | null = null;
  try {
    result = await getManualReviews({
      only_open: !showCompleted,
      search: q || undefined,
      limit: 200,
    });
  } catch (e) {
    error = `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  }

  let items: ManualReviewListItem[] = result?.results ?? [];

  // Deep-link: make sure the email-linked review is present even if it's
  // resolved or filtered out by the current search/toggle.
  if (reviewCode && !items.some((r) => r.code === reviewCode)) {
    try {
      const one = await getManualReviews({
        only_open: false,
        search: reviewCode,
        limit: 5,
      });
      const match = one.results.find((r) => r.code === reviewCode);
      if (match) items = [match, ...items];
    } catch {
      // best-effort — the link still loads the list, just without the prepend
    }
  }

  const count = items.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find a review</CardTitle>
          <CardDescription>
            Search by review code, key tag, or RO#. Toggle to include completed reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualReviewSearch />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Manual reviews
            {result && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({showCompleted ? `${count} total` : `${result.open_count} open`})
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Anomalies the system surfaced for a human decision — click a row to see the issue and
            resolve it.
          </CardDescription>
        </CardHeader>
        <CardContent id="manual-review-list">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">Couldn&apos;t load manual reviews.</p>
                  <p className="mt-0.5 text-destructive/90">{error}</p>
                </div>
              </div>
            </div>
          ) : (
            <ManualReviewList
              items={items}
              deepLinkCode={reviewCode}
              hasQuery={q.trim().length > 0}
              showCompleted={showCompleted}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
