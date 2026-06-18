"use client";

/**
 * ManualReviewSearch — URL-param-driven search + completed toggle.
 *
 * Mirrors AuditHistoryFilters' "push to /keytags?... and let the Server
 * Component re-fetch" pattern, but debounced on typing. Writes `q` and
 * `show_completed`; drops any `review` deep-link param (that was a one-time
 * landing from an email).
 *
 * Visual parity with AuditHistoryFilters: a search field with an inset icon
 * and a quiet inline pending spinner, a labelled completed-toggle checkbox,
 * and a Reset button. The sr-only field label + the toggle's accessible name
 * are preserved.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LIST_REGION_ID = "manual-review-list";

export function ManualReviewSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const showCompleted = searchParams.get("show_completed") === "1";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(nextQ: string, nextCompleted: boolean) {
    const params = new URLSearchParams();
    params.set("tab", "manual-reviews");
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextCompleted) params.set("show_completed", "1");
    startTransition(() => {
      router.push(`/keytags?${params.toString()}`);
    });
  }

  function onSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push(v, showCompleted), 300);
  }

  function onToggle(e: React.ChangeEvent<HTMLInputElement>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    push(q, e.target.checked);
  }

  function reset() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQ("");
    startTransition(() => {
      router.push("/keytags?tab=manual-reviews");
    });
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative min-w-[220px] flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Label htmlFor="review-search" className="sr-only">
          Search reviews by code, key tag, or RO number
        </Label>
        <Input
          id="review-search"
          type="search"
          value={q}
          onChange={onSearchChange}
          autoComplete="off"
          placeholder="Code, key tag (R4 / Y12), or RO#…"
          aria-controls={LIST_REGION_ID}
          className="pl-8 pr-9"
        />
        {isPending && (
          <Loader2
            className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="show-completed"
          type="checkbox"
          checked={showCompleted}
          onChange={onToggle}
          aria-controls={LIST_REGION_ID}
          className="size-4 rounded border-input accent-primary"
        />
        <Label htmlFor="show-completed" className="text-sm text-muted-foreground">
          Show completed
        </Label>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={reset}
        disabled={isPending}
        className="gap-1.5"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Reset
      </Button>
    </div>
  );
}
