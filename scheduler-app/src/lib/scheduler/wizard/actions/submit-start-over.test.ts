/**
 * Unit test for submitStartOverV2 — narrowed to the task-EH1 addition that
 * the wipe also nulls edit_return_step (so a fresh session never resumes
 * mid-edit). The broader wipe behavior is covered by integration flow.
 *
 * Mocks: applyWizardTransition + Sentry at the module boundary; a supabase
 * mock that serves the prior-row read + swallows the message delete + the
 * audit insert.
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

interface AwtCall {
  chatId: string;
  nextStep: string;
  updates?: Record<string, unknown>;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

function makeMockClient() {
  return {
    from(_table: string) {
      const builder = {
        select(_cols: string) {
          return builder;
        },
        delete() {
          return builder;
        },
        insert(_payload: unknown) {
          // scheduler_audit_log insert is fire-and-forget (.then).
          return {
            then(resolve: (v: { error: unknown }) => unknown) {
              return resolve({ error: null });
            },
          };
        },
        eq(_col: string, _val: unknown) {
          // delete().eq(...) is awaited for its { error } result.
          return {
            ...builder,
            then(resolve: (v: { error: unknown }) => unknown) {
              return resolve({ error: null });
            },
          };
        },
        async maybeSingle() {
          return {
            data: {
              current_step: "summary_edit_hub",
              status: "active",
              started_at: new Date().toISOString(),
            },
            error: null,
          };
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

import { submitStartOverV2 } from "./submit-start-over";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  awtCalls.length = 0;
  createSupabaseAdminClientMock.mockClear();
});

describe("submitStartOverV2 — task EH1", () => {
  it("wipes edit_return_step to null and resets to greeting", async () => {
    await submitStartOverV2({ chatId: CHAT_ID });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("greeting");
    expect(awtCalls[0]!.updates).toMatchObject({ edit_return_step: null });
  });
});
