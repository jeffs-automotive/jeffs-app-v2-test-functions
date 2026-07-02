"use client";

/**
 * SubcategoriesDirectTab — direct webform for concern-subcategory enrichment
 * + the testing-service eligibility map (sub-feature A).
 *
 * UX: category dropdown (the distinct categories present in the rows) → list
 * of that category's subcategories → an editor with two independently-saved
 * sections:
 *   1. Enrichment  — display_label, description, positive/negative examples,
 *      synonyms (chip lists), active toggle → updateSubcategoryEnrichmentAction.
 *   2. Service map — checkbox list of testing services (value = service_key)
 *      → updateSubcategoryServiceMapAction.
 *
 * IMPERATIVE SUBMIT IDIOM (copied from AssignKeytagForm, 2026-06-26): each
 * Save runs the Server Action with `await` + a local `loading` flag rather than
 * useActionState. useActionState ties isPending to the transition that applies
 * the post-action RSC re-render; on a force-dynamic /schedulerconfig page that
 * re-render re-suspends sibling tabs and pins the spinner. Awaiting the action's
 * RETURN decouples the spinner from the re-render. router.refresh() then pulls
 * fresh server-fetched rows (including the new updated_at staleness token).
 *
 * Staleness: every Save submits the row's render-time updated_at as
 * expected_updated_at; a "stale" result toasts + router.refresh().
 *
 * Deactivation: the active toggle is part of the enrichment form, so flipping
 * a subcategory to inactive is confirmed by an inline two-click confirm step on
 * the Save button (no window.confirm) rather than a separate destructive action.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { SubcategoryRow, TestingServiceRow } from "@/lib/scheduler/read-dal";
import type { DirectFormState } from "@/lib/scheduler/direct-form-state";
import {
  updateSubcategoryEnrichmentAction,
  updateSubcategoryServiceMapAction,
} from "@/actions/scheduler/direct-catalog-actions";
import { SubcategoriesChipList } from "./SubcategoriesChipList";

interface Props {
  subcategories: SubcategoryRow[];
  testingServices: TestingServiceRow[];
}

/**
 * Toast a DirectFormState result. Returns true on success so the caller can
 * decide whether to router.refresh(). "stale" and errors are surfaced, never
 * swallowed (observability rule: no silent failures).
 */
function reportState(state: DirectFormState, successMsg: string): boolean {
  switch (state.status) {
    case "success":
      toast.success(successMsg);
      return true;
    case "stale":
      toast.warning("Row changed since load", { description: state.error });
      return false;
    case "validation_error":
      toast.error("Validation failed", { description: state.error });
      return false;
    case "error":
      toast.error("Save failed", { description: state.error });
      return false;
    default:
      return false;
  }
}

