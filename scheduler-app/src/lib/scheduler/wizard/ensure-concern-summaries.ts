/**
 * ensureConcernSummaries — 2026-05-18 helper.
 *
 * After the clarification queue drains (either because the customer
 * answered every question, OR because the LLM didn't request any in the
 * first place), this helper synthesizes ONE "Customer states ..."
 * paragraph per concern by combining the customer's free-text
 * `explanation_text` with the Q&A answers that belong to that concern.
 *
 * Called from two places:
 *   - `runDiagnosticsV2` at the end of LLM categorization — covers the
 *     "no clarification questions asked" path so summaries are always
 *     present by the time the wizard reaches the Tekmetric description
 *     builder.
 *   - `submitClarificationAnswerV2` at queue-drain — covers the normal
 *     "customer answered the questions" path.
 *
 * The helper is idempotent — re-running it on a row whose
 * `explanation_required_items[i].summary` is already populated returns
 * silently. (Background reruns after a back-button → re-answer regen
 * the summary; we let the most-recent answer win.)
 *
 * Per-concern question-id grouping uses the `unanswered_question_ids`
 * field that runDiagnostics writes onto each explanation_required_items
 * entry — that's the canonical source-of-truth for "which questions did
 * THIS concern queue up." Skipped/missing answers are dropped from the
 * LLM input so the model doesn't synthesize from non-information.
 */
import { revalidateTag } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sessionTag } from "@/lib/scheduler/cache";
import { summarizeConcern } from "@/lib/scheduler/wizard/llm/summarize-concern";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

interface ExplanationItem {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
  /** Optional per-concern grouping (added 2026-05-18). The LLM-returned
   *  list of question IDs that this concern queued for the customer.
   *  When absent, summary falls back to just the explanation_text. */
  unanswered_question_ids?: number[];
  /** Synthesized "Customer states ..." paragraph (added 2026-05-18).
   *  Filled by `ensureConcernSummaries`. Once present, re-runs short-
   *  circuit unless `force=true`. */
  summary?: string;
}

function parseExplanationItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const service_key =
      typeof obj.service_key === "string" ? obj.service_key : null;
    if (!service_key) continue;
    const display_name =
      typeof obj.display_name === "string" ? obj.display_name : service_key;
    const explanation_text =
      typeof obj.explanation_text === "string" ? obj.explanation_text : "";
    const category =
      typeof obj.category === "string" && obj.category.length > 0
        ? obj.category
        : null;
    const item: ExplanationItem = {
      service_key,
      display_name,
      explanation_text,
      category,
    };
    if (Array.isArray(obj.unanswered_question_ids)) {
      item.unanswered_question_ids = obj.unanswered_question_ids.filter(
        (x): x is number => typeof x === "number",
      );
    }
    if (typeof obj.summary === "string" && obj.summary.length > 0) {
      item.summary = obj.summary;
    }
    out.push(item);
  }
  return out;
}

function parseAnswered(
  raw: unknown,
): Record<string, string | string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    } else if (
      Array.isArray(v) &&
      v.every((x): x is string => typeof x === "string")
    ) {
      out[k] = v;
    }
  }
  return out;
}

interface QuestionLookup {
  question_text: string;
  options: Array<{ label: string; value: string }>;
}

async function loadQuestionTexts(
  supabase: SupabaseClient,
  ids: number[],
): Promise<Map<number, QuestionLookup>> {
  const out = new Map<number, QuestionLookup>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("concern_questions")
    .select("id, question_text, options")
    .eq("shop_id", SHOP_ID)
    .in("id", unique);
  if (error) {
    Sentry.captureMessage(
      "ensure_concern_summaries question lookup failed",
      { level: "warning", extra: { error: error.message } },
    );
    return out;
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const optsRaw = row.options;
    const options: Array<{ label: string; value: string }> = Array.isArray(
      optsRaw,
    )
      ? (optsRaw
          .map((opt) => {
            if (!opt || typeof opt !== "object") return null;
            const o = opt as Record<string, unknown>;
            const label = typeof o.label === "string" ? o.label : null;
            const value = typeof o.value === "string" ? o.value : null;
            if (!label || !value) return null;
            return { label, value };
          })
          .filter((x): x is { label: string; value: string } => x !== null))
      : [];
    out.set(row.id as number, {
      question_text: (row.question_text as string) ?? "",
      options,
    });
  }
  return out;
}

/** Render an answered value (single string OR string[]) into a single
 *  human-readable label using the question's options map. Drops the
 *  "skipped" marker entirely — caller filters those out before passing in. */
function renderAnswer(
  value: string | string[],
  options: Array<{ label: string; value: string }>,
): string {
  const labelFor = (v: string): string =>
    options.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) {
    return value.map(labelFor).join(", ");
  }
  return labelFor(value);
}

