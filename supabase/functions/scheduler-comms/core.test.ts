// Tests for scheduler-comms core (revamp Phase 3).
//
// Run: deno test --allow-all --no-check supabase/functions/scheduler-comms/core.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createMockSupabaseClient } from "../_shared/test-helpers.ts";
import {
  dispatchKind,
  isWithinQuietHoursSendWindow,
  renderTemplate,
  type Senders,
  type SendTarget,
} from "./core.ts";

// deno-lint-ignore no-explicit-any
type AnySb = any;

function target(overrides: Partial<SendTarget> = {}): SendTarget {
  return {
    shop_id: 7476,
    tekmetric_appointment_id: 999123,
    appointment_type_slug: "dropoff",
    start_time: "2026-07-10T12:00:00.000Z",
    phone_e164: "+16105551234",
    email: "pat@example.com",
    first_name: "Pat",
    vehicle: "2019 Honda Accord",
    services_summary: "Oil change",
    ...overrides,
  };
}

function makeSenders(overrides: Partial<Senders> = {}): Senders & {
  smsCalls: Array<{ phone: string; text: string; context: string }>;
  emailCalls: Array<{ to: string; subject: string }>;
} {
  const smsCalls: Array<{ phone: string; text: string; context: string }> = [];
  const emailCalls: Array<{ to: string; subject: string }> = [];
  return {
    smsCalls,
    emailCalls,
    sendSms: overrides.sendSms ??
      ((phone, text, context) => {
        smsCalls.push({ phone, text, context });
        return Promise.resolve({ ok: true, provider_message_id: "tx-1" });
      }),
    sendEmail: overrides.sendEmail ??
      ((args) => {
        emailCalls.push({ to: args.to, subject: args.subject });
        return Promise.resolve({ ok: true, status: 200, id: "re-1" });
      }),
  };
}

const TEMPLATE_ROW = {
  subject: "Confirmed — {{shop_name}}",
  body:
    "Jeff's Automotive: {{appointment_type_label}} confirmed {{appointment_date}}{{appointment_time_suffix}}. Call {{shop_phone}}.",
};

/** Standard sb wiring: templates resolve, consents active, claims succeed. */
function makeSb(opts: {
  consent?: boolean;
  claimBehavior?: "ok" | "conflict";
  template?: typeof TEMPLATE_ROW | null;
} = {}) {
  const sb = createMockSupabaseClient();
  let claimCount = 0;
  sb.onTable("scheduler_reminders", (call) => {
    const m = call.chain[0]?.method;
    if (m === "insert") {
      if (opts.claimBehavior === "conflict") {
        return { data: null, error: { message: "dup", code: "23505" } as never };
      }
      claimCount += 1;
      return { data: { id: `claim-${claimCount}` }, error: null };
    }
    return { data: null, error: null }; // settle updates
  });
  sb.onTable("scheduler_message_templates", {
    data: opts.template === undefined ? TEMPLATE_ROW : opts.template,
    error: null,
  });
  sb.onTable("sms_consents", {
    data: (opts.consent ?? true) ? { id: "c1" } : null,
    error: null,
  });
  sb.onTable("scheduler_appointment_types", { data: [], error: null });
  sb.onTable("sms_messages", { data: null, error: null });
  return sb;
}

Deno.test("renderTemplate — fail-closed on unknown tokens", () => {
  const bad = renderTemplate("Hello {{nope}}", { first_name: "x" });
  assert(!bad.ok);
  const good = renderTemplate("Hi {{first_name}}", { first_name: "Pat" });
  assert(good.ok && good.text === "Hi Pat");
});

Deno.test("dispatchKind — happy path sends BOTH channels + ledgers the SMS", async () => {
  const sb = makeSb();
  const senders = makeSenders();
  const out = await dispatchKind(sb as AnySb, senders, target(), "confirmation");
  assertEquals(out.email, "sent");
  assertEquals(out.sms, "sent");
  assertEquals(senders.emailCalls.length, 1);
  assertEquals(senders.smsCalls.length, 1);
  assert(senders.smsCalls[0].text.includes("Jeff's Automotive"));
  // outbound sms ledgered for DLR correlation
  assertEquals(sb.callsForTable("sms_messages").length, 1);
});

