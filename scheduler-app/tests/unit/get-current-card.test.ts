import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 17 (2026-05-16) — canonical V2 view-builder test.
 *
 * getCurrentCard (lib/scheduler/wizard/get-current-card.ts) reads the
 * customer_chat_sessions row and dispatches on row.current_step to
 * build the discriminated-union WizardCard payload the page renders.
 *
 * Test scope (representative — covers the 3 highest-risk branches):
 *
 *   1. step=null OR row missing → defaults to { step: 'greeting' }.
 *   2. step='customer_notes' approval mode → calls parseCustomerNote
 *      with attempt=edit_attempts+1 and returns parsed_preview.
 *   3. step='completed' → builds appointment_label from
 *      appointment_date + appointment_time + appointment_type
 *      (waiter shows time, dropoff shows date only).
 *
 * Builds-on-top branches (vehicle_pick, summary, etc.) hit Tekmetric
 * via booking-direct-client which would require a much wider mock
 * surface; deferred to Phase 17.1 integration tests + E2E Playwright.
 */

import type { Mock } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

let storedRow: Record<string, unknown> | null = null;

// Plan 04 Phase 5B: getCurrentCard reads the session row via
// `getCachedSessionRow` (Next.js data cache, tag `session-${chatId}`).
// Mock the cache helper directly so tests don't need to wire through
// the supabase chain for the session-row read. Other reads in
// get-current-card (appointment_holds, routine_services,
// testing_services) still go through the supabase admin client mock.
let cachedRowThrows: Error | null = null;
vi.mock("@/lib/scheduler/cache", () => ({
  sessionTag: (chatId: string) => `session-${chatId}`,
  getCachedSessionRow: vi.fn(async (_chatId: string) => {
    if (cachedRowThrows) throw cachedRowThrows;
    return storedRow;
  }),
}));

const createSupabaseAdminClientMock: Mock = vi.fn(() => ({
  from(_table: string) {
    return {
      select(_cols: string) {
        return {
          eq(_col: string, _val: unknown) {
            return {
              async maybeSingle() {
                return { data: storedRow, error: null };
              },
            };
          },
        };
      },
    };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

const parseCustomerNoteMock: Mock = vi.fn();
vi.mock("@/lib/scheduler/wizard/llm/parse-customer-note", () => ({
  parseCustomerNote: (...args: unknown[]) => parseCustomerNoteMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// Booking-direct-client + routine-services-cache aren't exercised by the
// 3 paths under test, but get-current-card imports them at the top.
// Stub them so the import resolves cleanly.
vi.mock("@/lib/scheduler/booking-direct-client", () => ({
  fetchVehiclesForCustomer: vi.fn(),
  listWaiterTimes: vi.fn(),
  BookingDirectError: class BookingDirectError extends Error {},
}));

vi.mock("@/lib/scheduler/routine-services-cache", () => ({
  getRoutineServicesForChips: vi.fn(async () => []),
}));

vi.mock("@/lib/scheduler/wizard/build-summary-data", () => ({
  buildSummaryCardPayload: vi.fn(),
}));

vi.mock("@/lib/scheduler/wizard/availability", () => ({
  computeAvailableDates: vi.fn(async () => []),
  getEarliestAvailableDate: vi.fn(async () => null),
}));

import { getCurrentCard } from "@/lib/scheduler/wizard/get-current-card";

beforeEach(() => {
  storedRow = null;
  cachedRowThrows = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getCurrentCard", () => {
  it("returns null when the row doesn't exist", async () => {
    storedRow = null;
    const card = await getCurrentCard("sess-missing");
    expect(card).toBeNull();
  });

  it("falls back to step='greeting' when current_step is null on an existing row", async () => {
    storedRow = {
      id: "sess-1",
      current_step: null,
      phone_e164: null,
    };

    const card = await getCurrentCard("sess-1");
    expect(card).toEqual({ step: "greeting", payload: {} });
  });

  it("returns input-mode customer_notes payload when no prior text saved", async () => {
    storedRow = {
      id: "sess-1",
      current_step: "customer_notes",
      customer_notes_text: null,
      customer_notes_approved: null,
      customer_notes_edit_attempts: 0,
    };

    const card = await getCurrentCard("sess-1");
    expect(card).toEqual({
      step: "customer_notes",
      payload: {
        initial_text: null,
        parsed_preview: null,
        edit_attempts: 0,
      },
    });
    // No LLM call in input mode.
  });

  it("returns approval-mode customer_notes payload with the RAW note as the preview (LLM rewriter removed, revamp Phase 0)", async () => {
    storedRow = {
      id: "sess-1",
      current_step: "customer_notes",
      customer_notes_text: "Hey can you please not move the seats",
      customer_notes_approved: null,
      customer_notes_edit_attempts: 0,
      verified_first_name: "Sarah",
    };

    const card = await getCurrentCard("sess-1");
    expect(card?.step).toBe("customer_notes");
    if (card?.step === "customer_notes") {
      expect(card.payload.parsed_preview).toBe(
        "Hey can you please not move the seats",
      );
      expect(card.payload.edit_attempts).toBe(0);
    }
  });

  it("edit_attempts still tracks after a reject (edit path re-renders with the retyped raw note)", async () => {
    storedRow = {
      id: "sess-1",
      current_step: "customer_notes",
      customer_notes_text: "Dont move seats please",
      customer_notes_approved: null,
      customer_notes_edit_attempts: 1,
      verified_first_name: null,
      entered_first_name: "Sarah",
    };

    const card = await getCurrentCard("sess-1");
    if (card?.step === "customer_notes") {
      expect(card.payload.parsed_preview).toBe("Dont move seats please");
      expect(card.payload.edit_attempts).toBe(1);
    }
  });


  it("builds appointment_label with time for waiter appointments on the completed card", async () => {
    storedRow = {
      id: "sess-1",
      current_step: "completed",
      appointment_date: "2026-05-13",
      appointment_time: "08:00",
      appointment_type: "waiter",
      verified_first_name: "Sarah",
    };

    const card = await getCurrentCard("sess-1");
    expect(card?.step).toBe("completed");
    if (card?.step === "completed") {
      expect(card.payload.first_name).toBe("Sarah");
      expect(card.payload.allow_schedule_another).toBe(true);
      // Format depends on locale; assert structurally — must contain
      // a weekday + month + day + "at" + a time fragment.
      expect(card.payload.appointment_label).toMatch(/.*at.*\d/);
    }
  });

  it("builds appointment_label WITHOUT time for dropoff appointments", async () => {
    storedRow = {
      id: "sess-1",
      current_step: "completed",
      appointment_date: "2026-05-13",
      appointment_time: null,
      appointment_type: "dropoff",
      verified_first_name: null,
      entered_first_name: "Bob",
    };

    const card = await getCurrentCard("sess-1");
    expect(card?.step).toBe("completed");
    if (card?.step === "completed") {
      expect(card.payload.first_name).toBe("Bob");
      // Drop-off label has no "at <time>" segment.
      expect(card.payload.appointment_label).not.toMatch(/at \d/);
      // But it does still carry the date.
      expect(card.payload.appointment_label).toMatch(/May/);
    }
  });
});
