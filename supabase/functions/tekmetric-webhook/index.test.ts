// Tests for the general-purpose Tekmetric webhook firehose (tekmetric-webhook).
//
// Coverage:
//   1. Valid token + new payload  → 200 + ok:true + logged:true + id
//   2. Valid token + duplicate    → 200 + duplicate:true (no further processing)
//   3. Invalid token              → 401 + supabase NOT called
//   4. Missing ?token=            → 401
//   5. Non-JSON body              → 200 + _parse_error captured in raw_body
//   6. Header + querystring redaction → Authorization/Cookie/Set-Cookie + token stripped
//   7. TEKMETRIC_WEBHOOK_TOKEN unset → 500 Misconfigured
//   8. Non-POST method            → 405
//
// Tests inject a chainable mock Supabase client via the
// `_setSupabaseClientForTesting(client)` seam exported from index.ts. No
// real Supabase connection needed.
//
// Run: deno test --allow-all --no-check supabase/functions/tekmetric-webhook/index.test.ts

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  createMockSupabaseClient,
  setEnv,
  unsetEnv,
} from "../_shared/test-helpers.ts";
import { _setSupabaseClientForTesting, handler } from "./index.ts";

// ─── Shared fixtures ────────────────────────────────────────────────────────

const FAKE_TOKEN = "test-webhook-token-abc123";

/**
 * Build a representative Tekmetric webhook request. Defaults cover the
 * "happy path" — valid token, RO status_updated event, JSON body.
 */
function makeRequest(opts: {
  method?: string;
  token?: string | null;
  body?: unknown | string;
  extraHeaders?: Record<string, string>;
  extraQuery?: Record<string, string>;
} = {}): Request {
  const method = opts.method ?? "POST";
  const params = new URLSearchParams();
  if (opts.token !== null && opts.token !== undefined) {
    params.set("token", opts.token);
  }
  for (const [k, v] of Object.entries(opts.extraQuery ?? {})) {
    params.set(k, v);
  }
  const qs = params.toString();
  const url = `https://example.test/tekmetric-webhook${qs.length ? "?" + qs : ""}`;
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [k, v] of Object.entries(opts.extraHeaders ?? {})) {
    headers.set(k, v);
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(url, init);
}

const SAMPLE_PAYLOAD = {
  event: "Repair Order #152448 status updated by mjacobi@jeffsautomotive.com",
  event_type: "ro.status_updated",
  data: {
    id: 152448,
    shopId: 7476,
    customerId: 1001,
    vehicleId: 2002,
    updatedDate: "2026-05-22T12:00:00Z",
    repairOrderStatus: { id: 2, code: "WIP", name: "Work In Progress" },
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test({
  name: "tekmetric-webhook — happy path: valid token + new payload inserts row + returns 200",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    sb.onTable("tekmetric_webhook_events", {
      data: { id: "row-new-1" },
      error: null,
    });
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: FAKE_TOKEN, body: SAMPLE_PAYLOAD }),
    );

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.logged, true);
    assertEquals(body.id, "row-new-1");
    assertEquals(body.event_kind_inferred, "ro_status_updated");

    // Exactly one supabase from() invocation against the events table
    const tableCalls = sb.callsForTable("tekmetric_webhook_events");
    assertEquals(tableCalls.length, 1);
    const chain = tableCalls[0].chain;
    // Plain INSERT (idempotency is enforced by the partial unique index +
    // 23505 catch — see the duplicate test below for that path).
    const insertCall = chain.find((c) => c.method === "insert");
    assertExists(insertCall);

    // The inserted row carries the correctly inferred event kind +
    // entity IDs derived from the payload's `data` block.
    const insertedRow = insertCall.args[0] as Record<string, unknown>;
    assertEquals(insertedRow.event_kind_inferred, "ro_status_updated");
    assertEquals(insertedRow.event_type, "ro.status_updated");
    assertEquals(insertedRow.tekmetric_ro_id, 152448);
    assertEquals(insertedRow.tekmetric_customer_id, 1001);
    assertEquals(insertedRow.status_id, 2);
  },
});

Deno.test({
  name: "tekmetric-webhook — duplicate payload (23505 unique_violation) returns 200 + duplicate:true",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    // Plain INSERT path: partial unique index on event_hash fires error
    // code 23505 when Tekmetric retries the same event. Handler catches
    // 23505 → 200 ok=true duplicate=true (no further processing).
    sb.onTable("tekmetric_webhook_events", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" } as never,
    });
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: FAKE_TOKEN, body: SAMPLE_PAYLOAD }),
    );

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.logged, true);
    assertEquals(body.duplicate, true);
    assertEquals(body.event_kind_inferred, "ro_status_updated");
    // Verify the early-return semantic: no further work beyond the upsert
    // (which means exactly one from() call — the events table)
    assertEquals(sb.calls.length, 1);
  },
});

