// Deno tests for autoResolveReviewsForRo.
//   deno test --allow-env supabase/functions/_shared/keytag-auto-resolve.test.ts

import { assertEquals } from "jsr:@std/assert@^1";
import { autoResolveReviewsForRo } from "./keytag-auto-resolve.ts";

type RpcCall = { name: string; args: Record<string, unknown> };

// sb stub that records rpc calls + returns a canned result.
function fakeSb(result: { data: unknown; error: { message: string } | null }) {
  const calls: RpcCall[] = [];
  const sb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  } as unknown as Parameters<typeof autoResolveReviewsForRo>[0];
  return { sb, calls };
}

Deno.test("null/undefined roId → 0, no rpc call", async () => {
  const { sb, calls } = fakeSb({ data: 3, error: null });
  assertEquals(await autoResolveReviewsForRo(sb, null, "x", "webhook"), 0);
  assertEquals(await autoResolveReviewsForRo(sb, undefined, "x", "webhook"), 0);
  assertEquals(calls.length, 0);
});

Deno.test("returns the count the RPC closed", async () => {
  const { sb, calls } = fakeSb({ data: 2, error: null });
  assertEquals(await autoResolveReviewsForRo(sb, 152817, "ro_posted_paid", "webhook"), 2);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "auto_resolve_reviews_for_ro");
  assertEquals(calls[0].args, {
    p_ro_id: 152817,
    p_reason: "moot_ro_closed:ro_posted_paid",
    p_source: "webhook",
  });
});

Deno.test("zero open reviews → 0", async () => {
  const { sb } = fakeSb({ data: 0, error: null });
  assertEquals(await autoResolveReviewsForRo(sb, 999, "payment_made", "webhook"), 0);
});

Deno.test("rpc error → 0, never throws (best-effort)", async () => {
  const { sb, calls } = fakeSb({ data: null, error: { message: "boom" } });
  // Must not throw — the release already committed.
  assertEquals(await autoResolveReviewsForRo(sb, 152817, "manual_release", "claude_desktop"), 0);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_source, "claude_desktop");
});

Deno.test("non-numeric data → 0 (defensive)", async () => {
  const { sb } = fakeSb({ data: null, error: null });
  assertEquals(await autoResolveReviewsForRo(sb, 1, "x", "cron"), 0);
});
