"use client";

/**
 * LookupManualReviewForm — paste/type the 6-char code, see review details.
 * Phase C.4: read-only display. Phase C.6 adds the resolve-by-choice flow.
 */
import { useActionState } from "react";
import { Search, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  lookupManualReviewAction,
  type LookupManualReviewState,
} from "@/actions/keytag/lookup-manual-review";
import { formatEastern } from "@/lib/format-time";
import { ResolveManualReviewForm } from "./ResolveManualReviewForm";

const initialState: LookupManualReviewState = { kind: "idle" };

export function LookupManualReviewForm() {
  const [state, formAction, isPending] = useActionState(
    lookupManualReviewAction,
    initialState,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="review-code" className="text-xs uppercase tracking-wider text-muted-foreground">
            Manual review code
          </Label>
          <Input
            id="review-code"
            name="code"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. ORP-4XKZ9P"
            className="font-mono uppercase"
          />
        </div>
        <Button
          type="submit"
          loading={isPending}
          loadingText="Looking up…"
          className="gap-1.5"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Look up
        </Button>
      </form>

      {state.kind === "validation_error" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}
      {state.kind === "error" && (
        <p className="text-sm text-destructive">
          Couldn&apos;t look up the review. {state.message}
        </p>
      )}
      {state.kind === "result" && <ReviewResultDisplay state={state} />}
    </div>
  );
}

function ReviewResultDisplay({
  state,
}: {
  state: Extract<LookupManualReviewState, { kind: "result" }>;
}) {
  const r = state.data;

  if (!r.ok) {
    const reasonLabel: Record<typeof r.failure_reason, string> = {
      user_label_required: "An actor identity is required.",
      lockout_active: "Too many failed lookups — locked out for an hour.",
      code_not_found: "No review found for that code.",
    };
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">{reasonLabel[r.failure_reason]}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{r.code}</p>
      </div>
    );
  }

  const isResolved = !!r.resolved_at;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="font-mono text-sm font-semibold">{r.code}</p>
          <p className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
            {r.category.replace(/_/g, " ")}
          </p>
        </div>
        {isResolved ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Resolved
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Open
          </Badge>
        )}
      </header>

      <section>
        <p className="text-sm leading-relaxed text-foreground">{r.issue_summary}</p>
      </section>

      {Object.keys(r.context).length > 0 && (
        <section className="rounded-md bg-muted/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Info className="h-3 w-3" aria-hidden="true" />
            Context
          </p>
          <dl className="grid gap-1.5 text-xs sm:grid-cols-2">
            {Object.entries(r.context).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="font-medium text-muted-foreground">{k}:</dt>
                <dd className="font-mono text-foreground">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Options ({r.options.length})
        </p>
        <ul className="space-y-2">
          {r.options.map((opt) => (
            <li
              key={opt.key}
              className="rounded-md border border-border bg-background p-3 text-sm"
            >
              <p className="font-medium text-foreground">{opt.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
              {opt.needs_tag_input && (
                <Badge variant="outline" className="mt-2 text-[10px] font-normal">
                  Requires tag input
                </Badge>
              )}
            </li>
          ))}
        </ul>
        {!isResolved && (
          <div className="mt-4 border-t border-border pt-4">
            <ResolveManualReviewForm code={r.code} options={r.options} />
          </div>
        )}
        {isResolved && (
          <p className="mt-3 rounded border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Resolved <span className="font-medium">{formatEastern(r.resolved_at)}</span> with choice{" "}
            <span className="font-mono">{r.resolved_choice}</span>.
          </p>
        )}
      </section>
    </article>
  );
}
