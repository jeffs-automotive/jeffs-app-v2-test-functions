// Deno-native unit tests for the shared Resend transport.
//
// Run with:
//   deno test --allow-env supabase/functions/_shared/resend-client.test.ts
//
// Stubs globalThis.fetch (no real network) and sets RESEND_API_KEY via env.

import { assert, assertEquals } from "jsr:@std/assert@^1";
import { sendResendEmail } from "./resend-client.ts";

const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string, init: RequestInit) => Response): {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(handler(url, init ?? {}));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

Deno.test("missing API key → ok:false, status:0, no fetch", async () => {
  Deno.env.delete("RESEND_API_KEY");
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const r = await sendResendEmail({ from: "a@b.com", to: "c@d.com", subject: "s", html: "<p>x</p>" });
    assertEquals(r, { ok: false, status: 0, error: "RESEND_API_KEY not configured" });
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test("2xx → ok:true with parsed id; request shape correct", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const { calls, restore } = stubFetch(() => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
  try {
    const r = await sendResendEmail({
      from: "from@x.com",
      to: "one@x.com",
      subject: "Subj",
      html: "<p>hi</p>",
      idempotencyKey: "key-1",
    });
    assertEquals(r, { ok: true, status: 200, id: "re_123" });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, "https://api.resend.com/emails");
    assertEquals(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer test-key");
    assertEquals(headers["Idempotency-Key"], "key-1");
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.to, ["one@x.com"]); // string normalized to array
    assertEquals(body.from, "from@x.com");
    assertEquals(body.subject, "Subj");
  } finally {
    restore();
  }
});

Deno.test("array `to` is passed through; no idempotency key omits header", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    await sendResendEmail({ from: "f@x.com", to: ["a@x.com", "b@x.com"], subject: "s", html: "<p>x</p>" });
    const headers = calls[0].init.headers as Record<string, string>;
    assert(!("Idempotency-Key" in headers));
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.to, ["a@x.com", "b@x.com"]);
  } finally {
    restore();
  }
});

Deno.test("409 → ok:true, deduped:true", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const { restore } = stubFetch(() => new Response("", { status: 409 }));
  try {
    const r = await sendResendEmail({ from: "f@x.com", to: "t@x.com", subject: "s", html: "<p>x</p>", idempotencyKey: "k" });
    assertEquals(r, { ok: true, status: 409, deduped: true });
  } finally {
    restore();
  }
});

Deno.test("non-ok HTTP → ok:false with HTTP-prefixed error", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const { restore } = stubFetch(() => new Response("bad request body", { status: 422 }));
  try {
    const r = await sendResendEmail({ from: "f@x.com", to: "t@x.com", subject: "s", html: "<p>x</p>" });
    assertEquals(r.ok, false);
    assertEquals(r.status, 422);
    assert(r.error?.startsWith("HTTP 422: "));
    assert(r.error?.includes("bad request body"));
  } finally {
    restore();
  }
});

Deno.test("fetch throws → ok:false, status:0, error message", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const r = await sendResendEmail({ from: "f@x.com", to: "t@x.com", subject: "s", html: "<p>x</p>" });
    assertEquals(r, { ok: false, status: 0, error: "network down" });
  } finally {
    globalThis.fetch = realFetch;
  }
});
