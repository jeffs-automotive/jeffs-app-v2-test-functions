/**
 * Unit tests for shop-clock.ts (P1.6 post-validator 2026-05-25).
 *
 * Covers:
 *   - Happy path: RPC returns valid JSON → snapshot.source === "postgres"
 *   - RPC error: Sentry warning + Vercel-fallback snapshot
 *   - Malformed JSON: Sentry warning + Vercel-fallback snapshot
 *   - RPC throws: Sentry warning + Vercel-fallback snapshot
 *   - isAfterSameDayCutoffPg + getShopTodayPg pull from the snapshot
 *
 * NOTE: React `cache()` per-request memoization is NOT exercised here —
 * cache() only applies inside a React render tree. Vitest runs unmocked,
 * so each test gets a fresh call. The behavior is verified at the
 * integration level (availability.ts + submit-date.ts sharing the
 * snapshot within a render).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

const sentryCaptureExceptionMock: Mock = vi.fn();
const sentryCaptureMessageMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
  setTag: vi.fn(),
}));

// React's `cache()` is a no-op in vitest (no React render tree). Mock
// to identity so each call goes through.
vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
}));

// Per-test result slot for the RPC mock.
let rpcResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let rpcThrows: Error | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: vi.fn(async (fn: string) => {
      if (rpcThrows) throw rpcThrows;
      if (fn === "scheduler_shop_now") return rpcResult;
      return { data: null, error: null };
    }),
  }),
}));

import {
  getShopClock,
  isAfterSameDayCutoffPg,
  getShopTodayPg,
} from "@/lib/scheduler/shop-clock";

beforeEach(() => {
  sentryCaptureExceptionMock.mockReset();
  sentryCaptureMessageMock.mockReset();
  rpcResult = { data: null, error: null };
  rpcThrows = null;
});

describe("getShopClock — happy path", () => {
  it("returns snapshot with source='postgres' when RPC succeeds", async () => {
    rpcResult = {
      data: {
        date: "2026-06-10",
        hour: 14,
        minute: 30,
        iso_local: "2026-06-10T14:30:00",
      },
      error: null,
    };

    const snap = await getShopClock();

    expect(snap).toEqual({
      date: "2026-06-10",
      hour: 14,
      minute: 30,
      iso_local: "2026-06-10T14:30:00",
      source: "postgres",
    });
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
    expect(sentryCaptureMessageMock).not.toHaveBeenCalled();
  });
});

describe("getShopClock — RPC failure paths fall back to Vercel clock", () => {
  it("RPC returns error → Sentry warning + Vercel-fallback snapshot", async () => {
    rpcResult = {
      data: null,
      error: { code: "PGRST301", message: "RPC not found" },
    };

    const snap = await getShopClock();

    expect(snap.source).toBe("vercel_fallback");
    expect(typeof snap.date).toBe("string");
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof snap.hour).toBe("number");
    expect(snap.hour).toBeGreaterThanOrEqual(0);
    expect(snap.hour).toBeLessThanOrEqual(23);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect((opts as { level: string }).level).toBe("warning");
    expect(
      (opts as { tags: { surface: string } }).tags.surface,
    ).toBe("shop_clock_rpc");
  });

  it("RPC returns malformed data → Sentry warning + Vercel-fallback snapshot", async () => {
    rpcResult = {
      data: { date: "not-a-date", hour: 99, minute: 999, iso_local: "bad" },
      error: null,
    };

    const snap = await getShopClock();

    expect(snap.source).toBe("vercel_fallback");
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "shop_clock_rpc_malformed",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("RPC returns null → Sentry warning + Vercel-fallback snapshot", async () => {
    rpcResult = { data: null, error: null };

    const snap = await getShopClock();

    expect(snap.source).toBe("vercel_fallback");
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "shop_clock_rpc_malformed",
      expect.anything(),
    );
  });

  it("RPC throws → Sentry warning + Vercel-fallback snapshot", async () => {
    rpcThrows = new Error("connection ECONNRESET");

    const snap = await getShopClock();

    expect(snap.source).toBe("vercel_fallback");
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect(
      (opts as { tags: { surface: string } }).tags.surface,
    ).toBe("shop_clock_rpc_throw");
  });
});

describe("isAfterSameDayCutoffPg", () => {
  it("returns true when snapshot.hour >= 12", async () => {
    rpcResult = {
      data: {
        date: "2026-06-10",
        hour: 12,
        minute: 0,
        iso_local: "2026-06-10T12:00:00",
      },
      error: null,
    };
    expect(await isAfterSameDayCutoffPg()).toBe(true);
  });

  it("returns false when snapshot.hour < 12", async () => {
    rpcResult = {
      data: {
        date: "2026-06-10",
        hour: 11,
        minute: 59,
        iso_local: "2026-06-10T11:59:00",
      },
      error: null,
    };
    expect(await isAfterSameDayCutoffPg()).toBe(false);
  });

  it("uses Vercel fallback when RPC fails", async () => {
    rpcResult = { data: null, error: { code: "X", message: "boom" } };
    // Result depends on the actual Vercel clock — assert it's a boolean.
    const result = await isAfterSameDayCutoffPg();
    expect(typeof result).toBe("boolean");
  });
});

describe("getShopTodayPg", () => {
  it("returns snapshot.date on the happy path", async () => {
    rpcResult = {
      data: {
        date: "2026-06-10",
        hour: 9,
        minute: 0,
        iso_local: "2026-06-10T09:00:00",
      },
      error: null,
    };
    expect(await getShopTodayPg()).toBe("2026-06-10");
  });
});
