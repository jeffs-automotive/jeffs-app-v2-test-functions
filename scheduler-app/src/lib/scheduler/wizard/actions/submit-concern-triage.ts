"use server";

/**
 * submitConcernTriageV2 — concern-triage Tier-A tap Server Action (2026-07-19).
 *
 * Resolves ONE concern_triage chip tap. When a concern's Stage-1 diagnostic
 * returned 0 candidates for a triage-eligible reason (`too_vague` /
 * `no_catalog_fit`) on its first pass, run-diagnostics persisted a TriageEntry
 * (the rendered chip snapshot + the SERVER-resolved allowed_by_chip subset) to
 * customer_chat_sessions.concern_triage_state and routed the wizard here. The
 * customer taps one broad-category chip ("What kind of trouble is it?"); their
 * tap drives a CONSTRAINED re-diagnosis of ONLY that concern.
 *
 * Input: { chatId, chip_key, concern_id }
 *   - chip_key = TRIAGE_ESCAPE_CHIP_KEY ("not_sure")  → advisor handoff.
 *   - chip_key = a DB chip                            → constrained re-diagnosis.
 *   - chip_key that doesn't resolve (forged/stale)    → advisor handoff.
 *
 * The constraint is derived SERVER-side from the persisted TriageEntry's
 * allowed_by_chip snapshot (INV-14) — never from a client-sent service list.
 *
 * Resolution branches:
 *   - "not_sure" (escape) OR an unresolvable chip → set the concern's
 *     handoff_reason ('triage_not_sure' / 'triage_bad_chip'), pop the entry,
 *     and route remaining-triage > pending-clarify > routeAfterDiagnostics
 *     (INV-4) — no re-diagnosis.
 *   - a valid chip → set the concern's triage_answers = the derived constraint
 *     + triage_round = 1 + STRIP its unanswered_question_ids (so it's NOT
 *     already-diagnosed for exactly this concern), pop the entry, reset
 *     diagnostic_processing_complete = false, and route to diagnostic_loading.
 *     The loading card re-invokes runDiagnosticsV2, which re-diagnoses ONLY
 *     this concern under the constraint and re-enters the normal graph.
 *
 * Concurrency (INV-15): re-reads the row, validates current_step ===
 * "concern_triage" and the HEAD entry's concern_id === the submitted
 * concern_id AND triage_round === 0. A stale/double-tap (head mismatch, queue
 * drained, round already consumed) is an idempotent no-op that returns ok
 * (NOT a second consume) so the page just re-renders the current state. Every
 * write goes through ONE applyWizardTransition call.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WizardStep } from "@/lib/scheduler/session-state";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { routeAfterDiagnostics } from "@/lib/scheduler/wizard/route-after-diagnostics";
import {
  deriveConstraint,
  TRIAGE_ESCAPE_CHIP_KEY,
  type TriageEntry,
  type TriageChipOption,
} from "@/lib/scheduler/wizard/triage";

const inputSchema = z.object({
  chatId: z.string().min(1),
  chip_key: z.string().min(1).max(200),
  concern_id: z.string().min(1).max(200),
});

export type SubmitConcernTriageV2Args = z.infer<typeof inputSchema>;

const CONCERN_TRIAGE_STEP: WizardStep = "concern_triage";
const CONCERN_CLARIFY_STEP: WizardStep = "concern_clarify";
const DIAGNOSTIC_LOADING_STEP: WizardStep = "diagnostic_loading";

/** Fixed user-voice bubble for the escape chip (it is NOT a DB row, so its
 *  label can't be read from the snapshot — INV-14 §10.4). */
const NOT_SURE_LABEL = "Something else / not sure";

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Fully reconstruct the persisted concern_triage_state into TriageEntry[]
 * (the tap needs chips + allowed_by_chip to derive the constraint). Mirrors
 * the run-diagnostics persisted shape (INV-12). Accepts null AND [].
 */
function parseTriageEntries(raw: unknown): TriageEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TriageEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const concern_id = typeof e.concern_id === "string" ? e.concern_id : null;
    const service_key =
      typeof e.service_key === "string" ? e.service_key : null;
    if (!concern_id || !service_key) continue;
    if (!Array.isArray(e.chips)) continue;
    if (!e.allowed_by_chip || typeof e.allowed_by_chip !== "object") continue;

    const chips: TriageChipOption[] = [];
    for (const chip of e.chips) {
      if (!chip || typeof chip !== "object") continue;
      const c = chip as Record<string, unknown>;
      if (
        typeof c.chip_key === "string" &&
        typeof c.display_label === "string"
      ) {
        chips.push({ chip_key: c.chip_key, display_label: c.display_label });
      }
    }

    const allowed_by_chip: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(
      e.allowed_by_chip as Record<string, unknown>,
    )) {
      if (Array.isArray(v)) {
        allowed_by_chip[k] = v.filter((x): x is string => typeof x === "string");
      }
    }

    const triage_round = e.triage_round === 1 ? 1 : 0;
    out.push({
      concern_id,
      concern_index:
        typeof e.concern_index === "number" ? e.concern_index : 0,
      service_key,
      concern_text: typeof e.concern_text === "string" ? e.concern_text : "",
      chips,
      allowed_by_chip,
      triage_round,
      created_version:
        typeof e.created_version === "string" ? e.created_version : "v1",
    });
  }
  return out;
}

