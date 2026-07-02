// Tests for the telnyx-webhook Phase-2 consumers (STOP/HELP + DLR).
//
// Run: deno test --allow-all --no-check supabase/functions/telnyx-webhook/consumers.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createMockSupabaseClient } from "../_shared/test-helpers.ts";
import {
  classifyInboundKeyword,
  extractMessagePayload,
  processMessageEvent,
} from "./consumers.ts";

// deno-lint-ignore no-explicit-any
type AnySb = any;

function inboundEnvelope(text: string, opts: { id?: string } = {}) {
  return {
    data: {
      id: "evt-1",
      event_type: "message.received",
      payload: {
        id: opts.id ?? "msg-inbound-1",
        direction: "inbound",
        text,
        from: { phone_number: "+16105551234" },
        to: [{ phone_number: "+14846278453" }],
      },
    },
  } as Record<string, unknown>;
}

Deno.test("classifyInboundKeyword — CTIA single-word semantics", () => {
  assertEquals(classifyInboundKeyword("STOP"), "stop");
  assertEquals(classifyInboundKeyword("  stop "), "stop");
  assertEquals(classifyInboundKeyword("Stop!"), "stop");
  assertEquals(classifyInboundKeyword("UNSUBSCRIBE"), "stop");
  assertEquals(classifyInboundKeyword("START"), "start");
  assertEquals(classifyInboundKeyword("unstop"), "start");
  assertEquals(classifyInboundKeyword("HELP"), "help");
  assertEquals(classifyInboundKeyword("please stop texting me"), null); // sentence ≠ keyword
  assertEquals(classifyInboundKeyword("running late, be there at 8"), null);
  assertEquals(classifyInboundKeyword(""), null);
  assertEquals(classifyInboundKeyword(null), null);
});

Deno.test("extractMessagePayload — envelope unwrap", () => {
  const p = extractMessagePayload(inboundEnvelope("STOP"));
  assert(p);
  assertEquals(p?.from?.phone_number, "+16105551234");
  assertEquals(extractMessagePayload({}), null);
});

Deno.test("STOP revokes active consents + ledgers inbound (even unsigned)", async () => {
  const sb = createMockSupabaseClient();
  sb.onTable("sms_consents", { data: [{ id: "c1" }], error: null });
  sb.onTable("sms_messages", { data: null, error: null });

  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.received",
    body: inboundEnvelope("STOP"),
    signatureVerified: false, // spoofable STOP still acts — fail toward not-sending
  });

  const ledger = sb.callsForTable("sms_messages");
  assertEquals(ledger.length, 1);
  assertEquals(ledger[0].chain[0].method, "insert");
  const inserted = ledger[0].chain[0].args[0] as Record<string, unknown>;
  assertEquals(inserted.kind, "inbound");
  assertEquals(inserted.status, "received");

  const consent = sb.callsForTable("sms_consents");
  assertEquals(consent.length, 1);
  assertEquals(consent[0].chain[0].method, "update");
  const patch = consent[0].chain[0].args[0] as Record<string, unknown>;
  assertEquals(patch.revoke_source, "sms_stop");
  assert(typeof patch.revoked_at === "string");
});

Deno.test("START on an UNSIGNED delivery is ignored (no consent writes)", async () => {
  const sb = createMockSupabaseClient();
  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.received",
    body: inboundEnvelope("START"),
    signatureVerified: false,
  });
  assertEquals(sb.callsForTable("sms_consents").length, 0);
  // inbound still ledgered
  assertEquals(sb.callsForTable("sms_messages").length, 1);
});

Deno.test("signed START re-grants only when a prior consent exists", async () => {
  const sb = createMockSupabaseClient();
  sb.onTable("sms_consents", (call) => {
    const first = call.chain[0]?.method;
    if (first === "select") return { data: { shop_id: 7476 }, error: null }; // prior revoked row
    return { data: null, error: null }; // insert ok
  });

  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.received",
    body: inboundEnvelope("START"),
    signatureVerified: true,
  });

  const consentCalls = sb.callsForTable("sms_consents");
  assertEquals(consentCalls.length, 2); // lookup + insert
  const insert = consentCalls[1];
  assertEquals(insert.chain[0].method, "insert");
  const row = insert.chain[0].args[0] as Record<string, unknown>;
  assertEquals(row.acquisition_medium, "sms_start");
  assertEquals(row.shop_id, 7476);
});

Deno.test("signed START with NO prior consent does not mint one", async () => {
  const sb = createMockSupabaseClient();
  sb.onTable("sms_consents", (call) => {
    const first = call.chain[0]?.method;
    if (first === "select") return { data: null, error: null }; // no prior row
    return { data: null, error: null };
  });
  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.received",
    body: inboundEnvelope("START"),
    signatureVerified: true,
  });
  const consentCalls = sb.callsForTable("sms_consents");
  assertEquals(consentCalls.length, 1); // lookup only, no insert
});

Deno.test("HELP is ledgered but touches no consent rows", async () => {
  const sb = createMockSupabaseClient();
  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.received",
    body: inboundEnvelope("HELP"),
    signatureVerified: true,
  });
  assertEquals(sb.callsForTable("sms_consents").length, 0);
  assertEquals(sb.callsForTable("sms_messages").length, 1);
});

Deno.test("message.finalized DLR updates status by telnyx_message_id", async () => {
  const sb = createMockSupabaseClient();
  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.finalized",
    body: {
      data: {
        event_type: "message.finalized",
        payload: { id: "msg-out-9", to: [{ status: "delivered" }] },
      },
    },
    signatureVerified: true,
  });
  const calls = sb.callsForTable("sms_messages");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].chain[0].method, "update");
  const patch = calls[0].chain[0].args[0] as Record<string, unknown>;
  assertEquals(patch.status, "delivered");
  // targeted by telnyx_message_id
  const eq = calls[0].chain.find((c) => c.method === "eq");
  assertEquals(eq?.args, ["telnyx_message_id", "msg-out-9"]);
});

Deno.test("failed DLR maps to status=failed with error detail", async () => {
  const sb = createMockSupabaseClient();
  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.finalized",
    body: {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "msg-out-10",
          to: [{ status: "delivery_failed" }],
          errors: [{ code: "40008", title: "Blocked by STOP" }],
        },
      },
    },
    signatureVerified: true,
  });
  const patch = sb.callsForTable("sms_messages")[0].chain[0].args[0] as Record<string, unknown>;
  assertEquals(patch.status, "failed");
  assert(String(patch.status_detail).includes("40008"));
});

Deno.test("consumer never throws — sb errors are swallowed into logEdgeError", async () => {
  const sb = createMockSupabaseClient();
  sb.onTable("sms_messages", { data: null, error: { message: "boom" } });
  sb.onTable("sms_consents", { data: null, error: { message: "boom" } });
  // Must not throw even when everything fails.
  await processMessageEvent({
    sb: sb as AnySb,
    eventType: "message.received",
    body: inboundEnvelope("STOP"),
    signatureVerified: false,
  });
  // scheduler_error_log writes happened via logEdgeError
  assert(sb.callsForTable("scheduler_error_log").length >= 1);
});
