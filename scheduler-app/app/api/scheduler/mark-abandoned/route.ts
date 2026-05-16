/**
 * POST /api/scheduler/mark-abandoned — Phase 14 idle / tab-close handler.
 *
 * Per chat-design.md §B "Idle / abandon flow" (lines 3188-3223): when the
 * client detects either (a) 7 minutes of total inactivity OR (b) tab
 * unload via `beforeunload` / `pagehide`, it fires
 * `navigator.sendBeacon('/api/scheduler/mark-abandoned?chat_id=...&step=...')`.
 *
 * `sendBeacon` is fire-and-forget — the browser sends even during page
 * tear-down. The endpoint accepts POST (sendBeacon defaults to POST) and
 * returns 204 No Content quickly so the browser doesn't queue the
 * response.
 *
 * Idempotent: the WHERE clause only flips rows whose status is `active`.
 * A row that's already escalated/ended/timed_out is left alone — the
 * customer might be on a stale tab from an earlier completed session.
 *
 * Status convention follows the schema's `'active'|'idle'|'ended'|
 * 'escalated'|'timed_out'` enum (per migration 20260513000000):
 *   - `timed_out` matches the chat-design.md spec's "abandoned" intent.
 *   - We also stamp `ended_at` so transcript-dispatcher's session_end
 *     timing reads correctly.
 *
 * Auth: NONE. This endpoint accepts an unauthenticated beacon because
 * (a) the browser can't attach bearers on a sendBeacon during tear-down
 * and (b) the abuse surface is small — the only effect is marking a row
 * that the abuser already knows the chat_id for (cookie-bound) as
 * timed_out, which is precisely what the customer would do themselves.
 *
 * Phase 1 limitation: this is a best-effort beacon. If the browser fails
 * to send (network drop, force-quit, etc.), the orphan `active` row will
 * be reaped by a future Phase 1.1 server-side cron OR by the customer's
 * next return (which can flip it to `active` again — see chat-design.md
 * §C "Resume after returning").
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
