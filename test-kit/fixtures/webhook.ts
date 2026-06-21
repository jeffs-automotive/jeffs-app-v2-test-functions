/**
 * Webhook-idempotency fixtures — shared cookie-cutter data for the "dedup on the WHOLE body"
 * invariant (test-kit/README.md "webhook idempotency"). Pure data, no test-framework imports,
 * so `deno test` (the edge functions) and Vitest both import it. Provider-shaped but generic.
 *
 * The trap (incident c83bea3): a dedup key narrowed to a few fields (eventType + repairOrderId)
 * COLLIDES two genuinely-distinct payments on the same RO and silently drops the second. The fix
 * keys on the whole canonical body — Postgres `sha256(raw_body::text)` (jsonb normalizes key order
 * + whitespace, so a byte-shuffled retry still collapses to one row).
 */

/** A payment webhook. DISTINCT from B (different payment `data.id` + amount) — both must store. */
export const paymentWebhookA = {
  eventType: "PAYMENT.CREATED",
  shopId: 7476,
  data: { id: 9001, repairOrderId: 336946898, amount: 12000, paymentType: "CC" },
};

/** A SECOND, distinct payment on the SAME repair order. A (eventType, repairOrderId) key would
 *  wrongly collide this with A; the whole-body hash keeps them apart. */
export const paymentWebhookB = {
  eventType: "PAYMENT.CREATED",
  shopId: 7476,
  data: { id: 9002, repairOrderId: 336946898, amount: 33379, paymentType: "Check" },
};

/** A byte-shuffled (keys reordered) RETRY of A — semantically identical, so jsonb-canonical
 *  text is the same → it must dedupe to A (one row), proving the hash is order-insensitive. */
export const paymentWebhookARetry = {
  data: { paymentType: "CC", amount: 12000, repairOrderId: 336946898, id: 9001 },
  shopId: 7476,
  eventType: "PAYMENT.CREATED",
};

/** The narrow key that the BUG used — same for A and B (it can't tell two payments apart). */
export const narrowDedupKey = (b: { eventType: string; data: { repairOrderId: number } }): string =>
  `${b.eventType}:${b.data.repairOrderId}`;
