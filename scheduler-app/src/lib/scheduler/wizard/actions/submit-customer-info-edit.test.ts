/**
 * Unit tests for submitCustomerInfoEditV2 — the summary-edit-hub return
 * branch (task EH1). When the edit was reached from the hub
 * (edit_return_step='summary_edit_hub') the action returns to the hub
 * instead of the forced forward chain into vehicle_pick.
 *
 * Scope: only the routing branch. The Tekmetric PATCH path is skipped in
 * these tests by using identity_verification_level != 'full', so the action
 * advances straight through with just the row write.
 *
 * Mocks: applyWizardTransition + patchCustomer + Sentry + logError at the
 * module boundary; minimal supabase mock for the row read.
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

const logErrorMock: Mock = vi.fn(async () => {});
vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
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

const patchCustomerMock: Mock = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/scheduler/booking-direct-client", () => ({
  patchCustomer: (...args: unknown[]) => patchCustomerMock(...args),
  BookingDirectError: class BookingDirectError extends Error {
    status?: number;
  },
}));

let sessionRowResult: { data: Record<string, unknown> | null; error: unknown } =
  { data: null, error: null };
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
          return sessionRowResult;
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

import { submitCustomerInfoEditV2 } from "./submit-customer-info-edit";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

const VALID_INPUT = {
  chatId: CHAT_ID,
  edited_phones: [{ phone_e164: "+14845551234", is_primary: true }],
  edited_emails: [{ email: "chris@example.com", is_primary: true }],
  edited_address: null,
  primary_email_for_description: "chris@example.com",
};

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    // Partial verification → PATCH is skipped (no Tekmetric call).
    identity_verification_level: "partial",
    customer_id: 9999,
    edited_phones: [{ phone_e164: "+14845551234", is_primary: true }],
    edited_emails: [{ email: "chris@example.com", is_primary: true }],
    edited_address: null,
    primary_email_for_description: "chris@example.com",
    edit_return_step: null,
    ...overrides,
  };
}

beforeEach(() => {
  awtCalls.length = 0;
  sessionRowResult = { data: baseRow(), error: null };
  patchCustomerMock.mockClear();
  logErrorMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitCustomerInfoEditV2 — summary edit hub return (task EH1)", () => {
  it("edit_return_step='summary_edit_hub' → returns to hub, not vehicle_pick", async () => {
    sessionRowResult = {
      data: baseRow({ edit_return_step: "summary_edit_hub" }),
      error: null,
    };

    await submitCustomerInfoEditV2(VALID_INPUT);

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("summary_edit_hub");
    // edit_return_step is NOT cleared here — survives until hub "done".
    expect(awtCalls[0]!.updates).not.toHaveProperty("edit_return_step");
    // No Tekmetric PATCH (partial verification).
    expect(patchCustomerMock).not.toHaveBeenCalled();
  });

  it("edit_return_step null → normal forward chain to vehicle_pick", async () => {
    sessionRowResult = {
      data: baseRow({ edit_return_step: null }),
      error: null,
    };

    await submitCustomerInfoEditV2(VALID_INPUT);

    expect(awtCalls[0]!.nextStep).toBe("vehicle_pick");
  });
});