Deno.test({
  name: "tekmetric-webhook — invalid token returns 401 + supabase NOT called",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: "wrong-token", body: SAMPLE_PAYLOAD }),
    );

    assertEquals(res.status, 401);
    const body = await res.json();
    assert(String(body.error).toLowerCase().includes("unauthorized"));
    // No supabase work happens on auth failure
    assertEquals(sb.calls.length, 0);
  },
});

Deno.test({
  name: "tekmetric-webhook — missing ?token= query param returns 401",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: null, body: SAMPLE_PAYLOAD }),
    );

    assertEquals(res.status, 401);
    assertEquals(sb.calls.length, 0);
  },
});

Deno.test({
  name: "tekmetric-webhook — non-JSON body still inserts row with _parse_error and returns 200",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    sb.onTable("tekmetric_webhook_events", {
      data: { id: "row-malformed" },
      error: null,
    });
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: FAKE_TOKEN, body: "this is not json" }),
    );

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.logged, true);

    // raw_body should carry _parse_error + raw text excerpt
    const insertCall = sb.callsForTable("tekmetric_webhook_events")[0].chain.find(
      (c) => c.method === "insert",
    );
    assertExists(insertCall);
    const row = insertCall.args[0] as { raw_body: Record<string, unknown> };
    assertExists(row.raw_body._parse_error);
    assertEquals(row.raw_body._raw_text, "this is not json");
  },
});

Deno.test({
  name: "tekmetric-webhook — Authorization/Cookie/Set-Cookie headers stripped + token query param stripped",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    sb.onTable("tekmetric_webhook_events", {
      data: { id: "row-redact" },
      error: null,
    });
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({
        token: FAKE_TOKEN,
        body: SAMPLE_PAYLOAD,
        extraHeaders: {
          Authorization: "Bearer should-not-land-in-DB",
          Cookie: "session=should-not-land-in-DB",
          "Set-Cookie": "tracking=should-not-land-in-DB",
          "X-Tekmetric-Delivery": "delivery-12345",
        },
        extraQuery: { foo: "bar", trace: "abc" },
      }),
    );
    assertEquals(res.status, 200);

    const insertCall = sb.callsForTable("tekmetric_webhook_events")[0].chain.find(
      (c) => c.method === "insert",
    );
    assertExists(insertCall);
    const row = insertCall.args[0] as {
      raw_headers: Record<string, string>;
      raw_query_string: string | null;
    };

    // Sensitive headers absent
    const lowered = Object.keys(row.raw_headers).map((k) => k.toLowerCase());
    assert(!lowered.includes("authorization"), "authorization leaked");
    assert(!lowered.includes("cookie"), "cookie leaked");
    assert(!lowered.includes("set-cookie"), "set-cookie leaked");
    // Non-sensitive headers preserved (case-insensitive presence check
    // since `new Headers()` normalises to lowercase)
    assert(
      lowered.includes("x-tekmetric-delivery"),
      "non-sensitive header should pass through",
    );

    // token query param stripped, other params preserved
    assertExists(row.raw_query_string);
    assert(!row.raw_query_string.includes("token=") || !row.raw_query_string.includes(FAKE_TOKEN));
    assert(row.raw_query_string.includes("foo=bar"));
    assert(row.raw_query_string.includes("trace=abc"));
  },
});

Deno.test({
  name: "tekmetric-webhook — TEKMETRIC_WEBHOOK_TOKEN env unset returns 500 Misconfigured",
  fn: async () => {
    unsetEnv("TEKMETRIC_WEBHOOK_TOKEN");
    const sb = createMockSupabaseClient();
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: "anything", body: SAMPLE_PAYLOAD }),
    );

    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Misconfigured");
    assertEquals(sb.calls.length, 0);
  },
});

Deno.test({
  name: "tekmetric-webhook — non-POST method returns 405",
  fn: async () => {
    setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
    const sb = createMockSupabaseClient();
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ method: "GET", token: FAKE_TOKEN }),
    );

    assertEquals(res.status, 405);
    const body = await res.json();
    assertEquals(body.error, "Use POST");
    assertEquals(sb.calls.length, 0);
  },
});
