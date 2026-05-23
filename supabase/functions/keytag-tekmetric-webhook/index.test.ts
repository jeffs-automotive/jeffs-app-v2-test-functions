// Tests for the keytag-flow-aware Tekmetric webhook receiver.
//
// Coverage (10 tests):
//   1. Valid token + new ro.work_approved event → upsert + assign_next_keytag RPC + Tekmetric PATCH
//   2. Same event repeated (event_hash collision) → duplicate:true, NO downstream dispatch
//   3. ro.status_updated with no existing tag → drift-prevention skip (NEVER auto-assigns)
//   4. ro.sent_to_ar with existing tag → mark_keytag_posted RPC
//   5. ro.posted (statusId=POSTED_PAID) → release_keytag_for_ro RPC
//   6. payment_made (qualified, RO POSTED_PAID) → release_keytag_for_ro RPC
//   7. Invalid token → 401 + no downstream
//   8. Tekmetric PATCH downstream failure → DB log written + manual review (PAF) issued
//
// Plus:
//   9. Self-authored event (trailing " by " with empty actor) → skipped_self_authored
//  10. TEKMETRIC_WEBHOOK_TOKEN env unset → 500 Misconfigured
//
// Tests inject a chainable mock Supabase client via the
// `_setSupabaseClientForTesting(client)` seam exported from index.ts and
// stub `fetch` per-test for Tekmetric API interactions.
//
// Run: deno test --allow-all --no-check supabase/functions/keytag-tekmetric-webhook/index.test.ts

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  createMockSupabaseClient,
  jsonResponse,
  type MockSupabaseClient,
  setEnv,
  unsetEnv,
  withMockedFetch,
} from "../_shared/test-helpers.ts";
import { clearTekmetricTokenCache } from "../_shared/tekmetric-client.ts";
import { _setSupabaseClientForTesting, handler } from "./index.ts";

// ─── Shared fixtures ────────────────────────────────────────────────────────

const FAKE_TOKEN = "test-keytag-webhook-token-xyz";
const FAKE_SHOP_ID = 7476;
const FAKE_TEK_ACCESS_TOKEN = "tek-access-token-abc";

function makeRequest(opts: {
  token?: string | null;
  body?: unknown | string;
  extraHeaders?: Record<string, string>;
} = {}): Request {
  const params = new URLSearchParams();
  if (opts.token !== null && opts.token !== undefined) {
    params.set("token", opts.token);
  }
  const qs = params.toString();
  const url = `https://example.test/keytag-tekmetric-webhook${qs.length ? "?" + qs : ""}`;
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [k, v] of Object.entries(opts.extraHeaders ?? {})) {
    headers.set(k, v);
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {}),
  });
}

/** Webhook payload for "Michael Jacobi approved 1 job(s) and declined 0 job(s) for Repair Order #152448". */
function workApprovedPayload(opts: {
  roId?: number;
  roNumber?: number;
  actor?: string;
  statusId?: number;
} = {}): unknown {
  const roId = opts.roId ?? 152448;
  const roNumber = opts.roNumber ?? 1480;
  const actor = opts.actor ?? "mjacobi@jeffsautomotive.com";
  return {
    event: `${actor} approved 1 job(s) and declined 0 job(s) for Repair Order #${roNumber}`,
    data: {
      id: roId,
      repairOrderNumber: roNumber,
      shopId: FAKE_SHOP_ID,
      customerId: 1001,
      vehicleId: 2002,
      serviceWriterId: 50,
      technicianId: 70,
      updatedDate: "2026-05-22T12:00:00Z",
      repairOrderStatus: { id: opts.statusId ?? 2, code: "WIP", name: "Work In Progress" },
    },
  };
}

function statusUpdatedPayload(opts: { roId?: number; roNumber?: number } = {}): unknown {
  const roId = opts.roId ?? 152449;
  const roNumber = opts.roNumber ?? 1481;
  return {
    event: `Repair Order #${roNumber} status updated by mjacobi@jeffsautomotive.com`,
    data: {
      id: roId,
      repairOrderNumber: roNumber,
      shopId: FAKE_SHOP_ID,
      updatedDate: "2026-05-22T12:00:00Z",
      repairOrderStatus: { id: 2, code: "WIP", name: "Work In Progress" },
    },
  };
}

