// Deno tests for resolveCustomerName.
//   deno test --allow-env supabase/functions/_shared/keytag-customer-name.test.ts

import { assertEquals } from "jsr:@std/assert@^1";
import { resolveCustomerName } from "./keytag-customer-name.ts";

const realFetch = globalThis.fetch;

// Minimal sb stub: resolveCustomerName -> tekmetricGetJson -> tekmetricFetch
// reads the token via sb.rpc('tekmetric_get_secret'), then fetches. Stub both.
function fakeSb() {
  return {
    rpc: (_name: string, _args: unknown) =>
      Promise.resolve({ data: "test-token", error: null }),
  } as unknown as Parameters<typeof resolveCustomerName>[0];
}

function stubFetch(handler: () => Response): () => void {
  globalThis.fetch = (() => Promise.resolve(handler())) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

Deno.test("null customerId → null, no fetch", async () => {
  let called = false;
  const restore = stubFetch(() => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  try {
    assertEquals(await resolveCustomerName(fakeSb(), 7476, null), null);
    assertEquals(await resolveCustomerName(fakeSb(), 7476, undefined), null);
    assertEquals(called, false);
  } finally {
    restore();
  }
});

Deno.test("resolves person first+last", async () => {
  const restore = stubFetch(() =>
    new Response(JSON.stringify({ firstName: "Jane", lastName: "Doe" }), { status: 200 })
  );
  try {
    assertEquals(await resolveCustomerName(fakeSb(), 7476, 123), "Jane Doe");
  } finally {
    restore();
  }
});

Deno.test("business (firstName only)", async () => {
  const restore = stubFetch(() =>
    new Response(JSON.stringify({ firstName: "Carmax", lastName: "" }), { status: 200 })
  );
  try {
    assertEquals(await resolveCustomerName(fakeSb(), 7476, 44695835), "Carmax");
  } finally {
    restore();
  }
});

Deno.test("Tekmetric failure → null (never throws)", async () => {
  const restore = stubFetch(() => new Response("nope", { status: 500 }));
  try {
    assertEquals(await resolveCustomerName(fakeSb(), 7476, 999), null);
  } finally {
    restore();
  }
});

Deno.test("network throw → null", async () => {
  globalThis.fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
  try {
    assertEquals(await resolveCustomerName(fakeSb(), 7476, 999), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
