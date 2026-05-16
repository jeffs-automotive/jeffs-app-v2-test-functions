/**
 * fireTranscriptDispatch — Phase 13 (2026-05-16) on-demand transcript-
 * email trigger for the V2 wizard.
 *
 * Per chat-design.md §10.5 (lines 2779-2789): the moment current_step
 * advances to 'completed' (Step 10.4 customer_question submit), the
 * Server Action:
 *   1. INSERTs a row into `transcript_emails` (status='pending')
 *   2. Immediately POSTs to the transcript-dispatcher Edge Function with
 *      { transcript_id } so the email goes out within a few seconds
 *      (vs. waiting up to 5 min for the cron backstop).
 *
 * The cron-driven backstop (every 5 min) stays in place and ensures any
 * failed on-demand POST is eventually retried. Idempotency-Key inside
 * the dispatcher prevents duplicate emails.
 *
 * Fire-and-forget — failure here does NOT block the customer's
 * advance-to-completed flow. The cron backstop will pick it up.
 */
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

export interface FireTranscriptDispatchResult {
  ok: boolean;
  transcript_id?: string;
  reason?: string;
}

function transcriptDispatcherUrl(): string | null {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    return null;
  }
  // Same pattern as booking-direct-client.ts — swap the trailing path
  // segment of ORCHESTRATOR_URL (e.g. /orchestrator-direct) to
  // /transcript-dispatcher.
  return orchestratorUrl.replace(/\/[^/]+\/?$/, "/transcript-dispatcher");
}

export async function fireTranscriptDispatch(args: {
  chatId: string;
}): Promise<FireTranscriptDispatchResult> {
  const supabase = createSupabaseAdminClient();

  // Step 1 — INSERT a transcript_emails row. Cron will pick this up even
  // if the immediate POST below fails.
  const { data: insertRow, error: insertErr } = await supabase
    .from("transcript_emails")
    .insert({ session_id: args.chatId, status: "pending" })
    .select("id")
    .single();

  if (insertErr || !insertRow) {
    Sentry.captureException(insertErr ?? new Error("no transcript row"), {
      tags: { surface: "fire_transcript_dispatch_insert" },
      level: "warning",
      extra: { chatId: args.chatId },
    });
    return {
      ok: false,
      reason: `insert_failed: ${insertErr?.message ?? "unknown"}`,
    };
  }

  const transcriptId = insertRow.id as string;

  // Step 2 — POST to the dispatcher. Fail-soft so the customer's advance
  // never blocks on the email send.
  const url = transcriptDispatcherUrl();
  if (!url) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "fire_transcript_dispatch_no_url",
        chat_id: args.chatId,
        transcript_id: transcriptId,
      }),
    );
    return { ok: false, transcript_id: transcriptId, reason: "no_url" };
  }

  const secretKey = resolveServiceRoleKey();
  if (!secretKey) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "fire_transcript_dispatch_no_service_key",
        chat_id: args.chatId,
        transcript_id: transcriptId,
      }),
    );
    return {
      ok: false,
      transcript_id: transcriptId,
      reason: "no_service_key",
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        apikey: secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcript_id: transcriptId }),
      // 15s is generous — the dispatcher's per-transcript work is one
      // Postgres lookup + one Resend POST. The 30s backstop window
      // means we don't need to wait long here either.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      Sentry.captureMessage("fire_transcript_dispatch_non_2xx", {
        level: "warning",
        extra: {
          chatId: args.chatId,
          transcript_id: transcriptId,
          status: res.status,
          body: text.slice(0, 300),
        },
      });
      return {
        ok: false,
        transcript_id: transcriptId,
        reason: `dispatcher_${res.status}`,
      };
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "fire_transcript_dispatch_post" },
      level: "warning",
      extra: { chatId: args.chatId, transcript_id: transcriptId },
    });
    return {
      ok: false,
      transcript_id: transcriptId,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  return { ok: true, transcript_id: transcriptId };
}
