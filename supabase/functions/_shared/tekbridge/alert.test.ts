// Deno-native unit tests for the tekbridge operator alerting.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/alert.test.ts

import { assert, assertEquals } from "jsr:@std/assert@^1";
import { clearBotAlert, sendBotSessionAlert } from "./alert.ts";

const realFetch = globalThis.fetch;

interface SbState {
  lastAlertAt: string | null;
  upserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
}
// deno-lint-ignore no-explicit-any
function makeSb(state: SbState): any {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { last_alert_at: state.lastAlertAt }, error: null }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        state.upserts.push(row);
        return Promise.resolve({ error: null });
      },
      update: (row: Record<string, unknown>) => ({
        eq: () => {
          state.updates.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

const ALERT = { reason: "chain broke", detail: "401 from Tekmetric" };

Deno.test("sendBotSessionAlert: sends + stamps when no prior alert", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const state: SbState = { lastAlertAt: null, upserts: [], updates: [] };
  const box = { n: 0 };
  globalThis.fetch = ((i: string | URL | Request) => {
    if (i.toString().includes("api.resend.com")) box.n++;
    return Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await sendBotSessionAlert(makeSb(state), 7476, ALERT);
    assertEquals(r.emailed, true);
    assertEquals(box.n, 1, "one Resend call");
    assertEquals(state.upserts.length, 1);
    assert(state.upserts[0].last_alert_at, "stamped last_alert_at");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendBotSessionAlert: de-dupes within the window (no email)", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const state: SbState = { lastAlertAt: new Date().toISOString(), upserts: [], updates: [] };
  const box = { n: 0 };
  globalThis.fetch = ((i: string | URL | Request) => {
    if (i.toString().includes("api.resend.com")) box.n++;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await sendBotSessionAlert(makeSb(state), 7476, ALERT);
    assertEquals(r.emailed, false);
    assertEquals(r.reason, "deduped");
    assertEquals(box.n, 0, "no Resend call when deduped");
    assertEquals(state.upserts.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendBotSessionAlert: sends again once the window has elapsed", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const thirteenHoursAgo = new Date(Date.now() - 13 * 3_600_000).toISOString();
  const state: SbState = { lastAlertAt: thirteenHoursAgo, upserts: [], updates: [] };
  const box = { n: 0 };
  globalThis.fetch = ((i: string | URL | Request) => {
    if (i.toString().includes("api.resend.com")) box.n++;
    return Promise.resolve(new Response(JSON.stringify({ id: "re_2" }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await sendBotSessionAlert(makeSb(state), 7476, ALERT);
    assertEquals(r.emailed, true);
    assertEquals(box.n, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendBotSessionAlert: reports emailed:false when Resend has no key", async () => {
  Deno.env.delete("RESEND_API_KEY");
  const state: SbState = { lastAlertAt: null, upserts: [], updates: [] };
  const r = await sendBotSessionAlert(makeSb(state), 7476, ALERT);
  assertEquals(r.emailed, false);
  assertEquals(state.upserts.length, 0, "no stamp when the email didn't send");
});

Deno.test("clearBotAlert: nulls last_alert_at", async () => {
  const state: SbState = { lastAlertAt: new Date().toISOString(), upserts: [], updates: [] };
  await clearBotAlert(makeSb(state), 7476);
  assertEquals(state.updates.length, 1);
  assertEquals(state.updates[0].last_alert_at, null);
});
