/**
 * loadConcernContext — Phase 9a (2026-05-14).
 *
 * Loads the per-category context the diagnostic LLM needs: prose guideline
 * (from concern_category_guidelines) + active questionnaire rows (from
 * concern_questions). One round-trip per category.
 *
 * Both tables live under `deny_all` RLS — the caller MUST use the service-
 * role admin client. The Server Actions that consume this helper already
 * do so (createSupabaseAdminClient()), so the helper signature takes the
 * client.
 *
 * The new concern_category_guidelines table is not yet in
 * scheduler-app/src/lib/database.types.ts (regenerated after the user runs
 * `supabase gen types`). Until then we use a narrow local row interface
 * and a cast to satisfy TypeScript without weakening the Supabase JS query
 * type-check entirely.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConcernQuestion } from "./diagnose-concern";

const SHOP_ID = 7476;

export interface ConcernContext {
  category: string;
  display_label: string;
  guideline_prose: string;
  questions: ConcernQuestion[];
}

interface ConcernQuestionRow {
  id: number;
  question_text: string;
  options: unknown;
  display_order: number;
}

interface ConcernGuidelineRow {
  display_label: string;
  guideline_prose: string;
}

function normalizeOptions(
  raw: unknown,
): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label : null;
      const value = typeof obj.value === "string" ? obj.value : null;
      if (!label || !value) return null;
      return { label, value };
    })
    .filter((x): x is { label: string; value: string } => x !== null);
}

export async function loadConcernContext(
  supabase: SupabaseClient,
  category: string,
): Promise<ConcernContext | null> {
  const [guidelineRes, questionsRes] = await Promise.all([
    (supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: number) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{
                data: ConcernGuidelineRow | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    })
      .from("concern_category_guidelines")
      .select("display_label, guideline_prose")
      .eq("shop_id", SHOP_ID)
      .eq("category", category)
      .maybeSingle(),
    supabase
      .from("concern_questions")
      .select("id, question_text, options, display_order")
      .eq("shop_id", SHOP_ID)
      .eq("category", category)
      .eq("active", true)
      .order("display_order", { ascending: true }),
  ]);

  if (guidelineRes.error) {
    throw new Error(
      `concern_category_guidelines lookup failed: ${guidelineRes.error.message}`,
    );
  }
  if (questionsRes.error) {
    throw new Error(
      `concern_questions lookup failed: ${questionsRes.error.message}`,
    );
  }

  if (!guidelineRes.data) {
    return null;
  }

  const questions: ConcernQuestion[] = (
    (questionsRes.data as unknown as ConcernQuestionRow[]) ?? []
  ).map((row) => ({
    id: row.id,
    question_text: row.question_text,
    options: normalizeOptions(row.options),
  }));

  return {
    category,
    display_label: guidelineRes.data.display_label,
    guideline_prose: guidelineRes.data.guideline_prose,
    questions,
  };
}
