import { assertEquals } from "jsr:@std/assert@1";

/**
 * scheduler-auth is the Pattern-A operator bearer gate. The H5 fix wires
 * checkSchedulerBearer as the FIRST statement of keytag-seed-from-tekmetric (and,
 * until they were removed 2026-07-23, the retired tekmetric-list-wip-keytags /
 * tekmetric-find-ro-by-keytag operator fns) — previously verify_jwt=true with no
 * in-handler auth (the publishable anon key, a signature-valid Supabase JWT,
 * reached them). These tests pin the security-critical behavior the gate
 * guarantees: only the service-role/secret key passes; an anon JWT (or no
 * bearer) is rejected 401.
 *
 * scheduler-auth reads the key env at MODULE LOAD, so set it BEFORE the dynamic import.
 */
const VALID = "sb_secret_unit_test_service_role_key_0123456789abcdef";
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", VALID);
Deno.env.delete("SUPABASE_SECRET_KEY");
Deno.env.delete("SUPABASE_SECRET_KEYS");

const { checkSchedulerBearer, unauthorizedResponse, bearersEqual } = await import(
  "./scheduler-auth.ts"
);

const req = (headers?: Record<string, string>): Request =>
  new Request("http://localhost/", { method: "GET", headers });

Deno.test("checkSchedulerBearer — no Authorization header → not ok (missing_bearer)", () => {
  const r = checkSchedulerBearer(req(), "test-fn");
  assertEquals(r.ok, false);
  assertEquals(r.reason, "missing_bearer");
});

Deno.test("checkSchedulerBearer — anon/publishable JWT bearer → not ok (bearer_mismatch)", () => {
  const r = checkSchedulerBearer(
    req({
      authorization:
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-publishable.signature",
    }),
    "test-fn",
  );
  assertEquals(r.ok, false);
  assertEquals(r.reason, "bearer_mismatch");
});

Deno.test("checkSchedulerBearer — the service-role/secret key → ok", () => {
  const r = checkSchedulerBearer(req({ authorization: `Bearer ${VALID}` }), "test-fn");
  assertEquals(r.ok, true);
});

Deno.test("unauthorizedResponse — returns HTTP 401", () => {
  const res = unauthorizedResponse({ ok: false, reason: "bearer_mismatch" });
  assertEquals(res.status, 401);
});

Deno.test("bearersEqual — constant-time compare matches only the exact key", () => {
  assertEquals(bearersEqual(VALID, VALID), true);
  assertEquals(bearersEqual(VALID, VALID + "x"), false);
  assertEquals(bearersEqual("anon", VALID), false);
});
