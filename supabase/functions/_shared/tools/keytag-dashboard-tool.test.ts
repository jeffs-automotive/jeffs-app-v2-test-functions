// Deno-native unit tests for the pure reshape in keytag-dashboard-tool.ts.
//
// Run with:
//   deno test supabase/functions/_shared/tools/keytag-dashboard-tool.test.ts

import { assertEquals } from "jsr:@std/assert@^1";
import { toGridTile } from "./keytag-dashboard-tool.ts";
import type { KeytagRow } from "../keytag-dashboard-data.ts";

function row(overrides: Partial<KeytagRow> = {}): KeytagRow {
  return {
    tag_color: "red",
    tag_number: 5,
    status: "available",
    ro_id: null,
    ro_number: null,
    customer_id: null,
    assigned_at: null,
    posted_at: null,
    last_activity_at: null,
    ...overrides,
  };
}

Deno.test("toGridTile — available → in_use:false", () => {
  assertEquals(toGridTile(row({ status: "available" })), {
    tag_color: "red",
    tag_number: 5,
    in_use: false,
    status: "available",
    ro_number: null,
  });
});

Deno.test("toGridTile — assigned + posted_ar → in_use:true", () => {
  assertEquals(
    toGridTile(row({ status: "assigned", ro_number: 152222 })).in_use,
    true,
  );
  assertEquals(
    toGridTile(row({ status: "posted_ar", ro_number: 152300 })).in_use,
    true,
  );
});
