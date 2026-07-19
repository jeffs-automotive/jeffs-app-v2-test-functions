/**
 * Unit tests for submitTestingServiceApprovalV2 — focused on the D1/INV-8
 * SYMMETRIC approve/decline write:
 *
 *   finalApproved  = (existingApproved ∪ newApproved) with acted keys cleared
 *   finalDeclined  = (existingDeclined ∪ newDeclined) − finalApproved
 *
 * Every key the customer acted on THIS submit is cleared from BOTH prior sets
 * first (re-decline safety) so a re-decline of a previously-approved service
 * isn't silently stripped, and prior declines that aren't touched this submit
 * survive (no overwrite).
 *
 * Mocks: applyWizardTransition + Sentry + logError at the module boundary; a
 * supabase mock that serves the session row read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: vi.fn(async () => undefined),
}));

interface AwtCall {
  chatId: string;
  nextStep: string;
  jeffBubble?: string;
  updates?: Record<string, unknown>;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

let sessionRow: Record<string, unknown> | null = null;

function makeMockClient() {
  return {
    from(_table: string) {
      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(_col: string, _val: unknown) {
          return builder;
        },
        async maybeSingle() {
          return { data: sessionRow, error: null };
        },
      };
      return builder;
    },
  };
}
const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

import { submitTestingServiceApprovalV2 } from "./submit-testing-service-approval";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

function rec(service_key: string) {
  return { service_key, display_name: service_key, starting_price_cents: 0 };
}

beforeEach(() => {
  awtCalls.length = 0;
  createSupabaseAdminClientMock.mockClear();
});

describe("submitTestingServiceApprovalV2 — symmetric write (INV-8)", () => {
  it("unions new declines with prior declines instead of overwriting them", async () => {
    sessionRow = {
      recommended_testing_services: [rec("brake_diag"), rec("battery_test")],
      approved_testing_services: [],
      // A prior decline the customer is NOT touching this submit — must survive.
      declined_testing_services: ["prior_decline"],
    };

    await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["brake_diag"],
      declined: ["battery_test"],
    });

    const call = awtCalls[0]!;
    expect(call.updates!.approved_testing_services).toEqual(["brake_diag"]);
    // prior_decline preserved (union, not overwrite) + the new decline added.
    expect(
      (call.updates!.declined_testing_services as string[]).sort(),
    ).toEqual(["battery_test", "prior_decline"].sort());
  });

  it("re-declining a previously-approved service flips it cleanly (re-decline safety)", async () => {
    sessionRow = {
      recommended_testing_services: [rec("brake_diag")],
      // brake_diag was approved earlier (e.g. a 7.1 direct pick).
      approved_testing_services: ["brake_diag"],
      declined_testing_services: [],
    };

    await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: [],
      declined: ["brake_diag"],
    });

    const call = awtCalls[0]!;
    // Cleared from approved, landed in declined — NOT silently stripped.
    expect(call.updates!.approved_testing_services).toEqual([]);
    expect(call.updates!.declined_testing_services).toEqual(["brake_diag"]);
  });

  it("re-approving a previously-declined service flips it cleanly", async () => {
    sessionRow = {
      recommended_testing_services: [rec("brake_diag")],
      approved_testing_services: [],
      declined_testing_services: ["brake_diag"],
    };

    await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["brake_diag"],
      declined: [],
    });

    const call = awtCalls[0]!;
    expect(call.updates!.approved_testing_services).toEqual(["brake_diag"]);
    expect(call.updates!.declined_testing_services).toEqual([]);
  });

  it("preserves an independent 7.1 direct pick while declining a recommendation", async () => {
    sessionRow = {
      recommended_testing_services: [rec("battery_test")],
      // brake_diag is a direct pick, NOT in the recommendation set.
      approved_testing_services: ["brake_diag"],
      declined_testing_services: [],
    };

    await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: [],
      declined: ["battery_test"],
    });

    const call = awtCalls[0]!;
    // The direct pick survives; the recommendation is declined.
    expect(call.updates!.approved_testing_services).toEqual(["brake_diag"]);
    expect(call.updates!.declined_testing_services).toEqual(["battery_test"]);
  });

  it("rejects keys not in the recommendation set", async () => {
    sessionRow = {
      recommended_testing_services: [rec("brake_diag")],
      approved_testing_services: [],
      declined_testing_services: [],
    };

    const result = await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["invented_key"],
      declined: [],
    });

    expect(result.ok).toBe(false);
    expect(awtCalls).toHaveLength(0);
  });

  it("rejects an approved/declined overlap", async () => {
    sessionRow = {
      recommended_testing_services: [rec("brake_diag")],
      approved_testing_services: [],
      declined_testing_services: [],
    };

    const result = await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["brake_diag"],
      declined: ["brake_diag"],
    });

    expect(result.ok).toBe(false);
    expect(awtCalls).toHaveLength(0);
  });
});
