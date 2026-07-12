// Contract tests for qteklink-email (QTekLink's notification sender).
//
// This fn is the single transport for four LIVE alert paths (day-changed,
// date-move, mirror-apply notify, payroll alerts) — all of which send the
// legacy {to, subject, text} body. The payroll pay-summary work (plan
// 2026-07-12 §5.7, N2/N10/N15) added an ADDITIVE-only optional `html` field;
// these tests are the regression lock that the legacy contract is unchanged.
//
// Coverage:
//   - LEGACY CONTRACT: {to, subject, text} → 200 {ok:true, id}; Resend payload
//     carries from/to/subject/text and NO html key
//   - unknown-field tolerance unchanged (extra fields ignored, not forwarded)
//   - html passthrough: {..., html} → 200; Resend payload carries text AND html
//   - html cap: exactly 100k accepted; over 100k → 400 mentioning html, no send
//   - html present but wrong type / empty string → 400 mentioning html, no send
//   - html: null tolerated as absent (JSON-null=clear convention) → legacy send
//   - text stays REQUIRED: {to, subject, html} without text → 400, no send
//   - Resend rejection (5xx) with html present → 502 {ok:false, error:"send_failed"}
//   - invalid bearer → 401; non-POST → 405
//
// Run: deno test --allow-all --no-check supabase/functions/qteklink-email/index.test.ts

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  jsonResponse,
  type MockedFetchScope,
  setEnv,
  unsetEnv,
  withMockedFetch,
} from "../_shared/test-helpers.ts";
import { handler } from "./index.ts";

const FAKE_SECRET = "sb_secret_test_qtl_email_0123456789";
const FAKE_RESEND_KEY = "re_test_fake_key";

const LEGACY_BODY = {
  to: ["chris@jeffsautomotive.com"],
  subject: "Payroll day changed",
  text: "The 7/3 draft changed. Review it.",
};

/** Scope the auth + Resend env vars to one test body (save/restore). */
async function withEmailEnv(fn: () => Promise<void>): Promise<void> {
  const prevSecret = Deno.env.get("SUPABASE_SECRET_KEY");
  const prevResend = Deno.env.get("RESEND_API_KEY");
  setEnv("SUPABASE_SECRET_KEY", FAKE_SECRET);
  setEnv("RESEND_API_KEY", FAKE_RESEND_KEY);
  try {
    await fn();
  } finally {
    if (prevSecret === undefined) unsetEnv("SUPABASE_SECRET_KEY");
    else setEnv("SUPABASE_SECRET_KEY", prevSecret);
    if (prevResend === undefined) unsetEnv("RESEND_API_KEY");
    else setEnv("RESEND_API_KEY", prevResend);
  }
}

function makeRequest(opts: {
  method?: string;
  bearer?: string | null;
  body?: unknown | string;
} = {}): Request {
  const method = opts.method ?? "POST";
  const headers = new Headers({ "Content-Type": "application/json" });
  const bearer = opts.bearer === undefined ? FAKE_SECRET : opts.bearer;
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request("https://example.test/qteklink-email", init);
}

/** The single Resend call's JSON payload (asserts exactly one send happened). */
function resendPayload(scope: MockedFetchScope): Record<string, unknown> {
  assertEquals(scope.calls.length, 1);
  assertEquals(scope.calls[0].url, "https://api.resend.com/emails");
  return JSON.parse(String(scope.calls[0].init?.body)) as Record<string, unknown>;
}

// ─── legacy contract (the four live alert paths) ────────────────────────────

Deno.test("LEGACY: {to, subject, text} still returns 200 and forwards NO html key", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.resolve(jsonResponse({ id: "email_legacy_1" })),
      async (scope) => {
        const res = await handler(makeRequest({ body: LEGACY_BODY }));
        assertEquals(res.status, 200);
        const out = await res.json();
        assertEquals(out, { ok: true, id: "email_legacy_1" });
        const payload = resendPayload(scope);
        assertExists(payload.from);
        assertEquals(payload.to, LEGACY_BODY.to);
        assertEquals(payload.subject, LEGACY_BODY.subject);
        assertEquals(payload.text, LEGACY_BODY.text);
        assertEquals("html" in payload, false);
      },
    )
  );
});

Deno.test("LEGACY: unknown-field tolerance unchanged — extra fields ignored, not forwarded", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.resolve(jsonResponse({ id: "email_legacy_2" })),
      async (scope) => {
        const res = await handler(
          makeRequest({ body: { ...LEGACY_BODY, priority: 7, foo: "bar" } }),
        );
        assertEquals(res.status, 200);
        assertEquals((await res.json()).ok, true);
        const payload = resendPayload(scope);
        assertEquals("priority" in payload, false);
        assertEquals("foo" in payload, false);
        assertEquals("html" in payload, false);
      },
    )
  );
});