Deno.test("dispatchKind — NO consent → SMS skipped, email still sends", async () => {
  const sb = makeSb({ consent: false });
  const senders = makeSenders();
  const out = await dispatchKind(sb as AnySb, senders, target(), "reminder_24h");
  assertEquals(out.email, "sent");
  assertEquals(out.sms, "skipped");
  assertEquals(senders.smsCalls.length, 0);
  // the skip is settled with no_consent
  const settles = sb
    .callsForTable("scheduler_reminders")
    .filter((c) => c.chain[0]?.method === "update");
  assert(
    settles.some(
      (c) =>
        (c.chain[0].args[0] as Record<string, unknown>).skip_reason ===
          "no_consent",
    ),
  );
});

Deno.test("dispatchKind — stub provider → SMS skipped (provider_stub), claim stands", async () => {
  const sb = makeSb();
  const senders = makeSenders({
    sendSms: () =>
      Promise.resolve({ ok: true, provider_message_id: "stub-no-send" }),
  });
  const out = await dispatchKind(sb as AnySb, senders, target(), "confirmation");
  assertEquals(out.sms, "skipped");
  const settles = sb
    .callsForTable("scheduler_reminders")
    .filter((c) => c.chain[0]?.method === "update");
  assert(
    settles.some(
      (c) =>
        (c.chain[0].args[0] as Record<string, unknown>).skip_reason ===
          "provider_stub",
    ),
  );
});

Deno.test("dispatchKind — already claimed → nothing sends (idempotency)", async () => {
  const sb = makeSb({ claimBehavior: "conflict" });
  const senders = makeSenders();
  const out = await dispatchKind(sb as AnySb, senders, target(), "confirmation");
  assertEquals(out.email, "already_claimed");
  assertEquals(out.sms, "already_claimed");
  assertEquals(senders.emailCalls.length, 0);
  assertEquals(senders.smsCalls.length, 0);
});

Deno.test("dispatchKind — missing contact → skipped no_contact", async () => {
  const sb = makeSb();
  const senders = makeSenders();
  const out = await dispatchKind(
    sb as AnySb,
    senders,
    target({ phone_e164: null, email: null }),
    "reminder_2h",
  );
  assertEquals(out.email, "skipped");
  assertEquals(out.sms, "skipped");
  assertEquals(senders.emailCalls.length, 0);
});

Deno.test("dispatchKind — no template → skipped no_template (fail closed)", async () => {
  const sb = makeSb({ template: null });
  const senders = makeSenders();
  const out = await dispatchKind(sb as AnySb, senders, target(), "confirmation");
  assertEquals(out.email, "skipped");
  assertEquals(out.sms, "skipped");
  assertEquals(senders.emailCalls.length, 0);
  assertEquals(senders.smsCalls.length, 0);
});

Deno.test("dispatchKind — SMS provider failure → failed with error detail", async () => {
  const sb = makeSb();
  const senders = makeSenders({
    sendSms: () =>
      Promise.resolve({ ok: false, error_code: "auth", detail: "401" }),
  });
  const out = await dispatchKind(sb as AnySb, senders, target(), "confirmation");
  assertEquals(out.sms, "failed");
});

Deno.test("quiet hours — 8am..8:59pm shop-local sends; night blocks", () => {
  // 2026-07-10 (EDT, UTC-4): 12:00Z = 8am ET → allowed; 03:00Z = 11pm ET
  // (prev day) → blocked; 23:00Z = 7pm ET → allowed; 02:30Z = 10:30pm → blocked.
  assert(isWithinQuietHoursSendWindow(Date.parse("2026-07-10T12:00:00Z")));
  assert(isWithinQuietHoursSendWindow(Date.parse("2026-07-10T23:00:00Z")));
  assert(!isWithinQuietHoursSendWindow(Date.parse("2026-07-10T03:00:00Z")));
  assert(!isWithinQuietHoursSendWindow(Date.parse("2026-07-11T02:30:00Z")));
});
