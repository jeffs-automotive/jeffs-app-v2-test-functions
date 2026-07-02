// scheduler-appointment-types.ts — shared reader for the DB-driven appointment
// types (sub-feature B of docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md).
//
// Replaces the two hardcoded color→type switch statements (appointments-sync
// classifyAppointmentType + scheduler-slots classifyAppointmentType) with a
// table-driven lookup over public.scheduler_appointment_types, while keeping
// their EXACT current behavior for the seeded vocabulary:
//
//   #D01919 red    → waiter   (requires_time_slot row)
//   #0D4A80 navy   → dropoff
//   #FCB70D yellow → dropoff  (loaner row — dropoff for capacity)
//   #F0572A orange → dropoff  (tow_in row — dropoff for capacity)
//   #1786E8 blue   → dropoff  (needs-ride; STATIC fallback — no table row)
//   #128743 green  → dropoff  (needs-by;  STATIC fallback — no table row)
//   unknown/null   → null     (caller decides: sync → "dropoff", slots → hour heuristic)
//
// EXPAND-phase contract: laneForColor COLLAPSES every type to its capacity
// lane ("waiter" | "dropoff") because the appointment_type CHECK constraints
// on appointments/appointment_holds/customer_chat_sessions still enforce the
// 2-value enum until step B5. Richer slugs become storable after the
// CHECK→trigger swap.
//
// Classifiers read ALL rows (active or not): bookable ⊂ classifiable — the
// inactive loaner/tow_in seeds keep historical yellow/orange appointments
// classifying. On a color conflict the ACTIVE row wins (the partial unique
// index guarantees at most one active row per color).
//
// Fail-safe: loadAppointmentTypes never throws; on a read error it returns
// null and laneForColor(null, ...) serves the STATIC map — identical to the
// pre-table behavior. A table outage can never break sync or booking.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AppointmentTypeRow {
  id: string;
  slug: string;
  label: string;
  card_title: string;
  card_description: string | null;
  emoji: string | null;
  tekmetric_color: string; // color NAME ('red' | 'navy' | 'orange' | 'yellow' | ...)
  requires_time_slot: boolean;
  is_system: boolean;
  active: boolean;
  sort: number;
}

export type CapacityLane = "waiter" | "dropoff";

// Tekmetric stores colors as hex; the table stores the API color NAME (what
// the POST body sends). Mapping per docs/scheduler/appointment-post.md
// (empirically verified 2026-05-16: name sent → hex stored).
export const TEKMETRIC_COLOR_HEX: Record<string, string> = {
  red: "#d01919",
  navy: "#0d4a80",
  yellow: "#fcb70d",
  orange: "#f0572a",
  blue: "#1786e8",
  green: "#128743",
};

// The pre-table classifier behavior, verbatim (appointments-sync/index.ts:158
// + scheduler-slots.ts:221 as of B1). Serves as (a) the types-unavailable
// fallback and (b) the mapping for colors with no table row (blue/green).
const STATIC_LANE_BY_HEX: Record<string, CapacityLane> = {
  "#d01919": "waiter",
  "#0d4a80": "dropoff",
  "#fcb70d": "dropoff",
  "#f0572a": "dropoff",
  "#1786e8": "dropoff",
  "#128743": "dropoff",
};

/**
 * Capacity lane for a Tekmetric hex color. Returns null for unknown/missing
 * colors — the CALLER owns that fallback (sync defaults to "dropoff"; the
 * slots classifier falls to its shop-local-hour heuristic, both unchanged
 * from today).
 */
export function laneForColor(
  types: AppointmentTypeRow[] | null,
  colorHex: string | null | undefined,
): CapacityLane | null {
  const c = (colorHex ?? "").toLowerCase();
  if (!c) return null;
  if (types) {
    let match: AppointmentTypeRow | null = null;
    for (const row of types) {
      if ((TEKMETRIC_COLOR_HEX[row.tekmetric_color] ?? "") !== c) continue;
      if (row.active) { match = row; break; } // active row always wins
      match ??= row;
    }
    if (match) return match.requires_time_slot ? "waiter" : "dropoff";
  }
  return STATIC_LANE_BY_HEX[c] ?? null;
}

/** Active, bookable types in wizard display order (used from B3 on). */
export function activeBookableTypes(types: AppointmentTypeRow[]): AppointmentTypeRow[] {
  return types.filter((t) => t.active).sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug));
}

// ─── cached loader ───────────────────────────────────────────────────────────
// 5-minute TTL module cache (routine-services-cache.ts precedent). Warm edge
// isolates reuse it across requests; the sync cron gets at most one read per
// run per isolate.
const TTL_MS = 5 * 60 * 1000;
let cache: { shopId: number; rows: AppointmentTypeRow[]; at: number } | null = null;

export function _resetAppointmentTypesCacheForTesting(): void {
  cache = null;
}

/**
 * Load ALL type rows for a shop (active + inactive). Never throws: a read
 * error logs + returns null so callers fall back to STATIC behavior.
 */
export async function loadAppointmentTypes(
  sb: SupabaseClient,
  shopId: number,
): Promise<AppointmentTypeRow[] | null> {
  if (cache && cache.shopId === shopId && Date.now() - cache.at < TTL_MS) {
    return cache.rows;
  }
  const { data, error } = await sb
    .from("scheduler_appointment_types")
    .select("id, slug, label, card_title, card_description, emoji, tekmetric_color, requires_time_slot, is_system, active, sort")
    .eq("shop_id", shopId)
    .order("sort", { ascending: true });
  if (error) {
    // Visible, not silent (observability.md) — but NEVER fatal: static fallback.
    console.error(JSON.stringify({
      level: "error", surface: "scheduler-appointment-types",
      msg: "type table read failed — using static fallback", shop_id: shopId, error: error.message,
    }));
    return null;
  }
  const rows = (data ?? []) as AppointmentTypeRow[];
  cache = { shopId, rows, at: Date.now() };
  return rows;
}
