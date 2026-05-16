"use server";

/**
 * Step 7.2 submit — concern explanation (Phase 9c, 2026-05-15).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
 * one card per picked-service-that-needs-a-description. Each submit fills
 * the explanation_text on the FIRST item in explanation_required_items
 * whose explanation_text is still empty AND whose service_key matches
 * (defensive matching prevents a back-button + re-submit from writing to
 * the wrong queue entry).
 *
 * After the write:
 *   - any items still empty → advance to concern_explanation (the next one)
 *   - queue fully filled    → advance to diagnostic_loading (which mounts
 *     and triggers runDiagnosticsV2 to do the gap-detection)
 *
 * Escalation keyword scan runs on the customer's prose (spec §A). A hit
 * routes to escalated terminal state with the description preserved in
 * the audit log (escalation_reason carries the keyword).
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { scanForEscalationKeywords } from "@/lib/scheduler/escalation-keywords";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { logError } from "@/lib/scheduler/wizard/log-error";

const submitExplanationSchema = z.object({
  chatId: z.string().min(1),
  service_key: z.string().min(1),
  explanation_text: z.string().trim().min(1).max(2000),
});

export type SubmitExplanationV2Args = z.infer<typeof submitExplanationSchema>;

interface ExplanationItem {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
}

function parseItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const service_key =
        typeof e.service_key === "string" ? e.service_key : null;
      if (!service_key) return null;
      const display_name =
        typeof e.display_name === "string" ? e.display_name : service_key;
      const explanation_text =
        typeof e.explanation_text === "string" ? e.explanation_text : "";
      const category =
        typeof e.category === "string" && e.category.length > 0
          ? e.category
          : null;
      return {
        service_key,
        display_name,
        explanation_text,
        category,
      } satisfies ExplanationItem;
    })
    .filter((x): x is ExplanationItem => x !== null);
}

async function submitExplanationV2Impl(
  args: SubmitExplanationV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitExplanationSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, service_key, explanation_text } = parsed.data;

  // Pattern-extension fix 2026-05-16: prior shape had try/catch ONLY
  // around the keyword scanner (lines 124-146 below). The main body —
  // supabase row read, parseItems, applyWizardTransition — had no
  // top-level catch. An uncaught throw would escape as a raw Server
  // Action rejection (the client sees a thrown error, not the
  // {ok:false} envelope every other action returns). Now wrapped to
  // match the action-suite convention.
  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select("explanation_required_items")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    const items = parseItems(row.explanation_required_items);
    if (items.length === 0) {
      // Nothing to fill — defensively advance to appointment_type. The
      // submit-service-and-concern-picker action would normally have
      // routed here only when items existed, so this is the back-button
      // case.
      return applyWizardTransition({
        chatId,
        nextStep: "appointment_type",
      });
    }

    // Find the FIRST empty entry matching this service_key. If the
    // customer back-buttons and resubmits a previously-filled entry,
    // treat it as an overwrite (still picks the first matching key).
    const targetIdx = items.findIndex(
      (i) => i.service_key === service_key && !i.explanation_text,
    );
    if (targetIdx === -1) {
      // Defensive: the submit references a service_key that doesn't
      // have an open slot. Could be a stale form submit. Don't error
      // noisily — just try to advance based on current queue state.
      const stillEmpty = items.some((i) => !i.explanation_text);
      return applyWizardTransition({
        chatId,
        nextStep: stillEmpty ? "concern_explanation" : "diagnostic_loading",
      });
    }

    // Escalation keyword scan on the customer's prose. Inner try kept
    // around the scanner itself so a scanner failure doesn't block
    // the queue advance — but the OUTER try below catches anything
    // else.
    try {
      const hit = scanForEscalationKeywords(explanation_text);
      if (hit) {
        return applyWizardTransition({
          chatId,
          updates: {
            status: "escalated",
            escalated_at: new Date().toISOString(),
            escalation_reason: `keyword:${hit.category}:${hit.keyword}`,
          },
          nextStep: "escalated",
          userBubble: explanation_text,
          jeffBubble:
            "Let me get a real person on this one — please call us at (610) 253-6565 and we'll take great care of you. 📞",
        });
      }
    } catch (e) {
      // Keyword scanner is non-critical; log + proceed.
      Sentry.captureException(e, {
        tags: { surface: "submit_explanation_v2_keyword_scan" },
        level: "warning",
      });
    }

    // Patch the matched entry; preserve every other field.
    const targetItem = items[targetIdx];
    if (!targetItem) {
      // Type narrowing — targetIdx >= 0 guarantees a hit, but TS doesn't
      // know.
      return { ok: false, error: "internal_state_error_target_item" };
    }
    const updatedItems: ExplanationItem[] = items.map((item, idx) =>
      idx === targetIdx ? { ...item, explanation_text } : item,
    );

    const stillEmpty = updatedItems.some((i) => !i.explanation_text);
    const nextStep = stillEmpty
      ? ("concern_explanation" as const)
      : ("diagnostic_loading" as const);

    const jeffBubble = stillEmpty
      ? undefined
      : "Thanks — let me think through what testing might be needed. 🤔";

    return applyWizardTransition({
      chatId,
      updates: { explanation_required_items: updatedItems },
      nextStep,
      userBubble: explanation_text,
      jeffBubble,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_explanation_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_explanation_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { service_key },
    });
    return { ok: false, error: msg };
  }
}

export const submitExplanationV2 = wrapAction(
  "submitExplanationV2",
  submitExplanationV2Impl,
);
