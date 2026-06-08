/**
 * Shop-settings DAL (C8b) — per (shop, realm) config: the auto_post gate, the settle
 * window, and the shop tz + PA tax/tire defaults. `getShopSettings` returns the row
 * (or the built-in defaults when unconfigured / no connection) so the daily-reconcile +
 * poster read ONE source of truth instead of hardcoded constants; `upsertShopSettings`
 * writes via the SECURITY DEFINER RPC (admin-gated at the action).
 *
 * Fat-DAL: pure TS, unit-testable. MULTI-TENANT: shopId server-derived; realmId from the
 * bound connection. No silent failures: every DB error throws; a non-safe-integer config
 * value read back fails closed.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";

export interface ShopSettings {
  autoPost: boolean;
  settleWindowMinutes: number;
  shopTimezone: string;
  salesTaxRateBps: number;
  tireFeeCents: number;
}

/** The built-in defaults (Jeff's / PA) used until a shop configures its own row. */
export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  autoPost: false,
  settleWindowMinutes: 0,
  shopTimezone: "America/New_York",
  salesTaxRateBps: 600,
  tireFeeCents: 100,
};

interface SettingsDbRow {
  auto_post: boolean;
  settle_window_minutes: number | string;
  shop_timezone: string;
  sales_tax_rate_bps: number | string;
  tire_fee_cents: number | string;
}

function safeInt(v: number | string, field: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`getShopSettings: non-safe-integer ${field} (${String(v)})`);
  return n;
}

/**
 * Read a shop's settings — the configured row, or the built-in defaults when the shop
 * has no row yet (or no connection). Throws on DB error.
 */
export async function getShopSettings(
  shopId: number,
): Promise<{ realmId: string | null; settings: ShopSettings }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, settings: DEFAULT_SHOP_SETTINGS };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_settings")
    .select("auto_post, settle_window_minutes, shop_timezone, sales_tax_rate_bps, tire_fee_cents")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .limit(1);
  if (error) throw new Error(`getShopSettings failed: ${error.message}`);

  const row = (data ?? [])[0] as SettingsDbRow | undefined;
  if (!row) return { realmId, settings: DEFAULT_SHOP_SETTINGS };
  return {
    realmId,
    settings: {
      autoPost: row.auto_post === true,
      settleWindowMinutes: safeInt(row.settle_window_minutes, "settle_window_minutes"),
      shopTimezone: row.shop_timezone,
      salesTaxRateBps: safeInt(row.sales_tax_rate_bps, "sales_tax_rate_bps"),
      tireFeeCents: safeInt(row.tire_fee_cents, "tire_fee_cents"),
    },
  };
}

/**
 * Upsert a shop's settings (partial — only the provided fields change). Fails closed
 * when the shop has no connection. Throws on DB error.
 */
export async function upsertShopSettings(
  shopId: number,
  input: Partial<ShopSettings>,
): Promise<void> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_upsert_settings", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_auto_post: input.autoPost ?? null,
    p_settle_window_minutes: input.settleWindowMinutes ?? null,
    p_shop_timezone: input.shopTimezone ?? null,
    p_sales_tax_rate_bps: input.salesTaxRateBps ?? null,
    p_tire_fee_cents: input.tireFeeCents ?? null,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_upsert_settings failed: ${error.message}`);
  }
}
