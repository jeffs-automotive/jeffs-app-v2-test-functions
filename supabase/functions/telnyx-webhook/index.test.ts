// Tests for the Telnyx durable intake receiver (telnyx-webhook).
//
// Coverage:
//   - extractTelnyxEvent / isAlertEvent (pure)
//   - happy path: envelope stored + 200 stored:true with telnyx_event_id /
//     event_type / signature_verified=false (no public key configured)
//   - duplicate (23505) → 200 duplicate:true
//   - STORE FAILURE (non-23505) → 503 (durable-before-200; NOT a silent 200)
//   - parse failure → still stored (event_type 'unparseable', bounded raw text)
//   - invalid/missing token → 401; missing secret → 500; non-POST → 405
//   - Ed25519: valid signature → stored signature_verified:true; TAMPERED
//     signature → 401 + NO insert; absent headers w/ key set → stored unverified
//   - PII/secret redaction (Authorization header + ?token= stripped)
//
// Run: deno test --allow-all --no-check supabase/functions/telnyx-webhook/index.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createMockSupabaseClient, setEnv, unsetEnv } from "../_shared/test-helpers.ts";
import { _scrubStringForTesting } from "../_shared/sentry-edge.ts";
import {
  _setSupabaseClientForTesting,
  extractTelnyxEvent,
  handler,
  isAlertEvent,
  redactedRequestUrl,
  verifyTelnyxSignature,
} from "./index.ts";

const FAKE_TOKEN = "tlx-test-token-abc123";

function makeRequest(opts: {
  method?: string;
  token?: string | null;
  body?: unknown | string;
  extraHeaders?: Record<string, string>;
} = {}): Request {
  const method = opts.method ?? "POST";
  const params = new URLSearchParams();
  if (opts.token !== null && opts.token !== undefined) params.set("token", opts.token);
  const qs = params.toString();
  const url = `https://example.test/telnyx-webhook${qs.length ? "?" + qs : ""}`;
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [k, v] of Object.entries(opts.extraHeaders ?? {})) headers.set(k, v);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(url, init);
}

const MESSAGE_ENVELOPE = {
  data: {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    event_type: "message.received",
    occurred_at: "2026-07-01T22:00:00.000Z",
    payload: { from: { phone_number: "+14845551212" }, text: "STOP" },
    record_type: "event",
  },
  meta: { attempt: 1, delivered_to: "https://example.test/telnyx-webhook" },
};

type SupabaseRes = { data: unknown; error: { code?: string; message: string } | null };
function sbWith(insert?: SupabaseRes): ReturnType<typeof createMockSupabaseClient> {
  const sb = createMockSupabaseClient();
  sb.onTable("telnyx_webhook_events", insert ?? { data: { id: "row-1" }, error: null });
  return sb;
}

function insertedRow(sb: ReturnType<typeof createMockSupabaseClient>): Record<string, unknown> {
  const calls = sb.callsForTable("telnyx_webhook_events");
  assertEquals(calls.length, 1);
  const ins = calls[0].chain.find((c) => c.method === "insert");
  assert(ins, "insert was called");
  return ins!.args[0] as Record<string, unknown>;
}

// ─── pure units ─────────────────────────────────────────────────────────────
Deno.test("extractTelnyxEvent pulls id/event_type/occurred_at; unknown shapes → nulls", () => {
  const ev = extractTelnyxEvent(MESSAGE_ENVELOPE as unknown as Record<string, unknown>);
  assertEquals(ev.telnyxEventId, "3fa85f64-5717-4562-b3fc-2c963f66afa6");
  assertEquals(ev.eventType, "message.received");
  assertEquals(ev.occurredAt, "2026-07-01T22:00:00.000Z");

  const weird = extractTelnyxEvent({ weird: true });
  assertEquals(weird.telnyxEventId, null);
  assertEquals(weird.eventType, "unknown");
  assertEquals(weird.occurredAt, null);

  const badTs = extractTelnyxEvent({ data: { id: 42, event_type: "x", occurred_at: "not-a-date" } });
  assertEquals(badTs.telnyxEventId, "42");
  assertEquals(badTs.occurredAt, null);
});

