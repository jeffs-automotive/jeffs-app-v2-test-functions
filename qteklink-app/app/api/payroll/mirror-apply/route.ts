/**
 * POST /api/payroll/mirror-apply — the round-7 #40 webhook → mirror → recompute
 * consumer. The qteklink-webhook edge function fire-and-forget POSTs the ids of
 * freshly-stored RO events here; this route loads their raw_body JSONB from
 * qteklink_events, applies every FULL RO payload into the tekmetric_ros* mirror
 * through the SAME single-sourced TS mappers the ingest uses (payload-only — no
 * Tekmetric API call), marks the shop's open payroll runs stale, and recomputes
 * them debounced (skip when a recompute ran < 60s ago) into the stored live
 * snapshot. Backstops for missed notifies: the nightly ingest + the dry-run /
 * manual refresh actions.
 *
 * AUTH (the CRON_SECRET idiom — app/api/cron/daily-sync/route.ts): the edge fn
 * sends `Authorization: Bearer ${PAYROLL_MIRROR_APPLY_SECRET}`; anything else is
 * rejected (no public trigger of a mirror write). Set the SAME secret as
 * PAYROLL_MIRROR_APPLY_SECRET on Vercel (this app) and QTL_MIRROR_APPLY_SECRET on
 * the Supabase edge function (plus QTL_MIRROR_APPLY_URL = this route's URL).
 *
 * MULTI-TENANT: the shop comes from each stored event row (bound server-side by
 * the webhook's realm resolve), never from the request body. Per-shop failures are
 * isolated inside applyMirrorEventsAndRecompute (captured + reported per shop).
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { applyMirrorEventsAndRecompute, fetchMirrorApplyEvents } from "@/lib/dal/payroll-live";
import { bearerMatches } from "@/lib/bearer-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // apply + a possible multi-run recompute

const BodySchema = z.object({
  // The edge fn sends one id per delivery; the cap guards a hand-rolled replay.
  event_ids: z.array(z.uuid()).min(1).max(100),
});

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.PAYROLL_MIRROR_APPLY_SECRET;
  const auth = req.headers.get("authorization");
  // Constant-time compare (incident 82dc03d — `!==` leaks per-byte timing); a
  // rejection is surfaced to Sentry (observability rule 5 — a bare 401 on a
  // mirror-WRITE endpoint must not be silent).
  if (!bearerMatches(auth, secret)) {
    Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("event", "signature_fail");
      scope.setFingerprint(["mirror-apply-auth-fail", "qteklink", "/api/payroll/mirror-apply"]);
      scope.setContext("request", {
        ip: req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown",
        user_agent: req.headers.get("user-agent") ?? "unknown",
      });
      Sentry.captureMessage("qteklink payroll mirror-apply: unauthorized call rejected", "warning");
    });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "body must be { event_ids: uuid[] (1..100) }" }, { status: 400 });
  }

  try {
    const events = await fetchMirrorApplyEvents(parsed.data.event_ids);
    const shops = await applyMirrorEventsAndRecompute(events);
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      eventsRequested: parsed.data.event_ids.length,
      eventsFound: events.length,
      shops,
    });
  } catch (e) {
    // A whole-request failure (the events fetch) — the notify is best-effort and the
    // nightly ingest reconciles; still visible in Sentry + a 500 for the fn's logs.
    Sentry.captureException(e, { tags: { qteklink_action: "payroll-mirror-apply-route" } });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