// ─── html passthrough ────────────────────────────────────────────────────────

Deno.test("html: valid string is passed through to Resend alongside text", async () => {
  const html = "<h1>Pay summary for Matt Clark</h1><p>Jun 28 – Jul 11</p>";
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.resolve(jsonResponse({ id: "email_html_1" })),
      async (scope) => {
        const res = await handler(makeRequest({ body: { ...LEGACY_BODY, html } }));
        assertEquals(res.status, 200);
        assertEquals((await res.json()).id, "email_html_1");
        const payload = resendPayload(scope);
        assertEquals(payload.text, LEGACY_BODY.text);
        assertEquals(payload.html, html);
      },
    )
  );
});

Deno.test("html: exactly 100000 chars is accepted (cap boundary)", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.resolve(jsonResponse({ id: "email_html_cap" })),
      async (scope) => {
        const html = "x".repeat(100_000);
        const res = await handler(makeRequest({ body: { ...LEGACY_BODY, html } }));
        assertEquals(res.status, 200);
        assertEquals((await res.json()).ok, true);
        assertEquals((resendPayload(scope).html as string).length, 100_000);
      },
    )
  );
});

Deno.test("html: over 100k → 400 mentioning html, nothing sent", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.reject(new Error("must not be called")),
      async (scope) => {
        const html = "x".repeat(100_001);
        const res = await handler(makeRequest({ body: { ...LEGACY_BODY, html } }));
        assertEquals(res.status, 400);
        assert(String((await res.json()).error).includes("html"));
        assertEquals(scope.calls.length, 0);
      },
    )
  );
});

Deno.test("html: wrong type → 400 mentioning html (no silent text-only fallback), nothing sent", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.reject(new Error("must not be called")),
      async (scope) => {
        const res = await handler(makeRequest({ body: { ...LEGACY_BODY, html: 123 } }));
        assertEquals(res.status, 400);
        assert(String((await res.json()).error).includes("html"));
        assertEquals(scope.calls.length, 0);
      },
    )
  );
});

Deno.test("html: empty string → 400 mentioning html, nothing sent", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.reject(new Error("must not be called")),
      async (scope) => {
        const res = await handler(makeRequest({ body: { ...LEGACY_BODY, html: "" } }));
        assertEquals(res.status, 400);
        assert(String((await res.json()).error).includes("html"));
        assertEquals(scope.calls.length, 0);
      },
    )
  );
});

Deno.test("html: null is tolerated as absent → legacy plain-text send", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.resolve(jsonResponse({ id: "email_null_html" })),
      async (scope) => {
        const res = await handler(makeRequest({ body: { ...LEGACY_BODY, html: null } }));
        assertEquals(res.status, 200);
        assertEquals((await res.json()).ok, true);
        assertEquals("html" in resendPayload(scope), false);
      },
    )
  );
});

Deno.test("text stays REQUIRED: {to, subject, html} without text → 400, nothing sent", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.reject(new Error("must not be called")),
      async (scope) => {
        const res = await handler(
          makeRequest({ body: { to: LEGACY_BODY.to, subject: LEGACY_BODY.subject, html: "<p>hi</p>" } }),
        );
        assertEquals(res.status, 400);
        assert(String((await res.json()).error).includes("text"));
        assertEquals(scope.calls.length, 0);
      },
    )
  );
});

// ─── error + auth paths around the change ────────────────────────────────────

Deno.test("Resend rejection with html present → 502 send_failed (loud, not swallowed)", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.resolve(jsonResponse({ message: "invalid recipient" }, 422)),
      async () => {
        const res = await handler(
          makeRequest({ body: { ...LEGACY_BODY, html: "<p>hi</p>" } }),
        );
        assertEquals(res.status, 502);
        assertEquals(await res.json(), { ok: false, error: "send_failed" });
      },
    )
  );
});

Deno.test("invalid bearer → 401; non-POST → 405 (unchanged)", async () => {
  await withEmailEnv(() =>
    withMockedFetch(
      () => Promise.reject(new Error("must not be called")),
      async (scope) => {
        const unauthorized = await handler(
          makeRequest({ bearer: "wrong-key", body: LEGACY_BODY }),
        );
        assertEquals(unauthorized.status, 401);
        const wrongMethod = await handler(makeRequest({ method: "GET" }));
        assertEquals(wrongMethod.status, 405);
        assertEquals(scope.calls.length, 0);
      },
    )
  );
});