Deno.test("isAlertEvent matches suspension/deactivation family only", () => {
  assert(isAlertEvent("campaign.suspended"));
  assert(isAlertEvent("phone_number.deactivated"));
  assert(!isAlertEvent("message.received"));
  assert(!isAlertEvent("message.finalized"));
});

// ─── request gates ──────────────────────────────────────────────────────────
Deno.test("non-POST → 405", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const res = await handler(makeRequest({ method: "GET", token: FAKE_TOKEN }));
  assertEquals(res.status, 405);
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

Deno.test("missing TELNYX_WEBHOOK_TOKEN secret → 500 (fail-closed)", async () => {
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: MESSAGE_ENVELOPE }));
  assertEquals(res.status, 500);
});

Deno.test("wrong/missing token → 401, nothing stored", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: "wrong", body: MESSAGE_ENVELOPE }));
  assertEquals(res.status, 401);
  const res2 = await handler(makeRequest({ token: null, body: MESSAGE_ENVELOPE }));
  assertEquals(res2.status, 401);
  assertEquals(sb.callsForTable("telnyx_webhook_events").length, 0);
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

// ─── happy path / durability contract ───────────────────────────────────────
Deno.test("valid token, no public key → 200 stored, signature_verified=false", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  unsetEnv("TELNYX_PUBLIC_KEY");
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: MESSAGE_ENVELOPE }));
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.stored, true);
  assertEquals(out.event_type, "message.received");
  const row = insertedRow(sb);
  assertEquals(row.telnyx_event_id, "3fa85f64-5717-4562-b3fc-2c963f66afa6");
  assertEquals(row.event_type, "message.received");
  assertEquals(row.signature_verified, false);
  assertEquals(row.shop_id, null);
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

Deno.test("duplicate (23505) → 200 duplicate:true", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({ data: null, error: { code: "23505", message: "duplicate key value" } });
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: MESSAGE_ENVELOPE }));
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.duplicate, true);
  assertEquals(out.stored, false);
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

Deno.test("genuine store failure → 503 so Telnyx retries (no silent drop)", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith({ data: null, error: { code: "57014", message: "db down" } });
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: MESSAGE_ENVELOPE }));
  assertEquals(res.status, 503);
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

Deno.test("unparseable body → still stored with bounded raw text", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body: "{not json" }));
  assertEquals(res.status, 200);
  const row = insertedRow(sb);
  assertEquals(row.event_type, "unparseable");
  const payload = row.payload as Record<string, unknown>;
  assert(typeof payload._parse_error === "string");
  assertEquals(payload._raw_text, "{not json");
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

// ─── Ed25519 ────────────────────────────────────────────────────────────────
async function makeSignedFixture(body: string, tamper = false): Promise<{
  publicKeyB64: string;
  signatureB64: string;
  timestamp: string;
}> {
  const timestamp = "1782000000";
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const message = new TextEncoder().encode(`${timestamp}|${body}`);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey, message));
  if (tamper) sig[0] ^= 0xff;
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return { publicKeyB64: b64(raw), signatureB64: b64(sig), timestamp };
}

Deno.test("verifyTelnyxSignature: valid round-trip true; tampered false; garbage false", async () => {
  const body = JSON.stringify(MESSAGE_ENVELOPE);
  const ok = await makeSignedFixture(body);
  assert(await verifyTelnyxSignature(ok.publicKeyB64, ok.signatureB64, ok.timestamp, body));
  const bad = await makeSignedFixture(body, true);
  assert(!(await verifyTelnyxSignature(bad.publicKeyB64, bad.signatureB64, bad.timestamp, body)));
  assert(!(await verifyTelnyxSignature("!!notb64!!", "also-not", "0", body)));
});

