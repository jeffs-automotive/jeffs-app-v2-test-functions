/**
 * logError is a best-effort logger — it MUST NEVER throw out of a Server
 * Action's terminal catch (code-review #2). createSupabaseAdminClient() throws
 * on missing env; logError has to swallow that rather than propagate a raw
 * Server Action rejection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

const adminClientMock: Mock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => adminClientMock(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import { logError } from "@/lib/scheduler/wizard/log-error";

beforeEach(() => {
  adminClientMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("logError — best-effort, never throws", () => {
  it("swallows a createSupabaseAdminClient() throw and warns (does NOT reject)", async () => {
    adminClientMock.mockImplementation(() => {
      throw new Error("Missing Supabase admin-client env vars.");
    });
    // The regression: this used to reject out of the Server Action's catch.
    await expect(
      logError({ surface: "submit_phone_name_v2", message: "boom" }),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("inserts a scheduler_error_log row on the happy path", async () => {
    const insertMock = vi.fn(
      async (_row: Record<string, unknown>) => ({ error: null }),
    );
    adminClientMock.mockReturnValue({
      from: () => ({ insert: insertMock }),
    });
    // No chatId → skip the step lookup; only the log insert runs.
    await logError({
      surface: "submit_x",
      error_code: "uncaught",
      message: "boom",
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.surface).toBe("submit_x");
    expect(row.error_code).toBe("uncaught");
  });
});
