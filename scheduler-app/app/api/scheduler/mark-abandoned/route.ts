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
import { revalidateTag } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sessionTag } from "@/lib/scheduler/cache";
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
    //
    // 2026-05-23 BUG FIX (date-picker stuck-on-first-click): also pull
    // last_active_at so we can defend against spurious-pagehide races
    // where the beacon fires DURING an in-flight Server Action. See the
    // "ageMs < 5_000" guard below.
    const { data: snapshot } = await supabase
      .from("customer_chat_sessions")
      .select(
        "appointment_id, appointment_confirmed_at, last_active_at, current_step",
      )
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
      //
      // 2026-05-23: switched to `await` so the audit row reliably lands
      // even on Vercel serverless cold-stops. Previously the void-promise
      // pattern was dropped by the response flush, masking the abandon
      // path's true behavior during postmortem queries (e.g., the
      // date-picker bug's "hold released with no audit entry" mystery).
      try {
        await supabase
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
      } catch (auditErr) {
        Sentry.captureMessage("mark_abandoned_audit_post_confirm_failed", {
          level: "warning",
          extra: {
            chatId,
            error: auditErr instanceof Error ? auditErr.message : String(auditErr),
          },
        });
      }
      return new NextResponse(null, { status: 204 });
    }

    // 2026-05-23 BUG FIX (date-picker stuck-on-first-click): defense
    // against the spurious-pagehide race.
    //
    // Empirical observation (test data 77d7e925 + 7a4a20b4): appointment
    // holds were getting `released_at` set 2.5-7.7 seconds after creation
    // when the customer tapped a date on iOS Safari. The 5-minute idle
    // timer can't fire that fast. The cron reaper only runs after a 70-min
    // grace window. The only remaining write path is THIS route.
    //
    // Diagnosis: iOS Safari fires `pagehide` transiently during many
    // mid-flow interactions — Server Action POSTs, URL-bar taps, brief
    // app-switcher touches, bfcache transitions — even when the page is
    // not actually being abandoned. The IdleTimer's pagehide handler was
    // calling sendBeacon for every one of those events.
    //
    // Defense: if last_active_at is younger than 10 seconds, the user is
    // mid-interaction (likely an in-flight Server Action followed by a
    // brief render-settle moment). Refuse the release; the legitimate
    // 5-min idle path + 70-min cron reaper still cover truly-abandoned
    // sessions.
    //
    // Why 10 seconds: applyWizardTransition writes last_active_at on
    // every step advance. submit-date.ts's dropoff hold path takes 2-5
    // seconds (Tekmetric pre-check + hold INSERT) and ALL 4 observed
    // spurious-release lags in the DB were < 8 seconds. 10s is a
    // comfortable 95th-percentile upper bound with safety margin.
    const lastActiveMs =
      snapshot?.last_active_at
        ? new Date(snapshot.last_active_at as string).getTime()
        : 0;
    const ageMs = Date.now() - lastActiveMs;
    if (snapshot && lastActiveMs > 0 && ageMs < 10_000) {
      try {
        await supabase
          .from("scheduler_audit_log")
          .insert({
            session_id: chatId,
            step: step ?? "unknown",
            event_type: "session_abandon_skipped_recent_activity",
            event_detail: {
              source: source ?? "tab_close",
              step_at_abandon: step ?? null,
              row_step: (snapshot.current_step as string | null) ?? null,
              age_ms: ageMs,
            },
          });
      } catch (auditErr) {
        Sentry.captureMessage("mark_abandoned_audit_recent_activity_failed", {
          level: "warning",
          extra: {
            chatId,
            error: auditErr instanceof Error ? auditErr.message : String(auditErr),
          },
        });
      }
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

    // Plan 04 Phase 5B (closes I-OTH-3 gap caught by verifier B
    // 2026-05-25): the session row was just flipped to status=timed_out.
    // Without this revalidateTag, hydrateSession on the customer's
    // next visit reads the CACHED pre-abandon row (status='active'),
    // skips wipe-in-place, and resumes a "ghost" session for up to
    // 60s (the TTL backstop). Fires unconditionally — supabase-js
    // doesn't return row-count on .update().eq() without .select(),
    // and over-invalidating an already-timed-out cache entry is
    // strictly safer than under-invalidating a freshly-flipped one.
    revalidateTag(sessionTag(chatId));

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

    // 2026-05-23: switched from `void`-then-`.then()` (fire-and-forget) to
    // an `await`-with-try/catch. The fire-and-forget pattern was getting
    // dropped by Vercel's response-flush on the nodejs runtime — the
    // INSERT promise would be cut off the moment the route returned 204,
    // so a non-trivial fraction of legitimate session_abandoned events
    // were missing from scheduler_audit_log. That masked the date-picker
    // bug for days (sessions showed `released_at` set with no audit
    // explanation — see SQL trail in commit message).
    try {
      await supabase
        .from("scheduler_audit_log")
        .insert({
          session_id: chatId,
          step: step ?? "unknown",
          event_type: "session_abandoned",
          event_detail: {
            source: source ?? "idle_timer",
            step_at_abandon: step ?? null,
          },
        });
    } catch (auditErr) {
      Sentry.captureMessage("mark_abandoned_audit_failed", {
        level: "warning",
        extra: {
          chatId,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        },
      });
    }

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
