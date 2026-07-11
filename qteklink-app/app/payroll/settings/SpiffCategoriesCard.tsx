"use client";

/**
 * SpiffCategoriesCard — which Tekmetric job categories count toward the
 * service-writer spiff, and the per-job multiplier (1–9). Grouped New-first
 * (is_new badge) / Counted / Not-counted (collapsed <details>), with a
 * client-side search filter. Saving submits the FULL category array to the
 * settings action (its existing contract); rows the admin touched submit with
 * is_new: false so the "new" badge clears once reviewed. Category discovery
 * itself happens in the nightly ingest / run refresh — never here.
 */
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Save, Search, Sparkles, Tags } from "lucide-react";
import { updatePayrollSettingsAction } from "@/actions/payroll";
import type { SpiffCategory } from "@/lib/payroll/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";

const MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const selectCls =
  "rounded-md border border-input bg-card px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

type RowVal = { counted: boolean; multiplier: number };

export default function SpiffCategoriesCard({ categories }: { categories: SpiffCategory[] }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(updatePayrollSettingsAction, null);
  const [, start] = useTransition();
  const [edits, setEdits] = useState<Record<string, RowVal>>({});
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (state?.ok) {
      // Server props take over after the refresh (is_new flags now persisted).
      setEdits({});
      setTouched(new Set());
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router]);

  const val = (c: SpiffCategory): RowVal => edits[c.name] ?? { counted: c.counted, multiplier: c.multiplier };

  function setRow(name: string, next: RowVal) {
    setEdits((prev) => ({ ...prev, [name]: next }));
    setTouched((prev) => {
      const s = new Set(prev);
      s.add(name);
      return s;
    });
  }

  // Groups come from the SERVER values so rows don't jump between groups mid-edit.
  const groups = useMemo(() => {
    const byName = (a: SpiffCategory, b: SpiffCategory) => a.name.localeCompare(b.name);
    return {
      fresh: categories.filter((c) => c.is_new).sort(byName),
      counted: categories.filter((c) => !c.is_new && c.counted).sort(byName),
      rest: categories.filter((c) => !c.is_new && !c.counted).sort(byName),
    };
  }, [categories]);

  const q = search.trim().toLowerCase();
  const matches = (c: SpiffCategory) => q.length === 0 || c.name.toLowerCase().includes(q);
  const visibleFresh = groups.fresh.filter(matches);
  const visibleCounted = groups.counted.filter(matches);
  const visibleRest = groups.rest.filter(matches);
  const nothingMatches =
    q.length > 0 && visibleFresh.length === 0 && visibleCounted.length === 0 && visibleRest.length === 0;

  const countedNow = categories.reduce((n, c) => n + (val(c).counted ? 1 : 0), 0);

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = categories.map((c) => {
      const v = val(c);
      return {
        name: c.name,
        counted: v.counted,
        multiplier: v.multiplier,
        first_seen: c.first_seen,
        // Touching a row either way marks it reviewed — the badge clears on save.
        is_new: touched.has(c.name) ? false : c.is_new,
      };
    });
    const fd = new FormData();
    fd.set("spiff_categories", JSON.stringify(next));
    start(() => dispatch(fd));
  }

  function renderRow(c: SpiffCategory) {
    const v = val(c);
    const display = c.name.trim();
    return (
      <div
        key={c.name}
        className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground" title={c.name}>
            {display}
          </span>
          {c.is_new && !touched.has(c.name) && (
            <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/10 text-primary">
              <Sparkles aria-hidden="true" />
              new
            </Badge>
          )}
        </span>
        <input
          type="checkbox"
          checked={v.counted}
          disabled={pending}
          onChange={(e) => setRow(c.name, { ...v, counted: e.target.checked })}
          aria-label={`Count ${display} in spiffs`}
          className="size-4 shrink-0 accent-primary"
        />
        <select
          value={v.multiplier}
          disabled={pending || !v.counted}
          onChange={(e) => setRow(c.name, { ...v, multiplier: Number(e.target.value) })}
          aria-label={`Spiffs per ${display} job`}
          className={`${selectCls} w-14 shrink-0`}
        >
          {MULTIPLIERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const gridCls = "grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <Card className="mt-6 shadow-xs">
      <CardHeader>
        <CardTitle>Spiff categories</CardTitle>
        <CardDescription>
          Pick which Tekmetric job categories count toward the service-writer spiff, and how many
          spiffs each job in that category is worth.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{countedNow} counted</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories yet"
            subtext="They appear here after the first Tekmetric sync."
          />
        ) : (
          <form onSubmit={onSave}>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter categories…"
                aria-label="Filter categories"
                className="pl-8"
              />
            </div>

            {nothingMatches ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No categories match &ldquo;{search.trim()}&rdquo;.
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {visibleFresh.length > 0 && (
                  <section className="border-l-2 border-primary pl-3">
                    <h3 className="text-xs font-semibold tracking-wide text-primary uppercase">
                      New categories — review these ({visibleFresh.length})
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Discovered by the nightly sync. New categories start not counted, multiplier 1,
                      until you decide.
                    </p>
                    <div className="mt-1">{visibleFresh.map(renderRow)}</div>
                  </section>
                )}

                {visibleCounted.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Counted ({visibleCounted.length})
                    </h3>
                    <div className={`mt-1 ${gridCls}`}>{visibleCounted.map(renderRow)}</div>
                  </section>
                )}

                {groups.rest.length > 0 &&
                  (q.length > 0 ? (
                    visibleRest.length > 0 && (
                      <section>
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Not counted ({visibleRest.length} match)
                        </h3>
                        <div className={`mt-1 ${gridCls}`}>{visibleRest.map(renderRow)}</div>
                      </section>
                    )
                  ) : (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground select-none">
                        <ChevronRight
                          className="size-4 shrink-0 transition-transform group-open:rotate-90"
                          aria-hidden="true"
                        />
                        Show {groups.rest.length} not-counted categor{groups.rest.length === 1 ? "y" : "ies"}
                      </summary>
                      <div className={`mt-2 ${gridCls}`}>{groups.rest.map(renderRow)}</div>
                    </details>
                  ))}
              </div>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              Set the multiplier higher than 1 when one job line covers several services — e.g. a
              &ldquo;FLUID FLUSH 2&rdquo; job counting as 2 spiffs.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="submit" loading={pending} loadingText="Saving…">
                <Save aria-hidden="true" />
                Save spiff categories
              </Button>
              {state?.ok && (
                <span className="text-sm text-emerald-800 dark:text-emerald-300">Saved.</span>
              )}
              {state?.ok === false && (
                <span className="text-sm text-red-700 dark:text-red-400">{state.message}</span>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
