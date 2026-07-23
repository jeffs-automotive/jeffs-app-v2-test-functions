// Deno-native unit tests for the tekbridge session refresh.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/refresh.test.ts

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { refreshBotJwt } from "./refresh.ts";
import { clearBotJwtCache, TekbridgeSessionError } from "./session.ts";

const realFetch = globalThis.fetch;

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwt(exp: number): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ exp, shopId: "7476" })}.sig`;
}
const CURRENT = jwt(9_000_000_000);
const NEW = jwt(9_000_057_600);

interface SbCaps { setSecretValue?: string }
// deno-lint-ignore no-explicit-any
function makeSb(caps: SbCaps): any {
  return {
    rpc: (name: string, params: { p_name?: string; p_value?: string }) => {
      if (name === "tekmetric_get_secret" && params?.p_name === "tekbridge_session_jwt") {
        return Promise.resolve({ data: CURRENT, error: null });
      }
      if (name === "tekmetric_set_secret") {
        caps.setSecretValue = params?.p_value;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  };
}

function stubFetch(handler: (url: string) => Response): () => void {
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(handler(input.toString()))) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

Deno.test("refreshBotJwt: calls refresh endpoint, stores fresh token", async () => {
  clearBotJwtCache();
  const caps: SbCaps = {};
  const sb = makeSb(caps);
  const restore = stubFetch((url) => {
    assert(url.endsWith("/api/token/shop/7476"), `unexpected url: ${url}`);
    return new Response(JSON.stringify({ token: NEW }), { status: 200 });
  });
  try {
    const r = await refreshBotJwt(sb, 7476);
    assertEquals(r.expiresAt, new Date(9_000_057_600 * 1000).toISOString());
    assertEquals(r.previousExpiresAt, new Date(9_000_000_000 * 1000).toISOString());
    assertEquals(caps.setSecretValue, NEW, "the fresh token must be persisted");
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("refreshBotJwt: throws when endpoint returns no token", async () => {
  clearBotJwtCache();
  const sb = makeSb({});
  const restore = stubFetch(() => new Response(JSON.stringify({ nope: true }), { status: 200 }));
  try {
    await assertRejects(() => refreshBotJwt(sb, 7476), Error, "no usable token");
  } finally {
    restore();
    clearBotJwtCache();
  }
});

Deno.test("refreshBotJwt: 401 surfaces as a session error (chain broke)", async () => {
  clearBotJwtCache();
  const sb = makeSb({});
  const restore = stubFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    const err = await assertRejects(() => refreshBotJwt(sb, 7476), TekbridgeSessionError);
    assertEquals((err as TekbridgeSessionError).code, "expired");
  } finally {
    restore();
    clearBotJwtCache();
  }
});
