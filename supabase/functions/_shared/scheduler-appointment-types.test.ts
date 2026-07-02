// Tests for the shared appointment-types reader (sub-feature B2).
//
// The load-bearing property: laneForColor reproduces the two retired switch
// statements EXACTLY for the full known vocabulary, with and without table
// rows, so swapping the classifiers is a zero-behavior-change refactor.
//
// Run: deno test --allow-all --no-check supabase/functions/_shared/scheduler-appointment-types.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createMockSupabaseClient } from "./test-helpers.ts";
import {
  _resetAppointmentTypesCacheForTesting,
  activeBookableTypes,
  type AppointmentTypeRow,
  laneForColor,
  loadAppointmentTypes,
} from "./scheduler-appointment-types.ts";

const row = (over: Partial<AppointmentTypeRow>): AppointmentTypeRow => ({
  id: crypto.randomUUID(),
  slug: "x",
  label: "X",
  card_title: "X",
  card_description: null,
  emoji: null,
  tekmetric_color: "navy",
  requires_time_slot: false,
  is_system: false,
  active: true,
  sort: 0,
  ...over,
});

// The B1 seed set (shape as loaded from the table).
const SEEDS: AppointmentTypeRow[] = [
  row({ slug: "waiter", tekmetric_color: "red", requires_time_slot: true, is_system: true, sort: 10 }),
  row({ slug: "dropoff", tekmetric_color: "navy", is_system: true, sort: 20 }),
  row({ slug: "loaner", tekmetric_color: "yellow", active: false, sort: 30 }),
  row({ slug: "tow_in", tekmetric_color: "orange", active: false, sort: 40 }),
];

Deno.test("laneForColor with seeds === the retired switch statements, byte for byte", () => {
  // table-backed vocabulary
  assertEquals(laneForColor(SEEDS, "#D01919"), "waiter");   // red (case-insensitive)
  assertEquals(laneForColor(SEEDS, "#0d4a80"), "dropoff");  // navy
  assertEquals(laneForColor(SEEDS, "#fcb70d"), "dropoff");  // yellow loaner — dropoff for capacity
  assertEquals(laneForColor(SEEDS, "#f0572a"), "dropoff");  // orange tow-in
  // static-only vocabulary (no table rows)
  assertEquals(laneForColor(SEEDS, "#1786e8"), "dropoff");  // blue needs-ride
  assertEquals(laneForColor(SEEDS, "#128743"), "dropoff");  // green needs-by
  // unknown/missing → null (sync coalesces to dropoff; slots uses hour heuristic)
  assertEquals(laneForColor(SEEDS, "#abcdef"), null);
  assertEquals(laneForColor(SEEDS, null), null);
  assertEquals(laneForColor(SEEDS, undefined), null);
  assertEquals(laneForColor(SEEDS, ""), null);
});

Deno.test("laneForColor with types=null (table outage) === static fallback", () => {
  assertEquals(laneForColor(null, "#d01919"), "waiter");
  assertEquals(laneForColor(null, "#fcb70d"), "dropoff");
  assertEquals(laneForColor(null, "#ffffff"), null);
});

Deno.test("a future time-slotted table row drives the waiter lane (table wins over static)", () => {
  // hypothetical: shop makes orange a waitable type post-B5 — the table row
  // must override the static dropoff mapping.
  const types = [row({ slug: "express", tekmetric_color: "orange", requires_time_slot: true, is_system: true })];
  assertEquals(laneForColor(types, "#f0572a"), "waiter");
});

Deno.test("active row wins a color conflict with an inactive row", () => {
  const types = [
    row({ slug: "old_loaner", tekmetric_color: "yellow", active: false, requires_time_slot: false }),
    row({ slug: "new_waitable", tekmetric_color: "yellow", active: true, requires_time_slot: true, is_system: true }),
  ];
  assertEquals(laneForColor(types, "#fcb70d"), "waiter");
});

Deno.test("activeBookableTypes filters inactive + sorts", () => {
  const out = activeBookableTypes(SEEDS);
  assertEquals(out.map((t) => t.slug), ["waiter", "dropoff"]);
});

Deno.test("loadAppointmentTypes: rows on success (cached), null on error (fail-safe)", async () => {
  _resetAppointmentTypesCacheForTesting();
  const sb = createMockSupabaseClient();
  sb.onTable("scheduler_appointment_types", { data: SEEDS, error: null });
  // deno-lint-ignore no-explicit-any
  const first = await loadAppointmentTypes(sb as any, 7476);
  assert(first && first.length === 4);
  // second call served from cache — no new from() recorded
  const callsAfterFirst = sb.callsForTable("scheduler_appointment_types").length;
  // deno-lint-ignore no-explicit-any
  await loadAppointmentTypes(sb as any, 7476);
  assertEquals(sb.callsForTable("scheduler_appointment_types").length, callsAfterFirst);

  _resetAppointmentTypesCacheForTesting();
  const sbErr = createMockSupabaseClient();
  sbErr.onTable("scheduler_appointment_types", { data: null, error: { message: "boom" } });
  // deno-lint-ignore no-explicit-any
  assertEquals(await loadAppointmentTypes(sbErr as any, 7476), null);
  _resetAppointmentTypesCacheForTesting();
});
