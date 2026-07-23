// Deno-native unit tests for the tekbridge internal-API client.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/client.test.ts
//
// Stubs globalThis.fetch (no real network) + a Supabase client that serves the
// bot JWT from "Vault" and records session-state upserts.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import {
  tekbridgeFetch,
  tekbridgeJson,
  TekbridgeApiError,
} from "./client.ts";
import { clearBotJwtCache, TekbridgeSessionError } from "./session.ts";

const realFetch = globalThis.fetch;

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.sig`;
}

/** A JWT that expires far in the future (so the local pre-check passes). */
const FRESH_JWT = makeJwt({ exp: 9_999_999_999, shopId: "7476" });

function stubFetch(handler: (url: string, init: RequestInit) => Response): {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input.toString(), init: init ?? {} });
    return Promise.resolve(handler(input.toString(), init ?? {}));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

interface SbStub {
  // deno-lint-ignore no-explicit-any
  sb: any;
  upserts: Array<{ table: string; row: Record<string, unknown> }>;
}
function makeSb(jwt: string | null): SbStub {
  const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const sb = {
    rpc: (name: string) =>
      Promise.resolve(name === "tekmetric_get_secret" ? { data: jwt, error: null } : { data: null, error: null }),
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { sb, upserts };
}

// ─── tekbridgeFetch ──────────────────────────────────────────────────────────

Deno.test("tekbridgeFetch: attaches x-auth-token + base url + body", async () => {
  clearBotJwtCache();
  const { sb } = makeSb(FRESH_JWT);
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const res = await tekbridgeFetch(sb, "/repair-orders/345/customer-concerns", {
      method: "POST",
      body: { concern: "x", techComment: "y" },
      shopId: 7476,
    });
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, "https://shop.tekmetric.com/api/repair-orders/345/customer-concerns");
    assertEquals(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers["x-auth-token"], FRESH_JWT);
    assertEquals(headers["content-type"], "application/json");
    assertEquals(JSON.parse(calls[0].init.body as string), { concern: "x", techComment: "y" });
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("tekbridgeFetch: GET omits content-type / body", async () => {
  clearBotJwtCache();
  const { sb } = makeSb(FRESH_JWT);
  const { calls, restore } = stubFetch(() => new Response("[]", { status: 200 }));
  try {
    await tekbridgeFetch(sb, "/repair-orders/345/customer-concerns", { shopId: 7476 });
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers["content-type"], undefined);
    assertEquals(calls[0].init.body, undefined);
    assertEquals(calls[0].init.method, "GET");
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("tekbridgeFetch: 401 marks session stale + throws expired", async () => {
  clearBotJwtCache();
  const { sb, upserts } = makeSb(FRESH_JWT);
  const { restore } = stubFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    const err = await assertRejects(
      () => tekbridgeFetch(sb, "/anything", { shopId: 7476 }),
      TekbridgeSessionError,
    );
    assertEquals((err as TekbridgeSessionError).code, "expired");
    assertEquals(upserts.length, 1);
    assertEquals(upserts[0].table, "tekbridge_session_state");
    assertEquals(upserts[0].row.status, "stale");
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("tekbridgeFetch: locally-expired JWT throws without fetching", async () => {
  clearBotJwtCache();
  const expired = makeJwt({ exp: 1000, shopId: "7476" }); // long past
  const { sb, upserts } = makeSb(expired);
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const err = await assertRejects(
      () => tekbridgeFetch(sb, "/anything", { shopId: 7476 }),
      TekbridgeSessionError,
    );
    assertEquals((err as TekbridgeSessionError).code, "expired");
    assertEquals(calls.length, 0, "must not hit the network with a dead token");
    assertEquals(upserts[0].row.status, "stale");
  } finally {
    restore();
    clearBotJwtCache();
  }
});

// ─── tekbridgeJson ───────────────────────────────────────────────────────────

Deno.test("tekbridgeJson: parses 2xx JSON", async () => {
  clearBotJwtCache();
  const { sb } = makeSb(FRESH_JWT);
  const { restore } = stubFetch(() => new Response(JSON.stringify({ type: "SUCCESS", data: { id: 42 } }), { status: 200 }));
  try {
    const out = await tekbridgeJson<{ type: string; data: { id: number } }>(sb, "/x", { shopId: 7476 });
    assertEquals(out.type, "SUCCESS");
    assertEquals(out.data.id, 42);
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("tekbridgeJson: non-2xx → TekbridgeApiError with status", async () => {
  clearBotJwtCache();
  const { sb } = makeSb(FRESH_JWT);
  const { restore } = stubFetch(() => new Response("Not Found", { status: 404 }));
  try {
    const err = await assertRejects(() => tekbridgeJson(sb, "/missing", { shopId: 7476 }), TekbridgeApiError);
    assertEquals((err as TekbridgeApiError).status, 404);
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("tekbridgeJson: empty body → null (e.g. DELETE)", async () => {
  clearBotJwtCache();
  const { sb } = makeSb(FRESH_JWT);
  const { restore } = stubFetch(() => new Response("", { status: 200 }));
  try {
    assertEquals(await tekbridgeJson(sb, "/customer-concerns/1", { method: "DELETE", shopId: 7476 }), null);
  } finally {
    restore();
    clearBotJwtCache();
  }
});
