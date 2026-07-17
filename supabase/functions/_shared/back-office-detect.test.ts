// Deno unit tests for the pure back-office detection helpers.
// Run: deno test supabase/functions/_shared/back-office-detect.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyChangeType,
  toShopLocalDate,
  parseUnpostedBy,
  buildReopenedCycle,
  type SaleEvent,
} from "./back-office-detect.ts";

Deno.test("classifyChangeType: not reposted → unposted", () => {
  assertEquals(
    classifyChangeType({ hasRepost: false, originalDate: "2026-07-11", newDate: null, originalCents: 100, newCents: null }),
    "unposted",
  );
});

Deno.test("classifyChangeType: reposted same date+total → reposted", () => {
  assertEquals(
    classifyChangeType({ hasRepost: true, originalDate: "2026-07-11", newDate: "2026-07-11", originalCents: 100, newCents: 100 }),
    "reposted",
  );
});

Deno.test("classifyChangeType: date only / total only / both", () => {
  assertEquals(
    classifyChangeType({ hasRepost: true, originalDate: "2026-07-11", newDate: "2026-07-14", originalCents: 100, newCents: 100 }),
    "date_changed",
  );
  assertEquals(
    classifyChangeType({ hasRepost: true, originalDate: "2026-07-11", newDate: "2026-07-11", originalCents: 100, newCents: 250 }),
    "total_changed",
  );
  assertEquals(
    classifyChangeType({ hasRepost: true, originalDate: "2026-07-11", newDate: "2026-07-14", originalCents: 100, newCents: 250 }),
    "date_and_total_changed",
  );
});

Deno.test("toShopLocalDate: converts a late-UTC instant to the prior Eastern day", () => {
  // 2026-07-17T02:30:00Z is still 2026-07-16 in America/New_York (22:30 EDT).
  assertEquals(toShopLocalDate("2026-07-17T02:30:00Z", "America/New_York"), "2026-07-16");
  assertEquals(toShopLocalDate(null, "America/New_York"), null);
});

Deno.test("parseUnpostedBy: extracts the actor from the event sentence", () => {
  assertEquals(parseUnpostedBy("Repair Order #154224 unposted by zane@jeffsautomotive.com"), "zane@jeffsautomotive.com");
  assertEquals(parseUnpostedBy("nothing here"), null);
  assertEquals(parseUnpostedBy(null), null);
});

function ev(over: Partial<SaleEvent> & { kind: string; receivedAt: string }): SaleEvent {
  return { postedDate: null, totalCents: null, roNumber: "154119", eventText: null, ...over };
}

Deno.test("buildReopenedCycle: unposted-not-reposted", () => {
  const cycle = buildReopenedCycle(
    [
      ev({ kind: "ro_posted", receivedAt: "2026-07-11T15:00:00Z", postedDate: "2026-07-11T15:00:00Z", totalCents: 632593 }),
      ev({ kind: "ro_unposted", receivedAt: "2026-07-16T15:12:00Z", eventText: "Repair Order #154119 unposted by james@jeffsautomotive.com" }),
    ],
    "America/New_York",
  );
  assertEquals(cycle?.change_type, "unposted");
  assertEquals(cycle?.original_total_cents, 632593);
  assertEquals(cycle?.new_total_cents, null);
  assertEquals(cycle?.unposted_by, "james@jeffsautomotive.com");
  assertEquals(cycle?.unposted_at, "2026-07-16T15:12:00Z");
});

Deno.test("buildReopenedCycle: reposted to a different date, same total", () => {
  // postedDate is a full UTC ISO timestamp (18:00Z = 2 PM EDT → that Eastern calendar day).
  const cycle = buildReopenedCycle(
    [
      ev({ kind: "ro_posted", receivedAt: "2026-07-16T14:00:00Z", postedDate: "2026-07-16T18:00:00Z", totalCents: 140771 }),
      ev({ kind: "ro_unposted", receivedAt: "2026-07-16T18:57:00Z", eventText: "unposted by james@jeffsautomotive.com" }),
      ev({ kind: "ro_posted", receivedAt: "2026-07-16T19:10:00Z", postedDate: "2026-07-14T18:00:00Z", totalCents: 140771 }),
    ],
    "America/New_York",
  );
  assertEquals(cycle?.change_type, "date_changed");
  assertEquals(cycle?.original_posted_date, "2026-07-16");
  assertEquals(cycle?.new_posted_date, "2026-07-14");
});

Deno.test("buildReopenedCycle: reposted with a different total (real 154224 case)", () => {
  const cycle = buildReopenedCycle(
    [
      ev({ kind: "ro_posted", receivedAt: "2026-07-16T12:00:00Z", postedDate: "2026-07-16T16:00:00Z", totalCents: 13697, roNumber: "154224" }),
      ev({ kind: "ro_unposted", receivedAt: "2026-07-16T20:55:00Z", roNumber: "154224", eventText: "Repair Order #154224 unposted by zane@jeffsautomotive.com" }),
      ev({ kind: "ro_posted", receivedAt: "2026-07-16T21:05:00Z", postedDate: "2026-07-16T21:05:00Z", totalCents: 10860, roNumber: "154224" }),
    ],
    "America/New_York",
  );
  assertEquals(cycle?.change_type, "total_changed");
  assertEquals(cycle?.original_total_cents, 13697);
  assertEquals(cycle?.new_total_cents, 10860);
  assertEquals(cycle?.ro_number, "154224");
});

Deno.test("buildReopenedCycle: no unpost → null", () => {
  const cycle = buildReopenedCycle(
    [ev({ kind: "ro_posted", receivedAt: "2026-07-11T15:00:00Z", postedDate: "2026-07-11", totalCents: 100 })],
    "America/New_York",
  );
  assertEquals(cycle, null);
});
