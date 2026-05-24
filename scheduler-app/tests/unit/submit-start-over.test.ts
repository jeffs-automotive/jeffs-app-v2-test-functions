import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 17 (2026-05-16) — canonical V2 Server Action test.
 *
 * submitStartOverV2 (lib/scheduler/wizard/actions/submit-start-over.ts)
 * does FIVE things:
 *
 *   1. Reads the row to snapshot prior step/status/started_at
 *      (for the session_restarted audit row).
 *   2. Deletes customer_chat_messages for the session (transcript wipe).
 *   3. Updates customer_chat_sessions: wipes every wizard column +
 *      sets current_step='greeting' + last_active_at=now() via
 *      applyWizardTransition (which calls revalidatePath internally).
 *   4. Inserts a session_restarted audit row (fire-and-forget; the
 *      action does NOT await this in production — it dispatches it
 *      via `.then`).
 *   5. Returns a WizardTransitionResult of { ok: true, next_step: 'greeting' }.
 *
 * Plan 04 Phase 1A (2026-05-24): the wizard column-wipe now flows through
 * `supabase.rpc('apply_wizard_transition', { p_chat_id, p_payload, ... })`
 * instead of `.from('customer_chat_sessions').update(...)`. The mock
 * client below tracks both `.from(...)` chains AND `.rpc(...)` calls; the
 * "wipes the wizard-state columns" assertion now inspects p_payload.
 *
 * The test mocks createSupabaseAdminClient + next/cache.revalidatePath
 * and asserts on the recorded query chain.
 */

import type { Mock } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

