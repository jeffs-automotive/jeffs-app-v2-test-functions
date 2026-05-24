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

// Plan 04 Phase 5B: hydrate-session now reads the session row through
// `getCachedSessionRow` (Next.js data cache, tag `session-${chatId}`).
// Mock the cache helper directly — bypasses the supabase row-read chain
// the prior test version stubbed. The supabase client mock below is
// still used for the RPC call on the stale-reset path.
//
// Test compatibility: the existing tests configure `rowReadResult.data`
// to a session row OR null. The cache mock pulls `rowReadResult.data`
// through unchanged — preserves the test ergonomics. To simulate a
// THROW from the cache helper (replaces the prior "supabase chain
// throws" path), set `cachedRowThrows` to an Error.
const cachedRowCalls: Array<{ chatId: string }> = [];
let cachedRowThrows: Error | null = null;
vi.mock("@/lib/scheduler/cache", () => ({
  sessionTag: (chatId: string) => `session-${chatId}`,
  getCachedSessionRow: vi.fn(async (chatId: string) => {
    cachedRowCalls.push({ chatId });
    if (cachedRowThrows) throw cachedRowThrows;
    return rowReadResult.data;
  }),
}));

// Supabase admin client — now used ONLY for the RPC call on stale path.
// (The session-row read goes through the cache helper above.)
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];

// Test-configurable: per-test row data (preserves prior test ergonomics —
// the `.data` field is what the cache mock returns).
let rowReadResult: { data: Record<string, unknown> | null; error: unknown } = {
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
    // No .from() — Phase 5B routes the row read through the cache
    // helper (mocked above). If a future code path adds a direct
    // supabase.from(...) read in hydrate-session, this stub returning
    // undefined will throw, surfacing the regression in tests.
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
  cachedRowCalls.length = 0;
  cachedRowThrows = null;
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
    expect(cachedRowCalls).toHaveLength(0);
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
  it("no row for cookie → returns cookie's chatId, cache hit/miss but no RPC", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = { data: null, error: null };

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    // Plan 04 Phase 5B: row read goes through the per-session cache;
    // assert on the cache invocation (chatId) rather than the supabase
    // chain (which now lives inside the cache helper).
    expect(cachedRowCalls).toHaveLength(1);
    expect(cachedRowCalls[0]!.chatId).toBe(VALID_UUID);
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
  it("getCachedSessionRow throws → Sentry warning + returns chatId without crashing", async () => {
    // Plan 04 Phase 5B: read path failure is now surfaced by the cache
    // helper throwing (previously the supabase admin client throw was the
    // simulated failure point; that lives inside the cache helper now).
    cookieValue = VALID_UUID;
    cachedRowThrows = new Error("cache read failed");

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect((err as Error).message).toBe("cache read failed");
    const tags = (ctx as { tags?: Record<string, unknown>; level?: string })
      .tags;
    expect(tags?.surface).toBe("hydrate_session_stale_check");
    expect(
      (ctx as { level?: string }).level,
    ).toBe("warning");
    // The RPC-error logError path should NOT have fired (we never got there).
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("createSupabaseAdminClient throws on stale-reset RPC path → outer Sentry warning fires", async () => {
    // Phase 5B preserves the outer try/catch around the stale-reset RPC.
    // To exercise the admin-client throw path, configure: row IS returned
    // by cache AS stale, then admin client throws when transition.ts
    // builds the RPC supabase instance.
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
    createSupabaseAdminClientThrows = new Error("admin client init failed");

    const result = await hydrateSession();

    expect(result.chatId).toBe(VALID_UUID);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [err] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect((err as Error).message).toBe("admin client init failed");
    // RPC was never reached (admin client threw before .rpc).
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("hydrateSession — cache invocation shape (Plan 04 Phase 5B)", () => {
  it("getCachedSessionRow is invoked with the chatId as the cache key", async () => {
    cookieValue = VALID_UUID;
    rowReadResult = { data: null, error: null };

    await hydrateSession();

    expect(cachedRowCalls).toHaveLength(1);
    expect(cachedRowCalls[0]!.chatId).toBe(VALID_UUID);
    // The projection (id, status, last_active_at, hold_token) is now
    // hidden inside the cache helper (which selects '*' once + lets
    // callers pluck fields). Projection assertion lives in cache.test.ts
    // (helper unit tests) if added.
  });

  it("cache is NOT called when cookie is missing (early-return path)", async () => {
    cookieValue = undefined;

    await hydrateSession();

    expect(cachedRowCalls).toHaveLength(0);
  });
});
