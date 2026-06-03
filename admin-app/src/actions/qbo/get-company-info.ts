"use server";

/**
 * getCompanyInfoAction — the canonical QBO connection smoke (read-only).
 * Proves the whole loop: token refresh → authed GET → response. CompanyInfo is
 * available on every QBO tier, so it never trips the tier-graceful path.
 *
 * Thin action (admin-app pattern): requireAdmin() FIRST, then delegate to the
 * QboClient. Live result requires a seeded qbo_connections row (the OAuth
 * handshake) — otherwise returns reason:"reconnect_required".
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { QboClient } from "@/lib/qbo/client";
import { getValidAccessToken } from "@/lib/qbo/tokens";
import { qboFailure, type QboActionResult } from "./result";

async function getCompanyInfoImpl(): Promise<QboActionResult<unknown>> {
  await requireAdmin();
  try {
    const { realmId } = await getValidAccessToken();
    const data = await new QboClient({ realmId }).request(
      "GET",
      `companyinfo/${realmId}`,
    );
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const getCompanyInfoAction = wrapAdminAction(
  "qboGetCompanyInfo",
  getCompanyInfoImpl,
);