export function SubcategoriesDirectTab({ subcategories, testingServices }: Props) {
  const categories = useMemo(() => {
    const set = new Set(subcategories.map((s) => s.category));
    return [...set].sort();
  }, [subcategories]);

  const [category, setCategory] = useState<string>(categories[0] ?? "");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const inCategory = useMemo(
    () =>
      subcategories
        .filter((s) => s.category === category)
        .sort((a, b) => a.display_order - b.display_order),
    [subcategories, category],
  );

  const selected = useMemo(
    () => subcategories.find((s) => s.id === selectedId) ?? null,
    [subcategories, selectedId],
  );

  function handleCategoryChange(next: string) {
    setCategory(next);
    setSelectedId(null);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tags className="h-4 w-4" aria-hidden="true" />
            Concern subcategories
          </CardTitle>
          <CardDescription>
            Pick a category, then a subcategory, to edit its enrichment (labels,
            description, examples, synonyms) and the testing services it makes
            eligible. Each section saves independently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="max-w-xs space-y-1">
              <Label
                htmlFor="subcat-category"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Category
              </Label>
              <select
                id="subcat-category"
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {inCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No subcategories in this category.
              </p>
            ) : (
              <div
                className="flex flex-wrap gap-2"
                role="listbox"
                aria-label="Subcategories"
              >
                {inCategory.map((s) => {
                  const active = s.id === selectedId;
                  return (
                    <Button
                      key={s.id}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelectedId(s.id)}
                    >
                      {s.display_label}
                      {!s.active && (
                        <span className="ml-1.5 text-[10px] uppercase opacity-70">
                          inactive
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <SubcategoryEditor
          // key forces a fresh editor (resetting all local draft state) when a
          // different subcategory is picked OR when router.refresh() delivers a
          // new updated_at for the same row after a save.
          key={`${selected.id}:${selected.updated_at}`}
          row={selected}
          testingServices={testingServices}
        />
      )}
    </div>
  );
}

// ─── SubcategoryEditor ──────────────────────────────────────────────────────

function SubcategoryEditor({
  row,
  testingServices,
}: {
  row: SubcategoryRow;
  testingServices: TestingServiceRow[];
}) {
  const router = useRouter();

  // Enrichment draft state (seeded from the row; reset via the parent's key).
  const [displayLabel, setDisplayLabel] = useState(row.display_label);
  const [displayOrder, setDisplayOrder] = useState(String(row.display_order));
  const [description, setDescription] = useState(row.description);
  const [positive, setPositive] = useState<string[]>(row.positive_examples);
  const [negative, setNegative] = useState<string[]>(row.negative_examples);
  const [synonyms, setSynonyms] = useState<string[]>(row.synonyms);
  const [active, setActive] = useState(row.active);
  const [enrichLoading, setEnrichLoading] = useState(false);
  // Inline two-click confirm for the destructive "flip to inactive" edit.
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Service-map draft state.
  const [eligibleKeys, setEligibleKeys] = useState<string[]>(
    row.eligible_testing_service_keys,
  );
  const [mapLoading, setMapLoading] = useState(false);

  const deactivating = row.active && !active;

  const saveEnrichment = useCallback(async () => {
    setEnrichLoading(true);
    try {
      const result = await updateSubcategoryEnrichmentAction({
        subcategory_id: row.id,
        display_label: displayLabel.trim(),
        display_order: Number(displayOrder),
        description,
        positive_examples: positive,
        negative_examples: negative,
        synonyms,
        active,
        expected_updated_at: row.updated_at,
      });
      const ok = reportState(result, "Enrichment saved.");
      if (ok || result.status === "stale") {
        setConfirmDeactivate(false);
        router.refresh();
      }
    } catch (e) {
      toast.error("Enrichment save failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEnrichLoading(false);
    }
  }, [
    row.id,
    row.updated_at,
    displayLabel,
    displayOrder,
    description,
    positive,
    negative,
    synonyms,
    active,
    router,
  ]);

  function onEnrichSubmit() {
    // Deactivation gets a two-click confirm before it actually saves.
    if (deactivating && !confirmDeactivate) {
      setConfirmDeactivate(true);
      return;
    }
    void saveEnrichment();
  }

  const saveServiceMap = useCallback(async () => {
    setMapLoading(true);
    try {
      const result = await updateSubcategoryServiceMapAction({
        subcategory_id: row.id,
        eligible_keys: eligibleKeys,
        expected_updated_at: row.updated_at,
      });
      const ok = reportState(result, "Eligible testing services saved.");
      if (ok || result.status === "stale") router.refresh();
    } catch (e) {
      toast.error("Service map save failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMapLoading(false);
    }
  }, [row.id, row.updated_at, eligibleKeys, router]);

  function toggleKey(key: string, checked: boolean) {
    setEligibleKeys((prev) =>
      checked ? [...new Set([...prev, key])] : prev.filter((k) => k !== key),
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Enrichment section ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Enrichment — {row.display_label}
          </CardTitle>
          <CardDescription>
            Category <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{row.category}</code>{" "}
            · slug <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{row.slug}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label
                  htmlFor="subcat-label"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Display label
                </Label>
                <Input
                  id="subcat-label"
                  value={displayLabel}
                  onChange={(e) => setDisplayLabel(e.target.value)}
                  maxLength={80}
                  disabled={enrichLoading}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="subcat-order"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Display order
                </Label>
                <Input
                  id="subcat-order"
                  type="number"
                  min="0"
                  value={displayOrder}
                  onChange={(e) => setDisplayOrder(e.target.value)}
                  disabled={enrichLoading}
                  className="w-28"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="subcat-description"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Description
              </Label>
              <textarea
                id="subcat-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={4}
                disabled={enrichLoading}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <p className="text-[10px] text-muted-foreground">
                {description.length} / 2000
              </p>
            </div>

            <SubcategoriesChipList
              id="subcat-positive"
              label="Positive examples"
              values={positive}
              onChange={setPositive}
              placeholder="Add a phrase a customer might say…"
              disabled={enrichLoading}
              maxItems={30}
            />
            <SubcategoriesChipList
              id="subcat-negative"
              label="Negative examples"
              values={negative}
              onChange={setNegative}
              placeholder="Add a phrase that should NOT match…"
              disabled={enrichLoading}
              maxItems={30}
            />
            <SubcategoriesChipList
              id="subcat-synonyms"
              label="Synonyms"
              values={synonyms}
              onChange={setSynonyms}
              placeholder="Add a synonym…"
              disabled={enrichLoading}
              maxItems={50}
            />

            <div className="flex items-center gap-2">
              <input
                id="subcat-active"
                type="checkbox"
                checked={active}
                onChange={(e) => {
                  setActive(e.target.checked);
                  setConfirmDeactivate(false);
                }}
                disabled={enrichLoading}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="subcat-active" className="text-sm">
                Active — shown to customers in the wizard
              </Label>
            </div>

            {deactivating && confirmDeactivate && (
              <p className="text-sm text-destructive">
                You&apos;re about to deactivate this subcategory. Click
                <strong> Confirm deactivate &amp; save</strong> to proceed.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={
                  deactivating && confirmDeactivate ? "destructive" : "default"
                }
                loading={enrichLoading}
                loadingText="Saving…"
                onClick={onEnrichSubmit}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {deactivating && confirmDeactivate
                  ? "Confirm deactivate & save"
                  : "Save enrichment"}
              </Button>
              {deactivating && confirmDeactivate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={enrichLoading}
                  onClick={() => setConfirmDeactivate(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Service-map section ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Eligible testing services</CardTitle>
          <CardDescription>
            Which diagnostic / testing services this subcategory makes eligible.
            Saved separately from the enrichment above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {testingServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No testing services defined.
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">Eligible testing services</legend>
                {testingServices.map((svc) => {
                  const checked = eligibleKeys.includes(svc.service_key);
                  const inactive = !svc.active;
                  return (
                    <label
                      key={svc.service_key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          toggleKey(svc.service_key, e.target.checked)
                        }
                        disabled={mapLoading}
                        className="h-4 w-4 rounded border-border"
                      />
                      <span>
                        {svc.display_name}
                        {inactive && (
                          <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                            inactive
                          </span>
                        )}
                        <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {svc.service_key}
                        </code>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}

            <Separator />

            <Button
              type="button"
              loading={mapLoading}
              loadingText="Saving…"
              onClick={() => void saveServiceMap()}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save service map
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
