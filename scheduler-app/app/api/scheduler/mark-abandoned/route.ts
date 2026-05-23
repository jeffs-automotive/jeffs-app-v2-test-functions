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
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/scheduler/wizard/log-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PLAN-03 Phase 2B (I-SEC-6) — pre-validate the beacon input shape
 * BEFORE any DB query.
 *
 * Threat: an attacker probes the endpoint with garbage chat_id values
 * (SQL-injection-like strings, path traversals, NULL bytes). The previous
 * implementation called `.eq("id", chatId)` with whatever string the
 * attacker submitted, leaving the supabase-js client to handle malformed
 * UUIDs. While supabase-js DOES properly escape via PostgREST, refusing
 * malformed input BEFORE the DB round-trip:
 *   1. Eliminates the DB roundtrip cost of malformed probes (DoS hardening)
 *   2. Makes the validation explicit + auditable
 *   3. Removes any future risk of `.eq()` behavior change (Supabase's
 *      type-validation on string-cast columns is stable but not guaranteed)
 *
 * Returns 204 on validation failure (NOT 400) so we don't leak info to
 * the probe — the legitimate sendBeacon path also returns 204, so a
 * 400 would let an attacker enumerate valid UUIDs by timing the
 * response shape.
 */
const beaconInputSchema = z.object({
  chat_id: z.string().uuid(),
  step: z.string().max(64).nullable().optional(),
  source: z.enum(["idle_timer", "tab_close"]).nullable().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Accept either querystring (sendBeacon's default — no body when
    // using `new URLSearchParams()`) OR JSON body. The IdleTimer client
    // uses the querystring path because it's simpler under sendBeacon.
    const url = new URL(req.url);
    let rawChatId = url.searchParams.get("chat_id");
    let rawStep = url.searchParams.get("step");
    let rawSource = url.searchParams.get("source");

    if (!rawChatId) {
      try {
        const body = (await req.json().catch(() => null)) as
          | { chat_id?: string; step?: string; source?: string }
          | null;
        if (body && typeof body.chat_id === "string") {
          rawChatId = body.chat_id;
          rawStep = body.step ?? null;
          rawSource = body.source ?? null;
        }
      } catch {
        // empty body is fine — beacon is best-effort
      }
    }

    // PLAN-03 Phase 2B — Zod validation. Malformed/missing chat_id → 204
    // (no DB query, no info leak). The legitimate happy path goes through
    // here too.
    const parsed = beaconInputSchema.safeParse({
      chat_id: rawChatId,
      step: rawStep,
      source: rawSource,
    });
    if (!parsed.success) {
      return new NextResponse(null, { status: 204 });
    }
    const chatId = parsed.data.chat_id;
    const step = parsed.data.step ?? null;
    const source = parsed.data.source ?? null;

    const supabase = createSupabaseAdminClient();

    // R4-IMPORTANT-C-3 2026-05-16: post-confirm race protection. The
    // booking flow has a window between the Tekmetric POST succeeding
    // and the Vercel row write completing (submit-summary advances to
    // customer_notes via applyWizardTransition). If the 5-min idle
    // beacon fires inside that window, mark-abandoned would release
    // the hold + flip the row to timed_out — wiping the customer's
    // freshly-confirmed appointment context even though Tekmetric
    // has the booking.
    //
    // The edge fn's confirmAppointment writes appointment_id onto the
    // session row BEFORE returning. If we observe appointment_id set,
    // the booking succeeded — never release the hold (defense in
    // depth) and never flip the session to timed_out.
    const { data: snapshot } = await supabase
      .from("customer_chat_sessions")
      .select("appointment_id, appointment_confirmed_at")
      .eq("id", chatId)
      .maybeSingle();
    const bookingLanded =
      snapshot &&
      (typeof snapshot.appointment_id === "number" ||
        snapshot.appointment_confirmed_at != null);
    if (bookingLanded) {
      // Don't run the abandon path. The customer notes step (or any
      // post-confirm surface) can navigate away naturally. Audit-log
      // the no-op so we can measure how often this race kicks in.
      void supabase
        .from("scheduler_audit_log")
        .insert({
          session_id: chatId,
          step: step ?? "unknown",
          event_type: "session_abandon_skipped_post_confirm",
          event_detail: {
            source: source ?? "idle_timer",
            step_at_abandon: step ?? null,
            appointment_id: snapshot.appointment_id ?? null,
          },
        });
      return new NextResponse(null, { status: 204 });
    }

    // Only flip rows that are currently in-flight. Idempotent: a row
    // that's already ended/escalated/timed_out is left alone.
    //
    // Bug fix 2026-05-16 (R4-BLOCKER-E-1): previously wrote
    // outcome: "abandoned", but the CHECK constraint only allows
    // ('scheduled','info_only','escalation','incomplete'). Every beacon
    // silently failed the row update — session stayed status='active'
    // and downstream resume logic mis-treated truly-abandoned rows as
    // resumable. Fixed to 'incomplete' (matches schema enum). The
    // separate abandoned_at TIMESTAMPTZ column distinguishes
    // "user-abandoned" from other "incomplete" outcomes for analytics.
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("customer_chat_sessions")
      .update({
        status: "timed_out",
        ended_at: nowIso,
        abandoned_at: nowIso,
        outcome: "incomplete",
        last_active_at: nowIso,
      })
      .eq("id", chatId)
      .eq("status", "active");

    if (updateErr) {
      Sentry.captureMessage("mark_abandoned_update_failed", {
        level: "warning",
        extra: { chatId, error: updateErr.message },
      });
      await logError({
        chatId,
        surface: "mark_abandoned_route",
        error_code: "session_update_failed",
        message: updateErr.message,
        level: "warning",
        context: { source: source ?? null, step: step ?? null },
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
      await logError({
        chatId,
        surface: "mark_abandoned_route",
        error_code: "hold_release_failed",
        message: releaseErr.message,
        level: "warning",
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
    await logError({
      surface: "mark_abandoned_route",
      error_code: "uncaught",
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack ?? null : null,
      level: "error",
    });
    // Always return 204 — sendBeacon doesn't process error responses.
    return new NextResponse(null, { status: 204 });
  }
}
