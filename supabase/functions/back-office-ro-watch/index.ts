// back-office-ro-watch — 30-min cron for the back-office module (reuses qteklink's
// Tekmetric event ledger, does NOT touch the live webhook / posting paths).
//
//   Job A — reopened-RO detection: for every RO with a recent `ro_unposted` event,
//     reconstruct the unpost cycle (original vs new posted date + total from the
//     surrounding posting events), upsert a `reopened_ro` back-office issue (dedup per
//     cycle), and fire a `detected` alert for newly-created ones.
//   Job B — open-RO auto-close (decision #12): for every un-verified `open_ro` issue whose
//     RO has since closed (a posting event is its newest state), flip it to ro_closed and
//     fire a `ro_closed` "verify the entries" nudge.
//
// Triggered by pg_cron (jobname: back-office-ro-watch) via scheduler_invoke_edge_function.
// Auth: the scheduler bearer (same as keytag-daily-report). Alerts go through
// back-office-notify (called with the service key).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { buildReopenedCycle, isPosting, type SaleEvent } from "../_shared/back-office-detect.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const DEFAULT_TZ = "America/New_York";
const UNPOST_LOOKBACK_MS = 72 * 60 * 60 * 1000; // self-healing across missed runs; dedup makes re-scan safe
const SCAN_KINDS = ["ro_posted", "ro_sent_to_ar", "ro_unposted"];

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface RawEventRow {
  event_kind: string;
  raw_body: { data?: Record<string, unknown>; event?: unknown } | null;
  received_at: string;
  event_text?: string | null;
  tekmetric_ro_id?: number | string | null;
}

function toSaleEvent(r: RawEventRow): SaleEvent {
  // Tekmetric payloads are usually nested under `data`, but some arrive FLAT (the 2026-07-06
  // flat-vs-nested incident) — fall back to the top-level body so those aren't misread.
  const d = (r.raw_body?.data as Record<string, unknown> | undefined) ?? (r.raw_body as Record<string, unknown> | null) ?? {};
  const total = typeof d.totalSales === "number" && Number.isSafeInteger(d.totalSales) ? d.totalSales : null;
  const roNum =
    typeof d.repairOrderNumber === "string" || typeof d.repairOrderNumber === "number"
      ? String(d.repairOrderNumber)
      : null;
  return {
    kind: r.event_kind,
    receivedAt: r.received_at,
    postedDate: typeof d.postedDate === "string" ? d.postedDate : null,
    totalCents: total,
    roNumber: roNum,
    eventText: r.event_text ?? (typeof r.raw_body?.event === "string" ? r.raw_body.event : null),
  };
}

/** Fire a back-office-notify alert (service-to-service). Never throws into the cron. */
async function notify(shopId: number, issueId: string, event: string): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/back-office-notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESOLVED_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId, issue_id: issueId, event }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ level: "error", surface: "back-office-ro-watch", msg: "notify_failed", event, status: res.status }));
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "back-office-ro-watch", step: "notify" } });
  }
}

