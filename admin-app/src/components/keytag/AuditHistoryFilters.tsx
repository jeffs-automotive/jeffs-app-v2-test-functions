"use client";

/**
 * AuditHistoryFilters — URL-param-driven filter form.
 *
 * Submits to /keytags?tab=audit&color=...&action=...&since=...&limit=...
 * Server Component re-fetches with new params. No client state.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function AuditHistoryFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function applyFilters(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    // Preserve tab=audit so we stay on this tab after submit
    params.set("tab", "audit");
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string" && v.trim().length > 0) {
        params.set(k, v.trim());
      }
    }
    startTransition(() => {
      router.push(`/keytags?${params.toString()}`);
    });
  }

  function reset() {
    startTransition(() => {
      router.push("/keytags?tab=audit");
    });
  }

  return (
    <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1">
        <Label htmlFor="audit-color" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Color
        </Label>
        <select
          id="audit-color"
          name="color"
          defaultValue={searchParams.get("color") ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
        >
          <option value="">Any</option>
          <option value="red">Red</option>
          <option value="yellow">Yellow</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-number" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Tag #
        </Label>
        <Input
          id="audit-number"
          name="tag_number"
          type="number"
          min="1"
          max="90"
          placeholder="1–90"
          defaultValue={searchParams.get("tag_number") ?? ""}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-ro" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          RO #
        </Label>
        <Input
          id="audit-ro"
          name="ro_number"
          type="number"
          min="1"
          placeholder="e.g. 152222"
          defaultValue={searchParams.get("ro_number") ?? ""}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-action" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Action
        </Label>
        <select
          id="audit-action"
          name="action"
          defaultValue={searchParams.get("action") ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
        >
          <option value="">Any</option>
          <option value="assigned">Assigned</option>
          <option value="force_assigned">Force assigned</option>
          <option value="marked_posted">Marked posted</option>
          <option value="reverted">Reverted</option>
          <option value="released">Released</option>
          <option value="released_orphan">Released (orphan)</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-limit" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Limit
        </Label>
        <Input
          id="audit-limit"
          name="limit"
          type="number"
          min="1"
          max="200"
          defaultValue={searchParams.get("limit") ?? "50"}
        />
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
        <Button type="submit" disabled={isPending} className="gap-1.5">
          <Filter className="h-4 w-4" aria-hidden="true" />
          {isPending ? "Filtering…" : "Apply filters"}
        </Button>
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
    </form>
  );
}