interface ChainCall {
  table: string;
  op: "update" | "delete" | "insert" | "select";
  payload?: Record<string, unknown>;
  match?: Array<{ col: string; val: unknown }>;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const chainCalls: ChainCall[] = [];
const rpcCalls: RpcCall[] = [];

// Per-test row snapshot returned by the FIRST select() chain.
let snapshotRow: Record<string, unknown> | null = {
  current_step: "vehicle_pick",
  status: "active",
  started_at: new Date(Date.now() - 30_000).toISOString(),
};

function makeMockClient() {
  function buildBuilder(table: string) {
    const eqs: Array<{ col: string; val: unknown }> = [];
    type Builder = {
      eq(col: string, val: unknown): Builder;
      maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>;
      then(resolve: (v: { error: null }) => unknown): Promise<unknown>;
      select(cols: string): Builder;
    };
    const builder: Builder = {
      eq(col: string, val: unknown) {
        eqs.push({ col, val });
        return builder;
      },
      async maybeSingle() {
        chainCalls.push({ table, op: "select", match: [...eqs] });
        return { data: snapshotRow, error: null };
      },
      // Insert/update/delete don't have a maybeSingle terminator — they
      // resolve as thenables. Mock that path too.
      async then(resolve: (v: { error: null }) => unknown) {
        return resolve({ error: null });
      },
      select(_cols: string) {
        return builder;
      },
    };
    return builder;
  }

  return {
    from(table: string) {
      const eqs: Array<{ col: string; val: unknown }> = [];
      const inner = buildBuilder(table);
      return {
        select(cols: string) {
          chainCalls.push({ table, op: "select", payload: { cols } });
          return inner;
        },
        update(payload: Record<string, unknown>) {
          chainCalls.push({ table, op: "update", payload });
          return {
            eq(col: string, val: unknown) {
              eqs.push({ col, val });
              return {
                async then(resolve: (v: { error: null }) => unknown) {
                  chainCalls[chainCalls.length - 1]!.match = [...eqs];
                  return resolve({ error: null });
                },
              };
            },
          };
        },
        delete() {
          chainCalls.push({ table, op: "delete" });
          return {
            eq(col: string, val: unknown) {
              eqs.push({ col, val });
              return {
                async then(resolve: (v: { error: null }) => unknown) {
                  chainCalls[chainCalls.length - 1]!.match = [...eqs];
                  return resolve({ error: null });
                },
              };
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          chainCalls.push({ table, op: "insert", payload });
          return {
            async then(resolve: (v: { error: null }) => unknown) {
              return resolve({ error: null });
            },
          };
        },
      };
    },
    // Plan 04 Phase 1A: applyWizardTransition routes through the
    // apply_wizard_transition RPC. Track the call so tests can inspect
    // p_payload (which is what used to land in `.update(payload)`).
    async rpc(fnName: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn: fnName, args });
      return {
        data: {
          row: {},
          user_bubble_inserted: true,
          assistant_bubble_inserted: true,
        },
        error: null,
      };
    },
  };
}

const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
const revalidatePathMock: Mock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  // R6-A-1: actions are wrapped in Sentry.withServerActionInstrumentation
  // via the wrapAction helper. The mock just invokes the callback so the
  // wrapped action's behavior is unchanged in tests.
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

vi.mock("@/lib/scheduler/wizard/append-bubble", () => ({
  appendBubble: vi.fn(async () => undefined),
}));

import { submitStartOverV2 } from "@/lib/scheduler/wizard/actions/submit-start-over";

beforeEach(() => {
  chainCalls.length = 0;
  rpcCalls.length = 0;
  createSupabaseAdminClientMock.mockClear();
  revalidatePathMock.mockClear();
  snapshotRow = {
    current_step: "vehicle_pick",
    status: "active",
    started_at: new Date(Date.now() - 30_000).toISOString(),
  };
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("submitStartOverV2", () => {
  it("returns { ok: true, next_step: 'greeting' } on happy path", async () => {
    const result = await submitStartOverV2({ chatId: "sess-abc" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next_step).toBe("greeting");
    }
  });

  it("wipes the wizard-state columns AND advances current_step to 'greeting' (via apply_wizard_transition RPC)", async () => {
    await submitStartOverV2({ chatId: "sess-abc" });

    const rpcCall = rpcCalls.find((c) => c.fn === "apply_wizard_transition");
    expect(rpcCall).toBeDefined();
    // applyWizardTransition forwards the caller's updates onto p_payload
    // (plus a default status: 'active' at the front and current_step at
    // the end — see scheduler-app/src/lib/scheduler/wizard/transition.ts).
    const payload = rpcCall?.args.p_payload as Record<string, unknown>;

    // Identity bindings wiped
    expect(payload.customer_id).toBeNull();
    expect(payload.vehicle_id).toBeNull();
    expect(payload.appointment_id).toBeNull();
    // Wizard-step + status reset (transition.ts prepends status='active'
    // and always sets current_step to the nextStep arg).
    expect(payload.current_step).toBe("greeting");
    expect(payload.status).toBe("active");
    // Service picks wiped
    expect(payload.selected_simple_services).toBeNull();
    expect(payload.approved_testing_services).toBeNull();
    // Customer notes / question wiped
    expect(payload.customer_notes_text).toBeNull();
    expect(payload.customer_question).toBeNull();
    expect(payload.customer_notes_edit_attempts).toBe(0);
    // The RPC is invoked against the correct session.
    expect(rpcCall?.args.p_chat_id).toBe("sess-abc");
  });

  it("deletes the customer_chat_messages rows for the session", async () => {
    await submitStartOverV2({ chatId: "sess-abc" });

    const del = chainCalls.find(
      (c) => c.table === "customer_chat_messages" && c.op === "delete",
    );
    expect(del).toBeDefined();
    expect(del?.match).toContainEqual({ col: "session_id", val: "sess-abc" });
  });

  it("revalidates /book-v2 (which is the canonical wizard path during the migration window)", async () => {
    await submitStartOverV2({ chatId: "sess-abc" });

    // applyWizardTransition fans out to all three legacy wizard surfaces
    // (/, /book, /book-v2 — see transition.ts WIZARD_REVALIDATE_PATHS).
    // /book-v2 is the post-Phase-15 canonical entry, so we assert on it
    // specifically; the broader fan-out is covered by transition.test.ts.
    expect(revalidatePathMock).toHaveBeenCalledWith("/book-v2");
  });

  it("revalidates ALL wizard surfaces (/, /book, /book-v2) via applyWizardTransition", async () => {
    await submitStartOverV2({ chatId: "sess-abc" });

    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/book");
    expect(revalidatePathMock).toHaveBeenCalledWith("/book-v2");
  });

  it("inserts a session_restarted audit row with prior context", async () => {
    await submitStartOverV2({ chatId: "sess-abc" });

    const audit = chainCalls.find(
      (c) => c.table === "scheduler_audit_log" && c.op === "insert",
    );
    expect(audit).toBeDefined();
    const payload = audit?.payload as Record<string, unknown>;
    expect(payload.session_id).toBe("sess-abc");
    expect(payload.step).toBe("greeting");
    expect(payload.event_type).toBe("session_restarted");
    const detail = payload.event_detail as {
      previous_step: string;
      previous_status: string;
    };
    expect(detail.previous_step).toBe("vehicle_pick");
    expect(detail.previous_status).toBe("active");
  });

  it("rejects when chatId is empty (Zod gate)", async () => {
    const result = await submitStartOverV2({ chatId: "" });
    expect(result.ok).toBe(false);
  });
});
