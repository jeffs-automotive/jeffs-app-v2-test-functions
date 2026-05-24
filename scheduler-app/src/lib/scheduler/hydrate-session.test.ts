/**
 * Unit tests for hydrateSession AFTER the Plan 04 Phase 1B swap to the
 * atomic hydrate_session_reset RPC (closes I-COR-2).
 *
 * Surface under test (hydrate-session.ts post-swap):
 *   1. Reads the sched-chat-id cookie. Missing/malformed → returns a
 *      fresh chatId without touching the DB.
 *   2. With a valid cookie, reads (id, status, last_active_at, hold_token)
 *      from customer_chat_sessions.
 *   3. If no row → returns the chatId without writing.
 *   4. Terminal-state rows (status='ended' | 'escalated') → returns chatId
 *      without writing (regardless of age).
 *   5. Active rows under STALE_AFTER_MS → returns chatId without writing.
 *   6. STALE rows (status='timed_out' | 'abandoned' | active+age>5min) →
 *      calls supabase.rpc('hydrate_session_reset', { p_chat_id }).
 *   7. RPC error → logError(level:'error') + Sentry.captureException
 *      (level:'error'). Function still returns the chatId — the caller
 *      should never observe a thrown error from hydrateSession.
 *   8. Any exception thrown by the supabase calls is caught and reported
 *      to Sentry at warning level; chatId is still returned.
 *
 * Mocking mirrors transition.test.ts: vi.mock for next/headers +
 * @sentry/nextjs + @/lib/supabase/admin + @/lib/scheduler/wizard/log-error.
 * Then import hydrateSession AFTER the mocks are wired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryCaptureExceptionMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
}));

const logErrorMock: Mock = vi.fn(async () => {});
vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

// next/headers — cookies() returns a Promise<{ get(name): {value} | undefined }>.
let cookieValue: string | undefined;
const cookieGetMock: Mock = vi.fn(() =>
  cookieValue === undefined ? undefined : { value: cookieValue },
);
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGetMock(name) }),
}));

// Supabase admin client. The hydrate-session code uses TWO surfaces:
//   - .from('customer_chat_sessions').select(...).eq(...).maybeSingle()
//   - .rpc('hydrate_session_reset', { p_chat_id })
// Both are stubbed; tests configure rowReadResult + rpcResult per case.
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
interface FromCall {
  table: string;
  select: string;
  eqId: string;
}

const rpcCalls: RpcCall[] = [];
const fromCalls: FromCall[] = [];

let rowReadResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let rpcResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

/**
 * Allows the supabase client factory to optionally throw — used to
 * exercise the outer try/catch path. Reset to null in beforeEach.
 */
let createSupabaseAdminClientThrows: Error | null = null;

function makeMockClient() {
  return {
    from(table: string) {
      let capturedSelect = "";
      let capturedEqId = "";
      const builder = {
        select(cols: string) {
          capturedSelect = cols;
          return builder;
        },
        eq(_col: string, val: string) {
          capturedEqId = val;
          return builder;
        },
        async maybeSingle() {
          fromCalls.push({
            table,
            select: capturedSelect,
            eqId: capturedEqId,
          });
          return rowReadResult;
        },
      };
      return builder;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      // Mirror PostgrestBuilder thenable shape (matches transition.test.ts).
      return {
        async then(
          resolve: (v: { data: unknown; error: unknown }) => unknown,
        ) {
          return resolve(rpcResult);
        },
      };
    },
  };
}

const createSupabaseAdminClientMock: Mock = vi.fn(() => {
  if (createSupabaseAdminClientThrows) {
    throw createSupabaseAdminClientThrows;
  }
  return makeMockClient();
});
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Import the SUT after mocks are wired.
import { hydrateSession, COOKIE_NAME } from "./hydrate-session";

// ─── Helpers ───────────────────────────────────────────────────────────────

const VALID_UUID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
const SECOND_UUID = "11111111-2222-3333-4444-555555555555";

