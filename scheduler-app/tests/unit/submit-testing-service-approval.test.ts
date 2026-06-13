/**
 * Unit tests for submitTestingServiceApprovalV2 — Step 7.5.
 *
 * Focus: the merge-not-overwrite invariant (regression guard for the
 * 2026-06-13 audit data-loss fix). Step 7.1
 * (submit-service-and-concern-picker) writes the customer's explicitly
 * picked testing services to approved_testing_services. Step 7.5 must UNION
 * its recommendation-approvals with those existing picks (minus declines) —
 * not overwrite them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryCaptureExceptionMock: Mock = vi.fn();
const sentryCaptureMessageMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
  setTag: vi.fn(),
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
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

vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: vi.fn(async () => undefined),
}));

let storedRow: Record<string, unknown> | null = null;
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

import { submitTestingServiceApprovalV2 } from "@/lib/scheduler/wizard/actions/submit-testing-service-approval";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

function rec(...keys: string[]) {
  return keys.map((service_key) => ({ service_key }));
}

beforeEach(() => {
  awtCalls.length = 0;
  storedRow = null;
  sentryCaptureExceptionMock.mockClear();
  sentryCaptureMessageMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitTestingServiceApprovalV2 — merge with Step 7.1 picks", () => {
  it("UNIONs an existing 7.1 pick with a newly-approved recommendation (does not overwrite)", async () => {
    // 7.1 picked battery_test; the diagnostic LLM recommended brake_inspection;
    // the customer approves brake_inspection at 7.5.
    storedRow = {
      approved_testing_services: ["battery_test"],
      recommended_testing_services: rec("brake_inspection"),
    };

    const result = await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["brake_inspection"],
      declined: [],
    });

    expect(result.ok).toBe(true);
    const updates = awtCalls[0]!.updates!;
    const finalApproved = updates.approved_testing_services as string[];
    expect([...finalApproved].sort()).toEqual(
      ["battery_test", "brake_inspection"].sort(),
    );
  });

  it("declining a key removes it even when it was also a 7.1 pick (most-recent action wins)", async () => {
    storedRow = {
      approved_testing_services: ["battery_test"],
      recommended_testing_services: rec("battery_test", "brake_inspection"),
    };

    const result = await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["brake_inspection"],
      declined: ["battery_test"],
    });

    expect(result.ok).toBe(true);
    const updates = awtCalls[0]!.updates!;
    expect(updates.approved_testing_services).toEqual(["brake_inspection"]);
    expect(updates.declined_testing_services).toEqual(["battery_test"]);
  });

  it("with no prior 7.1 picks, writes exactly the 7.5 approvals (regression guard)", async () => {
    storedRow = {
      approved_testing_services: [],
      recommended_testing_services: rec("brake_inspection", "battery_test"),
    };

    const result = await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["brake_inspection"],
      declined: ["battery_test"],
    });

    expect(result.ok).toBe(true);
    const updates = awtCalls[0]!.updates!;
    expect(updates.approved_testing_services).toEqual(["brake_inspection"]);
  });

  it("rejects approvals that are not in the recommendation set (no client-invented keys)", async () => {
    storedRow = {
      approved_testing_services: ["battery_test"],
      recommended_testing_services: rec("brake_inspection"),
    };

    const result = await submitTestingServiceApprovalV2({
      chatId: CHAT_ID,
      approved: ["something_invented"],
      declined: [],
    });

    expect(result.ok).toBe(false);
    expect(awtCalls).toHaveLength(0);
  });
});