function sentToArPayload(opts: { roId?: number; roNumber?: number } = {}): unknown {
  const roId = opts.roId ?? 152450;
  const roNumber = opts.roNumber ?? 1482;
  return {
    event: `Repair Order #${roNumber} sent to A/R by chris@jeffsautomotive.com`,
    data: {
      id: roId,
      repairOrderNumber: roNumber,
      shopId: FAKE_SHOP_ID,
      updatedDate: "2026-05-22T13:00:00Z",
      postedDate: "2026-05-22T13:00:00Z",
      repairOrderStatus: { id: 6, code: "POSTED_AR", name: "Posted - A/R" },
    },
  };
}

function postedPaidPayload(opts: { roId?: number; roNumber?: number } = {}): unknown {
  const roId = opts.roId ?? 152451;
  const roNumber = opts.roNumber ?? 1483;
  return {
    event: `Repair Order #${roNumber} posted by chris@jeffsautomotive.com`,
    data: {
      id: roId,
      repairOrderNumber: roNumber,
      shopId: FAKE_SHOP_ID,
      updatedDate: "2026-05-22T14:00:00Z",
      postedDate: "2026-05-22T14:00:00Z",
      repairOrderStatus: { id: 5, code: "POSTED_PAID", name: "Posted - Paid" },
    },
  };
}

function paymentMadePayload(opts: {
  paymentId?: number;
  roId?: number;
  arPayment?: boolean;
  paymentStatus?: string;
} = {}): unknown {
  return {
    event: "Payment made by chris@jeffsautomotive.com",
    data: {
      id: opts.paymentId ?? 9001,
      repairOrderId: opts.roId ?? 152452,
      arPayment: opts.arPayment ?? true,
      paymentStatus: opts.paymentStatus ?? "SUCCEEDED",
      voided: false,
      refund: false,
      updatedDate: "2026-05-22T15:00:00Z",
    },
  };
}

/**
 * Common Supabase mock setup: returns a row id on keytag_webhook_events upsert
 * (i.e. "new event, not a duplicate") and gives sensible defaults for downstream
 * RPC calls. Tests override per-table / per-rpc to deviate.
 */
function freshDb(): MockSupabaseClient {
  const sb = createMockSupabaseClient();
  // Default: every events insert is "fresh"
  sb.onTable("keytag_webhook_events", { data: { id: "event-row-1" }, error: null });
  // Default: no manual review exists
  sb.onTable("keytag_manual_reviews", { data: null, error: null });
  sb.onTable("keytags", { data: null, error: null });
  sb.onTable("keytag_audit_log", { data: null, error: null });
  // Default: Tekmetric access token RPC returns a token
  sb.onRpc("tekmetric_get_secret", { data: FAKE_TEK_ACCESS_TOKEN, error: null });
  return sb;
}

