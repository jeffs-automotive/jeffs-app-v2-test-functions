// Tests for the QTekLink Tekmetric intake receiver (qteklink-webhook).
//
// Coverage:
//   - classifyEvent / extractEvent (pure)
//   - happy path: RO + payment events store + return 200 stored:true with the
//     right shop_id/realm_id/source_id/payment_id/ro_id/event_time_raw
//   - duplicate (23505) → 200 duplicate:true
//   - STORE FAILURE (non-23505) → 503 (the durable-before-200 contract; NOT a
//     silent 200) — and realm-resolve error → 503
//   - un-onboarded shop (null realm) → 200 stored:false, NO insert
//   - no data.shopId → 200 stored:false, NO rpc/insert
//   - invalid/missing token → 401; missing secret → 500; non-POST → 405
//   - PII/secret redaction (Authorization/Cookie + ?token=)
//
// Run: deno test --allow-all --no-check supabase/functions/qteklink-webhook/index.test.ts

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import { createMockSupabaseClient, setEnv, unsetEnv } from "../_shared/test-helpers.ts";
import {
  _setSupabaseClientForTesting,
  classifyEvent,
  extractEvent,
  handler,
} from "./index.ts";

const FAKE_TOKEN = "qtl-test-token-abc123";
const REALM = "9341455608740708";

function makeRequest(opts: {
  method?: string;
  token?: string | null;
  body?: unknown | string;
  extraHeaders?: Record<string, string>;
  extraQuery?: Record<string, string>;
} = {}): Request {
  const method = opts.method ?? "POST";
  const params = new URLSearchParams();
  if (opts.token !== null && opts.token !== undefined) params.set("token", opts.token);
  for (const [k, v] of Object.entries(opts.extraQuery ?? {})) params.set(k, v);
  const qs = params.toString();
  const url = `https://example.test/qteklink-webhook${qs.length ? "?" + qs : ""}`;
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [k, v] of Object.entries(opts.extraHeaders ?? {})) headers.set(k, v);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(url, init);
}

const RO_PAYLOAD = {
  event: "Repair Order #151522 status updated by mjacobi@jeffsautomotive.com",
  data: { id: 318590708, shopId: 7476, updatedDate: "2026-05-09T18:54:40Z", repairOrderStatus: { id: 2 } },
};
const PAYMENT_PAYLOAD = {
  event: "Payment made by Scott Werley",
  data: {
    id: 57840743, shopId: 7476, repairOrderId: 318590708, payerName: "Scott Werley",
    paymentDate: "2026-05-09T18:54:38", paymentType: { code: "CC", name: "Credit Card" },
    applicationFee: 1375, voided: false, refund: false,
  },
};

function sbWith(opts: { realm?: unknown; realmErr?: { message: string } | null; insert?: SupabaseRes }): ReturnType<typeof createMockSupabaseClient> {
  const sb = createMockSupabaseClient();
  sb.onRpc("qbo_resolve_realm_for_shop", { data: opts.realm === undefined ? REALM : opts.realm, error: opts.realmErr ?? null });
  sb.onTable("qteklink_events", opts.insert ?? { data: { id: "evt-1" }, error: null });
  return sb;
}
type SupabaseRes = { data: unknown; error: { code?: string; message: string } | null };

// ─── pure units ───────────────────────────────────────────────────────────
Deno.test("classifyEvent buckets RO + payment, else unknown", () => {
  assertEquals(classifyEvent("Repair Order #1 status updated by x"), "ro_status_updated");
  assertEquals(classifyEvent("Repair Order #1 posted by x"), "ro_posted");
  assertEquals(classifyEvent("Repair Order #1 sent to A/R by x"), "ro_sent_to_ar");
  assertEquals(classifyEvent("Payment made by x"), "payment_made");
  assertEquals(classifyEvent("Refund issued"), "unknown");
  assertEquals(classifyEvent(null), "unknown");
});

Deno.test("classifyEvent: the real registered texts — UNPOSTED never false-matches POSTED; void/refund variants land unknown", () => {
  // The load-bearing disambiguation: after `#\d+` the posted regex requires " posted",
  // and the unposted text has " unposted" there — no backtracking path can cross them.
  assertEquals(classifyEvent("Repair Order #152419 unposted by james@jeffsautomotive.com"), "ro_unposted");
  assertEquals(classifyEvent("Repair Order #152419 posted by james@jeffsautomotive.com"), "ro_posted");
  // The real payment-family variant texts (map doc 01–04) — all unknown by design;
  // extractEvent's payment-shape detection carries them to the reducer.
  assertEquals(classifyEvent("Payment voided for Bill Hickman"), "unknown");
  assertEquals(classifyEvent("Refund issued to Yotzael Cerezo"), "unknown");
  assertEquals(classifyEvent("Payment refunded"), "unknown");
});

