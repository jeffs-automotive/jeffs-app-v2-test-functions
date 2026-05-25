"use client";

/**
 * ResolveManualReviewForm — pick an option + (if needed) a tag, resolve.
 *
 * Renders inside the lookup form's result panel ONLY when the review is
 * unresolved. Each option is a button; clicking opens a small inline form
 * that asks for tag color/number if `needs_tag_input`, then submits.
 */
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resolveManualReviewAction,
  type ResolveManualReviewState,
} from "@/actions/keytag/resolve-manual-review";
import type {
  LookupManualReviewResult,
  ManualReviewOption,
} from "@/lib/orchestrator/types";

const initial: ResolveManualReviewState = { kind: "idle" };

export interface ResolveManualReviewFormProps {
  code: string;
  options: ManualReviewOption[];
  /** Set on success so the parent panel can hide the resolve UI. */
  onResolved?: (data: Extract<LookupManualReviewResult, { ok: true }>["code"]) => void;
}

export function ResolveManualReviewForm({
  code,
  options,
  onResolved,
}: ResolveManualReviewFormProps) {
  const [state, dispatch, isPending] = useActionState(resolveManualReviewAction, initial);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  useEffect(() => {
    if (state.kind === "success") {
      toast.success("Review resolved", {
        description: `${state.data.action_taken} (${state.data.message})`,
      });
      onResolved?.(state.data.code);
      setSelectedChoice(null);
    }
    if (state.kind === "tool_error") {
      toast.error("Resolution failed", { description: state.data.message });
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
  }, [state, onResolved]);

  const selected = options.find((o) => o.key === selectedChoice) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Resolve this review — pick one:
      </p>

      <div className="grid gap-2">
        {options.map((opt) => {
          const isSelected = opt.key === selectedChoice;
          return (
            <button
              type="button"
              key={opt.key}
              onClick={() => setSelectedChoice(opt.key)}
              disabled={isPending}
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-background hover:border-primary/50 hover:bg-muted/30"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <p className="font-medium text-foreground">{opt.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
            </button>
          );
        })}
      </div>

      {selected && (
        <form action={dispatch} className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4">
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="choice" value={selected.key} />

          <div>
            <p className="text-xs font-medium text-foreground">{selected.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{selected.description}</p>
          </div>

          {selected.needs_tag_input && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="resolve-color" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Tag color
                </Label>
                <select
                  id="resolve-color"
                  name="color"
                  required
                  className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">Pick color…</option>
                  <option value="red">Red</option>
                  <option value="yellow">Yellow</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="resolve-tag-num" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Tag #
                </Label>
                <Input
                  id="resolve-tag-num"
                  name="tag_number"
                  type="number"
                  min="1"
                  max="90"
                  required
                  placeholder="1–90"
                  className="bg-white"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="resolve-notes" className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </Label>
            <textarea
              id="resolve-notes"
              name="notes"
              maxLength={500}
              rows={2}
              placeholder="Anything the audit log should remember."
              className="flex w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedChoice(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={isPending}
              loadingText="Resolving…"
              className="gap-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Confirm resolve
            </Button>
          </div>

          {state.kind === "validation_error" && (
            <p className="text-xs text-destructive">{state.message}</p>
          )}
        </form>
      )}
    </div>
  );
}