/** Helpers to set up the test env consistently across all tests. */
function resetEnv() {
  setEnv("TEKMETRIC_WEBHOOK_TOKEN", FAKE_TOKEN);
  setEnv("TEKMETRIC_SHOP_ID", String(FAKE_SHOP_ID));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test({
  name: "keytag-tekmetric-webhook — ro_work_approved + no existing tag + WIP status → assigns tag + PATCHes Tekmetric",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    // keytags lookup returns null (no existing tag for this RO)
    sb.onTable("keytags", { data: null, error: null });
    // keytag_audit_log query (for prior history) returns no rows
    sb.onTable("keytag_audit_log", { data: [], error: null });
    // assign_next_keytag returns a fresh Red 7
    sb.onRpc("assign_next_keytag", {
      data: [{ tag_color: "red", tag_number: 7 }],
      error: null,
    });
    // Other RPCs return their default noop
    sb.onRpc("record_keytag_patched", { data: null, error: null });
    sb.onRpc("log_keytag_audit", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    await withMockedFetch(
      (url, init) => {
        // First fetch: GET /repair-orders/:id (defensive verify) → WIP
        if (init?.method === "GET" || !init?.method) {
          return Promise.resolve(jsonResponse({
            id: 152448,
            repairOrderNumber: 1480,
            shopId: FAKE_SHOP_ID,
            customerId: 1001,
            vehicleId: 2002,
            serviceWriterId: 50,
            technicianId: 70,
            updatedDate: "2026-05-22T12:00:00Z",
            repairOrderStatus: { id: 2, code: "WIP", name: "Work In Progress" },
          }));
        }
        // Second fetch: PATCH /repair-orders/:id → success
        return Promise.resolve(jsonResponse({ ok: true }, 200));
      },
      async (scope) => {
        const res = await handler(
          makeRequest({ token: FAKE_TOKEN, body: workApprovedPayload() }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.action, "assigned");
        assertEquals(body.tag_color, "red");
        assertEquals(body.tag_number, 7);

        // assign_next_keytag was called with the right RO context
        const assignCalls = sb.callsForRpc("assign_next_keytag");
        assertEquals(assignCalls.length, 1);
        const assignArgs = assignCalls[0].rpcArgs as Record<string, unknown>;
        assertEquals(assignArgs.p_ro_id, 152448);
        assertEquals(assignArgs.p_ro_number, 1480);

        // Two fetch calls: GET then PATCH
        assertEquals(scope.calls.length, 2);
        assertEquals(scope.calls[1].init?.method, "PATCH");
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — duplicate event (event_hash collision) returns 200 + duplicate:true BEFORE downstream",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    // Critical: events upsert returns null (duplicate) — DB-level dedup caught it
    sb.onTable("keytag_webhook_events", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    await withMockedFetch(
      // Should never be called — assert by counting scope.calls below
      () => Promise.resolve(jsonResponse({ should: "not be reached" })),
      async (scope) => {
        const res = await handler(
          makeRequest({ token: FAKE_TOKEN, body: workApprovedPayload() }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.logged, true);
        assertEquals(body.duplicate, true);
        assertEquals(body.event_kind, "ro_work_approved");

        // No downstream side effects: only the upsert ran
        assertEquals(sb.callsForRpc("assign_next_keytag").length, 0);
        assertEquals(sb.callsForRpc("log_keytag_audit").length, 0);
        assertEquals(scope.calls.length, 0, "fetch must not be called on duplicate");
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — ro_status_updated + no existing tag → drift-prevention skip (no auto-assign)",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    sb.onTable("keytags", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    await withMockedFetch(
      () => Promise.resolve(jsonResponse({ should: "not be reached" })),
      async (scope) => {
        const res = await handler(
          makeRequest({ token: FAKE_TOKEN, body: statusUpdatedPayload() }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.action, "skipped_status_updated_no_existing_tag");

        // No assign + no Tekmetric calls
        assertEquals(sb.callsForRpc("assign_next_keytag").length, 0);
        assertEquals(scope.calls.length, 0);
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — ro_sent_to_ar + existing tag → mark_keytag_posted RPC",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    // Existing tag for this RO
    sb.onTable("keytags", {
      data: { tag_color: "yellow", tag_number: 45, status: "assigned" },
      error: null,
    });
    sb.onRpc("mark_keytag_posted", {
      data: [{ tag_color: "yellow", tag_number: 45 }],
      error: null,
    });
    sb.onRpc("log_keytag_audit", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: FAKE_TOKEN, body: sentToArPayload() }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.action, "posted_marked");
    assertEquals(body.tag_color, "yellow");
    assertEquals(body.tag_number, 45);

    // mark_keytag_posted was called with the webhook's postedDate
    const postedCalls = sb.callsForRpc("mark_keytag_posted");
    assertEquals(postedCalls.length, 1);
    const postedArgs = postedCalls[0].rpcArgs as Record<string, unknown>;
    assertEquals(postedArgs.p_posted_at, "2026-05-22T13:00:00Z");
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — ro_posted statusId=POSTED_PAID → release_keytag_for_ro RPC",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    sb.onRpc("release_keytag_for_ro", {
      data: [{ tag_color: "red", tag_number: 12 }],
      error: null,
    });
    sb.onRpc("log_keytag_audit", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: FAKE_TOKEN, body: postedPaidPayload() }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.action, "released");
    assertEquals(body.tag_color, "red");
    assertEquals(body.tag_number, 12);

    const releaseCalls = sb.callsForRpc("release_keytag_for_ro");
    assertEquals(releaseCalls.length, 1);
    const releaseArgs = releaseCalls[0].rpcArgs as Record<string, unknown>;
    assertEquals(releaseArgs.p_reason, "posted_paid");
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — payment_made (qualified + RO is POSTED_PAID) → release_keytag_for_ro RPC",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    sb.onRpc("release_keytag_for_ro", {
      data: [{ tag_color: "yellow", tag_number: 22 }],
      error: null,
    });
    sb.onRpc("log_keytag_audit", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    await withMockedFetch(
      // GET RO → POSTED_PAID
      () =>
        Promise.resolve(
          jsonResponse({
            id: 152452,
            repairOrderNumber: 1490,
            repairOrderStatus: { id: 5, code: "POSTED_PAID", name: "Posted - Paid" },
          }),
        ),
      async (scope) => {
        const res = await handler(
          makeRequest({ token: FAKE_TOKEN, body: paymentMadePayload() }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, true);
        assertEquals(body.action, "released");
        assertEquals(body.tag_color, "yellow");
        assertEquals(body.tag_number, 22);

        // Defensive GET of the RO happened
        assertEquals(scope.calls.length, 1);
        // release_keytag_for_ro called with payment_webhook reason
        const releaseCalls = sb.callsForRpc("release_keytag_for_ro");
        assertEquals(releaseCalls.length, 1);
        const releaseArgs = releaseCalls[0].rpcArgs as Record<string, unknown>;
        assertEquals(releaseArgs.p_reason, "payment_webhook");
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — invalid token returns 401 + no downstream dispatch",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    _setSupabaseClientForTesting(sb);

    await withMockedFetch(
      () => Promise.resolve(jsonResponse({ should: "not be reached" })),
      async (scope) => {
        const res = await handler(
          makeRequest({ token: "wrong-token", body: workApprovedPayload() }),
        );
        assertEquals(res.status, 401);
        // No supabase work + no fetch
        assertEquals(sb.calls.length, 0);
        assertEquals(scope.calls.length, 0);
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — Tekmetric PATCH failure → DB log row written + manual review (PAF) issued",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    sb.onTable("keytags", { data: null, error: null });
    sb.onTable("keytag_audit_log", { data: [], error: null });
    sb.onRpc("assign_next_keytag", {
      data: [{ tag_color: "red", tag_number: 99 }],
      error: null,
    });
    sb.onRpc("record_keytag_patched", { data: null, error: null });
    // issueManualReview() does:
    //   1. sb.from("keytag_manual_reviews").select(...).eq(category).filter(ro_id).order().limit().maybeSingle()
    //   2. if existing: short-circuit. Else:
    //   3. sb.rpc("create_manual_review", ...)
    //   4. send email (we stub the fetch elsewhere — but resend is over fetch too;
    //      we let the fetch stub respond OK for the resend URL)
    //   5. sb.rpc("mark_manual_review_email_sent", ...)
    // No existing manual review for this RO
    sb.onTable("keytag_manual_reviews", { data: null, error: null });
    sb.onRpc("create_manual_review", {
      data: [{ code: "PAF-AB12CD", review_id: 42, audit_log_id: 100 }],
      error: null,
    });
    sb.onRpc("mark_manual_review_email_sent", { data: null, error: null });
    _setSupabaseClientForTesting(sb);

    await withMockedFetch(
      (url, init) => {
        // GET RO (verify status) → WIP
        if (url.includes("/repair-orders/") && (!init?.method || init.method === "GET")) {
          return Promise.resolve(
            jsonResponse({
              id: 152448,
              repairOrderNumber: 1480,
              shopId: FAKE_SHOP_ID,
              customerId: 1001,
              vehicleId: 2002,
              serviceWriterId: 50,
              technicianId: 70,
              updatedDate: "2026-05-22T12:00:00Z",
              repairOrderStatus: { id: 2, code: "WIP", name: "Work In Progress" },
            }),
          );
        }
        // PATCH RO → 500 (Tekmetric refused)
        if (url.includes("/repair-orders/") && init?.method === "PATCH") {
          return Promise.resolve(new Response("Tekmetric internal error", { status: 500 }));
        }
        // Resend email POST → succeed
        return Promise.resolve(jsonResponse({ id: "email-id-x" }, 200));
      },
      async (scope) => {
        const res = await handler(
          makeRequest({ token: FAKE_TOKEN, body: workApprovedPayload() }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.ok, false);
        assertEquals(body.action, "assigned_patch_failed_review_issued");
        assertEquals(body.tag_color, "red");
        assertEquals(body.tag_number, 99);
        assertExists(body.patch_error);
        assertEquals(body.code, "PAF-AB12CD");

        // record_keytag_patched was called with p_success=false
        const recordCalls = sb.callsForRpc("record_keytag_patched");
        assertEquals(recordCalls.length, 1);
        const recordArgs = recordCalls[0].rpcArgs as Record<string, unknown>;
        assertEquals(recordArgs.p_success, false);
        assertExists(recordArgs.p_error);

        // The DB log row was still updated (markProcessed called via UPDATE on
        // keytag_webhook_events)
        const eventTableCalls = sb.callsForTable("keytag_webhook_events");
        const hasUpdate = eventTableCalls.some(
          (c) => c.chain.some((m) => m.method === "update"),
        );
        assert(hasUpdate, "keytag_webhook_events should have been updated with markProcessed");

        // create_manual_review was called with category=tekmetric_patch_fail
        const reviewCalls = sb.callsForRpc("create_manual_review");
        assertEquals(reviewCalls.length, 1);
        const reviewArgs = reviewCalls[0].rpcArgs as Record<string, unknown>;
        assertEquals(reviewArgs.p_category, "tekmetric_patch_fail");

        // Both GET + PATCH were attempted (plus the Resend email POST)
        const tekmetricCalls = scope.calls.filter((c) =>
          c.url.includes("/repair-orders/")
        );
        assertEquals(tekmetricCalls.length, 2);
        assertEquals(tekmetricCalls[1].init?.method, "PATCH");
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — self-authored event (trailing 'by ' with empty actor) → skipped_self_authored",
  fn: async () => {
    resetEnv();
    clearTekmetricTokenCache();
    const sb = freshDb();
    _setSupabaseClientForTesting(sb);

    // Self-authored events come from our own PATCH calls (service-account
    // auth produces a status_updated event with empty actor after "by ").
    // The defensive guard short-circuits BEFORE any branching logic, so
    // no downstream RPCs fire even though the payload would otherwise
    // route to the "existing tag" branch.
    const selfAuthoredBody = {
      event: "Repair Order #1480 status updated by ",
      data: {
        id: 152448,
        repairOrderNumber: 1480,
        shopId: FAKE_SHOP_ID,
        updatedDate: "2026-05-22T12:00:00Z",
        repairOrderStatus: { id: 2, code: "WIP", name: "Work In Progress" },
      },
    };

    await withMockedFetch(
      () => Promise.resolve(jsonResponse({ should: "not be reached" })),
      async (scope) => {
        const res = await handler(
          makeRequest({ token: FAKE_TOKEN, body: selfAuthoredBody }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.action, "skipped_self_authored");
        // No downstream RPCs, no Tekmetric fetches
        assertEquals(sb.callsForRpc("assign_next_keytag").length, 0);
        assertEquals(sb.callsForRpc("touch_keytag_activity").length, 0);
        assertEquals(scope.calls.length, 0);
      },
    );
  },
});

Deno.test({
  name: "keytag-tekmetric-webhook — TEKMETRIC_WEBHOOK_TOKEN env unset returns 500 Misconfigured",
  fn: async () => {
    unsetEnv("TEKMETRIC_WEBHOOK_TOKEN");
    clearTekmetricTokenCache();
    const sb = freshDb();
    _setSupabaseClientForTesting(sb);

    const res = await handler(
      makeRequest({ token: "anything", body: workApprovedPayload() }),
    );
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Misconfigured");
    assertEquals(sb.calls.length, 0);
  },
});
