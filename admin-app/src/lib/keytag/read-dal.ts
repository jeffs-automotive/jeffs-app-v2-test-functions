import "server-only";

/**
 * Keytag READ DAL — direct in-process Node reads.
 *
 * Replaces the orchestrator HTTP gateway hop for the four keytag READ
 * surfaces (dashboard / board WIP tags / manual-reviews list / audit history).
 * Each fn builds a service-role Supabase client (createSupabaseAdminClient),
 * resolves shop_id SERVER-SIDE (resolveAdminShopId — never from client input),
 * calls the corresponding pure query under ./queries/, and wraps the whole call
 * in a 10s seatbelt that THROWS on timeout OR DB error (never swallows to an
 * empty result — callers map the throw to an error card / { kind: 'error' }).
 *
 * The reads were faithfully ported from the edge `_shared` source-of-truth into
 * ./queries/ (Node idiom, self-contained — no import from supabase/functions/**).
 * They return field-identical shapes to the admin-app's `@/lib/orchestrator/types`;
 * the casts at each return boundary bridge the nominally-distinct (but
 * structurally identical) ported types to the admin-app types the callers expect.
 *
 * All write paths + whoIsOnTag stay on the orchestrator gateway (@/lib/orchestrator/client).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";
import { getKeytagDashboardTool } from "./queries/keytag-dashboard";
import { listWipKeyTags } from "./queries/wip-keytags";
import {
  listManualReviewsTool,
  type ListManualReviewsArgs,
} from "./queries/manual-reviews";
import { getKeytagAuditHistory } from "./queries/audit-history";
import type {
  KeytagDashboardResult,
  WipKeyTagsResult,
  ListManualReviewsResult,
  GetKeytagAuditHistoryArgs,
  GetKeytagAuditHistoryResult,
} from "@/lib/orchestrator/types";

/**
 * 10s seatbelt. The reads are pure DB queries (no Tekmetric walk) and finish in
 * well under a second normally; the timeout guards against a hung connection so
 * the /keytags render never blocks indefinitely. Rejects (never resolves to an
 * empty result) so the caller surfaces the failure.
 */
const READ_TIMEOUT_MS = 10_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${READ_TIMEOUT_MS}ms`)),
      READ_TIMEOUT_MS,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Live keytag pool snapshot for the Dashboard tab. Throws on timeout / DB error. */
export async function getDashboard(): Promise<KeytagDashboardResult> {
  const sb = createSupabaseAdminClient();
  const shopId = resolveAdminShopId();
  const result = await withTimeout(
    getKeytagDashboardTool(sb, shopId),
    "getDashboard",
  );
  // Field-identical to the admin-app KeytagDashboardResult (the ported query
  // declares its own nominally-distinct StaleTagDetail / RoWithoutKeytagDetail /
  // KeytagGridTile types; the shapes match the orchestrator-types versions).
  return result as unknown as KeytagDashboardResult;
}

/** In-use keytags (WIP + A/R) for the Live board's tagged list. Throws on timeout / DB error. */
export async function getWipKeyTags(): Promise<WipKeyTagsResult> {
  const sb = createSupabaseAdminClient();
  const shopId = resolveAdminShopId();
  const result = await withTimeout(listWipKeyTags(sb, shopId), "getWipKeyTags");
  // Field-identical to the admin-app WipKeyTagsResult.
  return result as unknown as WipKeyTagsResult;
}

/** Manual-reviews list (open by default; searchable). Throws on timeout / DB error. */
export async function getManualReviews(
  args: ListManualReviewsArgs,
): Promise<ListManualReviewsResult> {
  const sb = createSupabaseAdminClient();
  const result = await withTimeout(
    listManualReviewsTool(sb, args),
    "getManualReviews",
  );
  // Field-identical to the admin-app ListManualReviewsResult (the ported query
  // declares its own ManualReviewCategory / ManualReviewContext / etc.).
  return result as unknown as ListManualReviewsResult;
}

/** Keytag audit-log history with optional filters. Throws on timeout / DB error. */
export async function getAuditHistory(
  args: GetKeytagAuditHistoryArgs,
): Promise<GetKeytagAuditHistoryResult> {
  const sb = createSupabaseAdminClient();
  const result = await withTimeout(
    getKeytagAuditHistory(sb, args),
    "getAuditHistory",
  );
  // Field-identical to the admin-app GetKeytagAuditHistoryResult.
  return result as unknown as GetKeytagAuditHistoryResult;
}
