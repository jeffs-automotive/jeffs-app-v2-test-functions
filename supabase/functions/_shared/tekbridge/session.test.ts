// Deno-native unit tests for the tekbridge session layer.
//
// Run with:
//   deno test --allow-env supabase/functions/_shared/tekbridge/session.test.ts
//
// Covers the pure JWT logic (decode / expiry) + the Vault-backed get/set with a
// stubbed Supabase client (no DB, no network).

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import {
  clearBotJwtCache,
  decodeJwtClaims,
  getBotJwt,
  isJwtExpired,
  jwtExpiresAt,
  setBotJwt,
  TekbridgeSessionError,
} from "./session.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.sig`;
}

interface StubOpts {
  rpc?: (name: string, params: unknown) => { data?: unknown; error?: { message: string } | null };
  upsertResult?: { error: { message: string } | null };
  onUpsert?: (table: string, row: Record<string, unknown>) => void;
}
// deno-lint-ignore no-explicit-any
function makeSb(opts: StubOpts = {}): any {
  return {
    rpc: (name: string, params: unknown) =>
      Promise.resolve(opts.rpc?.(name, params) ?? { data: null, error: null }),
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        opts.onUpsert?.(table, row);
        return Promise.resolve(opts.upsertResult ?? { error: null });
      },
    }),
  };
}

// ─── decodeJwtClaims ─────────────────────────────────────────────────────────

Deno.test("decodeJwtClaims: decodes a valid payload", () => {
  const jwt = makeJwt({ sub: "tekbridge@jeffsautomotive.com", shopId: "7476", exp: 123 });
  const c = decodeJwtClaims(jwt);
  assertEquals(c?.sub, "tekbridge@jeffsautomotive.com");
  assertEquals(c?.shopId, "7476");
  assertEquals(c?.exp, 123);
});

Deno.test("decodeJwtClaims: null on malformed input", () => {
  assertEquals(decodeJwtClaims("not-a-jwt"), null);
  assertEquals(decodeJwtClaims("a.b"), null); // 2 segments
  assertEquals(decodeJwtClaims("a.@@@.c"), null); // undecodable middle
  // deno-lint-ignore no-explicit-any
  assertEquals(decodeJwtClaims(42 as any), null);
});

// ─── expiry ──────────────────────────────────────────────────────────────────

Deno.test("jwtExpiresAt: returns exp, or null when absent", () => {
  assertEquals(jwtExpiresAt(makeJwt({ exp: 1784307712 })), 1784307712);
  assertEquals(jwtExpiresAt(makeJwt({ shopId: "7476" })), null);
});

Deno.test("isJwtExpired: fresh vs expired vs skew boundary", () => {
  const exp = 1_000_000;
  const jwt = makeJwt({ exp });
  // fresh: well before exp
  assert(!isJwtExpired(jwt, exp - 3600, 60));
  // expired: past exp
  assert(isJwtExpired(jwt, exp + 1, 60));
  // within skew window (60s): treated as expired
  assert(isJwtExpired(jwt, exp - 30, 60));
  // just outside skew window: still valid
  assert(!isJwtExpired(jwt, exp - 61, 60));
});

Deno.test("isJwtExpired: no exp ⇒ expired/unusable", () => {
  assert(isJwtExpired(makeJwt({ shopId: "7476" }), 1000, 60));
});

// ─── getBotJwt ───────────────────────────────────────────────────────────────

Deno.test("getBotJwt: returns Vault value + caches it", async () => {
  clearBotJwtCache();
  const jwt = makeJwt({ exp: 2_000_000 });
  let rpcCalls = 0;
  const sb = makeSb({
    rpc: (name) => {
      if (name === "tekmetric_get_secret") {
        rpcCalls++;
        return { data: jwt, error: null };
      }
      return { data: null, error: null };
    },
  });
  assertEquals(await getBotJwt(sb), jwt);
  // second call served from cache — no second RPC
  assertEquals(await getBotJwt(sb), jwt);
  assertEquals(rpcCalls, 1);
  clearBotJwtCache();
});

Deno.test("getBotJwt: no_session error when Vault is empty", async () => {
  clearBotJwtCache();
  const sb = makeSb({ rpc: () => ({ data: null, error: null }) });
  const err = await assertRejects(() => getBotJwt(sb), TekbridgeSessionError);
  assertEquals((err as TekbridgeSessionError).code, "no_session");
});

Deno.test("getBotJwt: throws (not session-typed) on RPC error", async () => {
  clearBotJwtCache();
  const sb = makeSb({ rpc: () => ({ data: null, error: { message: "boom" } }) });
  const err = await assertRejects(() => getBotJwt(sb), Error);
  assert(!(err instanceof TekbridgeSessionError));
  assert(err.message.includes("boom"));
});

// ─── setBotJwt ───────────────────────────────────────────────────────────────

Deno.test("setBotJwt: rejects a non-JWT value", async () => {
  clearBotJwtCache();
  const sb = makeSb();
  const err = await assertRejects(() => setBotJwt(sb, "garbage", 7476), TekbridgeSessionError);
  assertEquals((err as TekbridgeSessionError).code, "invalid_jwt");
});

Deno.test("setBotJwt: stores JWT + upserts active state with exp", async () => {
  clearBotJwtCache();
  const exp = 2_100_000;
  const jwt = makeJwt({ exp, shopId: "7476" });
  const setCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const sb = makeSb({
    rpc: (name, params) => {
      setCalls.push({ name, params: params as Record<string, unknown> });
      return { data: null, error: null };
    },
    onUpsert: (table, row) => upserts.push({ table, row }),
  });

  const { expiresAt } = await setBotJwt(sb, jwt, 7476);

  assertEquals(expiresAt, new Date(exp * 1000).toISOString());
  // wrote the secret under the tekbridge name
  const setSecret = setCalls.find((c) => c.name === "tekmetric_set_secret");
  assert(setSecret, "expected tekmetric_set_secret call");
  assertEquals(setSecret!.params.p_name, "tekbridge_session_jwt");
  assertEquals(setSecret!.params.p_value, jwt);
  // recorded active health state
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].table, "tekbridge_session_state");
  assertEquals(upserts[0].row.shop_id, 7476);
  assertEquals(upserts[0].row.status, "active");
  assertEquals(upserts[0].row.expires_at, expiresAt);
  clearBotJwtCache();
});
