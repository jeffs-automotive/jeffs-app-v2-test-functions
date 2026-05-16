// appointments-sync
//
// Per appointments_design.md §6.12 + §7.4 + §12.1.
//
// Cron-driven full pull of the rolling 7-day window from Tekmetric into our
// local `appointments` shadow table. Powers fast list_available_slots queries
// (millisec response from local shadow vs ~250-400ms per Tekmetric round-trip).
//
// Schedule:
//   - During shop hours (Mon-Sat 7am-6pm ET): every 10 min
//   - Off-hours: every 1h (cheap insurance against staff-side changes)
//   Configured at the Supabase Cron level (we'll set the cron expression
//   when scheduling).
//
// Pull strategy: full window, NOT delta-based.
//   - GET /appointments?shop=7476&start=<today>&end=<today+7d>
//   - For each: upsert into appointments (match by tekmetric_appointment_id)
//   - Soft-delete any local row that's no longer in the response (deleted in
//     Tekmetric since last sync)
//   - Prune rows where start_time < now() - 1 day (rolling window cleanup)
//   - Update appointment_sync_state.last_delta_sync_at + count
//
// Trigger:
//   - GET / or POST / (no body) — runs the sync
//   - On-demand invocation OK (used at first deploy to populate shadow)
//
// Auth: Pattern A bearer (matches orchestrator-direct).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricGetJson,
  type TekmetricPage,
} from "../_shared/tekmetric-client.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Tekmetric appointment shape (pull) ──────────────────────────────────────
//
// Phase 9d 2026-05-16 — fixed the interface to match what Tekmetric actually
// returns. The prior shape declared appointmentStatus as { id, name, code }
// but live API + webhook payloads return it as a bare string (e.g., "NONE").
// Reading `.code` on a string yields undefined and the upsert defaulted to
// "NONE" for every appointment — see scheduler-refactor-state.json
// phase_09d.discoveries_2026_05_14.bug_1_appointmentStatus_shape for the
// full incident write-up.

