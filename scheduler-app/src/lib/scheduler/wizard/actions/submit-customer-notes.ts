"use server";

/**
 * Step 10.3 submit — Customer notes (Phase 13 2026-05-16).
 *
 * Per chat-design.md §Step 10.3 (lines 2667-2714) + the 2026-05-16
 * amendment §10.3-10.5: the customer can leave an optional post-confirm
 * note (≤500 chars in the UI). We branch by length:
 *
 *   - **>150 chars** — skip the LLM parser; save raw + append to the
 *     Tekmetric appointment description via PATCH; advance to
 *     customer_question. The customer sees: "Got it — I'll send your
 *     full note to our service team and they'll call if they have any
 *     questions."
 *   - **≤150 chars** — LLM-parse with parseCustomerNote; STAY on the
 *     customer_notes step with the parsed preview surfaced by
 *     getCurrentCard. The card flips into approval mode (Save / Edit).
 *     Save approves → PATCH description with the parsed text. Edit
 *     rejects → increment edit_attempts; on the second reject, punt
 *     (PATCH description with the RAW text, advance).
 *   - **Skip** — null text. No PATCH; advance to customer_question.
 *
 * Four input shapes, one action:
 *
 *   - { kind: "skip" }                       — Skip button
 *   - { kind: "submit_raw", text: string }   — Send button in input mode
 *   - { kind: "approve_parsed", parsed_text }— Save button in approval mode
 *   - { kind: "reject_parsed" }              — Edit button in approval mode
 *
 * The "raw text" is preserved in customer_notes_text on the row across
 * the approve/reject loop, because:
 *   - On submit_raw (≤150), we write text=raw, approved=null, attempts=0
 *   - getCurrentCard re-derives parsed_preview by calling parseCustomerNote
 *     on row.customer_notes_text each render (cheap Haiku call)
 *   - On approve_parsed, we OVERWRITE text=parsed_text (echoed by the
 *     card so we don't re-parse for the third time) + approved=true
 *   - On reject_parsed (1st), we bump attempts to 1; re-render re-parses
 *     with attempt=2 for an alternate wording
 *   - On reject_parsed (2nd → attempts becomes 2): row already has
 *     text=raw; we PATCH with raw and advance, leaving text=raw +
 *     approved=false
 *
 * Keyword escalation: customer-notes content (raw or parsed) is scanned
 * via scanForEscalationKeywords before persisting. A hit routes through
 * submit-escalate the same way Step 7 explanation_text does.
 *
 * Audit log: card_submitted entries record the kind + the row's evolving
 * approved/attempts state at the moment of submit.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendAppointmentDescription, BookingDirectError } from "@/lib/scheduler/booking-direct-client";
import { scanForEscalationKeywords } from "@/lib/scheduler/escalation-keywords";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { submitEscalateV2 } from "./submit-escalate";

const PARSE_LENGTH_THRESHOLD = 150; // chars — chat-design.md §10.3
const REJECT_ATTEMPT_PUNT_THRESHOLD = 2; // 2nd reject = punt
const MAX_TEXT_LENGTH = 500; // matches CustomerNotesCard's textarea cap

const submitCustomerNotesSchema = z.discriminatedUnion("kind", [
  z.object({ chatId: z.string().min(1), kind: z.literal("skip") }),
  z.object({
    chatId: z.string().min(1),
    kind: z.literal("submit_raw"),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
  }),
  z.object({
    chatId: z.string().min(1),
    kind: z.literal("approve_parsed"),
    parsed_text: z.string().min(1).max(PARSE_LENGTH_THRESHOLD + 10),
  }),
  z.object({ chatId: z.string().min(1), kind: z.literal("reject_parsed") }),
]);

export type SubmitCustomerNotesV2Args = z.infer<
  typeof submitCustomerNotesSchema
>;

export async function submitCustomerNotesV2(
  args: SubmitCustomerNotesV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitCustomerNotesSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const input = parsed.data;

  try {
    switch (input.kind) {
      case "skip":
        return await handleSkip(input.chatId);
      case "submit_raw":
        return await handleSubmitRaw(input.chatId, input.text);
      case "approve_parsed":
        return await handleApproveParsed(input.chatId, input.parsed_text);
      case "reject_parsed":
        return await handleRejectParsed(input.chatId);
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: {
        surface: "submit_customer_notes_v2",
        kind: input.kind,
      },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Skip ───────────────────────────────────────────────────────────────────

async function handleSkip(chatId: string): Promise<WizardTransitionResult> {
  return applyWizardTransition({
    chatId,
    updates: {
      customer_notes_text: null,
      customer_notes_approved: false,
      customer_notes_edit_attempts: 0,
    },
    nextStep: "customer_question",
    jeffBubble:
      "No worries — one last thing: do you have any questions for our team? 🤔",
  });
}

// ─── Submit raw (≤500 chars from card; branch by 150-char threshold) ────────

async function handleSubmitRaw(
  chatId: string,
  text: string,
): Promise<WizardTransitionResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    // Defensive — Zod min(1) should have caught this, but treat as skip.
    return handleSkip(chatId);
  }

  // Phase 14 — scan the raw note for escalation keywords BEFORE we
  // commit it. A hit funnels through submitEscalateV2 (which sets
  // status=escalated + fires the [ESCALATED] transcript). The keyword
  // tag is included in the reason for service-team triage.
  const hit = scanForEscalationKeywords(trimmed);
  if (hit) {
    return submitEscalateV2({
      chatId,
      reason: `keyword:${hit.category}:${hit.keyword}`,
    });
  }

  if (trimmed.length > PARSE_LENGTH_THRESHOLD) {
    // >150 — skip the parser, PATCH description with raw, advance.
    return finalizeWithRawAppend(chatId, trimmed, {
      jeffBubble:
        "Got it — I'll send your full note to our service team and they'll call if they have any questions. 📞",
    });
  }

  // ≤150 — write raw to row, stay on customer_notes step. getCurrentCard
  // will call parseCustomerNote on next render to surface the preview.
  return applyWizardTransition({
    chatId,
    updates: {
      customer_notes_text: trimmed,
      customer_notes_approved: null,
      customer_notes_edit_attempts: 0,
    },
    nextStep: "customer_notes",
  });
}

// ─── Approve parsed ─────────────────────────────────────────────────────────

async function handleApproveParsed(
  chatId: string,
  parsedText: string,
): Promise<WizardTransitionResult> {
  const trimmed = parsedText.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "parsed_text empty" };
  }

  // PATCH appointment description with the parsed text. Need
  // appointment_id from the row.
  const supabase = createSupabaseAdminClient();
  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select("appointment_id, customer_notes_edit_attempts")
    .eq("id", chatId)
    .maybeSingle();
  if (rowErr || !row) {
    return { ok: false, error: rowErr?.message ?? "session_not_found" };
  }
  const appointmentId = row.appointment_id as number | null;

  if (appointmentId) {
    await safeAppendDescription(chatId, appointmentId, trimmed);
  } else {
    // No appointment_id yet — shouldn't happen since we only reach
    // customer_notes after a successful confirm. Log + persist anyway.
    Sentry.captureMessage(
      "submit_customer_notes_v2 approve without appointment_id",
      { level: "warning", extra: { chatId } },
    );
  }

  return applyWizardTransition({
    chatId,
    updates: {
      customer_notes_text: trimmed,
      customer_notes_approved: true,
    },
    nextStep: "customer_question",
    jeffBubble:
      "Perfect — passed that along to the team. One last thing: any questions for us? 🤔",
  });
}

// ─── Reject parsed ──────────────────────────────────────────────────────────

async function handleRejectParsed(
  chatId: string,
): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();
  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select(
      "appointment_id, customer_notes_text, customer_notes_edit_attempts",
    )
    .eq("id", chatId)
    .maybeSingle();
  if (rowErr || !row) {
    return { ok: false, error: rowErr?.message ?? "session_not_found" };
  }
  const priorAttempts =
    (row.customer_notes_edit_attempts as number | null) ?? 0;
  const nextAttempts = priorAttempts + 1;

  if (nextAttempts < REJECT_ATTEMPT_PUNT_THRESHOLD) {
    // 1st reject — bump attempts, stay on customer_notes. getCurrentCard
    // re-parses with attempt=2 on next render.
    return applyWizardTransition({
      chatId,
      updates: { customer_notes_edit_attempts: nextAttempts },
      nextStep: "customer_notes",
    });
  }

  // 2nd reject — punt to raw. row.customer_notes_text still holds the
  // raw text (we never overwrite it on submit_raw or reject_parsed).
  const rawText = (row.customer_notes_text as string | null) ?? "";
  const appointmentId = row.appointment_id as number | null;
  if (rawText.trim().length > 0 && appointmentId) {
    await safeAppendDescription(chatId, appointmentId, rawText.trim());
  }

  return applyWizardTransition({
    chatId,
    updates: {
      customer_notes_edit_attempts: nextAttempts,
      customer_notes_approved: false,
    },
    nextStep: "customer_question",
    jeffBubble:
      "Got it — I'll send your note over to our team as-is and they'll follow up if anything's unclear. One last thing: any questions for us? 🤔",
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * >150-char raw path AND 2nd-reject punt path both PATCH the appointment
 * description with the raw text + advance to customer_question. Pulled
 * out so both call sites share the same bubble + row-update shape.
 */