Deno.test("extractEvent: RO event → data.id is the RO id", () => {
  const ev = extractEvent(RO_PAYLOAD.data, "ro_status_updated");
  assertEquals(ev.shopId, 7476);
  assertEquals(ev.sourceId, "318590708");
  assertEquals(ev.tekmetricRoId, 318590708);
  assertEquals(ev.paymentId, null);
  assertEquals(ev.eventTimeRaw, "2026-05-09T18:54:40Z");
});

Deno.test("extractEvent: payment event → data.id is the payment id, repairOrderId is the RO", () => {
  const ev = extractEvent(PAYMENT_PAYLOAD.data, "payment_made");
  assertEquals(ev.shopId, 7476);
  assertEquals(ev.sourceId, "57840743");
  assertEquals(ev.paymentId, 57840743);
  assertEquals(ev.tekmetricRoId, 318590708);
  assertEquals(ev.eventTimeRaw, "2026-05-09T18:54:38");
  // tz-less Tekmetric timestamp is parsed as UTC (not the runtime's local tz)
  assertEquals(ev.tekmetricEventAt, "2026-05-09T18:54:38.000Z");
});

Deno.test("extractEvent: an unknown-kind VOID with the payment shape still extracts payment_id (reducer-visible)", () => {
  const ev = extractEvent(
    { id: 58000001, shopId: 7476, repairOrderId: 318590708, payerName: "Bill Hickman", paymentDate: "2026-06-08T15:00:00", voided: true, refund: false },
    "unknown",
  );
  assertEquals(ev.paymentId, 58000001);
  assertEquals(ev.tekmetricRoId, 318590708);
  assertEquals(ev.eventTimeRaw, "2026-06-08T15:00:00");
});

Deno.test("extractEvent: an A/R void/refund WITHOUT repairOrderId is STILL payment-family (the flags alone qualify)", () => {
  // arPayment voids/refunds can omit repairOrderId — requiring it stored the row with
  // payment_id NULL, invisible to the reducer's `payment_id IS NOT NULL` scan.
  const voided = extractEvent(
    { id: 58000002, shopId: 7476, payerName: "x", paymentDate: "2026-06-08T16:00:00", arPayment: true, voided: true, refund: false },
    "unknown",
  );
  assertEquals(voided.paymentId, 58000002);
  assertEquals(voided.tekmetricRoId, null);
  assertEquals(voided.eventTimeRaw, "2026-06-08T16:00:00");

  const refunded = extractEvent(
    { id: 58000003, shopId: 7476, paymentDate: "2026-06-08T17:00:00", arPayment: true, refund: true, voided: false },
    "unknown",
  );
  assertEquals(refunded.paymentId, 58000003);
  assertEquals(refunded.tekmetricRoId, null);
});

// ─── handler ──────────────────────────────────────────────────────────────
Deno.test("happy path — payment event stores with resolved realm + returns 200", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);

  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: PAYMENT_PAYLOAD }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json, { ok: true, stored: true, id: "evt-1", event_kind: "payment_made" });

  assertEquals(sb.callsForRpc("qbo_resolve_realm_for_shop")[0].rpcArgs, { p_shop_id: 7476 });
  const insert = sb.callsForTable("qteklink_events")[0].chain.find((c) => c.method === "insert");
  assertExists(insert);
  const row = insert.args[0] as Record<string, unknown>;
  assertEquals(row.shop_id, 7476);
  assertEquals(row.realm_id, REALM);
  assertEquals(row.event_kind, "payment_made");
  assertEquals(row.source_id, "57840743");
  assertEquals(row.payment_id, 57840743);
  assertEquals(row.tekmetric_ro_id, 318590708);
  assertEquals(row.event_time_raw, "2026-05-09T18:54:38");
});

Deno.test("happy path — an ro_posted event stores with the RO id + postedDate", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({
    token: FAKE_TOKEN,
    body: { event: "Repair Order #152419 posted by zane@jeffsautomotive.com", data: { id: 330000001, shopId: 7476, postedDate: "2026-06-09T20:11:00Z", totalSales: 12345 } },
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).event_kind, "ro_posted");
  const insert = sb.callsForTable("qteklink_events")[0].chain.find((c) => c.method === "insert");
  assertExists(insert);
  const row = insert.args[0] as Record<string, unknown>;
  assertEquals(row.event_kind, "ro_posted");
  assertEquals(row.tekmetric_ro_id, 330000001);
  assertEquals(row.payment_id, null);
  assertEquals(row.event_time_raw, "2026-06-09T20:11:00Z");
});

