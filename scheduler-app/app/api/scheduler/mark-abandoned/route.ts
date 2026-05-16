/**
 * POST /api/scheduler/mark-abandoned — idle / tab-close handler.
 *
 * Per the 2026-05-16 ephemeral-session architecture: the V2 wizard no
 * longer persists state across customer absence. If the customer leaves
 * the page OR is idle for 5+ minutes, the IdleTimer fires this beacon,
 * the row is marked timed_out, and ANY ACTIVE APPOINTMENT HOLD for the
 * session is released so other customers can pick that slot.
 *
 * Triggers:
 *   - 5-min inactivity timer in IdleTimer.tsx
 *   - pagehide / beforeunload (tab close, nav-away)
 *
 * The beacon writes the row update + releases the hold. The customer's
 * next visit goes through hydrateSession, which detects the stale row
 * (status != 'active') and wipes it in-place to start fresh.
 *
 * Idempotent: row updates only fire on status='active' rows. Hold
 * release only touches rows where released_at IS NULL. Multiple beacons
 * for the same session (e.g., one from idle timer + one from pagehide)
 * are safe — second one is a no-op.
 *
 * Auth: NONE. The browser can't attach bearers on sendBeacon during
 * tear-down. Abuse surface is small — marking a row the attacker
 * already knows the chat_id for as timed_out is exactly what the
 * legitimate customer would do.
 *
 * Returns 204 always so the browser doesn't queue retries.
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Accept either querystring (sendBeacon's default — no body when
    // using `new URLSearchParams()`) OR JSON body. The IdleTimer client
    // uses the querystring path because it's simpler under sendBeacon.
    const url = new URL(req.url);
    let chatId = url.searchParams.get("chat_id");
    let step = url.searchParams.get("step");
    let source = url.searchParams.get("source");

    if (!chatId) {
      try {
        const body = (await req.json().catch(() => null)) as
          | { chat_id?: string; step?: string; source?: string }
          | null;
        if (body && typeof body.chat_id === "string") {
          chatId = body.chat_id;
          step = body.step ?? null;
          source = body.source ?? null;
        }
      } catch {
        // empty body is fine — beacon is best-effort
      }
    }

    if (!chatId || typeof chatId !== "string" || chatId.length === 0) {
      // No chat_id → can't do anything; ack quickly so the beacon doesn't
      // retry.
      return new NextResponse(null, { status: 204 });
    }

    const supabase = createSupabaseAdminClient();

    // Only flip rows that are currently in-flight. Idempotent: a row
    // that's already ended/escalated/timed_out is left alone.
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("customer_chat_sessions")
      .update({
        status: "timed_out",
        ended_at: nowIso,
        outcome: "abandoned",
        last_active_at: nowIso,
      })
      .eq("id", chatId)
      .eq("status", "active");

    if (updateErr) {
      Sentry.captureMessage("mark_abandoned_update_failed", {
        level: "warning",
        extra: { chatId, error: updateErr.message },
      });
      return new NextResponse(null, { status: 204 });
    }

    // Release any active appointment_holds for this session so other
    // customers can pick the same slot. The 2026-05-16 ephemeral-session
    // architecture says holds survive only during the active session;
    // a timeout / tab-close MUST free the slot.
    //
    // Filter on released_at IS NULL so this is idempotent — a hold
    // already released by submitSummaryV2 confirm or by a prior beacon
    // is left alone.
    const { error: releaseErr } = await supabase
      .from("appointment_holds")
      .update({ released_at: nowIso })
      .eq("session_id", chatId)
      .is("released_at", null);
    if (releaseErr) {
      Sentry.captureMessage("mark_abandoned_release_hold_failed", {
        level: "warning",
        extra: { chatId, error: releaseErr.message },
      });
    }

    // Best-effort audit row carrying source + step at abandon.
    void supabase
      .from("scheduler_audit_log")
      .insert({
        session_id: chatId,
        step: step ?? "unknown",
        event_type: "session_abandoned",
        event_detail: {
          source: source ?? "idle_timer",
          step_at_abandon: step ?? null,
        },
      })
      .then(({ error }) => {
        if (error) {
          Sentry.captureMessage("mark_abandoned_audit_failed", {
            level: "warning",
            extra: { chatId, error: error.message },
          });
        }
      });

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "mark_abandoned_route" },
      level: "warning",
    });
    // Always return 204 — sendBeacon doesn't process error responses.
    return new NextResponse(null, { status: 204 });
  }
}
