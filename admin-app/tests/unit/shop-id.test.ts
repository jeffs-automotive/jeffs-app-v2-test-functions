import { describe, it, expect } from "vitest";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";

/**
 * resolveAdminShopId is the single source of truth for shop_id in admin-app.
 * Guards the `shop-id-server-derived` invariant: its ONLY input is the server
 * process env — never a client-supplied value. These tests pin the resolution
 * order (env override → 7476 fallback) and the fail-closed validation.
 */

// Build a minimal env stub. ProcessEnv requires NODE_ENV etc., but
// resolveAdminShopId only reads SCHEDULER_ADMIN_SHOP_ID, so a double-cast of a
// partial object is the right shape for the unit boundary.
function envWith(shopId?: string): NodeJS.ProcessEnv {
  const e: Record<string, string> = {};
  if (shopId !== undefined) e.SCHEDULER_ADMIN_SHOP_ID = shopId;
  return e as unknown as NodeJS.ProcessEnv;
}

describe("resolveAdminShopId", () => {
  it("honors SCHEDULER_ADMIN_SHOP_ID when it is a positive integer", () => {
    expect(resolveAdminShopId(envWith("1234"))).toBe(1234);
  });

  it("falls back to the canonical test-sandbox shop 7476 when the env var is unset", () => {
    expect(resolveAdminShopId(envWith())).toBe(7476);
  });

  it("throws (fail-closed) when the env var is set but not a positive integer", () => {
    expect(() => resolveAdminShopId(envWith("abc"))).toThrow();
    expect(() => resolveAdminShopId(envWith("-5"))).toThrow();
    expect(() => resolveAdminShopId(envWith("0"))).toThrow();
    expect(() => resolveAdminShopId(envWith("12.5"))).toThrow();
  });

  it("resolves shop_id ONLY from the passed env (no client/global input path)", () => {
    // The function signature takes `env` as its sole input — there is no code
    // path that reads a form field, URL param, or request header. This test
    // documents that contract (shop-agnostic.md / shop-id-server-derived).
    expect(resolveAdminShopId(envWith("7476"))).toBe(7476);
  });
});
