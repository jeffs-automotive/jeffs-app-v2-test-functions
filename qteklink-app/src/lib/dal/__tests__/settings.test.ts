/**
 * Unit tests for the shop-settings DAL (C8b). Mocks the Supabase admin client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { getShopSettings, upsertShopSettings, DEFAULT_SHOP_SETTINGS } from "../settings";

const REALM = "9341455608740708";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}
function routeRealm(realm: string | null = REALM) {
  rpcMock.mockImplementation((fn: string) =>
    fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: realm, error: null }) : Promise.resolve({ data: null, error: null }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("getShopSettings", () => {
  it("maps a configured row (incl. the named alert-email lists)", async () => {
    fromMock.mockReturnValue(chain({ data: [{
      auto_post: true, settle_window_minutes: "30", shop_timezone: "America/Chicago",
      sales_tax_rate_bps: "825", tire_fee_cents: "200",
      date_change_alert_emails: "om@shop.com, a@shop.com, b@shop.com",
      day_correction_alert_emails: "om@shop.com",
    }], error: null }));
    const { realmId, settings } = await getShopSettings(7476);
    expect(realmId).toBe(REALM);
    expect(settings).toEqual({
      autoPost: true, settleWindowMinutes: 30, shopTimezone: "America/Chicago",
      salesTaxRateBps: 825, tireFeeCents: 200,
      dateChangeAlertEmails: ["om@shop.com", "a@shop.com", "b@shop.com"],
      dayCorrectionAlertEmails: ["om@shop.com"],
    });
  });

  it("returns the DEFAULTS when the shop has no settings row", async () => {
    fromMock.mockReturnValue(chain({ data: [], error: null }));
    const { realmId, settings } = await getShopSettings(7476);
    expect(realmId).toBe(REALM);
    expect(settings).toEqual(DEFAULT_SHOP_SETTINGS);
  });

  it("returns {realmId:null, DEFAULTS} when the shop has no connection", async () => {
    routeRealm(null);
    expect(await getShopSettings(7476)).toEqual({ realmId: null, settings: DEFAULT_SHOP_SETTINGS });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a non-safe-integer config value", async () => {
    fromMock.mockReturnValue(chain({ data: [{ auto_post: false, settle_window_minutes: "0", shop_timezone: "America/New_York", sales_tax_rate_bps: "9007199254740993", tire_fee_cents: "100" }], error: null }));
    await expect(getShopSettings(7476)).rejects.toThrow(/non-safe-integer sales_tax_rate_bps/);
  });

  it("FAILS CLOSED on a DB error", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(getShopSettings(7476)).rejects.toThrow(/getShopSettings failed/);
  });
});

describe("upsertShopSettings", () => {
  it("upserts via the RPC, mapping absent fields to null (partial update)", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: null, error: null }),
    );
    await upsertShopSettings(7476, { autoPost: true });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_settings", {
      p_shop_id: 7476, p_realm_id: REALM, p_auto_post: true, p_settle_window_minutes: null,
      p_shop_timezone: null, p_sales_tax_rate_bps: null, p_tire_fee_cents: null,
      p_date_change_alert_emails: null, p_day_correction_alert_emails: null,
    });
  });

  it("alert lists: undefined = unchanged (null param); a list = explicit set; [] clears", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: null, error: null }),
    );
    await upsertShopSettings(7476, {
      dateChangeAlertEmails: ["om@shop.com", "a@shop.com"],
      dayCorrectionAlertEmails: ["om@shop.com"],
    });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_settings", expect.objectContaining({
      p_date_change_alert_emails: "om@shop.com, a@shop.com", p_day_correction_alert_emails: "om@shop.com",
    }));
    await upsertShopSettings(7476, { dateChangeAlertEmails: [], dayCorrectionAlertEmails: [] });
    expect(rpcMock).toHaveBeenLastCalledWith("qteklink_upsert_settings", expect.objectContaining({
      p_date_change_alert_emails: "", p_day_correction_alert_emails: "", // "" clears (the RPC contract)
    }));
  });

  it("FAILS CLOSED with reconnect_required when the shop has no connection", async () => {
    routeRealm(null);
    await expect(upsertShopSettings(7476, { autoPost: true })).rejects.toThrow(/not connected/i);
  });

  it("translates a P0001 validation rejection", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: null, error: { code: "P0001", message: "tire fee must be >= 0" } }),
    );
    await expect(upsertShopSettings(7476, { tireFeeCents: -1 })).rejects.toThrow(/tire fee must be >= 0/);
  });
});
