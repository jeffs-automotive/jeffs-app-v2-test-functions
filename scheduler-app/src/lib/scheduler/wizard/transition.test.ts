/**
 * Unit tests for applyWizardTransition AFTER the Plan 04 Phase 1A swap to
 * the atomic apply_wizard_transition RPC (closes I-COR-1).
 *
 * Surface under test (transition.ts post-swap):
 *   1. Builds a payload merging { status: 'active' } + caller updates +
 *      { current_step }. (last_active_at is set server-side by the RPC;
 *      transition.ts no longer stamps it.)
 *   2. Calls supabase.rpc('apply_wizard_transition', {
 *        p_chat_id, p_payload, p_user_bubble_text, p_assistant_bubble_text
 *      })
 *   3. On RPC error PGRST/Postgres code === 'P0002' → returns
 *      { ok: false, error: 'session_not_found_or_inactive' } (so the
 *      string is stable for callers to switch on).
 *   4. On any other RPC error → Sentry.captureException + returns
 *      { ok: false, error: <message> }.
 *   5. On success → revalidates ALL 3 paths ('/', '/book', '/book-v2') and
 *      returns { ok: true, next_step }.
 *
 * Mocking pattern mirrors actions/run-diagnostics.test.ts: vi.mock for
 * @sentry/nextjs + next/cache + @/lib/supabase/admin. Then we import
 * applyWizardTransition AFTER the mocks are wired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryCaptureExceptionMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
}));

const revalidatePathMock: Mock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

// Supabase admin client — a single rpc() stub configured per test. We
// capture every call's arg payload in `rpcCalls` so tests can assert on
// the parameter shape passed by transition.ts.
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
const rpcCalls: RpcCall[] = [];

// Per-test result returned by the rpc() stub. Set inside each test.
let rpcResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

function makeMockClient() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      // Supabase's PostgrestBuilder is thenable; consumers `await` it
      // directly. We mirror that with an async-then.
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

const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Import the SUT after mocks are wired.
import { applyWizardTransition } from "./transition";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build the canonical successful RPC return shape from apply_wizard_transition. */
function makeRpcSuccess(
  overrides: {
    row?: Record<string, unknown>;
    userInserted?: boolean;
    assistantInserted?: boolean;
  } = {},
): { data: Record<string, unknown>; error: null } {
  return {
    data: {
      row: overrides.row ?? {
        id: "sess-1",
        current_step: "phone_name",
        status: "active",
      },
      user_bubble_inserted: overrides.userInserted ?? false,
      assistant_bubble_inserted: overrides.assistantInserted ?? false,
    },
    error: null,
  };
}

/** Find the latest rpc call to apply_wizard_transition. */
function lastRpcCall(): RpcCall {
  const call = rpcCalls[rpcCalls.length - 1];
  if (!call) throw new Error("no rpc calls recorded");
  return call;
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
  sentryCaptureExceptionMock.mockClear();
  revalidatePathMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("applyWizardTransition — happy path", () => {
  it("calls apply_wizard_transition RPC and returns ok:true with next_step", async () => {
    rpcResult = makeRpcSuccess({
      userInserted: true,
      assistantInserted: true,
    });

    const result = await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "phone_name",
      updates: { entered_first_name: "Chris" },
      userBubble: "Chris",
      jeffBubble: "Got it — thanks Chris.",
    });

    expect(result).toEqual({ ok: true, next_step: "phone_name" });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe("apply_wizard_transition");
    // Sentry should NOT fire on the happy path.
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("revalidates ALL three wizard paths on success", async () => {
    rpcResult = makeRpcSuccess();

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "vehicle_pick",
    });

    const revalidatedPaths = revalidatePathMock.mock.calls.map(
      (c) => c[0] as string,
    );
    expect(revalidatedPaths).toEqual(
      expect.arrayContaining(["/", "/book", "/book-v2"]),
    );
    expect(revalidatedPaths).toHaveLength(3);
  });
});

