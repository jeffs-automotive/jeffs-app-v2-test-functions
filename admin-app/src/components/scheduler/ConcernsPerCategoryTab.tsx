"use client";

/**
 * ConcernsPerCategoryTab — composite tab for the 2 concern-per-category
 * surfaces (upload_concern_category_md + upload_concern_category_guideline_md).
 *
 * Shape per plan v0.5 §6:
 *   Category picker (14 options) + Sub-surface picker (Questions | Guidelines)
 *   → bound `<CatalogEditorTab>` instance with `extraFormFields={category_slug}`
 *     so every dispatched FormData carries the current category.
 *
 * State reset on switch (closes ROUND-2-RESIDUALS R-IMP-2):
 *   The `<CatalogEditorTab>` is keyed on `${category}-${subSurface}`. When the
 *   picker changes, React unmounts the old subtree and mounts a fresh one —
 *   all useState + useActionState reset cleanly. No stale `previewedMd` or
 *   `confirm_token` can leak across the switch.
 *
 * Recent-uploads: shown across ALL categories for the current sub-surface's
 * underlying audit surface (`concern_subcategories` for Questions,
 * `concern_category_guidelines` for Guidelines). The edge `list_scheduler_
 * admin_audit_log` tool does NOT support category_slug filter per ADR-021
 * (it's a STRICT enum-only surface filter), so per-category filtering would
 * require either an edge change or client-side post-filter on
 * `diff_summary` JSONB. Deferred — for now the list shows rows for the
 * surface regardless of category. R-IMP-2 noted this; per-category filter
 * is a small followup if Chris finds the unfiltered list confusing.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CatalogEditorTab } from "./CatalogEditorTab";
import { uploadConcernCategoryAction } from "@/actions/scheduler/upload-concern-category";
import { exportConcernCategoryAction } from "@/actions/scheduler/export-concern-category";
import { uploadConcernCategoryGuidelineAction } from "@/actions/scheduler/upload-concern-category-guideline";
import { exportConcernCategoryGuidelineAction } from "@/actions/scheduler/export-concern-category-guideline";
import type {
  AuditLogEntry,
  SchedulerAdminSurface,
  UploadConcernCategoryArgs,
} from "@/lib/scheduler/types";

type CategorySlug = UploadConcernCategoryArgs["category_slug"];
type SubSurface = "questions" | "guidelines";

/** The 14 concern category slugs per scheduler-field-validators.ts. */
const CATEGORY_OPTIONS: readonly { value: CategorySlug; label: string }[] = [
  { value: "noise", label: "Noise" },
  { value: "vibration", label: "Vibration" },
  { value: "pulling", label: "Pulling" },
  { value: "smell", label: "Smell" },
  { value: "smoke", label: "Smoke" },
  { value: "leak", label: "Leak" },
  { value: "warning_light", label: "Warning light" },
  { value: "performance", label: "Performance" },
  { value: "electrical", label: "Electrical" },
  { value: "hvac", label: "HVAC" },
  { value: "brakes", label: "Brakes" },
  { value: "steering", label: "Steering" },
  { value: "tires", label: "Tires" },
  { value: "other", label: "Other" },
] as const;

export interface ConcernsPerCategoryTabProps {
  /** Recent uploads for the Questions sub-surface (table=concern_subcategories). */
  questionsRecentUploads: AuditLogEntry[];
  /** Recent uploads for the Guidelines sub-surface (table=concern_category_guidelines). */
  guidelinesRecentUploads: AuditLogEntry[];
  /** Optional default category (e.g. for URL state hydration; defaults to "brakes" — most-edited per Chris). */
  defaultCategory?: CategorySlug;
}

export function ConcernsPerCategoryTab({
  questionsRecentUploads,
  guidelinesRecentUploads,
  defaultCategory = "brakes",
}: ConcernsPerCategoryTabProps) {
  const [category, setCategory] = useState<CategorySlug>(defaultCategory);
  const [subSurface, setSubSurface] = useState<SubSurface>("questions");

  // Bind props for the current (category, subSurface) tuple. The
  // <CatalogEditorTab> below is keyed on this tuple so all internal state
  // resets when the user switches.
  const isQuestions = subSurface === "questions";
  const surface: SchedulerAdminSurface = isQuestions
    ? "concern_subcategories"
    : "concern_category_guidelines";
  const surfaceLabel = isQuestions
    ? `Concerns — ${category} — Questions`
    : `Concerns — ${category} — Guidelines`;
  const uploadAction = isQuestions
    ? uploadConcernCategoryAction
    : uploadConcernCategoryGuidelineAction;
  const exportAction = isQuestions
    ? exportConcernCategoryAction
    : exportConcernCategoryGuidelineAction;
  const recentUploads = isQuestions
    ? questionsRecentUploads
    : guidelinesRecentUploads;
  const exportFilenameBase = isQuestions
    ? `concerns-${category}-questions`
    : `concerns-${category}-guideline`;

  const currentStateSummary: ReactNode = isQuestions ? (
    <>
      Subcategories + questions for the <span className="font-mono">{category}</span> concern category.
      Soft-deletes any subcategory/question not present in the MD; idempotent on identical content.
    </>
  ) : (
    <>
      Diagnostic guideline prose for the <span className="font-mono">{category}</span> concern category.
      Single H1 + prose; stops at the first <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">---</code> rule.
      Used as a system-prompt fragment by the diagnostic LLM before that category&apos;s questions.
    </>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Concerns — per category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="concern-cat" className="text-xs uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <div className="relative">
                <select
                  id="concern-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategorySlug)}
                  className="appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>

            <div className="space-y-1">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">
                Sub-surface
              </span>
              <div role="radiogroup" aria-label="Concerns sub-surface" className="flex gap-1 rounded-md border border-border bg-background p-1">
                <SubSurfaceRadio
                  current={subSurface}
                  value="questions"
                  label="Questions"
                  onChange={setSubSurface}
                />
                <SubSurfaceRadio
                  current={subSurface}
                  value="guidelines"
                  label="Guidelines"
                  onChange={setSubSurface}
                />
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Switching category or sub-surface clears any in-progress preview/upload
            below. Recent uploads list shows ALL categories for the selected
            sub-surface (per-category filter is a deferred enhancement).
          </p>
        </CardContent>
      </Card>

      {/*
        Keyed on (category, subSurface) so the internal useState +
        useActionState fully reset on switch — no stale previewedMd or
        confirm_token can leak across (R-IMP-2).
      */}
      <CatalogEditorTab
        key={`${category}-${subSurface}`}
        surface={surface}
        surfaceLabel={surfaceLabel}
        uploadAction={uploadAction}
        exportAction={exportAction}
        recentUploads={recentUploads}
        currentStateSummary={currentStateSummary}
        exportFilenameBase={exportFilenameBase}
        extraFormFields={{ category_slug: category }}
      />
    </div>
  );
}

function SubSurfaceRadio({
  current,
  value,
  label,
  onChange,
}: {
  current: SubSurface;
  value: SubSurface;
  label: string;
  onChange: (v: SubSurface) => void;
}) {
  const isOn = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isOn}
      onClick={() => onChange(value)}
      className={
        "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
        (isOn
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}
