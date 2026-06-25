// Deno-native unit tests for the pure helpers in keytag-dashboard-data.ts.
//
// Run with:
//   deno test supabase/functions/_shared/keytag-dashboard-data.test.ts

import { assertEquals } from "jsr:@std/assert@^1";
import {
  buildKeytagDashboardData,
  customerDisplayName,
  labelStatus,
} from "./keytag-dashboard-data.ts";
import { createMockSupabaseClient, withMockedFetch } from "./test-helpers.ts";

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

// ─── The snapshot builder: customer names come from the DB, NOT Tekmetric ─────
// Regression guard for the 2026-06-25 board "spin" root cause: the dashboard
// used to resolve customer names with a serial 125ms-per-customer Tekmetric walk
// that could exceed 45s and blocked every /keytags render. It now reads the
// denormalized keytags.customer_name. This test fails if the Tekmetric walk
// ever comes back (the mocked fetch throws on any call).
Deno.test("buildKeytagDashboardData — reads customer_name from the DB, never walks Tekmetric", async () => {
  const sb = createMockSupabaseClient();
  const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
  sb.onTable("keytags", {
    data: [
      {
        tag_color: "red",
        tag_number: 84,
        status: "assigned",
        ro_id: 338230427,
        ro_number: 153380,
        customer_id: 1001,
        customer_name: "Jean Ullman",
        assigned_at: fiveDaysAgo,
        posted_at: null,
        last_activity_at: fiveDaysAgo, // > STALE_DAYS(3) → stale
      },
      {
        tag_color: "red",
        tag_number: 1,
        status: "available",
        ro_id: null,
        ro_number: null,
        customer_id: null,
        customer_name: null,
        assigned_at: null,
        posted_at: null,
        last_activity_at: null,
      },
    ],
    error: null,
  });
  sb.onTable("keytag_manual_reviews", { data: [], error: null });

  await withMockedFetch(
    () => {
      throw new Error(
        "Tekmetric fetch must NOT happen — the dashboard reads customer_name from the DB",
      );
    },
    async (scope) => {
      const snap = await buildKeytagDashboardData(
        sb as unknown as Parameters<typeof buildKeytagDashboardData>[0],
        7476,
      );
      assertEquals(snap.inUseCount, 1);
      assertEquals(snap.availableCount, 1);
      assertEquals(snap.staleDetails.length, 1);
      // Name is the denormalized DB value — not a Tekmetric lookup.
      assertEquals(snap.staleDetails[0].customer_name, "Jean Ullman");
      // Zero external calls — the whole snapshot is a pure DB read.
      assertEquals(scope.calls.length, 0);
    },
  );
});
