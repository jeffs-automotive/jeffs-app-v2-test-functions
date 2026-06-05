"use server";

/**
 * getCompanyInfoAction — the canonical QBO connection smoke (read-only).
 * Proves the whole loop: token refresh → authed GET → response. CompanyInfo is
 * available on every QBO tier, so it never trips the tier-graceful path.
 *
 * Thin action (admin-app pattern): requireQtekUser() FIRST, then delegate to the
 * QboClient. Live result requires a seeded qbo_connections row (the OAuth
 * handshake) — otherwise returns reason:"reconnect_required".
 */
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { QboClient } from "@/lib/qbo/client";
import { getValidAccessToken } from "@/lib/qbo/tokens";
import { qboFailure, type QboActionResult } from "./result";

async function getCompanyInfoImpl(): Promise<QboActionResult<unknown>> {
  await requireQtekUser();
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

export const getCompanyInfoAction = wrapQtekAction(
  "qboGetCompanyInfo",
  getCompanyInfoImpl,
);
