"use server";

/**
 * Step 7.6 submit — second routine pass (Phase 10, 2026-05-15).
 *
 * Per chat-design.md §Step 7.6 (lines 1826-1868): one last add-on chance
 * before the customer picks waiter-vs-dropoff. The card emits
 * { added: string[] } — only NEW picks (already_picked items are filtered
 * out client-side via the disabled state). We:
 *
 *   1. Validate every key in `added` is a real, active routine service_key
 *      that isn't already in the customer's pick set. Drop anything that
 *      doesn't pass — defensive against a stale form submit or browser
 *      back-button replay.
 *   2. Write `additional_routine_services_round2 = added` on the row
 *      (TEXT[] column, idempotent overwrite).
 *   3. Advance current_step → appointment_type.
 *   4. Emit the §1866 transition bubble: "Perfect — here's what I've got:
 *      [services]. Let me check the schedule! 📅"
 *
 * Empty `added` is a valid "Continue without adding more" submission — the
 * row update still fires (writes [] so a subsequent back-button-replay
 * doesn't preserve a stale add list) and we still advance.
 *
 * Describe-another-issue branch (task EH2, 2026-07-04): when the card sends
 * `describe_issue: true`, the customer wants to type a second symptom. We
 * FIRST persist the validated `added` routine keys exactly as the normal
 * path does (nothing they toggled is lost), THEN append a fresh
 * `other_issue` entry to `explanation_required_items` (same shape
 * submit-service-and-concern-picker synthesizes for its "Other Issue"
 * pseudo-chip), reset `diagnostic_processing_complete=false`, and route to
 * `concern_explanation`. The downstream chain
 * (concern_explanation → diagnostic_loading → clarify/questions/approval)
 * loops back to `second_routine_pass` naturally per routeAfterDiagnostics —
 * so the customer can add yet another symptom or continue.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

/**
 * Synthetic service_key for a free-text "Other issue" concern, matching the
 * picker's OTHER_ISSUE pseudo-chip (submit-service-and-concern-picker.ts).
 * The diagnostic LLM classifies + recommends from the customer's free-text
 * description in the next step; there's no pre-resolved category.
 */
const OTHER_ISSUE_SERVICE_KEY = "other_issue";
const OTHER_ISSUE_DISPLAY_NAME = "Other issue";

const submitSecondRoutinePassSchema = z.object({
  chatId: z.string().min(1),
  added: z.array(z.string().min(1)).max(20),
  /** EH2: TRUE routes into the describe-another-issue branch. */
  describe_issue: z.literal(true).optional(),
});

export type SubmitSecondRoutinePassV2Args = z.infer<
  typeof submitSecondRoutinePassSchema
>;

/** An explanation_required_items entry (mirrors the picker's shape). */
interface ExplanationEntry {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
  unanswered_question_ids?: number[];
  summary?: string;
}

/** Parse the row's existing explanation_required_items defensively. */
function parseExistingExplanationItems(raw: unknown): ExplanationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const service_key =
      typeof e.service_key === "string" ? e.service_key : null;
    if (!service_key) continue;
    const item: ExplanationEntry = {
      service_key,
      display_name:
        typeof e.display_name === "string" ? e.display_name : service_key,
      explanation_text:
        typeof e.explanation_text === "string" ? e.explanation_text : "",
      category:
        typeof e.category === "string" && e.category.length > 0
          ? e.category
          : null,
    };
    if (Array.isArray(e.unanswered_question_ids)) {
      item.unanswered_question_ids = e.unanswered_question_ids.filter(
        (x): x is number => typeof x === "number",
      );
    }
    if (typeof e.summary === "string" && e.summary.length > 0) {
      item.summary = e.summary;
    }
    out.push(item);
  }
  return out;
}

