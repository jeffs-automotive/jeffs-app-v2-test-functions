"use client";

/**
 * ManualReviewSearch — URL-param-driven search + completed toggle.
 *
 * Mirrors AuditHistoryFilters' "push to /keytags?... and let the Server
 * Component re-fetch" pattern, but debounced on typing. Writes `q` and
 * `show_completed`; drops any `review` deep-link param (that was a one-time
 * landing from an email).
 *
 * Functional wiring only — visual polish applied later per the design spec.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative min-w-[220px] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
          placeholder="Search by code, key tag (e.g. R5), or RO#…"
          className="pl-9"
        />
      </div>

      <label className="flex select-none items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={onToggle}
          className="size-4 rounded border-input accent-primary"
        />
        Show completed
      </label>

      {isPending && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
