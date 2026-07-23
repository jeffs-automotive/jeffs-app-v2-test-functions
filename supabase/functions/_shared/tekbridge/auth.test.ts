// Deno-native unit tests for the tekbridge gateway auth.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/auth.test.ts

import { assert, assertEquals } from "jsr:@std/assert@^1";
import {
  authenticateServiceRole,
  isAllowedAdminEmail,
  timingSafeStringEqual,
} from "./auth.ts";

const SR = "service-role-secret-key";
const BEARERS = [SR];

function req(headers: Record<string, string>): Request {
  return new Request("https://x/functions/v1/tekbridge", { headers });
}

Deno.test("timingSafeStringEqual", () => {
  assert(timingSafeStringEqual("abc", "abc"));
  assert(!timingSafeStringEqual("abc", "abd"));
  assert(!timingSafeStringEqual("abc", "abcd")); // length differ
});

Deno.test("isAllowedAdminEmail", () => {
  assert(isAllowedAdminEmail("chris@jeffsautomotive.com"));
  assert(isAllowedAdminEmail("Chris@JeffsAutomotive.COM"));
  assert(!isAllowedAdminEmail("evil@gmail.com"));
  assert(!isAllowedAdminEmail("nodomain"));
  assert(!isAllowedAdminEmail("x@jeffsautomotive.com\ninjected: y")); // header injection
  assert(!isAllowedAdminEmail(""));
});

Deno.test("authenticateServiceRole: missing / malformed token", () => {
  assertEquals(authenticateServiceRole(req({}), BEARERS), { ok: false, reason: "missing_token" });
  assertEquals(
    authenticateServiceRole(req({ Authorization: "Basic xyz" }), BEARERS),
    { ok: false, reason: "invalid_token" },
  );
  assertEquals(
    authenticateServiceRole(req({ Authorization: "Bearer wrong-key", "X-Actor-Email": "chris@jeffsautomotive.com" }), BEARERS),
    { ok: false, reason: "invalid_token" },
  );
});

Deno.test("authenticateServiceRole: valid bearer needs a valid actor", () => {
  assertEquals(
    authenticateServiceRole(req({ Authorization: `Bearer ${SR}` }), BEARERS),
    { ok: false, reason: "missing_actor_email" },
  );
  assertEquals(
    authenticateServiceRole(req({ Authorization: `Bearer ${SR}`, "X-Actor-Email": "evil@gmail.com" }), BEARERS),
    { ok: false, reason: "invalid_actor_email_domain" },
  );
});

Deno.test("authenticateServiceRole: success lowercases the actor", () => {
  const r = authenticateServiceRole(
    req({ Authorization: `Bearer ${SR}`, "X-Actor-Email": "Chris@Jeffsautomotive.com" }),
    BEARERS,
  );
  assertEquals(r, { ok: true, actorEmail: "chris@jeffsautomotive.com" });
});