async function detectReopened(shopId: number, realmId: string, tz: string): Promise<number> {
  const cutoff = new Date(Date.now() - UNPOST_LOOKBACK_MS).toISOString();
  const { data: unpostRows, error: unpostErr } = await sb
    .from("qteklink_events")
    .select("tekmetric_ro_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("event_kind", "ro_unposted")
    .gte("received_at", cutoff);
  if (unpostErr) throw new Error(`detectReopened (unposts) failed: ${unpostErr.message}`);

  const roIds = [
    ...new Set(
      (unpostRows ?? [])
        .map((r) => Number((r as { tekmetric_ro_id: unknown }).tekmetric_ro_id))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];

  let created = 0;
  for (const ro of roIds) {
    const { data: evRows, error: evErr } = await sb
      .from("qteklink_events")
      .select("event_kind, raw_body, received_at, event_text")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .eq("tekmetric_ro_id", ro)
      .in("event_kind", SCAN_KINDS)
      .order("received_at", { ascending: true });
    if (evErr) {
      Sentry.captureException(evErr, { tags: { surface: "back-office-ro-watch", step: "events" } });
      continue;
    }
    const cycle = buildReopenedCycle((evRows ?? []).map((r) => toSaleEvent(r as RawEventRow)), tz);
    if (!cycle) continue;

    const { data: upRes, error: upErr } = await sb.rpc("back_office_upsert_reopened", {
      p_shop_id: shopId,
      p_tekmetric_ro_id: ro,
      p_cycle: cycle,
    });
    if (upErr) {
      Sentry.captureException(upErr, { tags: { surface: "back-office-ro-watch", step: "upsert_reopened" } });
      continue;
    }
    const row = (Array.isArray(upRes) ? upRes[0] : upRes) as { issue_id?: string; was_created?: boolean } | undefined;
    if (row?.was_created && row.issue_id) {
      await notify(shopId, row.issue_id, "detected");
      created++;
    }
  }
  return created;
}

async function detectOpenRoClose(shopId: number, realmId: string): Promise<number> {
  const { data: openRos, error: openErr } = await sb
    .from("back_office_issues")
    .select("id, ro_number, context")
    .eq("shop_id", shopId)
    .eq("kind", "open_ro")
    .neq("status", "verified")
    .not("ro_number", "is", null);
  if (openErr) throw new Error(`detectOpenRoClose (issues) failed: ${openErr.message}`);

  let closed = 0;
  for (const issue of openRos ?? []) {
    const row = issue as { id: string; ro_number: string; context: Record<string, unknown> | null };
    if ((row.context?.ro_status as string) === "ro_closed") continue;
    const roNum = String(row.ro_number);

    // Match the RO# under the usual nested `data` path OR a flat top-level payload.
    const { data: evRows, error: evErr } = await sb
      .from("qteklink_events")
      .select("event_kind, raw_body, received_at, tekmetric_ro_id")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .or(`raw_body->data->>repairOrderNumber.eq.${roNum},raw_body->>repairOrderNumber.eq.${roNum}`)
      .in("event_kind", SCAN_KINDS)
      .order("received_at", { ascending: false })
      .limit(1);
    if (evErr) {
      Sentry.captureException(evErr, { tags: { surface: "back-office-ro-watch", step: "openro_events" } });
      continue;
    }
    const latest = (evRows ?? [])[0] as RawEventRow | undefined;
    if (!latest || !isPosting(latest.event_kind)) continue; // RO is not currently closed

    const tekId = latest.tekmetric_ro_id ? Number(latest.tekmetric_ro_id) : null;
    const { data: closedIds, error: closeErr } = await sb.rpc("back_office_close_open_ro", {
      p_shop_id: shopId,
      p_ro_number: roNum,
      p_tekmetric_ro_id: Number.isInteger(tekId) ? tekId : null,
      p_closed_at: latest.received_at,
    });
    if (closeErr) {
      Sentry.captureException(closeErr, { tags: { surface: "back-office-ro-watch", step: "close_open_ro" } });
      continue;
    }
    for (const id of (closedIds ?? []) as string[]) {
      await notify(shopId, id, "ro_closed");
      closed++;
    }
  }
  return closed;
}

Deno.serve((req) =>
  withSentryScope(req, "back-office-ro-watch", async () => {
    if (req.method !== "GET" && req.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }
    const auth = checkSchedulerBearer(req, "back-office-ro-watch");
    if (!auth.ok) return unauthorizedResponse(auth);

    // Every active QBO connection (shop, realm) — shop-agnostic.
    const { data: conns, error: connErr } = await sb
      .from("qbo_connections")
      .select("shop_id, realm_id");
    if (connErr) {
      Sentry.captureException(connErr, { tags: { surface: "back-office-ro-watch" } });
      return json(500, { ok: false, error: "connections_read_failed" });
    }

    let detected = 0;
    let closed = 0;
    for (const c of conns ?? []) {
      const shopId = Number((c as { shop_id: unknown }).shop_id);
      const realmId = String((c as { realm_id: unknown }).realm_id ?? "");
      if (!Number.isInteger(shopId) || shopId <= 0 || !realmId) continue;

      const { data: setRow, error: setErr } = await sb
        .from("qteklink_settings")
        .select("shop_timezone")
        .eq("shop_id", shopId)
        .eq("realm_id", realmId)
        .limit(1)
        .maybeSingle();
      if (setErr) {
        // Surface the read error (observability rule 9) rather than silently using the
        // default tz — a wrong tz would misclassify reopened change_type business dates.
        Sentry.captureException(setErr, { tags: { surface: "back-office-ro-watch", step: "settings", shop_id: String(shopId) } });
      }
      const tz = (setRow?.shop_timezone as string) || DEFAULT_TZ;

      try {
        detected += await detectReopened(shopId, realmId, tz);
        closed += await detectOpenRoClose(shopId, realmId);
      } catch (e) {
        Sentry.captureException(e, { tags: { surface: "back-office-ro-watch", shop_id: String(shopId) } });
      }
    }

    return json(200, { ok: true, reopened_detected: detected, open_ros_closed: closed });
  }),
);