Deno.test("malformed JSON still stores durably (parse-error envelope, bounded raw text)", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: "{not json" }));
  // No shopId is derivable from a broken body → acknowledged, not stored (visible via Sentry).
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.stored, false);
  assertEquals(json.reason, "no_shop_id");
});

Deno.test("numeric-string data.shopId is accepted (coerced) + stores", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);
  // shopId serialized as a string "7476" (some APIs do this for large ids)
  const res = await handler(makeRequest({
    token: FAKE_TOKEN,
    body: { event: "Payment made by x", data: { id: 57840743, shopId: "7476", repairOrderId: 318590708, paymentDate: "2026-05-09T18:54:38" } },
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).stored, true);
  assertEquals(sb.callsForRpc("qbo_resolve_realm_for_shop")[0].rpcArgs, { p_shop_id: 7476 });
});

Deno.test("duplicate (23505) → 200 duplicate:true", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  _setSupabaseClientForTesting(sbWith({ insert: { data: null, error: { code: "23505", message: "dup" } } }));
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: PAYMENT_PAYLOAD }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.duplicate, true);
  assertEquals(json.stored, false);
});

Deno.test("STORE FAILURE (non-23505) → 503, NOT a silent 200", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  _setSupabaseClientForTesting(sbWith({ insert: { data: null, error: { code: "57014", message: "canceled" } } }));
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: PAYMENT_PAYLOAD }));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).stored, false);
});

Deno.test("realm-resolve error → 503", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({ realmErr: { message: "db down" } });
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: PAYMENT_PAYLOAD }));
  assertEquals(res.status, 503);
  // never attempted the insert
  assertEquals(sb.callsForTable("qteklink_events").length, 0);
});

Deno.test("un-onboarded shop (null realm) → 200 stored:false, NO insert", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({ realm: null });
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: PAYMENT_PAYLOAD }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.stored, false);
  assertEquals(json.reason, "shop_not_onboarded");
  assertEquals(sb.callsForTable("qteklink_events").length, 0);
});

Deno.test("no data.shopId → 200 stored:false, NO rpc/insert", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: { event: "Payment made by x", data: { id: 1, repairOrderId: 2, paymentDate: "2026-01-01T00:00:00" } } }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reason, "no_shop_id");
  assertEquals(sb.calls.length, 0);
});

Deno.test("invalid token → 401, no supabase calls", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: "wrong", body: PAYMENT_PAYLOAD }));
  assertEquals(res.status, 401);
  assertEquals(sb.calls.length, 0);
});

Deno.test("missing token → 401", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  _setSupabaseClientForTesting(sbWith({}));
  assertEquals((await handler(makeRequest({ token: null, body: PAYMENT_PAYLOAD }))).status, 401);
});

Deno.test("missing secret → 500", async () => {
  unsetEnv("TEKMETRIC_WEBHOOK_TOKEN");
  _setSupabaseClientForTesting(sbWith({}));
  assertEquals((await handler(makeRequest({ token: "anything", body: PAYMENT_PAYLOAD }))).status, 500);
});

Deno.test("non-POST → 405", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  _setSupabaseClientForTesting(sbWith({}));
  assertEquals((await handler(makeRequest({ method: "GET", token: FAKE_TOKEN }))).status, 405);
});

Deno.test("redaction — Authorization/Cookie stripped + ?token= stripped", async () => {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({});
  _setSupabaseClientForTesting(sb);
  await handler(makeRequest({
    token: FAKE_TOKEN, body: RO_PAYLOAD,
    extraHeaders: { Authorization: "Bearer leak", Cookie: "s=leak", "X-Delivery": "d-1" },
    extraQuery: { trace: "abc" },
  }));
  const insert = sb.callsForTable("qteklink_events")[0].chain.find((c) => c.method === "insert")!;
  const row = insert.args[0] as { raw_headers: Record<string, string>; raw_query_string: string };
  const lowered = Object.keys(row.raw_headers).map((k) => k.toLowerCase());
  assert(!lowered.includes("authorization") && !lowered.includes("cookie"), "sensitive header leaked");
  assert(lowered.includes("x-delivery"), "non-sensitive header dropped");
  assert(!row.raw_query_string.includes(FAKE_TOKEN), "token leaked into query string");
  assert(row.raw_query_string.includes("trace=abc"));
});
