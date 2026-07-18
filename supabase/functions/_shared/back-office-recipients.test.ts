// Deno unit tests for back-office alert recipient selection.
// Run: deno test supabase/functions/_shared/back-office-recipients.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { recipientsFor } from "./back-office-recipients.ts";

const blob = {
  sa_emails: ["sa@shop.com"],
  office_emails: ["office@shop.com"],
  accounting_emails: ["acct@shop.com"],
  reopened_emails: ["reopen1@shop.com", "reopen2@shop.com"],
};

Deno.test("detected → reopened_emails ONLY (not office/accounting)", () => {
  assertEquals(recipientsFor("detected", blob), ["reopen1@shop.com", "reopen2@shop.com"]);
});

Deno.test("detected with no reopened_emails → [] (no fallback, no send)", () => {
  assertEquals(recipientsFor("detected", { ...blob, reopened_emails: [] }), []);
  assertEquals(recipientsFor("detected", { sa_emails: ["sa@shop.com"], office_emails: ["office@shop.com"] }), []);
});

Deno.test("other events are unchanged by the reopened list", () => {
  assertEquals(recipientsFor("sent_to_sa", blob), ["sa@shop.com"]);
  assertEquals(recipientsFor("sa_submitted", blob), ["office@shop.com", "acct@shop.com"]);
  assertEquals(recipientsFor("ro_closed", blob), ["office@shop.com"]);
  assertEquals(recipientsFor("verified", blob), ["sa@shop.com", "office@shop.com", "acct@shop.com"]);
});

Deno.test("invalid addresses are filtered; dupes de-duped", () => {
  assertEquals(recipientsFor("detected", { reopened_emails: ["ok@shop.com", "nope", "ok@shop.com", 42] }), ["ok@shop.com"]);
});
