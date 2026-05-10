import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UIMessage } from "ai";

/**
 * Unit tests for chat-store DAL.
 *
 * The Supabase admin client is mocked at the module level so we can assert
 * the SQL/REST query shape (.from / .eq / .insert / .upsert / .order /
 * .select / .single chains) without hitting a real database.
 */

// Build a chainable mock that returns itself for every fluent method,
// and resolves to whatever the test sets via setNextResult().
function createSupabaseMock() {
  let nextResult: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  };
  const calls: Array<{ method: string; args: unknown[] }> = [];

  // Loose record so we can mix fluent methods (variadic) with the `single`
  // terminal and the `then` thenable shape. The chainable cast below gives
  // callers a typed surface.
  const recorder: Record<string, unknown> = {};
  const fluent = [
    "from",
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gte",
    "lte",
    "gt",
    "lt",
    "in",
    "is",
    "order",
    "limit",
  ];
  for (const m of fluent) {
    recorder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chainable;
    };
  }
  // Terminal methods that resolve the query
  recorder.single = (..._args: unknown[]) => Promise.resolve(nextResult);
  recorder.maybeSingle = (..._args: unknown[]) =>
    Promise.resolve(nextResult);
  recorder.then = (
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
  ) => Promise.resolve(nextResult).then(onFulfilled);

  const chainable = recorder as unknown as {
    from: (...a: unknown[]) => typeof chainable;
  } & PromiseLike<{ data: unknown; error: unknown }>;

  return {
    client: chainable,
    calls,
    setNextResult(r: { data: unknown; error: unknown }) {
      nextResult = r;
    },
  };
}

// Module-level mock for the admin client factory
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
  __resetAdminClientForTests: vi.fn(),
}));

import {
  createChat,
  loadChat,
  saveChat,
  findRecentChatByPhone,
  markSessionEnded,
  setCustomerSelfIdentified,
} from "@/lib/scheduler/chat-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