interface TekmetricAppointment {
  id: number;
  shopId: number;
  customerId: number | null;
  vehicleId: number | null;
  startTime: string;
  endTime: string;
  description: string | null;
  title?: string | null;
  // Bare string — NOT { id, name, code }. Empirical values: NONE | CANCELED
  // (plus the docs enum ARRIVED | NO_SHOW which we haven't seen in webhooks).
  appointmentStatus: string;
  // Object IS still { id, code, name } on GET/webhook for this one. But it's
  // unsettable via POST/PATCH (silently ignored — see 2026-05-16 testing).
  appointmentOption?: { id: number; name: string; code: string } | null;
  rideOption?: { id: number; name: string; code: string } | null;
  // Hex color code. The customer-pick → staff-visibility channel (per the
  // 2026-05-16 architecture amendment). Drives classifyAppointmentType below.
  color?: string | null;
  // Phase 9d additions — fields the prior parser discarded.
  arrived?: boolean | null;
  leadSource?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  createdDate?: string | null;
  updatedDate?: string | null;
  // confirmationStatus: NONE | CONFIRMED. Read-only via Tekmetric API; only
  // set via Tekmetric's internal flow (SMS reply / staff confirm). V2.1 webhook
  // handler will detect a flip to CONFIRMED and PATCH the title to prepend
  // "CONFIRMED " for advisor visibility (tracked in future-release-notes.md).
  confirmationStatus?: string | null;
  deletedDate?: string | null;
  // Forward-compat: allow unknown fields so Tekmetric additions don't break
  // the parse. raw_payload captures the full object verbatim.
  [k: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Phase 9d 2026-05-16 — color-derived classifier.
 *
 * The prior classifier used `appointmentOption.code` as the primary signal
 * (with a UTC-hour fallback). 2026-05-16 testing proved that Tekmetric's
 * POST/PATCH API silently ignores `appointmentOption` in every shape — every
 * API-created appointment defaults to STAY. Empirical query against the
 * existing 177-row shadow showed the legacy classifier mislabeled 39 rows
 * (22%): 35 navy appointments tagged as waiter and 4 red as dropoff.
 *
 * The fix: derive `appointment_type` from `color`. Tekmetric's UI lets staff
 * pick the color independently of the (broken) appointmentOption dropdown,
 * and per Chris's shop convention (per docs/scheduler/appointment-post.md):
 *
 *   #D01919 (red)    — waiter (customer waits)
 *   #0D4A80 (navy)   — dropoff (default; standard drop-off)
 *   #FCB70D (yellow) — loaner car required (still a dropoff for capacity)
 *   #F0572A (orange) — tow-in (still consumes a service bay → dropoff)
 *   #1786E8 (blue)   — needs ride/shuttle (still a dropoff for capacity)
 *   #128743 (green)  — needs-by time promise (still a dropoff)
 *   light green      — will reschedule; unused (would map to dropoff)
 *   lavender         — no show marker (would map to dropoff)
 *   purple           — new-customer marker (would map to dropoff)
 *
 * Only RED maps to waiter. Every other color is dropoff for capacity-tracking
 * purposes — including tow-in, since towed appointments still consume a
 * service bay slot. Future Phase v2.1 may widen the `appointment_type` enum
 * to add 'towed' as its own value (with coordinated reader updates in
 * scheduler-slots.ts + availability.ts), but for v2 launch the conservative
 * mapping ships.
 *
 * @param color  hex color from Tekmetric (e.g., "#D01919"); case-insensitive
 * @returns "waiter" if red, else "dropoff"
 */
function classifyAppointmentType(color: string | null | undefined): "waiter" | "dropoff" {
  const c = (color ?? "").toLowerCase();
  switch (c) {
    case "#d01919": return "waiter";    // red
    case "#0d4a80": return "dropoff";   // navy (default)
    case "#fcb70d": return "dropoff";   // yellow loaner
    case "#f0572a": return "dropoff";   // orange tow-in
    case "#1786e8": return "dropoff";   // blue needs-ride
    case "#128743": return "dropoff";   // green needs-by
    // light_green / lavender / purple — hex codes not yet observed; default
    // to dropoff for safety. Add explicit cases here if they start appearing.
    default:        return "dropoff";   // unknown / null / pre-Phase-9d rows
  }
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Sync logic ──────────────────────────────────────────────────────────────

interface SyncResult {
  ok: boolean;
  upserted: number;
  soft_deleted: number;
  pruned: number;
  window_start: string;
  window_end: string;
  pages_fetched: number;
  error?: string;
}

async function fetchAllPages(
  startIso: string,
  endIso: string,
): Promise<{ items: TekmetricAppointment[]; pages: number }> {
  const items: TekmetricAppointment[] = [];
  let page = 0;
  const size = 100;
  let pages = 0;
  // Tekmetric Spring pagination: number=0..N-1, last=true on the final page
  // Cap at 50 pages (5000 appointments) — the rolling 7-day window won't
  // realistically exceed this for one shop.
  while (page < 50) {
    const res = await tekmetricGetJson<TekmetricPage<TekmetricAppointment>>(
      sb,
      "/appointments",
      {
        shop: SHOP_ID,
        start: startIso,
        end: endIso,
        size,
        page,
      },
    );
    pages += 1;
    items.push(...(res.content ?? []));
    if (res.last) break;
    page += 1;
  }
  return { items, pages };
}

async function runSync(): Promise<SyncResult> {
  const now = new Date();
  const windowStart = new Date(`${ymd(now)}T00:00:00Z`);
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();

  let items: TekmetricAppointment[];
  let pages: number;
  try {
    const fetched = await fetchAllPages(startIso, endIso);
    items = fetched.items;
    pages = fetched.pages;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      upserted: 0,
      soft_deleted: 0,
      pruned: 0,
      window_start: startIso,
      window_end: endIso,
      pages_fetched: 0,
      error: `tekmetric_pull_failed: ${msg}`,
    };
  }

  // Build the upsert payload, naturally deduplicating across pages.
  //
  // Why: Tekmetric's Spring-style offset pagination doesn't guarantee
  // uniqueness when the underlying data shifts between page reads. If the
  // same appointment_id appears on page 0 AND page 1, passing both rows
  // into a single .upsert() call raises:
  //
  //   "ON CONFLICT DO UPDATE command cannot affect row a second time"
  //
  // — Postgres's cardinality-violation guard (per postgresql.org/docs/
  // current/sql-insert.html § ON CONFLICT). The fix is to dedupe in
  // application code so the input rows have unique conflict keys.
  //
  // Map<id, row> gives us last-write-wins semantics: if page 1 returns a
  // more recent version of the appointment than page 0, the page-1 state
  // is what ends up in the local shadow. That matches our "Tekmetric is
  // source of truth" model.
  //
  // seenIds (separate Set) still records every non-deleted id we saw —
  // used below by the "missing from window" detector for hard-delete
  // catching.
  const seenIds = new Set<number>();
  const upsertMap = new Map<number, Record<string, unknown>>();
  for (const a of items) {
    if (a.deletedDate) continue;
    seenIds.add(a.id);
    upsertMap.set(a.id, {
      shop_id: SHOP_ID,
      tekmetric_appointment_id: a.id,
      customer_id: a.customerId ?? null,
      vehicle_id: a.vehicleId ?? null,
      start_time: a.startTime,
      end_time: a.endTime,
      // Phase 9d 2026-05-16: color-derived classifier replaces the prior
      // appointmentOption.code + UTC-hour heuristic. See classifyAppointmentType
      // above for the full color-to-type mapping.
      appointment_type: classifyAppointmentType(a.color ?? null),
      // Phase 9d 2026-05-16: appointmentStatus is a BARE STRING on the
      // Tekmetric side ("NONE" | "CANCELED" | "ARRIVED" | "NO_SHOW"), not
      // a { id, name, code } object. The prior `?.code` read returned
      // undefined for every row and defaulted to "NONE" — every appointment
      // in the shadow had appointment_status = "NONE" until this fix.
      appointment_status: typeof a.appointmentStatus === "string"
        ? a.appointmentStatus
        : "NONE",
      title: a.title ?? null,
      description: a.description ?? null,
      appointment_option: a.appointmentOption?.code ?? null,
      ride_option: a.rideOption?.code ?? null,
      color: a.color ?? null,
      // Phase 9d 2026-05-16: previously-discarded Tekmetric fields.
      arrived: typeof a.arrived === "boolean" ? a.arrived : null,
      lead_source: a.leadSource ?? null,
      pickup_time: a.pickupTime ?? null,
      dropoff_time: a.dropoffTime ?? null,
      created_date: a.createdDate ?? null,
      updated_date: a.updatedDate ?? null,
      confirmation_status: a.confirmationStatus ?? null,
      // Verbatim Tekmetric payload — defense against future field
      // additions. Caller does not need to read this for routine queries;
      // it's a safety net for shape drift.
      raw_payload: a as Record<string, unknown>,
      parse_version: 2, // bumped from 1 = pre-Phase-9d shape
      source: "tekmetric",
      tekmetric_synced_at: new Date().toISOString(),
      deleted_at: null,
      updated_at: new Date().toISOString(),
    });
  }
  const upsertRows = Array.from(upsertMap.values());

  // Tekmetric-deleted rows (came back with deletedDate set). Dedupe by
  // id for the same pagination-overlap reason — the .in() filter would
  // tolerate duplicates, but we keep the count accurate.
  const deletedIds = Array.from(
    new Set(
      items.filter((a) => a.deletedDate).map((a) => a.id),
    ),
  );

  let upsertedCount = 0;
  if (upsertRows.length > 0) {
    const { error: upsertErr, count } = await sb
      .from("appointments")
      .upsert(upsertRows, {
        onConflict: "shop_id,tekmetric_appointment_id",
        count: "exact",
      });
    if (upsertErr) {
      return {
        ok: false,
        upserted: 0,
        soft_deleted: 0,
        pruned: 0,
        window_start: startIso,
        window_end: endIso,
        pages_fetched: pages,
        error: `appointments_upsert_failed: ${upsertErr.message}`,
      };
    }
    upsertedCount = count ?? upsertRows.length;
  }

  // Soft-delete (1) any explicitly deleted-in-Tekmetric rows AND (2) any local
  // shadow rows in the window that no longer come back from Tekmetric.
  let softDeletedCount = 0;
  if (deletedIds.length > 0) {
    const { error, count } = await sb
      .from("appointments")
      .update({
        deleted_at: new Date().toISOString(),
        tekmetric_synced_at: new Date().toISOString(),
      })
      .eq("shop_id", SHOP_ID)
      .in("tekmetric_appointment_id", deletedIds)
      .is("deleted_at", null);
    if (!error) softDeletedCount += count ?? deletedIds.length;
  }

  // Detect "missing from window" rows (in shadow but not in Tekmetric pull).
  // This catches HARD deletes that we'd otherwise miss.
  const { data: shadowInWindow } = await sb
    .from("appointments")
    .select("tekmetric_appointment_id")
    .eq("shop_id", SHOP_ID)
    .gte("start_time", startIso)
    .lt("start_time", endIso)
    .is("deleted_at", null)
    // Only consider tekmetric-sourced or scheduler-app-sourced (we own both)
    .in("source", ["tekmetric", "scheduler-app"]);
  const missing = (shadowInWindow ?? [])
    .map((r) => r.tekmetric_appointment_id as number)
    .filter((id) => !seenIds.has(id));
  if (missing.length > 0) {
    const { count } = await sb
      .from("appointments")
      .update({
        deleted_at: new Date().toISOString(),
        tekmetric_synced_at: new Date().toISOString(),
      })
      .eq("shop_id", SHOP_ID)
      .in("tekmetric_appointment_id", missing);
    softDeletedCount += count ?? missing.length;
  }

  // Prune rows older than now - 1 day (rolling 7-day window cleanup)
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { count: prunedCount } = await sb
    .from("appointments")
    .delete()
    .eq("shop_id", SHOP_ID)
    .lt("start_time", cutoff);

  // Update sync state
  await sb
    .from("appointment_sync_state")
    .update({
      last_delta_sync_at: new Date().toISOString(),
      last_delta_sync_count: upsertedCount,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", SHOP_ID);

  return {
    ok: true,
    upserted: upsertedCount,
    soft_deleted: softDeletedCount,
    pruned: prunedCount ?? 0,
    window_start: startIso,
    window_end: endIso,
    pages_fetched: pages,
  };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }
  const auth = checkSchedulerBearer(req, "appointments-sync");
  if (!auth.ok) {
    return unauthorizedResponse(auth);
  }

  try {
    const result = await runSync();
    if (!result.ok) {
      return jsonResponse(result, 500);
    }
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "appointments_sync_unhandled",
        detail: msg,
      }),
    );
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
