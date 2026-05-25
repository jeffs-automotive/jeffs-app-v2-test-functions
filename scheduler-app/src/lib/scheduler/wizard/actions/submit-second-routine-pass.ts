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
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

const submitSecondRoutinePassSchema = z.object({
  chatId: z.string().min(1),
  added: z.array(z.string().min(1)).max(20),
});

export type SubmitSecondRoutinePassV2Args = z.infer<
  typeof submitSecondRoutinePassSchema
>;

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
  const { chatId, added } = parsed.data;

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
