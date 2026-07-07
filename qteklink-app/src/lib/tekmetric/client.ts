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

/** The raw /repair-orders row: the status arrives ONLY as the NESTED repairOrderStatus
 *  object — there is NO flat repairOrderStatusId field (verified live 2026-07-06; parsing
 *  the flat field nulled every status and made the missed_ro_webhook safety net vacuous —
 *  the RO 153886 / $21.38 incident). The flat field stays as a defensive fallback only. */
interface RawRepairOrderRow {
  id: number;
  repairOrderStatus?: { id?: number | null } | null;
  repairOrderStatusId?: number | null;
  postedDate?: string | null;
}

function roStatusId(ro: RawRepairOrderRow): number | null {
  const nested = ro.repairOrderStatus?.id;
  if (typeof nested === "number" && Number.isSafeInteger(nested)) return nested;
  const flat = ro.repairOrderStatusId;
  if (typeof flat === "number" && Number.isSafeInteger(flat)) return flat;
  return null;
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
    const json = (await res.json()) as RawRepairOrderRow[] | { content?: RawRepairOrderRow[]; totalPages?: number };
    const content = Array.isArray(json) ? json : (json.content ?? []);
    for (const ro of content) {
      out.push({ id: Number(ro.id), repairOrderStatusId: roStatusId(ro), postedDate: ro.postedDate ?? null });
    }
    const totalPages = Array.isArray(json) ? undefined : json.totalPages;
    if (content.length < 100 || (totalPages != null && page + 1 >= totalPages)) break;
  }
  return out;
}

export interface TekmetricCustomerName {
  firstName: string | null;
  lastName: string | null;
}

/**
 * Fetch ONE customer's name from Tekmetric (`GET /customers/{id}?shop=`). Returns
 * `{firstName,lastName}` on 200, `null` on 404 (deleted/unknown — the caller falls back to
 * a synthetic label). Throws on any other HTTP/auth error (transient — the caller retries
 * on the next build). Mirrors the keytag Deno flow (`_shared/tools/keytag-extras.ts`).
 */
export async function getCustomerById(
  shopId: number,
  customerId: number,
  deps: TekmetricDeps = {},
): Promise<TekmetricCustomerName | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.token ?? (await getAccessToken(fetchImpl));
  const url = `${TEKMETRIC_API_BASE}/customers/${customerId}?shop=${shopId}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tekmetric getCustomerById ${customerId} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { firstName?: string | null; lastName?: string | null };
  return { firstName: json.firstName ?? null, lastName: json.lastName ?? null };
}

/**
 * Fetch ONE repair order's human number from Tekmetric (`GET /repair-orders/{id}?shop=`).
 * Returns the `repairOrderNumber` string on 200 (coerced — Tekmetric may serialize it as a
 * number), `null` on 404 (deleted/unknown) OR when the response carries no number. Throws on
 * any other HTTP/auth error (transient — the caller retries next warm). Used to close the
 * fleet/A-R check-payment RO# gap (the number is absent from our event ledgers), cached in
 * qteklink_ros. Mirrors getCustomerById.
 */
export async function getRepairOrderNumberById(
  shopId: number,
  repairOrderId: number,
  deps: TekmetricDeps = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.token ?? (await getAccessToken(fetchImpl));
  const url = `${TEKMETRIC_API_BASE}/repair-orders/${repairOrderId}?shop=${shopId}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tekmetric getRepairOrderNumberById ${repairOrderId} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { repairOrderNumber?: string | number | null };
  const n = json.repairOrderNumber;
  if (typeof n === "number") return String(n);
  const s = (n ?? "").trim();
  return s || null;
}

/**
 * Build a display name from a Tekmetric customer. People store first+last; COMMERCIAL
 * customers store the company in `firstName` (lastName blank). Both blank → `Customer #<id>`
 * (honest, never empty). Mirrors `_shared/tools/keytag-extras.ts` customerDisplayName.
 */
export function customerDisplayName(
  c: { firstName?: string | null; lastName?: string | null } | null,
  customerId: number,
): string {
  const first = (c?.firstName ?? "").trim();
  const last = (c?.lastName ?? "").trim();
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || `Customer #${customerId}`;
}
