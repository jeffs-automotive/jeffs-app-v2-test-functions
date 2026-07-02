"use client";

/**
 * GuidelinesDirectTab — per-category guideline prose editor (sub-feature A).
 *
 * One row per concern category (`concern_category_guidelines`). Left rail picks
 * a category; the right pane edits its `display_label` + long-form
 * `guideline_prose` (20–8000 chars, enforced client-side to mirror the
 * `guidelineSchema` in direct-catalog-actions.ts). Save routes through
 * `updateCategoryGuidelineAction`.
 *
 * IMPERATIVE-SUBMIT IDIOM (copied from keytag/AssignKeytagForm.tsx): the action
 * is awaited directly with a plain `saving` flag instead of `useActionState`.
 * On the force-dynamic /schedulerconfig page, useActionState ties `isPending`
 * to the post-action RSC re-render, which re-suspends sibling tabs and pins the
 * spinner. An imperative await resolves on the action's RETURN — the spinner
 * clears immediately — and we call router.refresh() ourselves to pull fresh
 * server-rendered rows (incl. the new updated_at staleness token).
 *
 * Staleness: each Save submits the row's render-time `updated_at` as
 * `expected_updated_at`; a `stale` result toasts + router.refresh().
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatEastern } from "@/lib/format-time";
import { updateCategoryGuidelineAction } from "@/actions/scheduler/direct-catalog-actions";
import type { DirectFormState } from "@/lib/scheduler/direct-form-state";
import type { GuidelineRow } from "@/lib/scheduler/read-dal";

const PROSE_MIN = 20;
const PROSE_MAX = 8000;
const LABEL_MAX = 80;

interface GuidelinesDirectTabProps {
  guidelines: GuidelineRow[];
}

export function GuidelinesDirectTab({ guidelines }: GuidelinesDirectTabProps) {
  const router = useRouter();

  // Which category is being edited. Default to the first row (if any).
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    guidelines[0]?.category ?? null,
  );

  const selected = useMemo(
    () => guidelines.find((g) => g.category === selectedCategory) ?? null,
    [guidelines, selectedCategory],
  );

  if (guidelines.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Category guidelines
          </CardTitle>
          <CardDescription>
            No concern-category guidelines exist yet. They are seeded per shop —
            check the migration seeds if this looks wrong.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(12rem,16rem)_1fr]">
      <CategoryRail
        guidelines={guidelines}
        selectedCategory={selectedCategory}
        onSelect={setSelectedCategory}
      />
      {selected ? (
        // key forces a fresh editor (resets local draft state) when the
        // category changes OR the row's updated_at advances after a save.
        <GuidelineEditor
          key={`${selected.category}:${selected.updated_at}`}
          row={selected}
          onSaved={() => router.refresh()}
          onStale={() => router.refresh()}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardDescription>Select a category to edit its guideline.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

// ─── left rail ──────────────────────────────────────────────────────────────

function CategoryRail({
  guidelines,
  selectedCategory,
  onSelect,
}: {
  guidelines: GuidelineRow[];
  selectedCategory: string | null;
  onSelect: (category: string) => void;
}) {
  return (
    <nav aria-label="Concern categories" className="space-y-1">
      {guidelines.map((g) => {
        const active = g.category === selectedCategory;
        return (
          <button
            key={g.category}
            type="button"
            onClick={() => onSelect(g.category)}
            aria-current={active ? "true" : undefined}
            className={[
              "flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              active
                ? "border-primary bg-primary/5 text-foreground"
                : "border-transparent hover:border-border hover:bg-muted/50 text-muted-foreground",
            ].join(" ")}
          >
            <span className="font-medium text-foreground">{g.display_label}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {g.category}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ─── editor ───────────────────────────────────────────────────────────────

function GuidelineEditor({
  row,
  onSaved,
  onStale,
}: {
  row: GuidelineRow;
  onSaved: () => void;
  onStale: () => void;
}) {
  const [displayLabel, setDisplayLabel] = useState(row.display_label ?? "");
  const [prose, setProse] = useState(row.guideline_prose ?? "");
  const [saving, setSaving] = useState(false);

  const proseLen = prose.trim().length;
  const proseTooShort = proseLen < PROSE_MIN;
  const proseTooLong = proseLen > PROSE_MAX;
  const labelTooLong = displayLabel.trim().length > LABEL_MAX;

  const dirty =
    displayLabel !== (row.display_label ?? "") || prose !== (row.guideline_prose ?? "");
  const canSave = dirty && !proseTooShort && !proseTooLong && !labelTooLong && !saving;

  const run = useCallback(async () => {
    setSaving(true);
    try {
      // Imperative await — resolves on the action's RETURN, not the route
      // re-render commit (see file header). Decouples the spinner from the
      // sibling-tab Suspense re-render.
      const result: DirectFormState = await updateCategoryGuidelineAction({
        category: row.category,
        display_label: displayLabel.trim(),
        guideline_prose: prose.trim(),
        expected_updated_at: row.updated_at,
      });

      switch (result.status) {
        case "success":
          toast.success("Guideline saved", {
            description: `Updated “${displayLabel.trim() || row.category}”.`,
          });
          onSaved();
          break;
        case "stale":
          toast.error("Someone else edited this first", {
            description: result.error,
          });
          onStale();
          break;
        case "validation_error":
          toast.error("Couldn’t save", { description: result.error });
          break;
        case "error":
          toast.error("Couldn’t save", { description: result.error });
          break;
        default:
          // idle should never come back from an invoked action
          break;
      }
    } catch (e) {
      toast.error("Couldn’t save", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [row.category, row.updated_at, displayLabel, prose, onSaved, onStale]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" aria-hidden="true" />
          {row.display_label}
        </CardTitle>
        <CardDescription>
          The AI orchestrator reads this prose verbatim when classifying and
          triaging <span className="font-mono text-xs">{row.category}</span>{" "}
          concerns. Write it as clear operating guidance, not marketing copy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void run();
          }}
        >
          <div className="space-y-1.5">
            <Label
              htmlFor={`guideline-label-${row.category}`}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Display label
            </Label>
            <Input
              id={`guideline-label-${row.category}`}
              name="display_label"
              value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)}
              maxLength={LABEL_MAX + 20}
              disabled={saving}
              placeholder="Human-friendly category name"
              aria-invalid={labelTooLong || undefined}
              aria-describedby={labelTooLong ? `guideline-label-err-${row.category}` : undefined}
            />
            {labelTooLong && (
              <p
                id={`guideline-label-err-${row.category}`}
                className="text-xs text-destructive"
              >
                Label must be {LABEL_MAX} characters or fewer.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label
                htmlFor={`guideline-prose-${row.category}`}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Guideline prose
              </Label>
              <span
                aria-live="polite"
                className={[
                  "font-mono text-[11px] tabular-nums",
                  proseTooShort || proseTooLong
                    ? "text-destructive"
                    : "text-muted-foreground",
                ].join(" ")}
              >
                {proseLen.toLocaleString()} / {PROSE_MAX.toLocaleString()}
              </span>
            </div>
            <textarea
              id={`guideline-prose-${row.category}`}
              name="guideline_prose"
              value={prose}
              onChange={(e) => setProse(e.target.value)}
              disabled={saving}
              rows={16}
              required
              aria-invalid={proseTooShort || proseTooLong || undefined}
              aria-describedby={
                proseTooShort || proseTooLong
                  ? `guideline-prose-err-${row.category}`
                  : undefined
              }
              className="flex min-h-[16rem] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              placeholder="Operating guidance the orchestrator follows for this category…"
            />
            {(proseTooShort || proseTooLong) && (
              <p
                id={`guideline-prose-err-${row.category}`}
                className="text-xs text-destructive"
              >
                {proseTooShort
                  ? `Guideline must be at least ${PROSE_MIN} characters (currently ${proseLen}).`
                  : `Guideline must be ${PROSE_MAX.toLocaleString()} characters or fewer (currently ${proseLen.toLocaleString()}).`}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Last edited{" "}
              <span className="font-mono">{formatEastern(row.updated_at)}</span>
            </p>
            <Button
              type="submit"
              disabled={!canSave}
              loading={saving}
              loadingText="Saving…"
              className="gap-1.5"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save guideline
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
