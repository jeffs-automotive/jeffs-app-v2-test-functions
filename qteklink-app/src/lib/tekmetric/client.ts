/**
 * Minimal Tekmetric API client (C8 §10 safety-net) — qteklink-app side. The keytag edge
 * functions have the full Deno client; this is the small read-only slice the nightly sync
 * needs: list the POSTED repair orders for a shop in a date window, to cross-check that every
 * posted RO produced a webhook event (catches a Tekmetric ingestion outage — the 2026-05-26
 * ~2h gap lost 8 postings).
 *
 * Auth mirrors the edge flow: OAuth client-credentials (Basic auth) using the Vault-stored
 * tekmetric_client_id / tekmetric_client_secret (read via the service_role-only
 * tekmetric_get_secret RPC). Base = production. No secret is logged. Fail-closed: throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TEKMETRIC_API_BASE = "https://shop.tekmetric.com/api/v1";
/** Tekmetric repairOrderStatusId for the two POSTED states (paid + on A/R). */
export const TEKMETRIC_POSTED_STATUS_IDS = [5, 6] as const;

export interface TekmetricRepairOrder {
  id: number;
  repairOrderStatusId: number | null;
  postedDate: string | null;
}

interface TekmetricDeps {
  /** Inject a token (tests / reuse); otherwise fetched via OAuth. */
  token?: string;
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch;
}

/** Exchange the Vault client credentials for a Tekmetric access token. */
async function getAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data: clientId, error: e1 } = await admin.rpc("tekmetric_get_secret", { p_name: "tekmetric_client_id" });
  const { data: clientSecret, error: e2 } = await admin.rpc("tekmetric_get_secret", { p_name: "tekmetric_client_secret" });
  if (e1 || e2) throw new Error(`tekmetric getAccessToken (vault) failed: ${e1?.message ?? e2?.message}`);
  if (typeof clientId !== "string" || typeof clientSecret !== "string" || !clientId || !clientSecret) {
    throw new Error("tekmetric getAccessToken: tekmetric_client_id / tekmetric_client_secret missing from Vault");
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchImpl(`${TEKMETRIC_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`tekmetric OAuth token exchange failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("tekmetric OAuth: response had no access_token");
  return json.access_token;
}

/**
 * List the repair orders a shop POSTED in [postedDateStartIso, postedDateEndIso). Paginates
 * (Spring `content`/`totalPages`, or a bare array). Returns id + status + postedDate; the
 * caller filters to the exact shop-local day + the posted statuses. Throws on any HTTP/auth error.
 */
export async function listPostedRepairOrders(
  shopId: number,
  postedDateStartIso: string,
  postedDateEndIso: string,
  deps: TekmetricDeps = {},
): Promise<TekmetricRepairOrder[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.token ?? (await getAccessToken(fetchImpl));
  const out: TekmetricRepairOrder[] = [];

  const MAX_PAGES = 50; // safety cap (5000 ROs/day is never real)
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${TEKMETRIC_API_BASE}/repair-orders?shop=${shopId}` +
      `&postedDateStart=${encodeURIComponent(postedDateStartIso)}` +
      `&postedDateEnd=${encodeURIComponent(postedDateEndIso)}` +
      `&size=100&page=${page}`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`tekmetric listPostedRepairOrders failed: HTTP ${res.status}`);
    const json = (await res.json()) as TekmetricRepairOrder[] | { content?: TekmetricRepairOrder[]; totalPages?: number };
    const content = Array.isArray(json) ? json : (json.content ?? []);
    for (const ro of content) {
      out.push({ id: Number(ro.id), repairOrderStatusId: ro.repairOrderStatusId ?? null, postedDate: ro.postedDate ?? null });
    }
    const totalPages = Array.isArray(json) ? undefined : json.totalPages;
    if (content.length < 100 || (totalPages != null && page + 1 >= totalPages)) break;
  }
  return out;
}