function isoNow(): string {
  return new Date().toISOString();
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  cookieValue = undefined;
  rpcCalls.length = 0;
  fromCalls.length = 0;
  rowReadResult = { data: null, error: null };
  rpcResult = { data: null, error: null };
  createSupabaseAdminClientThrows = null;
  sentryCaptureExceptionMock.mockClear();
  logErrorMock.mockClear();
  cookieGetMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("hydrateSession — no-DB paths (cookie missing / malformed)", () => {
  it("missing cookie → returns fresh chatId, no DB calls", async () => {
    cookieValue = undefined;

    const result = await hydrateSession();

    expect(result.chatId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(cookieGetMock).toHaveBeenCalledWith(COOKIE_NAME);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("malformed cookie (wrong length) → returns fresh chatId, no DB calls", async () => {
    cookieValue = "not-a-uuid";

    const result = await hydrateSession();

    expect(result.chatId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.chatId).not.toBe("not-a-uuid");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("malformed cookie (right length, wrong charset) → returns fresh chatId, no DB calls", async () => {
    // 36 chars but contains a non-hex non-hyphen char (Z).
    cookieValue = "Z0000000-0000-0000-0000-000000000000";

    const result = await hydrateSession();

    expect(result.chatId).not.toBe(cookieValue);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("hydrateSession — no-row / fresh / terminal paths (no RPC fire)", () => {
  it("no row for cookie → returns cookie's chatId, no RPC call", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = { data: null, error: null };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(fromCalls).toHaveLength(1);
    expect(fromCalls[0]!.table).toBe("customer_chat_sessions");
    expect(fromCalls[0]!.eqId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(0);
  });

  it("active row, fresh (1 min ago) → returns chatId, no RPC", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "active",
        last_active_at: isoMinutesAgo(1),
        hold_token: null,
      },
      error: null,
    };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(0);
  });

  it("terminal status='ended' (regardless of age) → returns chatId, no RPC", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "ended",
        // Deliberately stale-looking — terminal-state rule overrides age.
        last_active_at: isoMinutesAgo(60),
        hold_token: null,
      },
      error: null,
    };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(0);
  });

  it("terminal status='escalated' (regardless of age) → returns chatId, no RPC", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "escalated",
        last_active_at: isoMinutesAgo(120),
        hold_token: null,
      },
      error: null,
    };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("hydrateSession — stale paths fire hydrate_session_reset RPC", () => {
  it("status='timed_out' → calls RPC with correct args, returns chatId", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "timed_out",
        last_active_at: isoNow(), // Age irrelevant — status flags stale.
        hold_token: SECOND_UUID,
      },
      error: null,
    };
    rpcResult = {
      data: {
        messages_deleted: 3,
        hold_token_released: true,
        holds_released_by_session_id: 1,
      },
      error: null,
    };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe("hydrate_session_reset");
    expect(rpcCalls[0]!.args).toEqual({ p_chat_id: VALID_UUID });
    expect(logErrorMock).not.toHaveBeenCalled();
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("status='abandoned' → calls RPC, returns chatId", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "abandoned",
        last_active_at: isoMinutesAgo(1),
        hold_token: null,
      },
      error: null,
    };
    rpcResult = {
      data: {
        messages_deleted: 0,
        hold_token_released: false,
        holds_released_by_session_id: 0,
      },
      error: null,
    };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe("hydrate_session_reset");
  });

  it("active row aged > STALE_AFTER_MS (6 min) → calls RPC", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "active",
        last_active_at: isoMinutesAgo(6),
        hold_token: null,
      },
      error: null,
    };
    rpcResult = {
      data: {
        messages_deleted: 5,
        hold_token_released: false,
        holds_released_by_session_id: 0,
      },
      error: null,
    };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(rpcCalls).toHaveLength(1);
  });

  it("active row aged exactly at STALE_AFTER_MS boundary (5 min) → NOT stale", async () => {
    cookieValue = VALID_UUID;
    // Just under 5 min — the boundary is strictly > STALE_AFTER_MS.
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "active",
        last_active_at: isoMinutesAgo(4),
        hold_token: null,
      },
      error: null,
    };

    await hydrateSession();

    expect(rpcCalls).toHaveLength(0);
  });

  it("active row with null last_active_at + status='active' → stale (treated as ageMs=now-0)", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "active",
        last_active_at: null,
        hold_token: null,
      },
      error: null,
    };
    rpcResult = {
      data: {
        messages_deleted: 0,
        hold_token_released: false,
        holds_released_by_session_id: 0,
      },
      error: null,
    };

    await hydrateSession();

    // null last_active_at parses to 0, so ageMs is enormous → stale path fires.
    expect(rpcCalls).toHaveLength(1);
  });
});

describe("hydrateSession — RPC error handling", () => {
  it("RPC returns error → logError(level:'error') + Sentry.captureException(level:'error') + still returns chatId", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "timed_out",
        last_active_at: isoMinutesAgo(1),
        hold_token: null,
      },
      error: null,
    };
    rpcResult = {
      data: null,
      error: {
        code: "23502",
        message: "null value in column violates not-null constraint",
        details: "row 1",
        hint: "check column nullability",
      },
    };

    const result = await hydrateSession();

    // Function still resolves with the chatId — failures don't bubble.
    expect(result.chatId).toBe(VALID_UUID);

    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const logArgs = logErrorMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(logArgs.chatId).toBe(VALID_UUID);
    expect(logArgs.surface).toBe("hydrate_session_reset");
    expect(logArgs.level).toBe("error");
    expect(logArgs.error_code).toBe("23502");
    expect(logArgs.message).toContain("not-null constraint");

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [, sentryCtx] = sentryCaptureExceptionMock.mock.calls[0]!;
    const ctx = sentryCtx as {
      tags?: Record<string, unknown>;
      level?: string;
      extra?: Record<string, unknown>;
    };
    expect(ctx.tags?.surface).toBe("hydrate_session_reset");
    expect(ctx.level).toBe("error");
    expect(ctx.extra?.chatId).toBe(VALID_UUID);
    expect(ctx.extra?.code).toBe("23502");
  });

  it("RPC error with null code → logError + Sentry still fire, code field null-tolerant", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = {
      data: {
        id: VALID_UUID,
        status: "timed_out",
        last_active_at: isoMinutesAgo(1),
        hold_token: null,
      },
      error: null,
    };
    rpcResult = {
      data: null,
      error: { code: null, message: "unknown", details: null, hint: null },
    };

    await hydrateSession();

    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const logArgs = logErrorMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(logArgs.error_code).toBeNull();
  });
});

describe("hydrateSession — exception handling (outer try/catch)", () => {
  it("createSupabaseAdminClient throws → Sentry warning + returns chatId without crashing", async () => {
    cookieValue = VALID_UUID;
    createSupabaseAdminClientThrows = new Error("admin client init failed");

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect((err as Error).message).toBe("admin client init failed");
    const tags = (ctx as { tags?: Record<string, unknown>; level?: string })
      .tags;
    expect(tags?.surface).toBe("hydrate_session_stale_check");
    expect(
      (ctx as { level?: string }).level,
    ).toBe("warning");
    // The RPC-error logError path should NOT have fired (we never got there).
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe("hydrateSession — DB read shape", () => {
  it("selects the canonical 4 columns from customer_chat_sessions", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = { data: null, error: null };

    await hydrateSession();

    expect(fromCalls).toHaveLength(1);
    expect(fromCalls[0]!.select).toBe(
      "id, status, last_active_at, hold_token",
    );
  });
});
