// Deno contract suite — the cross-runtime half of the shared test-kit (../../../test-kit). Proves
// (a) the kit's pure fixtures import cleanly under `deno test` as well as Vitest, and (b) the
// webhook whole-body idempotency + Tekmetric received-time ordering invariants hold here too.
//
// Run: deno test --allow-all --no-check supabase/functions/_shared/webhook-idempotency.contract.test.ts
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  paymentWebhookA,
  paymentWebhookB,
  paymentWebhookARetry,
  narrowDedupKey,
} from "../../../test-kit/fixtures/webhook.ts";
import { backdatedRepostBurst } from "../../../test-kit/fixtures/tekmetric.ts";

/** Stable, key-sorted JSON — mirrors Postgres jsonb::text normalization (sorted keys, no gaps). */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("webhook idempotency: whole-body hash keeps distinct payments, collapses a byte-shuffled retry", async () => {
  // The buggy NARROW key (eventType + repairOrderId) can't tell the two distinct payments apart...
  assertEquals(narrowDedupKey(paymentWebhookA), narrowDedupKey(paymentWebhookB));
  // ...but the WHOLE-body hash does → both rows store (the 2nd payment isn't silently dropped).
  const ha = await sha256Hex(canonicalJson(paymentWebhookA));
  const hb = await sha256Hex(canonicalJson(paymentWebhookB));
  assertNotEquals(ha, hb);
  // A byte-shuffled (key-reordered) retry of A is semantically identical → same canonical text →
  // same hash → it dedupes to A's single row (jsonb normalization is order-insensitive).
  const haRetry = await sha256Hex(canonicalJson(paymentWebhookARetry));
  assertEquals(ha, haRetry);
});

Deno.test("time-ordering: a backdated repost still orders by received_at (shared cross-runtime fixture)", () => {
  const newest = [...backdatedRepostBurst].sort(
    (a, b) => Date.parse(b.received_at) - Date.parse(a.received_at),
  )[0];
  // The repost (received LAST) is the current state — never the unpost Tekmetric backdated ahead of it.
  assertEquals(newest.event_kind, "ro_posted");
  assertEquals(newest.raw_body.data.totalSales, 48651); // $486.51 survives; the stale $572.37 unpost loses
  assert(newest.tekmetric_event_at !== null);
});
