import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

// Settable fake supabase result; the query builder is thenable at any point.
let mockResult: { data: unknown; error: unknown } = { data: [], error: null };
const fromSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (...args: unknown[]) => {
      fromSpy(...args);
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(mockResult).then(res, rej),
      };
      return q;
    },
  }),
}));

import {
  getCardText,
  CARD_TEXT_DEFAULTS,
  __resetCardTextCacheForTests,
} from "@/lib/scheduler/card-text";

beforeEach(() => {
  captureException.mockClear();
  fromSpy.mockClear();
  mockResult = { data: [], error: null };
  __resetCardTextCacheForTests();
});

describe("getCardText", () => {
  it("returns hardcoded defaults when the shop has no override rows — and does NOT Sentry (0 rows is normal, not an outage)", async () => {
    mockResult = { data: [], error: null };
    const copy = await getCardText("greeting");
    expect(copy.title).toBe(CARD_TEXT_DEFAULTS.greeting.title.default);
    expect(copy.eyebrow).toBe("Welcome");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("overlays the DB body on top of the default, per slot", async () => {
    mockResult = {
      data: [
        { card_key: "greeting", slot_key: "title", body: "Hey there 👋" },
        // rows for another card or an unknown slot must be ignored
        { card_key: "greeting", slot_key: "not_a_real_slot", body: "ignored" },
        { card_key: "completed", slot_key: "title", body: "elsewhere" },
      ],
      error: null,
    };
    const copy = await getCardText("greeting");
    expect(copy.title).toBe("Hey there 👋");
    // untouched slot keeps its default
    expect(copy.eyebrow).toBe("Welcome");
    // an unknown slot_key never leaks into the resolved copy
    expect((copy as Record<string, string>).not_a_real_slot).toBeUndefined();
  });

  it("falls back to defaults AND captures a Sentry event on a genuine read error", async () => {
    mockResult = { data: null, error: { message: "boom" } };
    const copy = await getCardText("greeting");
    expect(copy.description).toBe(CARD_TEXT_DEFAULTS.greeting.description.default);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("caches within the TTL — repeated reads hit the DB once", async () => {
    mockResult = {
      data: [{ card_key: "greeting", slot_key: "eyebrow", body: "Hi" }],
      error: null,
    };
    await getCardText("greeting");
    await getCardText("greeting");
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});