async function submitSecondRoutinePassV2Impl(
  args: SubmitSecondRoutinePassV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitSecondRoutinePassSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, added, describe_issue } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    // Read the prior pick set so we can drop any submitted key that's
    // already accounted for. The card disables these visually, but a stale
    // submit could carry a removed key — be defensive.
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select(
        "selected_simple_services, approved_testing_services, explanation_required_items",
      )
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    const alreadyPicked = new Set<string>();
    for (const k of (row.selected_simple_services as string[] | null) ?? []) {
      alreadyPicked.add(k);
    }
    for (const k of (row.approved_testing_services as string[] | null) ?? []) {
      alreadyPicked.add(k);
    }
    const explanationItems = row.explanation_required_items;
    if (Array.isArray(explanationItems)) {
      for (const entry of explanationItems) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).service_key === "string"
        ) {
          alreadyPicked.add(
            (entry as Record<string, unknown>).service_key as string,
          );
        }
      }
    }

    // Validate each submitted key against the active routine_services
    // catalog AND against the already-picked set.
    const requested = Array.from(new Set(added)).filter(
      (k) => !alreadyPicked.has(k),
    );
    let validKeys: string[] = [];
    if (requested.length > 0) {
      // Bug audit 2026-05-16: also reject requires_explanation=true keys
      // here. These services must be picked at Step 7.1 so the diagnostic
      // concern_explanation flow can attach. A stale form submit or
      // browser-back replay could send one through; filter it out.
      const { data: catalog, error: catErr } = await supabase
        .from("routine_services")
        .select("service_key, requires_explanation")
        .eq("shop_id", SHOP_ID)
        .eq("active", true)
        .in("service_key", requested);
      if (catErr) {
        throw new Error(
          `routine_services validation lookup failed: ${catErr.message}`,
        );
      }
      const validRows = (catalog ?? []) as Array<{
        service_key: string;
        requires_explanation: boolean;
      }>;
      const knownKeys = new Set(
        validRows
          .filter((r) => !r.requires_explanation)
          .map((r) => r.service_key),
      );
      validKeys = requested.filter((k) => knownKeys.has(k));
    }

    // ── DESCRIBE-ANOTHER-ISSUE branch (task EH2) ─────────────────────────
    // The customer wants to type a second symptom. Persist the validated
    // routine adds EXACTLY as the normal path does (nothing they toggled is
    // lost), append a fresh empty `other_issue` concern entry (same shape
    // the picker synthesizes), reset diagnostic_processing_complete so the
    // downstream diagnostic pass re-runs, and route to concern_explanation.
    // The chain loops back to second_routine_pass naturally, so the customer
    // can describe yet another issue or continue.
    if (describe_issue) {
      const existing = parseExistingExplanationItems(
        row.explanation_required_items,
      );
      const newConcern: ExplanationEntry = {
        service_key: OTHER_ISSUE_SERVICE_KEY,
        display_name: OTHER_ISSUE_DISPLAY_NAME,
        explanation_text: "",
        category: null,
      };
      const mergedExplanation = [...existing, newConcern];

      return applyWizardTransition({
        chatId,
        updates: {
          additional_routine_services_round2: validKeys,
          explanation_required_items: mergedExplanation,
          // run-diagnostics keys off this being FALSE to do the work; the
          // new concern needs the full explanation → diagnostic pass.
          diagnostic_processing_complete: false,
        },
        nextStep: "concern_explanation",
        userBubble: "I've got another issue to describe",
        jeffBubble:
          "Of course — tell me a little about what you're noticing and I'll match up what we should test. 🤔",
      });
    }

    // Build the §1866 transition bubble. Use display names so the customer
    // sees readable text. Pulls display_name from routine + testing
    // catalogs covering every key in the merged pick list.
    const transitionBubble = await buildStep8TransitionBubble(
      supabase,
      Array.from(alreadyPicked),
      validKeys,
    );

    return applyWizardTransition({
      chatId,
      updates: { additional_routine_services_round2: validKeys },
      nextStep: "appointment_type",
      jeffBubble: transitionBubble,
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_second_routine_pass_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitSecondRoutinePassV2 = wrapAction(
  "submitSecondRoutinePassV2",
  submitSecondRoutinePassV2Impl,
);

/**
 * Build the Step 7.6 → Step 8 transition bubble:
 *
 *   "Perfect — here's what I've got: <comma-list>. Let me check the
 *    schedule! 📅"
 *
 * The list is built from display_names so it reads like a customer would
 * expect ("Oil Change, Brake Inspection") rather than service_keys. Service
 * keys that don't resolve (a stale row, a deleted catalog entry) are
 * silently dropped — better to surface a shorter list than to expose
 * raw keys.
 */
async function buildStep8TransitionBubble(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  priorPicks: string[],
  newPicks: string[],
): Promise<string> {
  const allKeys = Array.from(new Set([...priorPicks, ...newPicks]));
  if (allKeys.length === 0) {
    return "Got it — let me check the schedule! 📅";
  }

  const [routineRes, testingRes] = await Promise.all([
    supabase
      .from("routine_services")
      .select("service_key, display_name")
      .eq("shop_id", SHOP_ID)
      .in("service_key", allKeys),
    supabase
      .from("testing_services")
      .select("service_key, display_name")
      .eq("shop_id", SHOP_ID)
      .in("service_key", allKeys),
  ]);

  const nameByKey = new Map<string, string>();
  for (const r of (routineRes.data ?? []) as Array<{
    service_key: string;
    display_name: string;
  }>) {
    nameByKey.set(r.service_key, r.display_name);
  }
  for (const r of (testingRes.data ?? []) as Array<{
    service_key: string;
    display_name: string;
  }>) {
    nameByKey.set(r.service_key, r.display_name);
  }

  const names = allKeys
    .map((k) => nameByKey.get(k))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  if (names.length === 0) {
    return "Got it — let me check the schedule! 📅";
  }
  return `Perfect — here's what I've got: ${names.join(", ")}. Let me check the schedule! 📅`;
}