Deno.test("signed request with key configured → stored signature_verified=true", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const body = JSON.stringify(MESSAGE_ENVELOPE);
  const fx = await makeSignedFixture(body);
  setEnv("TELNYX_PUBLIC_KEY", fx.publicKeyB64);
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({
    token: FAKE_TOKEN,
    body,
    extraHeaders: { "telnyx-signature-ed25519": fx.signatureB64, "telnyx-timestamp": fx.timestamp },
  }));
  assertEquals(res.status, 200);
  assertEquals(insertedRow(sb).signature_verified, true);
  unsetEnv("TELNYX_PUBLIC_KEY");
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

Deno.test("TAMPERED signature with key configured → 401, NOT stored", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const body = JSON.stringify(MESSAGE_ENVELOPE);
  const fx = await makeSignedFixture(body, true);
  setEnv("TELNYX_PUBLIC_KEY", fx.publicKeyB64);
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({
    token: FAKE_TOKEN,
    body,
    extraHeaders: { "telnyx-signature-ed25519": fx.signatureB64, "telnyx-timestamp": fx.timestamp },
  }));
  assertEquals(res.status, 401);
  assertEquals(sb.callsForTable("telnyx_webhook_events").length, 0);
  unsetEnv("TELNYX_PUBLIC_KEY");
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

Deno.test("key configured but headers absent → accepted on token, stored unverified", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  const body = JSON.stringify(MESSAGE_ENVELOPE);
  const fx = await makeSignedFixture(body);
  setEnv("TELNYX_PUBLIC_KEY", fx.publicKeyB64);
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({ token: FAKE_TOKEN, body }));
  assertEquals(res.status, 200);
  assertEquals(insertedRow(sb).signature_verified, false);
  unsetEnv("TELNYX_PUBLIC_KEY");
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});

// ─── secret-leak regression (2026-07-01 security-review blocker) ────────────
Deno.test("redactedRequestUrl strips ?token= (Sentry context can never carry the secret)", () => {
  const u = new URL(`https://x.test/fn?token=${FAKE_TOKEN}&a=1`);
  const redacted = redactedRequestUrl(u);
  assert(!redacted.includes(FAKE_TOKEN));
  assertEquals(redacted, "https://x.test/fn?a=1");
  assertEquals(redactedRequestUrl(new URL(`https://x.test/fn?token=${FAKE_TOKEN}`)), "https://x.test/fn");
});

Deno.test("sentry-edge scrubString redacts secret-bearing query params in URLs and bare query strings", () => {
  const url = `https://x.test/fn?token=${FAKE_TOKEN}&a=1`;
  const scrubbed = _scrubStringForTesting(url);
  assert(!scrubbed.includes(FAKE_TOKEN));
  assert(scrubbed.includes("token=[REDACTED]"));
  // bare query_string shape (no leading ? or &) is scrubbed too
  const qs = _scrubStringForTesting(`token=${FAKE_TOKEN}&b=2`);
  assert(!qs.includes(FAKE_TOKEN));
  // apikey variant
  assert(!_scrubStringForTesting("https://x.test/?apikey=sk-live-123").includes("sk-live-123"));
  // non-secret params survive
  assertEquals(_scrubStringForTesting("https://x.test/?a=1&b=2"), "https://x.test/?a=1&b=2");
});

// ─── redaction ──────────────────────────────────────────────────────────────
Deno.test("Authorization header + ?token= never reach the stored row", async () => {
  setEnv("TELNYX_WEBHOOK_TOKEN", FAKE_TOKEN);
  unsetEnv("TELNYX_PUBLIC_KEY");
  const sb = sbWith();
  _setSupabaseClientForTesting(sb);
  const res = await handler(makeRequest({
    token: FAKE_TOKEN,
    body: MESSAGE_ENVELOPE,
    extraHeaders: { Authorization: "Bearer super-secret", Cookie: "sid=1" },
  }));
  assertEquals(res.status, 200);
  const row = insertedRow(sb);
  const headers = row.raw_headers as Record<string, string>;
  assertEquals(headers["authorization"], undefined);
  assertEquals(headers["cookie"], undefined);
  const qs = row.raw_query_string as string | null;
  assert(qs === null || !qs.includes(FAKE_TOKEN));
  unsetEnv("TELNYX_WEBHOOK_TOKEN");
});
