/**
 * Unit tests for submitEditHubV2 — the summary edit hub router (task EH1).
 *
 * Surface under test:
 *   - "done"     → clears edit_return_step (null) + nextStep summary.
 *   - "contact"  → sets edit_return_step + nextStep customer_info_edit.
 *   - "vehicle"  → sets edit_return_step + nextStep vehicle_pick.
 *   - "services" → sets edit_return_step + nextStep service_concern_picker.
 *   - "time"     → sets edit_return_step + releases the hold + clears
 *                  hold_token + nextStep date_pick.
 *   - "time" with no hold → no release call, still advances.
 *
 * Mocks: applyWizardTransition + Sentry + logError at the module boundary;
 * minimal supabase mock for the hold_token row read + hold-release UPDATE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

const sentryCaptureExceptionMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
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
  userBubble?: string;
  updates?: Record<string, unknown>;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

// Supabase mock — handles the customer_chat_sessions hold_token read and
// the appointment_holds release UPDATE.
interface ChainCall {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  match: Array<{ kind: "eq" | "is"; col: string; val: unknown }>;
}
const chainCalls: ChainCall[] = [];
let sessionRowResult: { data: Record<string, unknown> | null; error: unknown } =
  { data: { hold_token: null }, error: null };

function makeMockClient() {
  return {
    from(table: string) {
      let currentCall: ChainCall | null = null;
      const builder = {
        select(_cols: string) {
          currentCall = { table, op: "select", match: [] };
          chainCalls.push(currentCall);
          return builder;
        },
        update(payload: Record<string, unknown>) {
          currentCall = { table, op: "update", match: [], payload };
          chainCalls.push(currentCall);
          return builder;
        },
        eq(col: string, val: unknown) {
          currentCall?.match.push({ kind: "eq", col, val });
          return builder;
        },
        is(col: string, val: unknown) {
          currentCall?.match.push({ kind: "is", col, val });
          return builder;
        },
        async maybeSingle() {
          if (table === "customer_chat_sessions") return sessionRowResult;
          return { data: null, error: null };
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

import { submitEditHubV2 } from "./submit-edit-hub";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";
const HOLD_TOKEN = "00000000-0000-0000-0000-000000000002";

function findReleaseCall(): ChainCall | undefined {
  return chainCalls.find(
    (c) => c.table === "appointment_holds" && c.op === "update",
  );
}

beforeEach(() => {
  awtCalls.length = 0;
  chainCalls.length = 0;
  sessionRowResult = { data: { hold_token: null }, error: null };
  sentryCaptureExceptionMock.mockClear();
  logErrorMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitEditHubV2 — done", () => {
  it("clears edit_return_step (null) and returns to summary", async () => {
    const result = await submitEditHubV2({ chatId: CHAT_ID, section: "done" });

    expect(result.ok).toBe(true);
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("summary");
    expect(awtCalls[0]!.updates).toEqual({ edit_return_step: null });
    // No hold read/release for the done path.
    expect(chainCalls).toHaveLength(0);
  });
});

describe("submitEditHubV2 — section jumps set the flag", () => {
  it("contact → customer_info_edit + edit_return_step set", async () => {
    await submitEditHubV2({ chatId: CHAT_ID, section: "contact" });
    expect(awtCalls[0]!.nextStep).toBe("customer_info_edit");
    expect(awtCalls[0]!.updates).toEqual({
      edit_return_step: "summary_edit_hub",
    });
  });

  it("vehicle → vehicle_pick + edit_return_step set", async () => {
    await submitEditHubV2({ chatId: CHAT_ID, section: "vehicle" });
    expect(awtCalls[0]!.nextStep).toBe("vehicle_pick");
    expect(awtCalls[0]!.updates).toEqual({
      edit_return_step: "summary_edit_hub",
    });
  });

  it("services → service_concern_picker + edit_return_step set", async () => {
    await submitEditHubV2({ chatId: CHAT_ID, section: "services" });
    expect(awtCalls[0]!.nextStep).toBe("service_concern_picker");
    expect(awtCalls[0]!.updates).toEqual({
      edit_return_step: "summary_edit_hub",
    });
  });
});

describe("submitEditHubV2 — time (hold release)", () => {
  it("with an active hold → releases it, clears hold_token, advances to date_pick", async () => {
    sessionRowResult = { data: { hold_token: HOLD_TOKEN }, error: null };

    await submitEditHubV2({ chatId: CHAT_ID, section: "time" });

    // Hold release UPDATE fired with released_at + the id + released_at-null
    // filter (same mechanics as submit-back).
    const releaseCall = findReleaseCall();
    expect(releaseCall).toBeDefined();
    expect(typeof releaseCall!.payload?.released_at).toBe("string");
    expect(releaseCall!.match).toEqual(
      expect.arrayContaining([
        { kind: "eq", col: "id", val: HOLD_TOKEN },
        { kind: "is", col: "released_at", val: null },
      ]),
    );

    // Transition clears hold_token + sets the return flag + advances.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("date_pick");
    expect(awtCalls[0]!.updates).toEqual({
      edit_return_step: "summary_edit_hub",
      hold_token: null,
    });
  });

  it("with no hold → no release call, still advances to date_pick", async () => {
    sessionRowResult = { data: { hold_token: null }, error: null };

    await submitEditHubV2({ chatId: CHAT_ID, section: "time" });

    expect(findReleaseCall()).toBeUndefined();
    expect(awtCalls[0]!.nextStep).toBe("date_pick");
    expect(awtCalls[0]!.updates).toMatchObject({
      edit_return_step: "summary_edit_hub",
      hold_token: null,
    });
  });
});

describe("submitEditHubV2 — validation", () => {
  it("rejects an unknown section", async () => {
    const result = await submitEditHubV2({
      chatId: CHAT_ID,
      // @ts-expect-error — deliberately invalid section
      section: "bogus",
    });
    expect(result.ok).toBe(false);
    expect(awtCalls).toHaveLength(0);
  });
});
