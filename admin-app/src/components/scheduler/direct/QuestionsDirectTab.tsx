"use client";

/**
 * QuestionsDirectTab — concern-questions editor for /schedulerconfig.
 *
 * Flow: pick a category → pick a subcategory → see that subcategory's
 * questions ordered by display_order. Each collapsed row shows the text,
 * multi-select / active badges, an options count, and required_facts chips
 * with an inline quick-edit (updateQuestionRequiredFactsAction). "Edit"
 * expands the full form (QuestionsDirectForm); "Add question" opens the same
 * form empty.
 *
 * All mutations go through the assigned server actions via the imperative
 * await + sonner toast + router.refresh() idiom (see AssignKeytagForm) —
 * this dodges the force-dynamic useActionState re-suspend spin. Every write
 * submits the row's updated_at as expected_updated_at; on `status: "stale"`
 * we toast + refresh.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ListChecks, Pencil, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  updateQuestionRequiredFactsAction,
} from "@/actions/scheduler/direct-catalog-actions";
import type { QuestionRow, SubcategoryRow } from "@/lib/scheduler/read-dal";
import { QuestionsDirectForm } from "./QuestionsDirectForm";

const SELECT_CLASS =
  "flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

export interface QuestionsDirectTabProps {
  subcategories: SubcategoryRow[];
  questions: QuestionRow[];
}

export function QuestionsDirectTab({
  subcategories,
  questions,
}: QuestionsDirectTabProps) {
  const categories = useMemo(
    () => Array.from(new Set(subcategories.map((s) => s.category))).sort(),
    [subcategories],
  );

  const [category, setCategory] = useState<string>(categories[0] ?? "");
  const subsForCategory = useMemo(
    () =>
      subcategories
        .filter((s) => s.category === category)
        .sort((a, b) => a.display_order - b.display_order),
    [subcategories, category],
  );

  const [subcategoryId, setSubcategoryId] = useState<number | null>(
    subsForCategory[0]?.id ?? null,
  );

  // Keep subcategory valid when category changes.
  const effectiveSubId = useMemo(() => {
    if (subcategoryId != null && subsForCategory.some((s) => s.id === subcategoryId)) {
      return subcategoryId;
    }
    return subsForCategory[0]?.id ?? null;
  }, [subcategoryId, subsForCategory]);

  const visibleQuestions = useMemo(
    () =>
      questions
        .filter((q) => q.subcategory_id === effectiveSubId)
        .sort((a, b) => a.display_order - b.display_order),
    [questions, effectiveSubId],
  );

  const suggestedOrder = useMemo(
    () =>
      visibleQuestions.length === 0
        ? 0
        : Math.max(...visibleQuestions.map((q) => q.display_order)) + 1,
    [visibleQuestions],
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  function onCategoryChange(next: string) {
    setCategory(next);
    setEditingId(null);
    setAddingNew(false);
    const firstSub = subcategories
      .filter((s) => s.category === next)
      .sort((a, b) => a.display_order - b.display_order)[0];
    setSubcategoryId(firstSub?.id ?? null);
  }

  function onSubcategoryChange(next: number) {
    setSubcategoryId(next);
    setEditingId(null);
    setAddingNew(false);
  }

  const closeForms = useCallback(() => {
    setEditingId(null);
    setAddingNew(false);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          Concern questions
        </CardTitle>
        <CardDescription>
          Follow-up questions the wizard asks once a customer picks a concern
          subcategory. Pick a category and subcategory to edit its question set
          (ordered by display order).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="q-category"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Category
              </Label>
              <select
                id="q-category"
                value={category}
                onChange={(e) => onCategoryChange(e.target.value)}
                className={SELECT_CLASS}
              >
                {categories.length === 0 && <option value="">No categories</option>}
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="q-subcategory"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Subcategory
              </Label>
              <select
                id="q-subcategory"
                value={effectiveSubId ?? ""}
                onChange={(e) => onSubcategoryChange(Number(e.target.value))}
                disabled={subsForCategory.length === 0}
                className={SELECT_CLASS}
              >
                {subsForCategory.length === 0 && (
                  <option value="">No subcategories</option>
                )}
                {subsForCategory.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {effectiveSubId == null ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Select a category and subcategory to view its questions.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {visibleQuestions.length} question
                  {visibleQuestions.length === 1 ? "" : "s"}
                </p>
                {!addingNew && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditingId(null);
                      setAddingNew(true);
                    }}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add question
                  </Button>
                )}
              </div>

              {addingNew && (
                <QuestionsDirectForm
                  subcategoryId={effectiveSubId}
                  suggestedOrder={suggestedOrder}
                  onDone={closeForms}
                />
              )}

              {visibleQuestions.length === 0 && !addingNew && (
                <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No questions yet for this subcategory. Use “Add question” to
                  create the first one.
                </p>
              )}

              <ul className="space-y-3">
                {visibleQuestions.map((q) =>
                  editingId === q.id ? (
                    <li key={q.id}>
                      <QuestionsDirectForm
                        subcategoryId={effectiveSubId}
                        question={q}
                        onDone={closeForms}
                      />
                    </li>
                  ) : (
                    <li key={q.id}>
                      <QuestionRowView
                        question={q}
                        onEdit={() => {
                          setAddingNew(false);
                          setEditingId(q.id);
                        }}
                      />
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── collapsed row ──────────────────────────────────────────────────────────

interface QuestionRowViewProps {
  question: QuestionRow;
  onEdit: () => void;
}

function QuestionRowView({ question, onEdit }: QuestionRowViewProps) {
  const [factsEditing, setFactsEditing] = useState(false);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium">{question.question_text}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">#{question.display_order}</Badge>
            <Badge variant={question.active ? "secondary" : "destructive"}>
              {question.active ? "Active" : "Inactive"}
            </Badge>
            {question.multi_select && (
              <Badge variant="outline">Multi-select</Badge>
            )}
            <Badge variant="outline">
              {question.options.length} option
              {question.options.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </Button>
        </div>
      </div>

      <div className="mt-2.5 border-t border-border/60 pt-2.5">
        {factsEditing ? (
          <RequiredFactsQuickEdit
            question={question}
            onDone={() => setFactsEditing(false)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Required facts:
            </span>
            {question.required_facts.length === 0 ? (
              <span className="text-xs text-muted-foreground">none</span>
            ) : (
              question.required_facts.map((f) => (
                <span
                  key={f}
                  className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs"
                >
                  {f}
                </span>
              ))
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setFactsEditing(true)}
              className="ml-1 gap-1"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              Edit facts
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── required-facts inline quick edit ───────────────────────────────────────

interface RequiredFactsQuickEditProps {
  question: QuestionRow;
  onDone: () => void;
}

function RequiredFactsQuickEdit({ question, onDone }: RequiredFactsQuickEditProps) {
  const router = useRouter();
  const [facts, setFacts] = useState<string[]>(question.required_facts);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);

  function addDraft() {
    const raw = draft.trim();
    if (!raw) return;
    if (!facts.includes(raw)) setFacts([...facts, raw]);
    setDraft("");
  }

  const save = useCallback(async () => {
    setLoading(true);
    try {
      const result = await updateQuestionRequiredFactsAction({
        question_id: question.id,
        required_facts: facts,
        expected_updated_at: question.updated_at,
      });
      if (result.status === "success") {
        toast.success("Required facts updated.");
        router.refresh();
        onDone();
      } else if (result.status === "stale") {
        toast.error("Out of date", { description: result.error });
        router.refresh();
      } else if (
        result.status === "validation_error" ||
        result.status === "error"
      ) {
        toast.error("Couldn't update required facts", {
          description: result.error,
        });
      }
    } catch (e) {
      toast.error("Couldn't update required facts", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [facts, question.id, question.updated_at, router, onDone]);

  const factsInputId = `q-${question.id}-facts-quick`;

  return (
    <div className="space-y-2">
      <Label
        htmlFor={factsInputId}
        className="text-xs uppercase tracking-wider text-muted-foreground"
      >
        Required facts
      </Label>
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {facts.map((f) => (
            <li
              key={f}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
            >
              <span className="font-mono">{f}</span>
              <button
                type="button"
                onClick={() => setFacts(facts.filter((x) => x !== f))}
                disabled={loading}
                aria-label={`Remove ${f}`}
                className="text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={factsInputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          disabled={loading}
          placeholder="e.g. noise_location"
          className="max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addDraft}
          disabled={loading}
        >
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          loading={loading}
          loadingText="Saving…"
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={loading}
          className="gap-1.5"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Done
        </Button>
      </div>
    </div>
  );
}
