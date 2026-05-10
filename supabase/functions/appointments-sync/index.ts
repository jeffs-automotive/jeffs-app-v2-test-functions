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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
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

function checkAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  return auth.slice("bearer ".length).trim() === SERVICE_ROLE_KEY;
}

// ─── Tekmetric appointment shape (pull) ──────────────────────────────────────

interface TekmetricAppointment {
  id: number;
  shopId: number;
  customerId: number | null;
  vehicleId: number | null;
  startTime: string;
  endTime: string;
  description: string | null;
  title?: string | null;
  appointmentStatus: { id: number; name: string; code: string };
  appointmentOption?: { id: number; name: string; code: string } | null;
  rideOption?: { id: number; name: string; code: string } | null;
  color?: string | null;
  deletedDate?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyAppointmentType(
  startTime: string,
  appointmentOptionCode?: string | null,
): "waiter" | "dropoff" {
  // Trust appointmentOption.code if present (most authoritative)
  if (appointmentOptionCode === "WAITER") return "waiter";
  if (
    appointmentOptionCode === "PICKUP_DROPOFF" ||
    appointmentOptionCode === "TOWED" ||
    appointmentOptionCode === "NONE"
  ) {
    return "dropoff";
  }
  // Fallback to time heuristic — EDT 8 AM = UTC 12; EDT 9 AM = UTC 13
  const hour = new Date(startTime).getUTCHours();
  if (hour === 12 || hour === 13) return "waiter";
  return "dropoff";
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

  // Build the upsert payload
  const seenIds = new Set<number>();
  const upsertRows = items
    .filter((a) => !a.deletedDate)
    .map((a) => {
      seenIds.add(a.id);
      return {
        shop_id: SHOP_ID,
        tekmetric_appointment_id: a.id,
        customer_id: a.customerId ?? null,
        vehicle_id: a.vehicleId ?? null,
        start_time: a.startTime,
        end_time: a.endTime,
        appointment_type: classifyAppointmentType(
          a.startTime,
          a.appointmentOption?.code ?? null,
        ),
        appointment_status: a.appointmentStatus?.code ?? "NONE",
        title: a.title ?? null,
        description: a.description ?? null,
        appointment_option: a.appointmentOption?.code ?? null,
        ride_option: a.rideOption?.code ?? null,
        color: a.color ?? null,
        source: "tekmetric",
        tekmetric_synced_at: new Date().toISOString(),
        deleted_at: null,
        updated_at: new Date().toISOString(),
      };
    });

  // Tekmetric-deleted rows (came back with deletedDate set)
  const deletedFromTekmetric = items.filter((a) => a.deletedDate);

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
  if (deletedFromTekmetric.length > 0) {
    const ids = deletedFromTekmetric.map((a) => a.id);
    const { error, count } = await sb
      .from("appointments")
      .update({
        deleted_at: new Date().toISOString(),
        tekmetric_synced_at: new Date().toISOString(),
      })
      .eq("shop_id", SHOP_ID)
      .in("tekmetric_appointment_id", ids)
      .is("deleted_at", null);
    if (!error) softDeletedCount += count ?? ids.length;
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
  if (!checkAuth(req)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
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
