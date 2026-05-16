"use server";

/**
 * runDiagnosticsV2 — Phase 9a (2026-05-14) Server Action.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
 * The customer has explicitly picked one or more services at Step 7.1 and
 * described their concern per-service at Step 7.2 (concern_explanation
 * cards). This action runs the diagnostic LLM gap-detection ONCE — in
 * parallel — across every description, aggregates the unanswered question
 * IDs into a pending queue, and advances the wizard to either:
 *
 *   - 'clarification_question' — when there are 1+ unanswered questions
 *   - 'second_routine_pass'    — when every description already covered
 *                                its category's questionnaire
 *
 * Triggering: Phase 9b's diagnostic_loading card calls this action on
 * mount (useEffect + startTransition). The card itself is just a "thinking…"
 * UI; this Server Action does the actual work.
 *
 * The row's `explanation_required_items` is the input shape:
 *   [{ service_key: string, explanation_text: string, category?: string }, ...]
 * Phase 8's transient free-text-concern shape (service_key='concern') is
 * handled defensively: it falls through to category='other'.
 *
 * Failure modes (all surface to Sentry; user-facing result is still ok=true
 * with a pending queue computed from fail-safe defaults):
 *   - testing_services / routine_services lookup error  → category='other'
 *   - concern_category_guidelines miss for the resolved → category='other'
 *   - diagnoseConcern LLM error                         → all questions stay pending
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { diagnoseConcern } from "@/lib/scheduler/wizard/llm/diagnose-concern";
import { loadConcernContext } from "@/lib/scheduler/wizard/llm/load-concern-context";
import { resolveServiceCategory } from "@/lib/scheduler/wizard/llm/resolve-service-category";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { logError } from "@/lib/scheduler/wizard/log-error";

const FALLBACK_CATEGORY = "other";

const inputSchema = z.object({
  chatId: z.string().min(1),
});

export type RunDiagnosticsV2Args = z.infer<typeof inputSchema>;

interface ExplanationItem {
  service_key: string;
  explanation_text: string;
  category: string | null;
}

interface PendingQuestionEntry {
  question_id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  service_key: string;
  category: string;
}

function parseExplanationItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const service_key =
        typeof obj.service_key === "string" ? obj.service_key : null;
      const explanation_text =
        typeof obj.explanation_text === "string" ? obj.explanation_text : "";
      if (!service_key) return null;
      const category =
        typeof obj.category === "string" && obj.category.length > 0
          ? obj.category
          : null;
      return { service_key, explanation_text, category } satisfies ExplanationItem;
    })
    .filter((x): x is ExplanationItem => x !== null);
}

function parseVehicleNotes(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.notes === "string" && obj.notes.trim().length > 0) {
    return obj.notes;
  }
  return null;
}

async function runDiagnosticsV2Impl(
  args: RunDiagnosticsV2Args,
): Promise<WizardTransitionResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId } = parsed.data;

  // Pattern-extension fix 2026-05-16: this action previously had no
  // top-level try/catch. Uncaught throws from supabase reads,
  // Promise.all over diagnoseConcern, or applyWizardTransition would
  // escape as raw Server Action rejections. Wrapping the body to
  // match the rest of the V2 action suite — {ok:false} envelope on
  // any failure + logError for triage.
  try {
    return await runDiagnosticsBody(chatId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "run_diagnostics_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "run_diagnostics_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}

async function runDiagnosticsBody(
  chatId: string,
): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();

  // ── 1. Load the row ──────────────────────────────────────────────────────
  //
  // Bug audit 2026-05-16: clarification_questions_pending was missing from
  // this SELECT, so the idempotency-resume branch below ALWAYS read it as
  // undefined → []. The customer's clarification queue got silently dropped
  // on every page refresh in the diagnostic_loading step, and they were
  // advanced to second_routine_pass with no questions answered. Added the
  // column to the projection.
  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select(
      "id, explanation_required_items, new_vehicle_info, diagnostic_processing_complete, clarification_questions_pending",
    )
    .eq("id", chatId)
    .maybeSingle();

  if (rowErr || !row) {
    const msg = rowErr?.message ?? "session_not_found";
    Sentry.captureMessage("run_diagnostics_v2 row load failed", {
      level: "error",
      extra: { chatId, error: msg },
    });
    return { ok: false, error: msg };
  }

  // Idempotency: if diagnostic_processing_complete is already true, this is
  // a re-mount of the loading card after a navigation/refresh. Don't re-run
  // the LLM — just advance based on the existing pending queue.
  if (row.diagnostic_processing_complete) {
    const pendingExisting = Array.isArray(
      (row as Record<string, unknown>).clarification_questions_pending,
    )
      ? ((row as Record<string, unknown>).clarification_questions_pending as PendingQuestionEntry[])
      : [];
    return applyWizardTransition({
      chatId,
      nextStep: pendingExisting.length > 0
        ? "clarification_question"
        : "second_routine_pass",
    });
  }

  const items = parseExplanationItems(row.explanation_required_items);
  const vehicleNotes = parseVehicleNotes(row.new_vehicle_info);

  // Empty queue → skip diagnostic loop entirely. Mark complete + advance to
  // second_routine_pass so the customer keeps flowing.
  if (items.length === 0) {
    return applyWizardTransition({
      chatId,
      updates: {
        diagnostic_processing_complete: true,
        clarification_questions_pending: [],
      },
      nextStep: "second_routine_pass",
    });
  }

  // ── 2. Resolve category per item (parallel) ──────────────────────────────
  const categoryResolved: string[] = await Promise.all(
    items.map(async (item): Promise<string> => {
      if (item.category) return item.category;
      try {
        const cat = await resolveServiceCategory(supabase, item.service_key);
        return cat ?? FALLBACK_CATEGORY;
      } catch (e) {
        Sentry.captureException(e, {
          tags: {
            surface: "run_diagnostics_v2_resolve_category",
            service_key: item.service_key,
          },
          level: "warning",
        });
        return FALLBACK_CATEGORY;
      }
    }),
  );

  // ── 3. Load per-category context (one trip per UNIQUE category) ──────────
  const uniqueCategories: string[] = Array.from(new Set(categoryResolved));
  const contextEntries = await Promise.all(
    uniqueCategories.map(async (cat) => {
      try {
        const ctx = await loadConcernContext(supabase, cat);
        return [cat, ctx] as const;
      } catch (e) {
        Sentry.captureException(e, {
          tags: {
            surface: "run_diagnostics_v2_load_context",
            category: cat,
          },
          level: "warning",
        });
        return [cat, null] as const;
      }
    }),
  );
  const contextByCategory = new Map(contextEntries);

  // ── 4. Per-item diagnoseConcern in parallel ──────────────────────────────
  const diagnoseResults = await Promise.all(
    items.map(async (item, idx) => {
      const category = categoryResolved[idx] ?? FALLBACK_CATEGORY;
      const ctx = contextByCategory.get(category);
      if (!ctx) {
        // No guideline row for this category — return empty pending list
        // (we can't ask questions we don't have). Sentry already captured
        // the load failure (above) OR the row just doesn't exist yet (which
        // means the migration's seed didn't include this category).
        return {
          item,
          category,
          unanswered_question_ids: [] as number[],
          parsed_ok: false,
          context: null,
        } as const;
      }
      const result = await diagnoseConcern({
        category,
        guideline_prose: ctx.guideline_prose,
        category_display_label: ctx.display_label,
        questions: ctx.questions,
        customer_description: item.explanation_text,
        vehicle_notes: vehicleNotes,
      });
      return {
        item,
        category,
        unanswered_question_ids: result.unanswered_question_ids,
        parsed_ok: result.parsed_ok,
        context: ctx,
      } as const;
    }),
  );

  // ── 5. Aggregate into the pending queue ──────────────────────────────────
  const pending: PendingQuestionEntry[] = [];
  for (const r of diagnoseResults) {
    if (!r.context) continue;
    for (const qid of r.unanswered_question_ids) {
      const q = r.context.questions.find((x) => x.id === qid);
      if (!q) continue;
      pending.push({
        question_id: q.id,
        question_text: q.question_text,
        options: q.options,
        service_key: r.item.service_key,
        category: r.category,
      });
    }
  }

  // ── 6. Persist + advance ─────────────────────────────────────────────────
  const nextStep = pending.length > 0
    ? ("clarification_question" as const)
    : ("second_routine_pass" as const);

  const jeffBubble = pending.length > 0
    ? "Got it — a few quick questions to make sure we test the right things. 🔎"
    : "All set — let me check the schedule! 📅";

  return applyWizardTransition({
    chatId,
    updates: {
      diagnostic_processing_complete: true,
      clarification_questions_pending: pending,
      clarification_questions_answered: {},
    },
    nextStep,
    jeffBubble,
  });
}

export const runDiagnosticsV2 = wrapAction(
  "runDiagnosticsV2",
  runDiagnosticsV2Impl,
);
