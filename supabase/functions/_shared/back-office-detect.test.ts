// Deno unit tests for the pure back-office detection helpers.
// Run: deno test supabase/functions/_shared/back-office-detect.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  toShopLocalDate,
  parseActor,
  isPosting,
  buildReopenedSaga,
  type SaleEvent,
  type SagaAnchor,
} from "./back-office-detect.ts";

const TZ = "America/New_York";

function ev(over: Partial<SaleEvent> & { kind: string; receivedAt: string }): SaleEvent {
  return { postedDate: null, totalCents: null, roNumber: "154119", eventText: null, ...over };
}
function posted(receivedAt: string, postedDate: string, totalCents: number, ro = "154119"): SaleEvent {
  return ev({ kind: "ro_posted", receivedAt, postedDate, totalCents, roNumber: ro, eventText: `Repair Order #${ro} posted by james@jeffsautomotive.com` });
}
function sentToAr(receivedAt: string, postedDate: string, totalCents: number, ro = "154119"): SaleEvent {
  return ev({ kind: "ro_sent_to_ar", receivedAt, postedDate, totalCents, roNumber: ro, eventText: `Repair Order #${ro} sent to A/R by james@jeffsautomotive.com` });
}
function unposted(receivedAt: string, ro = "154119"): SaleEvent {
  return ev({ kind: "ro_unposted", receivedAt, roNumber: ro, eventText: `Repair Order #${ro} unposted by james@jeffsautomotive.com` });
}
function payment(receivedAt: string, by: string): SaleEvent {
  return ev({ kind: "payment_made", receivedAt, roNumber: null, eventText: `Payment made by ${by}` });
}

// ── helpers ──────────────────────────────────────────────────────────────────

Deno.test("toShopLocalDate: late-UTC instant maps to the prior Eastern day", () => {
  assertEquals(toShopLocalDate("2026-07-17T02:30:00Z", TZ), "2026-07-16"); // 22:30 EDT
  assertEquals(toShopLocalDate(null, TZ), null);
});

Deno.test("parseActor: extracts the trailing actor from every event verb", () => {
  assertEquals(parseActor("Repair Order #154119 posted by james@jeffsautomotive.com"), "james@jeffsautomotive.com");
  assertEquals(parseActor("Repair Order #154119 sent to A/R by zane@jeffsautomotive.com"), "zane@jeffsautomotive.com");
  assertEquals(parseActor("Repair Order #154119 unposted by james@jeffsautomotive.com"), "james@jeffsautomotive.com");
  assertEquals(parseActor("Payment made by Chaim Mishory"), "Chaim Mishory");
  assertEquals(parseActor("nothing here"), null);
  assertEquals(parseActor(null), null);
});

Deno.test("isPosting", () => {
  assertEquals(isPosting("ro_posted"), true);
  assertEquals(isPosting("ro_sent_to_ar"), true);
  assertEquals(isPosting("ro_unposted"), false);
  assertEquals(isPosting("payment_made"), false);
});

// ── the golden case: real RO #154119 ─────────────────────────────────────────

