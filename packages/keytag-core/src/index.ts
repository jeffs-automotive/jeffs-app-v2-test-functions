// @jeffs/keytag-core — shared keytag READ slice (Phase 0 build-seam spike).
//
// One TypeScript source consumed by BOTH the Node/Next admin-app (via
// transpilePackages) AND the Deno edge runtime (via this package's deno.json
// import map). The seam: every `SupabaseClient` reference is a bare-specifier
// `import type` (erased at runtime); relative imports keep `.ts` extensions so
// Deno resolves them directly and Turbopack/webpack transpiles them.
//
// READ-ONLY. No mutations, no RPCs, no Tekmetric HTTP, no confirmation tokens,
// no Deno.env. Mutations stay byte-for-byte on the gateway (plan §6, §8).

export {
  STALE_DAYS,
  customerDisplayName,
  labelStatus,
  buildKeytagDashboardData,
  type KeytagRow,
  type StaleTagDetail,
  type RoWithoutKeytagDetail,
  type TekmetricCustomerSubset,
  type TekmetricRepairOrderSubset,
  type KeytagDashboardData,
} from "./keytag-dashboard-data.ts";

export {
  getKeytagDashboardTool,
  toGridTile,
  type KeytagGridTile,
  type KeytagDashboardResult,
} from "./keytag-dashboard-tool.ts";

export {
  listManualReviewsTool,
  toListItem,
  reviewMatchesSearch,
  type ManualReviewListItem,
  type ListManualReviewsResult,
  type ListManualReviewsArgs,
} from "./manual-review-list.ts";

export {
  CATEGORY_PREFIX,
  type ManualReviewCategory,
  type ManualReviewContext,
  type ManualReviewOption,
} from "./manual-review-types.ts";

export {
  listWipKeyTags,
  findRoByKeyTag,
  type WipKeyTagsResult,
  type FindRoByKeyTagResult,
} from "./keytag-reads.ts";

export {
  getKeytagAuditHistory,
  type AuditHistoryEntry,
  type GetKeytagAuditHistoryResult,
} from "./keytag-audit-history.ts";

export {
  parseKeytag,
  formatKeytag,
  describeKeytag,
  type TagColor,
  type ParsedKeytag,
} from "./keytag-format.ts";

export {
  buildTekmetricRoUrl,
  TEKMETRIC_RO_STATUS,
  TEKMETRIC_API_BASE,
  TEKMETRIC_BASE_URL,
} from "./tekmetric.ts";
