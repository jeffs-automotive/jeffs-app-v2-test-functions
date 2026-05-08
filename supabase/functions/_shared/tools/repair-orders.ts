// Pure tool functions for repair-order lookups.
//
// These are designed to be reused two ways:
//   1. Today: imported by thin HTTP edge-function wrappers (one per tool) so the
//      team can hit them via curl/Claude Desktop while the orchestrator is being built.
//   2. Tomorrow: imported by the orchestrator (Vercel AI SDK) and registered as
//      `tool({ description, parameters, execute })` definitions. The execute
//      function will be a one-liner that just calls into here.
//
// "Fuzzy language" handling: tool DESCRIPTIONS in the orchestrator should make clear
// that any user question about "what is on key tag N" / "who has key tag N" / "which
// car has key tag N" / "which work order has key tag N" maps to findRoByKeyTag.
// The TOOL itself just returns RO data; the orchestrator does the routing.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricGetJson,
  type TekmetricPage,
  type TekmetricRepairOrder,
} from "../tekmetric-client.ts";
import { TEKMETRIC_RO_STATUS, buildTekmetricRoUrl } from "../tekmetric.ts";

// ─── Tool 1: list all WIP repair orders that have a keytag assigned ──────────

export interface WipKeyTagsResult {
  ok: true;
  count: number;
  shop_id: number;
  results: Array<{
    ro_number: number;
    ro_id: number;
    key_tag: number;
    customer_id: number | null;
    vehicle_id: number | null;
    ro_url: string;
  }>;
  /** Set when the WIP set exceeds one page (100). Truncated; orchestrator may want to warn user. */
  truncated?: boolean;
}

/**
 * Lists all repair orders currently in WIP status (status_id = 2) for a shop.
 * Filters out ROs with no keytag (those haven't been tagged yet).
 *
 * Note: Tekmetric paginates at max 100 per page. For shops with >100 active WIPs we
 * only return the first page and set `truncated: true`. The keytag pool is 100 anyway,
 * so this is the practical ceiling.
 */
export async function listWipKeyTags(
  sb: SupabaseClient,
  shopId: number,
): Promise<WipKeyTagsResult> {
  const page = await tekmetricGetJson<TekmetricPage<TekmetricRepairOrder>>(
    sb,
    "/repair-orders",
    {
      shop: shopId,
      repairOrderStatusId: TEKMETRIC_RO_STATUS.WIP,
      size: 100,
    },
  );

  const results = page.content
    .map((ro) => ({
      ro_number: ro.repairOrderNumber,
      ro_id: ro.id,
      key_tag: parseKeyTag(ro.keytag),
      customer_id: ro.customerId,
      vehicle_id: ro.vehicleId,
      ro_url: buildTekmetricRoUrl({ roId: ro.id, shopId: ro.shopId }),
    }))
    .filter((r): r is typeof r & { key_tag: number } => r.key_tag !== null)
    .sort((a, b) => a.key_tag - b.key_tag);

  return {
    ok: true,
    count: results.length,
    shop_id: shopId,
    results,
    ...(page.totalPages > 1 ? { truncated: true } : {}),
  };
}

// ─── Tool 2: find the repair order that holds a specific key tag ─────────────

export type FindRoByKeyTagResult =
  | {
      ok: true;
      found: true;
      key_tag: number;
      ro_number: number;
      ro_id: number;
      ro_url: string;
      customer_id: number | null;
      vehicle_id: number | null;
      /** Always "WIP" — this tool only searches WIP. Included for clarity in the response. */
      status: "WIP";
    }
  | {
      ok: true;
      found: false;
      key_tag: number;
      message: string;
      /** Set if the WIP set was truncated by pagination (>100 WIPs) — we may have missed it. */
      search_incomplete?: boolean;
    };

/**
 * Looks up the WIP repair order currently holding a given key tag.
 *
 * Why WIP-only:
 *   1. Tekmetric's GET /repair-orders does NOT support `keyTag` as a query filter
 *      (verified against TEKMETRIC_API_DOCS.md). An earlier version of this tool
 *      passed `keyTag=N`; Tekmetric silently ignored it and returned arbitrary ROs,
 *      e.g. querying for tag 96 returned a posted RO with tag 40 (2026-05-08).
 *   2. Posted/AR/Complete ROs may still carry a historical `keytag` value in the
 *      Tekmetric record, but the *physical tag* should already be off that car —
 *      so a "what RO has key tag N" question is really asking which WIP RO is
 *      currently using it.
 *
 * Implementation: delegate to listWipKeyTags (the verified-working WIP fetcher),
 * filter its results client-side. One source of truth for the WIP query.
 */
export async function findRoByKeyTag(
  sb: SupabaseClient,
  shopId: number,
  keyTag: number,
): Promise<FindRoByKeyTagResult> {
  if (!Number.isInteger(keyTag) || keyTag < 1 || keyTag > 100) {
    return {
      ok: true,
      found: false,
      key_tag: keyTag,
      message: `Key tag ${keyTag} is out of range. Valid key tags are 1-100.`,
    };
  }

  const wipList = await listWipKeyTags(sb, shopId);
  const match = wipList.results.find((r) => r.key_tag === keyTag);

  if (!match) {
    return {
      ok: true,
      found: false,
      key_tag: keyTag,
      message: wipList.truncated
        ? `Key tag ${keyTag} is not in the first ${wipList.results.length} WIP repair orders. WIP set was truncated by pagination — older WIPs may still hold it.`
        : `Key tag ${keyTag} is not currently on any WIP repair order.`,
      ...(wipList.truncated ? { search_incomplete: true } : {}),
    };
  }

  return {
    ok: true,
    found: true,
    key_tag: keyTag,
    ro_number: match.ro_number,
    ro_id: match.ro_id,
    ro_url: match.ro_url,
    customer_id: match.customer_id,
    vehicle_id: match.vehicle_id,
    status: "WIP",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parses Tekmetric's keytag response field into a number, or null if unset/invalid. */
function parseKeyTag(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}
