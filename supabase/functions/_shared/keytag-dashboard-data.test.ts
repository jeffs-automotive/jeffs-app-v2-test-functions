// Deno-native unit tests for the pure helpers in keytag-dashboard-data.ts.
//
// Run with:
//   deno test supabase/functions/_shared/keytag-dashboard-data.test.ts

import { assertEquals } from "jsr:@std/assert@^1";
import { customerDisplayName, labelStatus } from "./keytag-dashboard-data.ts";

Deno.test("customerDisplayName — person first+last", () => {
  assertEquals(
    customerDisplayName({ firstName: "Jane", lastName: "Doe" }),
    "Jane Doe",
  );
});

Deno.test("customerDisplayName — business (firstName only)", () => {
  assertEquals(
    customerDisplayName({ firstName: "Carmax", lastName: "" }),
    "Carmax",
  );
});

Deno.test("customerDisplayName — contact fallback when name blank", () => {
  assertEquals(
    customerDisplayName({
      firstName: "",
      lastName: "",
      contactFirstName: "Pat",
      contactLastName: "Smith",
    }),
    "Pat Smith",
  );
});

Deno.test("customerDisplayName — nothing usable → null", () => {
  assertEquals(customerDisplayName({}), null);
  assertEquals(customerDisplayName({ firstName: "  ", lastName: " " }), null);
});

Deno.test("labelStatus — POSTED + receivable → A/R", () => {
  assertEquals(labelStatus("POSTED"), "A/R");
  assertEquals(labelStatus("Accounts Receivable"), "A/R");
});

Deno.test("labelStatus — working / approved → WIP", () => {
  assertEquals(labelStatus("WORKING"), "WIP");
  assertEquals(labelStatus("Work Approved"), "WIP");
});

Deno.test("labelStatus — estimate / paid / blank / unknown", () => {
  assertEquals(labelStatus("ESTIMATE"), "Estimate");
  assertEquals(labelStatus("POSTED_PAID"), "Paid");
  assertEquals(labelStatus(""), "—");
  assertEquals(labelStatus("Some New Status"), "Some New Status");
});
