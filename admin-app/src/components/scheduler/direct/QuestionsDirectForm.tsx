"use client";

/**
 * QuestionsDirectForm — the expandable add/edit form for a concern question
 * (sibling of QuestionsDirectTab, split out per the ~500-line file policy).
 *
 * Imperative-submit idiom (copied from AssignKeytagForm): local `loading`
 * flag + `await action(args)` + sonner toast + `router.refresh()`. This
 * avoids the force-dynamic `useActionState` re-suspend spin bug — the await
 * resolves on the action's RETURN, decoupled from the RSC re-render.
 *
 * Every edit carries `expected_updated_at` (the render-time staleness token);
 * on `status: "stale"` we toast the message and refresh so the user re-reads
 * the latest row before re-applying.
 */
import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { upsertConcernQuestionAction } from "@/actions/scheduler/direct-catalog-actions";
import type { QuestionRow } from "@/lib/scheduler/read-dal";
import { ChipEditor, OptionsEditor, type Option } from "./QuestionsDirectFields";

const TEXTAREA_CLASS =
  "flex min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

export interface QuestionsDirectFormProps {
  /** The subcategory this question belongs to. */
  subcategoryId: number;
  /** Existing row when editing; omitted when adding a new question. */
  question?: QuestionRow;
  /** Suggested display_order for a new question (max existing + 1). */
  suggestedOrder?: number;
  onDone: () => void;
}

export function QuestionsDirectForm({
  subcategoryId,
  question,
  suggestedOrder,
  onDone,
}: QuestionsDirectFormProps) {
  const router = useRouter();
  const isEdit = question != null;

  const [text, setText] = useState(question?.question_text ?? "");
  const [options, setOptions] = useState<Option[]>(
    question?.options?.length
      ? question.options.map((o) => ({ label: o.label, value: o.value }))
      : [
          { label: "", value: "" },
          { label: "", value: "" },
        ],
  );
  const [multiSelect, setMultiSelect] = useState(question?.multi_select ?? false);
  const [active, setActive] = useState(question?.active ?? true);
  const [displayOrder, setDisplayOrder] = useState<string>(
    String(question?.display_order ?? suggestedOrder ?? 0),
  );
  const [requiredFacts, setRequiredFacts] = useState<string[]>(
    question?.required_facts ?? [],
  );
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    const trimmedText = text.trim();
    if (trimmedText.length < 5) {
      toast.error("Question text must be at least 5 characters.");
      return;
    }
    const cleanOptions = options
      .map((o) => ({ label: o.label.trim(), value: o.value.trim() }))
      .filter((o) => o.label.length > 0 && o.value.length > 0);
    if (cleanOptions.length < 2) {
      toast.error("Add at least 2 complete options (label + value).");
      return;
    }

    setLoading(true);
    try {
      const result = await upsertConcernQuestionAction({
        id: question?.id,
        subcategory_id: subcategoryId,
        question_text: trimmedText,
        options: cleanOptions,
        display_order: Number(displayOrder) || 0,
        active,
        multi_select: multiSelect,
        required_facts: requiredFacts,
        expected_updated_at: question?.updated_at,
      });

      if (result.status === "success") {
        toast.success(isEdit ? "Question saved." : "Question added.");
        router.refresh();
        onDone();
      } else if (result.status === "stale") {
        toast.error("Out of date", { description: result.error });
        router.refresh();
      } else if (
        result.status === "validation_error" ||
        result.status === "error"
      ) {
        toast.error("Couldn't save question", { description: result.error });
      }
    } catch (e) {
      toast.error("Couldn't save question", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [
    text,
    options,
    question?.id,
    question?.updated_at,
    subcategoryId,
    displayOrder,
    active,
    multiSelect,
    requiredFacts,
    isEdit,
    router,
    onDone,
  ]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run();
  }

  const fieldId = isEdit ? `q-${question.id}` : `q-new-${subcategoryId}`;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
    >
      <div className="space-y-1.5">
        <Label
          htmlFor={`${fieldId}-text`}
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Question text
        </Label>
        <textarea
          id={`${fieldId}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={loading}
          required
          placeholder="e.g. Where do you hear the noise coming from?"
          className={TEXTAREA_CLASS}
        />
      </div>

      <OptionsEditor
        idPrefix={fieldId}
        options={options}
        onChange={setOptions}
        disabled={loading}
      />

      <div className="grid gap-4 sm:grid-cols-[auto_auto_1fr] sm:items-end">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={multiSelect}
            onChange={(e) => setMultiSelect(e.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-border"
          />
          <span>Allow multiple answers</span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-border"
          />
          <span>Active</span>
        </label>

        <div className="space-y-1.5 sm:justify-self-end">
          <Label
            htmlFor={`${fieldId}-order`}
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Display order
          </Label>
          <Input
            id={`${fieldId}-order`}
            type="number"
            min="0"
            max="9999"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            disabled={loading}
            className="w-24"
          />
        </div>
      </div>

      <ChipEditor
        idPrefix={fieldId}
        label="Required facts"
        placeholder="e.g. noise_location"
        values={requiredFacts}
        onChange={setRequiredFacts}
        disabled={loading}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" loading={loading} loadingText="Saving…" className="gap-1.5">
          {isEdit ? (
            <Save className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {isEdit ? "Save question" : "Add question"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onDone}
          disabled={loading}
          className="gap-1.5"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