describe("applyWizardTransition — payload shape", () => {
  it("merges status='active' default + caller updates + current_step into p_payload", async () => {
    rpcResult = makeRpcSuccess();

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "phone_name",
      updates: { entered_first_name: "Chris", entered_last_name: "G" },
    });

    const call = lastRpcCall();
    const payload = call.args.p_payload as Record<string, unknown>;
    // 2026-05-23 date-picker rescue: default status='active' is in payload.
    expect(payload.status).toBe("active");
    // Caller updates flow through.
    expect(payload.entered_first_name).toBe("Chris");
    expect(payload.entered_last_name).toBe("G");
    // current_step is set to nextStep.
    expect(payload.current_step).toBe("phone_name");
    // p_chat_id propagates separately.
    expect(call.args.p_chat_id).toBe("sess-1");
  });

  it("caller's updates.status overrides the default 'active' (preserves escalation/ended paths)", async () => {
    rpcResult = makeRpcSuccess();

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "escalated",
      updates: {
        status: "escalation",
        escalated_at: "2026-05-24T22:00:00.000Z",
      },
    });

    const payload = lastRpcCall().args.p_payload as Record<string, unknown>;
    expect(payload.status).toBe("escalation");
    expect(payload.escalated_at).toBe("2026-05-24T22:00:00.000Z");
    expect(payload.current_step).toBe("escalated");
  });

  it("works with no updates argument (just status + current_step land in payload)", async () => {
    rpcResult = makeRpcSuccess();

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "greeting",
    });

    const payload = lastRpcCall().args.p_payload as Record<string, unknown>;
    expect(payload.status).toBe("active");
    expect(payload.current_step).toBe("greeting");
  });

  it("does NOT include last_active_at in p_payload (server canonicalizes via pg_catalog.now())", async () => {
    rpcResult = makeRpcSuccess();

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "phone_name",
      updates: {
        // Even if a caller accidentally passes last_active_at, transition.ts
        // should drop it (or the RPC will ignore it — either is acceptable;
        // the test asserts the CALLER's behavior of not forwarding it).
        last_active_at: "1999-01-01T00:00:00.000Z",
      },
    });

    const payload = lastRpcCall().args.p_payload as Record<string, unknown>;
    expect(payload.last_active_at).toBeUndefined();
  });
});

describe("applyWizardTransition — bubble parameter wiring", () => {
  it("passes BOTH bubbles when both are provided", async () => {
    rpcResult = makeRpcSuccess({
      userInserted: true,
      assistantInserted: true,
    });

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "phone_name",
      userBubble: "Chris G",
      jeffBubble: "Got it — let's verify by text.",
    });

    const args = lastRpcCall().args;
    expect(args.p_user_bubble_text).toBe("Chris G");
    expect(args.p_assistant_bubble_text).toBe("Got it — let's verify by text.");
  });

  it("passes only userBubble (assistant param is null)", async () => {
    rpcResult = makeRpcSuccess({ userInserted: true });

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "phone_name",
      userBubble: "Chris G",
    });

    const args = lastRpcCall().args;
    expect(args.p_user_bubble_text).toBe("Chris G");
    expect(args.p_assistant_bubble_text).toBeNull();
  });

  it("passes only jeffBubble (user param is null)", async () => {
    rpcResult = makeRpcSuccess({ assistantInserted: true });

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "greeting",
      jeffBubble: "Hi! I'm Jeff.",
    });

    const args = lastRpcCall().args;
    expect(args.p_user_bubble_text).toBeNull();
    expect(args.p_assistant_bubble_text).toBe("Hi! I'm Jeff.");
  });

  it("passes both bubble params as null when neither is provided", async () => {
    rpcResult = makeRpcSuccess();

    await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "diagnostic_loading",
    });

    const args = lastRpcCall().args;
    expect(args.p_user_bubble_text).toBeNull();
    expect(args.p_assistant_bubble_text).toBeNull();
  });
});

describe("applyWizardTransition — error paths", () => {
  it("session_not_found (P0002) → returns ok:false with stable error 'session_not_found_or_inactive'", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "P0002",
        message: "session_not_found: no customer_chat_sessions row with id sess-missing",
        details: null,
        hint: null,
      },
    };

    const result = await applyWizardTransition({
      chatId: "sess-missing",
      nextStep: "phone_name",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("session_not_found_or_inactive");
    }
    // Revalidate should NOT fire when the row write didn't happen.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("unexpected DB error → ok:false with the upstream message + Sentry captureException once", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: null,
        hint: null,
      },
    };

    const result = await applyWizardTransition({
      chatId: "sess-1",
      nextStep: "phone_name",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("duplicate key value");
    }
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    // Sentry call's tags should identify the failing surface.
    const [, ctx] = sentryCaptureExceptionMock.mock.calls[0]!;
    const tags = (ctx as { tags?: Record<string, unknown> }).tags;
    expect(tags?.surface).toBe("apply_wizard_transition_rpc");
    expect(tags?.next_step).toBe("phone_name");
    // Revalidate should NOT fire on error path.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("P0002 does NOT trigger Sentry (expected race-loss path, not an alertable error)", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "P0002",
        message: "session_not_found",
        details: null,
        hint: null,
      },
    };

    await applyWizardTransition({
      chatId: "sess-missing",
      nextStep: "phone_name",
    });

    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });
});