Deno.test("buildReopenedSaga: RO #154119 golden — later day, total −$42.39, 8-event history", () => {
  const lifecycle: SaleEvent[] = [
    sentToAr("2026-07-14T20:59:36Z", "2026-07-14T20:59:36Z", 145010), // baseline, 4:59 PM ET, 7/14
    unposted("2026-07-16T18:51:32Z"),
    sentToAr("2026-07-16T18:52:35Z", "2026-07-14T20:59:36Z", 140771),
    unposted("2026-07-16T18:52:47Z"),
    posted("2026-07-16T18:53:36Z", "2026-07-16T18:53:31Z", 140771),
    unposted("2026-07-16T18:57:12Z"),
    posted("2026-07-16T18:57:16Z", "2026-07-14T18:53:31Z", 140771), // final, 7/14 posted-date
  ];
  const payments = [payment("2026-07-16T18:53:35Z", "Chaim Mishory")];

  const res = buildReopenedSaga(lifecycle, payments, TZ);
  if (res.skip) throw new Error("expected a tracked saga, got skip");
  const s = res.saga;

  assertEquals(s.change_type, "total_changed"); // date nets Jul14→Jul14; total −$42.39
  assertEquals(s.baseline_posted_date, "2026-07-14");
  assertEquals(s.baseline_total_cents, 145010);
  assertEquals(s.final_posted_date, "2026-07-14");
  assertEquals(s.final_total_cents, 140771);
  assertEquals(s.final_at, "2026-07-16T18:57:16Z");
  assertEquals(s.saga_started_at, "2026-07-16T18:51:32Z");
  assertEquals(s.reopened_by, "james@jeffsautomotive.com");
  assertEquals(s.ro_number, "154119");

  assertEquals(s.history.length, 8);
  assertEquals(s.history[0].kind, "ro_sent_to_ar");
  assertEquals(s.history[0].total_cents, 145010);
  assertEquals(s.history[0].posted_date, "2026-07-14");
  // pre-formatted shop-local label (Chris: use local time) — 4:59 PM ET on Jul 14
  assertEquals(s.history[0].at_local, "Jul 14, 2026, 4:59 PM");
  assertEquals(s.history[1].at_local, "Jul 16, 2026, 2:51 PM");
  // payment lands 1s before the 2:53 repost
  assertEquals(s.history[4].kind, "payment_made");
  assertEquals(s.history[4].payer, "Chaim Mishory");
  assertEquals(s.history[5].kind, "ro_posted");
  assertEquals(s.history.map((h) => h.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ── the decision table (§2 of the plan) ──────────────────────────────────────

Deno.test("decision: same-day + total-only change → SKIP (routine same-day edit)", () => {
  const life = [
    posted("2026-07-18T14:00:00Z", "2026-07-18T14:00:00Z", 50000), // 10 AM ET, 7/18
    unposted("2026-07-18T15:00:00Z"),
    posted("2026-07-18T15:05:00Z", "2026-07-18T14:00:00Z", 45000), // same day, coupon
  ];
  assertEquals(buildReopenedSaga(life, [], TZ).skip, true);
});

Deno.test("decision: same-day + genuine date change → date_changed", () => {
  const life = [
    posted("2026-07-18T14:00:00Z", "2026-07-18T14:00:00Z", 50000),
    unposted("2026-07-18T15:00:00Z"),
    posted("2026-07-18T15:05:00Z", "2026-07-17T14:00:00Z", 50000), // reposted to 7/17
  ];
  const res = buildReopenedSaga(life, [], TZ);
  if (res.skip) throw new Error("expected date_changed");
  assertEquals(res.saga.change_type, "date_changed");
});

Deno.test("decision: same-day + date AND total change → date_changed (date is the trigger)", () => {
  const life = [
    posted("2026-07-18T14:00:00Z", "2026-07-18T14:00:00Z", 50000),
    unposted("2026-07-18T15:00:00Z"),
    posted("2026-07-18T15:05:00Z", "2026-07-17T14:00:00Z", 45000),
  ];
  const res = buildReopenedSaga(life, [], TZ);
  if (res.skip) throw new Error("expected date_changed");
  assertEquals(res.saga.change_type, "date_changed");
});

Deno.test("decision: later day + total-only → total_changed", () => {
  const life = [
    posted("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 13697, "154224"),
    unposted("2026-07-16T20:55:00Z", "154224"),
    posted("2026-07-16T21:05:00Z", "2026-07-14T16:00:00Z", 10860, "154224"), // later day, back to 7/14 date
  ];
  const res = buildReopenedSaga(life, [], TZ);
  if (res.skip) throw new Error("expected total_changed");
  assertEquals(res.saga.change_type, "total_changed");
  assertEquals(res.saga.ro_number, "154224");
});

Deno.test("decision: later day + date-only → date_changed", () => {
  const life = [
    posted("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 20000),
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-15T16:00:00Z", 20000), // later day, date moved to 7/15
  ];
  const res = buildReopenedSaga(life, [], TZ);
  if (res.skip) throw new Error("expected date_changed");
  assertEquals(res.saga.change_type, "date_changed");
});

Deno.test("decision: later day + date AND total → date_and_total_changed", () => {
  const life = [
    posted("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 20000),
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-15T16:00:00Z", 18000),
  ];
  const res = buildReopenedSaga(life, [], TZ);
  if (res.skip) throw new Error("expected date_and_total_changed");
  assertEquals(res.saga.change_type, "date_and_total_changed");
});

Deno.test("decision: later day, wrong date then corrected back, total same → SKIP (correction nets out)", () => {
  const life = [
    sentToAr("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 50000),
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-13T16:00:00Z", 50000), // wrong date
    unposted("2026-07-16T16:10:00Z"),
    posted("2026-07-16T16:15:00Z", "2026-07-14T16:00:00Z", 50000), // corrected back to 7/14
  ];
  assertEquals(buildReopenedSaga(life, [], TZ).skip, true);
});

Deno.test("decision: Chris's coupon example — later day, date wrong→corrected, total changed → total_changed", () => {
  const life = [
    sentToAr("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 50000), // baseline
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-13T16:00:00Z", 45000), // coupon + wrong date
    unposted("2026-07-16T16:10:00Z"),
    posted("2026-07-16T16:15:00Z", "2026-07-14T16:00:00Z", 45000), // back to original date, total stays 450
  ];
  const res = buildReopenedSaga(life, [], TZ);
  if (res.skip) throw new Error("expected total_changed");
  assertEquals(res.saga.change_type, "total_changed"); // only the total change survives as the issue
});

// ── guards ───────────────────────────────────────────────────────────────────

Deno.test("guard: currently unposted (not re-closed) → SKIP", () => {
  const life = [
    posted("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 50000),
    unposted("2026-07-16T16:00:00Z"),
  ];
  assertEquals(buildReopenedSaga(life, [], TZ).skip, true);
});

Deno.test("guard: never reopened → SKIP", () => {
  const life = [posted("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 50000)];
  assertEquals(buildReopenedSaga(life, [], TZ).skip, true);
});

Deno.test("guard: no baseline posting before the first unpost → SKIP", () => {
  const life = [
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-15T16:00:00Z", 20000),
  ];
  assertEquals(buildReopenedSaga(life, [], TZ).skip, true);
});

// ── D7: re-baseline after a prior verified issue ─────────────────────────────

Deno.test("anchor: a later reopen re-baselines from the verified state (ignores already-handled deltas)", () => {
  // Original booking $500 on 7/14, first issue took it to $450 (already verified).
  // A NEW reopen on 7/20 takes $450 → $400. Only the NEW $50 drop should be the issue.
  const life = [
    sentToAr("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 50000),
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-14T16:00:00Z", 45000), // verified final ($450)
    unposted("2026-07-20T16:00:00Z"),
    posted("2026-07-20T16:05:00Z", "2026-07-14T16:00:00Z", 40000), // new drop to $400
  ];
  const anchor: SagaAnchor = { at: "2026-07-16T16:05:00Z", posted_date: "2026-07-14", total_cents: 45000 };
  const res = buildReopenedSaga(life, [], TZ, anchor);
  if (res.skip) throw new Error("expected total_changed from the verified baseline");
  assertEquals(res.saga.change_type, "total_changed");
  assertEquals(res.saga.baseline_total_cents, 45000);
  assertEquals(res.saga.final_total_cents, 40000);
  assertEquals(res.saga.saga_started_at, "2026-07-20T16:00:00Z");
  // history starts at the verified anchor posting, not the original 7/14 booking
  assertEquals(res.saga.history[0].at, "2026-07-16T16:05:00Z");
  assertEquals(res.saga.history[0].total_cents, 45000);
});

Deno.test("anchor: no new reopen since the verified state → SKIP", () => {
  const life = [
    sentToAr("2026-07-14T16:00:00Z", "2026-07-14T16:00:00Z", 50000),
    unposted("2026-07-16T16:00:00Z"),
    posted("2026-07-16T16:05:00Z", "2026-07-14T16:00:00Z", 45000),
  ];
  const anchor: SagaAnchor = { at: "2026-07-16T16:05:00Z", posted_date: "2026-07-14", total_cents: 45000 };
  assertEquals(buildReopenedSaga(life, [], TZ, anchor).skip, true);
});