export interface EnsureConcernSummariesArgs {
  chatId: string;
  /** Re-generate summaries even if `explanation_required_items[i].summary`
   *  is already populated. Default false — typical callers want
   *  idempotency. Pass true after a back-button re-answer flow. */
  force?: boolean;
}

export interface EnsureConcernSummariesResult {
  /** Number of explanation_required_items that received a NEW summary
   *  this call. 0 means everything was already summarized OR there were
   *  no concerns to summarize. */
  generated: number;
  /** Total items in the row (after filtering null/invalid entries). */
  total: number;
  /** True when the row write succeeded. False when there was no work
   *  needed (everything already summarized) OR when persistence failed
   *  (caller should still continue — summaries are advisory). */
  persisted: boolean;
}

export async function ensureConcernSummaries(
  args: EnsureConcernSummariesArgs,
): Promise<EnsureConcernSummariesResult> {
  const { chatId, force = false } = args;
  const supabase = createSupabaseAdminClient();

  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select(
      "explanation_required_items, clarification_questions_answered",
    )
    .eq("id", chatId)
    .maybeSingle();
  if (rowErr || !row) {
    Sentry.captureMessage(
      "ensure_concern_summaries row load failed",
      {
        level: "warning",
        extra: { chatId, error: rowErr?.message ?? "session_not_found" },
      },
    );
    return { generated: 0, total: 0, persisted: false };
  }

  const items = parseExplanationItems(row.explanation_required_items);
  if (items.length === 0) {
    return { generated: 0, total: 0, persisted: false };
  }

  // Decide which items need summaries.
  const itemsToProcess = force
    ? items
    : items.filter((it) => !it.summary);
  if (itemsToProcess.length === 0) {
    return { generated: 0, total: items.length, persisted: false };
  }

  const answered = parseAnswered(row.clarification_questions_answered);

  // Collect all question_ids we need texts for (across all items being
  // processed). One IN-clause query rather than N queries.
  const allQuestionIds = new Set<number>();
  for (const it of itemsToProcess) {
    for (const qid of it.unanswered_question_ids ?? []) {
      if (answered[String(qid)] !== undefined) allQuestionIds.add(qid);
    }
  }
  const questionLookup = await loadQuestionTexts(
    supabase,
    Array.from(allQuestionIds),
  );

  // Generate summaries in parallel per concern.
  const summaries = await Promise.all(
    itemsToProcess.map(async (it) => {
      const qaPairs: Array<{ question_text: string; answer: string }> = [];
      for (const qid of it.unanswered_question_ids ?? []) {
        const value = answered[String(qid)];
        if (value === undefined) continue;
        // Drop skipped/no-answer — Chris's directive ("drop 'Not sure' /
        // 'Skipped' answers"). Single-string "skipped" + value-array
        // "unsure" both skipped.
        if (value === "skipped") continue;
        const lookup = questionLookup.get(qid);
        if (!lookup) continue;
        const answerLabel = renderAnswer(value, lookup.options);
        // Also drop pure-"Not sure" / "unsure" tokens — they synthesize
        // poorly into the paragraph.
        if (/^(not sure|unsure|haven't checked|unchecked)$/i.test(answerLabel)) continue;
        qaPairs.push({
          question_text: lookup.question_text,
          answer: answerLabel,
        });
      }
      const result = await summarizeConcern({
        explanation_text: it.explanation_text,
        qa_pairs: qaPairs,
        chip_display_name: it.display_name,
      });
      return { item: it, summary: result.summary, llm_ok: result.parsed_ok };
    }),
  );

  // Build the updated items array (preserve order; in-place .summary).
  const updatedItems = items.map((it) => {
    const match = summaries.find((s) => s.item.service_key === it.service_key);
    if (!match) return it;
    return { ...it, summary: match.summary };
  });

  const { error: writeErr } = await supabase
    .from("customer_chat_sessions")
    .update({ explanation_required_items: updatedItems })
    .eq("id", chatId);
  if (writeErr) {
    Sentry.captureMessage(
      "ensure_concern_summaries write failed",
      {
        level: "warning",
        extra: { chatId, error: writeErr.message },
      },
    );
    return {
      generated: summaries.length,
      total: items.length,
      persisted: false,
    };
  }

  // Plan 04 Phase 5B (closes gap caught by Verifier B 2026-05-25):
  // ensure-concern-summaries runs AFTER run-diagnostics.ts has already
  // called applyWizardTransition (which fired revalidateTag). The tag
  // invalidation fired BEFORE this write, so the next getCurrentCard
  // render (which reads via getCachedSessionRow) would still serve the
  // pre-summary explanation_required_items for up to 60s (the TTL
  // backstop). Fire the tag again after THIS write so the customer's
  // next clarification card sees fresh summaries immediately.
  revalidateTag(sessionTag(chatId));

  return {
    generated: summaries.length,
    total: items.length,
    persisted: true,
  };
}