/** Shallow structural filter for the clarify queue (routing only — we just
 *  need its LENGTH here; the carried entries pass through verbatim). */
function parseClarifyEntries(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).service_key === "string" &&
      Array.isArray((entry as Record<string, unknown>).candidates),
  );
}

/** Count entries with a numeric question_id (pending-question queue length,
 *  routing only). */
function countPendingQuestions(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter(
    (e) =>
      !!e &&
      typeof e === "object" &&
      typeof (e as Record<string, unknown>).question_id === "number",
  ).length;
}

function parseServiceKeyArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/** Recommended-service keys (routing only — the undecided count). */
function parseRecommendedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const e of raw) {
    if (e && typeof e === "object") {
      const k = (e as Record<string, unknown>).service_key;
      if (typeof k === "string") out.push(k);
    }
  }
  return out;
}

async function submitConcernTriageV2Impl(
  args: SubmitConcernTriageV2Args,
): Promise<WizardTransitionResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, chip_key, concern_id } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select(
        "id, current_step, concern_triage_state, concern_clarify_candidates, clarification_questions_pending, recommended_testing_services, approved_testing_services, declined_testing_services, explanation_required_items",
      )
      .eq("id", chatId)
      .maybeSingle();

    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    const currentStep = (row.current_step as string | null) ?? null;

    // Stale-tap guard (INV-15): the wizard must actually be on concern_triage.
    // A tap that lands after the step already advanced is an idempotent no-op
    // — return ok so the page re-renders the current (already-advanced) state
    // rather than surfacing an error the customer can't act on.
    if (currentStep !== CONCERN_TRIAGE_STEP) {
      Sentry.captureMessage("submit_concern_triage_v2 stale current_step", {
        level: "warning",
        extra: { chatId, current_step: currentStep, chip_key, concern_id },
      });
      const step = (currentStep ?? CONCERN_TRIAGE_STEP) as WizardStep;
      return { ok: true, next_step: step };
    }

    const triageQueue = parseTriageEntries(
      (row as Record<string, unknown>).concern_triage_state,
    );
    const head = triageQueue[0];

    // Head-identity + round guard (INV-15): a double-tap or two-tab race whose
    // concern_id no longer matches the queue head (or whose round is already
    // consumed) is an idempotent no-op — NOT a second consume.
    if (!head || head.concern_id !== concern_id || head.triage_round !== 0) {
      Sentry.captureMessage("submit_concern_triage_v2 stale head (no-op)", {
        level: "warning",
        extra: {
          chatId,
          submitted_concern_id: concern_id,
          head_concern_id: head?.concern_id ?? null,
          head_round: head?.triage_round ?? null,
        },
      });
      return { ok: true, next_step: CONCERN_TRIAGE_STEP };
    }

    // Derive the category constraint SERVER-side from the persisted snapshot
    // (INV-14). null = the escape chip OR a forged/unknown chip_key → advisor.
    const constraint =
      chip_key === TRIAGE_ESCAPE_CHIP_KEY
        ? null
        : deriveConstraint(head, chip_key);

    const remainingTriage = triageQueue.slice(1);
    // Work on the RAW items so every non-target field is preserved verbatim
    // (INV-3) — only the concern_id-matched entry is touched.
    const rawItems: unknown[] = Array.isArray(row.explanation_required_items)
      ? (row.explanation_required_items as unknown[])
      : [];

    if (constraint === null) {
      // ── Advisor handoff (escape chip OR unresolvable chip) ──────────────
      const handoffReason =
        chip_key === TRIAGE_ESCAPE_CHIP_KEY
          ? "triage_not_sure"
          : "triage_bad_chip";
      if (chip_key !== TRIAGE_ESCAPE_CHIP_KEY) {
        Sentry.captureMessage("submit_concern_triage_v2 unresolvable chip_key", {
          level: "warning",
          extra: {
            chatId,
            chip_key,
            concern_id,
            chip_keys: head.chips.map((c) => c.chip_key),
          },
        });
      }
      const updatedItems = rawItems.map((it) => {
        const obj = it as Record<string, unknown>;
        if (obj.concern_id !== concern_id) return it;
        // Consume the one-round cap (INV-5) alongside the handoff reason: if a
        // later describe-another-issue re-run resets
        // diagnostic_processing_complete and re-diagnoses this still-vague
        // concern, triage_round=1 keeps shouldTriage from resurrecting the
        // dismissed card — it falls through to the advisor path.
        return { ...obj, handoff_reason: handoffReason, triage_round: 1 };
      });

      // INV-4: route remaining-triage > pending-clarify > routeAfterDiagnostics
      // so a mixed multi-concern session isn't orphaned by this pop.
      const clarifyCount = parseClarifyEntries(
        (row as Record<string, unknown>).concern_clarify_candidates,
      ).length;
      let nextStep: WizardStep;
      let jeffBubble: string | undefined;
      if (remainingTriage.length > 0) {
        nextStep = CONCERN_TRIAGE_STEP;
        jeffBubble = undefined;
      } else if (clarifyCount > 0) {
        nextStep = CONCERN_CLARIFY_STEP;
        jeffBubble = undefined;
      } else {
        const pendingCount = countPendingQuestions(
          (row as Record<string, unknown>).clarification_questions_pending,
        );
        const recKeys = parseRecommendedKeys(
          (row as Record<string, unknown>).recommended_testing_services,
        );
        const approved = parseServiceKeyArray(
          (row as Record<string, unknown>).approved_testing_services,
        );
        const declined = parseServiceKeyArray(
          (row as Record<string, unknown>).declined_testing_services,
        );
        const undecided = recKeys.filter(
          (k) => !approved.includes(k) && !declined.includes(k),
        ).length;
        const routed = routeAfterDiagnostics({
          pending_count: pendingCount,
          recommendation_count: undecided,
        });
        nextStep = routed.nextStep;
        jeffBubble = routed.jeffBubble;
      }

      const transitionResult = await applyWizardTransition({
        chatId,
        updates: {
          explanation_required_items: updatedItems,
          concern_triage_state: remainingTriage,
        },
        nextStep,
        userBubble: NOT_SURE_LABEL,
        jeffBubble,
      });

      void insertTriageAudit(supabase, chatId, {
        chip_key,
        concern_id,
        outcome: handoffReason,
        chip_keys: head.chips.map((c) => c.chip_key),
      });
      return transitionResult;
    }

    // ── Constrained re-diagnosis (a valid chip) ───────────────────────────
    // On the target concern: set triage_answers + triage_round=1 and STRIP
    // unanswered_question_ids (delete the key) so isAlreadyDiagnosed is false
    // for exactly this concern — the re-run re-diagnoses ONLY it under the
    // constraint. Every other field is preserved verbatim (INV-3).
    const updatedItems = rawItems.map((it) => {
      const obj = it as Record<string, unknown>;
      if (obj.concern_id !== concern_id) return it;
      const { unanswered_question_ids: _stripped, ...rest } = obj;
      void _stripped; // dropped on purpose → forces re-diagnosis of this concern
      return {
        ...rest,
        triage_answers: constraint,
        triage_round: 1,
      };
    });

    const transitionResult = await applyWizardTransition({
      chatId,
      updates: {
        explanation_required_items: updatedItems,
        // Pop this concern's entry; the re-run reconciles the remainder.
        concern_triage_state: remainingTriage,
        // Re-open the diagnostic loop so the loading card re-invokes
        // runDiagnosticsV2 for the constrained re-diagnosis.
        diagnostic_processing_complete: false,
      },
      nextStep: DIAGNOSTIC_LOADING_STEP,
      userBubble: constraint.label,
    });

    void insertTriageAudit(supabase, chatId, {
      chip_key,
      concern_id,
      outcome: "constrained_rerun",
      allowed_service_keys: constraint.allowed_service_keys,
      chip_keys: head.chips.map((c) => c.chip_key),
    });
    return transitionResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_concern_triage_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_concern_triage_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { chip_key, concern_id },
    });
    return { ok: false, error: msg };
  }
}

/** Best-effort structured audit of the tap (mirrors submit-concern-clarify's
 *  fire-and-forget insert). Not on the critical path — a failure is logged,
 *  never blocks the wizard advance. */
function insertTriageAudit(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  chatId: string,
  detail: Record<string, unknown>,
): void {
  void supabase
    .from("scheduler_audit_log")
    .insert({
      session_id: chatId,
      step: "concern_triage",
      event_type: "concern_triage_choice",
      event_detail: detail,
    })
    .then(({ error }) => {
      if (error) {
        Sentry.captureMessage("submit_concern_triage_v2 audit insert failed", {
          level: "warning",
          extra: { chatId, error: error.message },
        });
      }
    });
}

export const submitConcernTriageV2 = wrapAction(
  "submitConcernTriageV2",
  submitConcernTriageV2Impl,
);