describe("chat-store DAL", () => {
  let mock: ReturnType<typeof createSupabaseMock>;

  beforeEach(() => {
    mock = createSupabaseMock();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      mock.client as unknown as ReturnType<typeof createSupabaseAdminClient>,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createChat", () => {
    it("inserts a session row with shop_id 7476 and returns the new id", async () => {
      mock.setNextResult({ data: { id: "abc-123" }, error: null });

      const id = await createChat({
        channel: "web",
        cookie_session: "cookie-xyz",
      });

      expect(id).toBe("abc-123");
      const fromCall = mock.calls.find((c) => c.method === "from");
      expect(fromCall?.args[0]).toBe("customer_chat_sessions");
      const insertCall = mock.calls.find((c) => c.method === "insert");
      expect(insertCall?.args[0]).toMatchObject({
        shop_id: 7476,
        channel: "web",
        cookie_session: "cookie-xyz",
        phone_e164: null,
      });
    });

    it("throws a clear error when Supabase returns an error", async () => {
      mock.setNextResult({ data: null, error: { message: "permission denied" } });
      await expect(createChat({ channel: "web" })).rejects.toThrow(
        /createChat failed.*permission denied/,
      );
    });
  });

  describe("loadChat", () => {
    it("returns messages oldest-first as UIMessage[]", async () => {
      const sample = [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
          created_at: "2026-05-10T01:00:00Z",
        },
        {
          id: "m2",
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
          created_at: "2026-05-10T01:00:01Z",
        },
      ];
      mock.setNextResult({ data: sample, error: null });

      const messages = await loadChat("session-123");

      expect(messages).toHaveLength(2);
      expect(messages[0]?.id).toBe("m1");
      expect(messages[1]?.role).toBe("assistant");

      const orderCall = mock.calls.find((c) => c.method === "order");
      expect(orderCall?.args).toEqual(["created_at", { ascending: true }]);
      const eqCall = mock.calls.find((c) => c.method === "eq");
      expect(eqCall?.args).toEqual(["session_id", "session-123"]);
    });

    it("returns [] when there are no messages", async () => {
      mock.setNextResult({ data: [], error: null });
      const messages = await loadChat("empty-session");
      expect(messages).toEqual([]);
    });

    it("throws on a Supabase error", async () => {
      mock.setNextResult({ data: null, error: { message: "boom" } });
      await expect(loadChat("session-x")).rejects.toThrow(/loadChat.*boom/);
    });
  });

  describe("saveChat", () => {
    it("upserts message rows with shop_id and onConflict id; bumps last_active_at", async () => {
      mock.setNextResult({ data: null, error: null });

      const messages: UIMessage[] = [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        } as UIMessage,
      ];
      await saveChat({ chatId: "sess-1", messages });

      const upsertCall = mock.calls.find((c) => c.method === "upsert");
      expect(upsertCall).toBeDefined();
      const rows = upsertCall?.args[0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "m1",
        session_id: "sess-1",
        shop_id: 7476,
        role: "user",
      });
      const opts = upsertCall?.args[1] as Record<string, unknown>;
      expect(opts.onConflict).toBe("id");

      // last_active_at touch
      const updateCall = mock.calls.find((c) => c.method === "update");
      expect(updateCall?.args[0]).toHaveProperty("last_active_at");
    });

    it("skips message upsert when messages is empty but still touches last_active_at", async () => {
      mock.setNextResult({ data: null, error: null });
      await saveChat({ chatId: "sess-1", messages: [] });

      expect(mock.calls.find((c) => c.method === "upsert")).toBeUndefined();
      expect(mock.calls.find((c) => c.method === "update")).toBeDefined();
    });
  });

  describe("findRecentChatByPhone", () => {
    it("queries by phone + active status + within window; returns the most recent id", async () => {
      mock.setNextResult({ data: [{ id: "sess-recent" }], error: null });

      const id = await findRecentChatByPhone({
        phone_e164: "+16105550123",
        within_minutes: 60,
      });

      expect(id).toBe("sess-recent");

      const eqCalls = mock.calls.filter((c) => c.method === "eq");
      const phoneEq = eqCalls.find((c) => c.args[0] === "phone_e164");
      expect(phoneEq?.args[1]).toBe("+16105550123");
      const statusEq = eqCalls.find((c) => c.args[0] === "status");
      expect(statusEq?.args[1]).toBe("active");
      const shopEq = eqCalls.find((c) => c.args[0] === "shop_id");
      expect(shopEq?.args[1]).toBe(7476);

      const gteCall = mock.calls.find((c) => c.method === "gte");
      expect(gteCall?.args[0]).toBe("last_active_at");

      const orderCall = mock.calls.find((c) => c.method === "order");
      expect(orderCall?.args).toEqual([
        "last_active_at",
        { ascending: false },
      ]);

      const limitCall = mock.calls.find((c) => c.method === "limit");
      expect(limitCall?.args[0]).toBe(1);
    });

    it("returns null when no rows", async () => {
      mock.setNextResult({ data: [], error: null });
      const id = await findRecentChatByPhone({ phone_e164: "+16105559999" });
      expect(id).toBeNull();
    });

    it("defaults the window to 60 min when within_minutes omitted", async () => {
      mock.setNextResult({ data: [], error: null });
      const before = Date.now();
      await findRecentChatByPhone({ phone_e164: "+16105550000" });
      const gteCall = mock.calls.find((c) => c.method === "gte");
      const cutoffIso = gteCall?.args[1] as string;
      const cutoffMs = Date.parse(cutoffIso);
      // Should be ~60 min before "before", within 5 sec slack
      expect(before - cutoffMs).toBeGreaterThan(60 * 60_000 - 5_000);
      expect(before - cutoffMs).toBeLessThan(60 * 60_000 + 5_000);
    });
  });

  describe("markSessionEnded", () => {
    it("updates status='ended', outcome, and ended_at", async () => {
      mock.setNextResult({ data: null, error: null });
      await markSessionEnded({ chatId: "s1", outcome: "scheduled" });

      const updateCall = mock.calls.find((c) => c.method === "update");
      expect(updateCall?.args[0]).toMatchObject({
        status: "ended",
        outcome: "scheduled",
      });
      expect(updateCall?.args[0]).toHaveProperty("ended_at");
    });

    it("supports overriding status to escalated/timed_out", async () => {
      mock.setNextResult({ data: null, error: null });
      await markSessionEnded({
        chatId: "s1",
        outcome: "escalation",
        status: "escalated",
      });

      const updateCall = mock.calls.find((c) => c.method === "update");
      expect(updateCall?.args[0]).toMatchObject({
        status: "escalated",
        outcome: "escalation",
      });
    });
  });

  describe("setCustomerSelfIdentified", () => {
    it("updates only the customer_self_identified field", async () => {
      mock.setNextResult({ data: null, error: null });
      await setCustomerSelfIdentified({ chatId: "s1", value: "returning" });

      const updateCall = mock.calls.find((c) => c.method === "update");
      expect(updateCall?.args[0]).toEqual({
        customer_self_identified: "returning",
      });
    });
  });
});
