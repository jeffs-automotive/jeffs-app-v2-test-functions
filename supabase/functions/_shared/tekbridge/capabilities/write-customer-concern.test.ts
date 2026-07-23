// Deno-native unit tests for the write-customer-concern capability.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/capabilities/write-customer-concern.test.ts
//
// Routes the mocked fetch by URL: the INTERNAL write (…/api/repair-orders/…/
// customer-concerns, …/api/customer-concerns/{id}) vs the PUBLIC verify read
// (…/api/v1/repair-orders/{id}). The Supabase stub serves the tekbridge JWT for
// "tekbridge_session_jwt" and the public bearer for "tekmetric_access_token".

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import {
  createCustomerConcern,
  deleteCustomerConcern,
} from "./write-customer-concern.ts";
import { clearBotJwtCache } from "../session.ts";
import { clearTekmetricTokenCache } from "../../tekmetric-client.ts";

const realFetch = globalThis.fetch;

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const FRESH_JWT = `${b64url({ alg: "HS256" })}.${b64url({ exp: 9_999_999_999, shopId: "7476" })}.sig`;

// deno-lint-ignore no-explicit-any
function makeSb(): any {
  return {
    rpc: (name: string, params: { p_name?: string }) => {
      if (name === "tekmetric_get_secret") {
        if (params?.p_name === "tekbridge_session_jwt") return Promise.resolve({ data: FRESH_JWT, error: null });
        if (params?.p_name === "tekmetric_access_token") return Promise.resolve({ data: "public-bearer", error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  };
}

interface Routes {
  onCreate?: (url: string, init: RequestInit) => Response;
  onVerify?: (url: string) => Response;
  onDelete?: (url: string) => Response;
}
function stubRoutes(routes: Routes): { calls: Array<{ url: string; method: string }>; restore: () => void } {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (url.includes("/api/v1/repair-orders/") && method === "GET") {
      return Promise.resolve(routes.onVerify?.(url) ?? new Response("{}", { status: 200 }));
    }
    if (url.includes("/customer-concerns") && method === "POST") {
      return Promise.resolve(routes.onCreate?.(url, init ?? {}) ?? new Response("{}", { status: 200 }));
    }
    if (url.includes("/customer-concerns/") && method === "DELETE") {
      return Promise.resolve(routes.onDelete?.(url) ?? new Response("", { status: 200 }));
    }
    return Promise.resolve(new Response("unrouted", { status: 500 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

function reset() {
  clearBotJwtCache();
  clearTekmetricTokenCache();
}

// ─── create ──────────────────────────────────────────────────────────────────

Deno.test("createCustomerConcern: POSTs body, returns id, verifies via public API", async () => {
  reset();
  const { calls, restore } = stubRoutes({
    onCreate: (_url, init) => {
      const body = JSON.parse(init.body as string);
      assertEquals(body, { concern: "brake noise", techComment: "left front" });
      return new Response(JSON.stringify({ type: "SUCCESS", data: { id: 999, repairOrderId: 345 } }), { status: 200 });
    },
    onVerify: () => new Response(JSON.stringify({ customerConcerns: [{ id: 999, concern: "brake noise" }] }), { status: 200 }),
  });
  try {
    const r = await createCustomerConcern(makeSb(), 7476, {
      repairOrderId: 345,
      concern: "brake noise",
      techComment: "left front",
    });
    assertEquals(r.ok, true);
    assertEquals(r.concernId, 999);
    assertEquals(r.verified, true);
    // hit the internal POST then the public GET
    assert(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/repair-orders/345/customer-concerns")));
    assert(calls.some((c) => c.method === "GET" && c.url.endsWith("/api/v1/repair-orders/345")));
  } finally {
    restore();
    reset();
  }
});

Deno.test("createCustomerConcern: verify:false skips the public read", async () => {
  reset();
  const { calls, restore } = stubRoutes({
    onCreate: () => new Response(JSON.stringify({ type: "SUCCESS", data: { id: 1 } }), { status: 200 }),
  });
  try {
    const r = await createCustomerConcern(makeSb(), 7476, { repairOrderId: 345, concern: "x", verify: false });
    assertEquals(r.verified, false);
    assert(!calls.some((c) => c.method === "GET"), "must not read back when verify:false");
  } finally {
    restore();
    reset();
  }
});

Deno.test("createCustomerConcern: verify read error → ok:true, verified:false, verifyError", async () => {
  reset();
  const { restore } = stubRoutes({
    onCreate: () => new Response(JSON.stringify({ type: "SUCCESS", data: { id: 7 } }), { status: 200 }),
    onVerify: () => new Response("upstream down", { status: 503 }),
  });
  try {
    const r = await createCustomerConcern(makeSb(), 7476, { repairOrderId: 345, concern: "x" });
    assertEquals(r.ok, true);
    assertEquals(r.concernId, 7);
    assertEquals(r.verified, false);
    assert(r.verifyError && r.verifyError.length > 0, "verifyError should be populated");
  } finally {
    restore();
    reset();
  }
});

Deno.test("createCustomerConcern: throws on response without data.id", async () => {
  reset();
  const { restore } = stubRoutes({
    onCreate: () => new Response(JSON.stringify({ type: "SUCCESS", data: {} }), { status: 200 }),
  });
  try {
    await assertRejects(
      () => createCustomerConcern(makeSb(), 7476, { repairOrderId: 345, concern: "x", verify: false }),
      Error,
      "no data.id",
    );
  } finally {
    restore();
    reset();
  }
});

// ─── delete ──────────────────────────────────────────────────────────────────

Deno.test("deleteCustomerConcern: DELETEs /customer-concerns/{id}", async () => {
  reset();
  const { calls, restore } = stubRoutes({ onDelete: () => new Response("", { status: 200 }) });
  try {
    const r = await deleteCustomerConcern(makeSb(), 7476, { concernId: 555 });
    assertEquals(r, { ok: true, concernId: 555 });
    assert(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/api/customer-concerns/555")));
  } finally {
    restore();
    reset();
  }
});
