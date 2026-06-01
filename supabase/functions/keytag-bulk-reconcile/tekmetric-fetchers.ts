// tekmetric-fetchers — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import { tekmetricFetch, tekmetricGetJson, type TekmetricPage } from "../_shared/tekmetric-client.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { Sentry } from "../_shared/sentry-edge.ts";
import { SHOP_ID, PAGE_SIZE, sb } from "./config.ts";
import { type RepairOrderWithUpdated } from "./types.ts";

// ── Tekmetric fetchers ──────────────────────────────────────────────────────

/**
 * Fetches a single RO from Tekmetric. Returns null if Tekmetric returns 404
 * (RO deleted) — caller treats that as an orphan-release trigger.
 */
export async function fetchRoOrNull(
  roId: number,
): Promise<RepairOrderWithUpdated | null> {
  const res = await tekmetricFetch(sb, `/repair-orders/${roId}`, {
    method: "GET",
    query: { shop: SHOP_ID },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Tekmetric GET /repair-orders/${roId} → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as RepairOrderWithUpdated;
}

export async function fetchAllByStatus(
  statusId: number,
): Promise<RepairOrderWithUpdated[]> {
  const out: RepairOrderWithUpdated[] = [];
  let page = 0;
  while (true) {
    const json = await tekmetricGetJson<TekmetricPage<RepairOrderWithUpdated>>(
      sb,
      "/repair-orders",
      {
        shop: SHOP_ID,
        repairOrderStatusId: statusId,
        size: PAGE_SIZE,
        page,
        sort: "updatedDate,desc",
      },
    );
    out.push(...json.content);
    if (json.last || json.content.length < PAGE_SIZE) break;
    page += 1;
  }
  return out;
}

export async function patchKeytagToTekmetric(
  roId: number,
  keyTagString: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await tekmetricFetch(sb, `/repair-orders/${roId}`, {
      method: "PATCH",
      query: { shop: SHOP_ID },
      body: { keyTag: keyTagString },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Surfaces a non-fatal Supabase RPC/select error for one RO without aborting
 * the cron loop. Routes through logEdgeError (writes a scheduler_error_log row
 * AND fires Sentry.captureMessage with tags; never throws). Returns true if
 * `error` was set (caller may reflect an error in the per-RO result).
 */
export async function surfaceRpcError(
  error: { message: string } | null,
  ctx: { op: string; ro_id: number; ro_number: number | null },
): Promise<boolean> {
  if (!error) return false;
  await logEdgeError(sb, {
    surface: `keytag-bulk-reconcile/${ctx.op}`,
    origin_id: "keytag-bulk-reconcile",
    level: "error",
    error_code: `rpc_${ctx.op}_failed`,
    message: error.message,
    context: { shop_id: SHOP_ID, ro_id: ctx.ro_id, ro_number: ctx.ro_number },
  });
  return true;
}