async function finalizeWithRawAppend(
  chatId: string,
  rawText: string,
  opts: { jeffBubble: string },
): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();
  const { data: row } = await supabase
    .from("customer_chat_sessions")
    .select("appointment_id")
    .eq("id", chatId)
    .maybeSingle();
  const appointmentId = (row?.appointment_id as number | null) ?? null;
  if (appointmentId) {
    await safeAppendDescription(chatId, appointmentId, rawText);
  } else {
    Sentry.captureMessage(
      "submit_customer_notes_v2 raw-path without appointment_id",
      { level: "warning", extra: { chatId } },
    );
  }

  return applyWizardTransition({
    chatId,
    updates: {
      customer_notes_text: rawText,
      customer_notes_approved: false,
    },
    nextStep: "customer_question",
    jeffBubble: opts.jeffBubble,
  });
}

/**
 * PATCH the Tekmetric appointment description with `append_text` via
 * scheduler-booking-direct. Fail-soft: failure is logged to Sentry but
 * does NOT block the customer's advance. The note still lives on the
 * row + in the transcript email + the staff email that fired at confirm.
 */
async function safeAppendDescription(
  chatId: string,
  appointmentId: number,
  appendText: string,
): Promise<void> {
  try {
    const result = await appendAppointmentDescription({
      op: "append_appointment_description",
      session_id: chatId,
      appointment_id: appointmentId,
      append_text: appendText,
    });
    if (!result.ok) {
      Sentry.captureMessage(
        "submit_customer_notes_v2 append_description returned !ok",
        {
          level: "warning",
          extra: {
            chatId,
            appointment_id: appointmentId,
            error: result.error,
            tekmetric_error_text: result.tekmetric_error_text?.slice(0, 300),
          },
        },
      );
    }
  } catch (e) {
    const reason =
      e instanceof BookingDirectError
        ? `booking_direct_${e.status ?? "network"}`
        : "booking_direct_unknown";
    Sentry.captureException(e, {
      tags: { surface: "submit_customer_notes_v2_append_description", reason },
      level: "warning",
      extra: { chatId, appointment_id: appointmentId },
    });
  }
}
