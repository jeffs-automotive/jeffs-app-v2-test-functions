"use server";

/**
 * Step 7.1 submit — service + concern picker (Phase 9c rewrite 2026-05-15).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
 * the customer's picks come in as a flat list of service_keys spanning BOTH
 * chip sections. This action splits them three ways:
 *
 *   - selected_simple_services[] — routine picks that don't need a description
 *   - approved_testing_services[] — testing-service picks (customer chose
 *     them explicitly, no later approval card; D2 of the redesign)
 *   - explanation_required_items[] — per-service description queue. Each
 *     entry: { service_key, display_name, explanation_text:"", category }.
 *     Set for: testing services + routine services with
 *     requires_explanation=true. The wizard walks this queue via Step 7.2
 *     concern_explanation cards (one per item, filled in by submitExplanationV2).
 *
 * After the queue is built:
 *   - queue non-empty → advance to concern_explanation
 *   - queue empty → advance to appointment_type (skip Steps 7.2-7.5 entirely)
 *
 * Escalation keyword scan: NOT applied here in Phase 9c because the picker
 * no longer has a free-text textarea — the concern_explanation cards in
 * Step 7.2 are where free text comes from, and submitExplanationV2 runs the
 * keyword scan there. Keeping escalation scoped to where the customer
 * actually types prose.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

const SHOP_ID = 7476;

/**
 * Synthetic service_key for the "💬 Other Issue" fixed pseudo-chip in
 * the picker. NOT a row in routine_services or testing_services — the
 * submit action recognises it explicitly and creates an
 * explanation_required_items entry whose downstream diagnostic flow
 * has no pre-resolved category (the LLM classifies from free text).
 */
const OTHER_ISSUE_SERVICE_KEY = "other_issue";
const OTHER_ISSUE_DISPLAY_NAME = "Other issue";

const submitServiceAndConcernPickerSchema = z.object({
  chatId: z.string().min(1),
  picks: z.array(z.string().min(1)),
});

export type SubmitServiceAndConcernPickerV2Args = z.infer<
  typeof submitServiceAndConcernPickerSchema
>;

interface RoutineRow {
  service_key: string;
  display_name: string;
  requires_explanation: boolean;
  concern_categories: string[] | null;
}

interface TestingRow {
  service_key: string;
  display_name: string;
  concern_categories: string[] | null;
}

async function submitServiceAndConcernPickerV2Impl(
  args: SubmitServiceAndConcernPickerV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitServiceAndConcernPickerSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, picks } = parsed.data;

  if (picks.length === 0) {
    return {
      ok: false,
      error: "Pick at least one service to continue.",
    };
  }

  const uniquePicks = Array.from(new Set(picks));
  const supabase = createSupabaseAdminClient();

  try {
    const [routineRes, testingRes] = await Promise.all([
      supabase
        .from("routine_services")
        .select("service_key, display_name, requires_explanation, concern_categories")
        .eq("shop_id", SHOP_ID)
        .eq("active", true)
        .in("service_key", uniquePicks),
      supabase
        .from("testing_services")
        .select("service_key, display_name, concern_categories")
        .eq("shop_id", SHOP_ID)
        .eq("active", true)
        .in("service_key", uniquePicks),
    ]);

    if (routineRes.error) {
      throw new Error(`routine_services lookup: ${routineRes.error.message}`);
    }
    if (testingRes.error) {
      throw new Error(`testing_services lookup: ${testingRes.error.message}`);
    }

    const routineRows = (routineRes.data ?? []) as RoutineRow[];
    const testingRows = (testingRes.data ?? []) as TestingRow[];
    const routineByKey = new Map(routineRows.map((r) => [r.service_key, r]));
    const testingByKey = new Map(testingRows.map((r) => [r.service_key, r]));

    const simpleServices: string[] = [];
    const approvedTesting: string[] = [];
    const explanationItems: Array<{
      service_key: string;
      display_name: string;
      explanation_text: string;
      category: string | null;
    }> = [];

    const unknownPicks: string[] = [];

    for (const key of uniquePicks) {
      // Other Issue is a fixed pseudo-chip (not in any DB table). Treat
      // it as a requires_explanation chip with no pre-resolved category
      // — the diagnostic LLM classifies + recommends from the customer's
      // free-text description in the next step.
      if (key === OTHER_ISSUE_SERVICE_KEY) {
        explanationItems.push({
          service_key: OTHER_ISSUE_SERVICE_KEY,
          display_name: OTHER_ISSUE_DISPLAY_NAME,
          explanation_text: "",
          category: null,
        });
        continue;
      }
      const routine = routineByKey.get(key);
      if (routine) {
        if (routine.requires_explanation) {
          explanationItems.push({
            service_key: routine.service_key,
            display_name: routine.display_name,
            explanation_text: "",
            category:
              routine.concern_categories && routine.concern_categories.length > 0
                ? (routine.concern_categories[0] ?? null)
                : null,
          });
        } else {
          simpleServices.push(routine.service_key);
        }
        continue;
      }
      const testing = testingByKey.get(key);
      if (testing) {
        approvedTesting.push(testing.service_key);
        explanationItems.push({
          service_key: testing.service_key,
          display_name: testing.display_name,
          explanation_text: "",
          category:
            testing.concern_categories && testing.concern_categories.length > 0
              ? (testing.concern_categories[0] ?? null)
              : null,
        });
        continue;
      }
      unknownPicks.push(key);
    }

    if (unknownPicks.length > 0) {
      Sentry.captureMessage("submit_service_and_concern_picker unknown picks", {
        level: "warning",
        extra: { chatId, unknownPicks },
      });
    }

    const nextStep = explanationItems.length > 0
      ? ("concern_explanation" as const)
      : ("appointment_type" as const);

    const jeffBubble = explanationItems.length > 0
      ? `Tell me a little about each one and I'll match up what we should test. 🤔`
      : "Got it — let me check the schedule! 📅";

    return applyWizardTransition({
      chatId,
      updates: {
        selected_simple_services: simpleServices,
        approved_testing_services: approvedTesting,
        explanation_required_items: explanationItems,
        // Phase 9a's run-diagnostics expects this to start FALSE so it does
        // the work; reset on every fresh pick-submit in case the customer
        // came back through Start Over.
        diagnostic_processing_complete: false,
        clarification_questions_pending: [],
        clarification_questions_answered: {},
      },
      nextStep,
      jeffBubble,
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_service_and_concern_picker_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitServiceAndConcernPickerV2 = wrapAction(
  "submitServiceAndConcernPickerV2",
  submitServiceAndConcernPickerV2Impl,
);
