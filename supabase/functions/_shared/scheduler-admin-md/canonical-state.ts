// canonical-state — scheduler admin MD module.
// Extracted from scheduler-admin-md.ts (file-size-refactor). Mechanical split
// — no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex } from "./md-table.ts";
import { canonicalStateTestingServicesV2, canonicalStateRoutineServicesV2, canonicalStateSubcategoryDescriptionsV2, canonicalStateSubcategoryServiceMapV2, canonicalStateQuestionRequiredFactsV2, canonicalStateConcernQuestionsFlat, canonicalStateConcernCategoryUpload, canonicalStateConcernCategoryGuideline, canonicalStateAppointmentDefaultLimits, canonicalStateClosedDatesFuture } from "./canonical-handlers.ts";

// ─── Snapshot kind allow-list (closed set) ─────────────────────────────────

/**
 * The 10 canonical snapshot_kind values per ADR-024 + ADR-025. This is the
 * closed allow-list used by `lock_surface_for_kind`, the dispatch RPC,
 * the apply RPCs' confirm_token formula (per E1cf-N2), and the TS-side
 * `computeCanonicalAfterState()` helper.
 *
 * Drift between this list and the plpgsql allow-list = production bug.
 */
export type SnapshotKind =
  | "testing_services_v2"
  | "routine_services_v2"
  | "concern_subcategories_descriptions_v2"
  | "concern_subcategories_map_v2"
  | "concern_questions_required_facts_v2"
  | "concern_questions_flat"
  | "concern_questions_per_category"
  | "concern_category_guidelines"
  | "appointment_default_limits"
  | "closed_dates_future";

const SNAPSHOT_KIND_ALLOWLIST: ReadonlySet<SnapshotKind> = new Set<SnapshotKind>([
  "testing_services_v2",
  "routine_services_v2",
  "concern_subcategories_descriptions_v2",
  "concern_subcategories_map_v2",
  "concern_questions_required_facts_v2",
  "concern_questions_flat",
  "concern_questions_per_category",
  "concern_category_guidelines",
  "appointment_default_limits",
  "closed_dates_future",
]);

/** Kinds whose confirm_token formula includes a `:<category_slug>` suffix. */
const KINDS_REQUIRING_CATEGORY_SLUG: ReadonlySet<SnapshotKind> = new Set<
  SnapshotKind
>([
  "concern_questions_per_category",
  "concern_category_guidelines",
]);

/** Kinds whose confirm_token formula includes a `:<original_today>` suffix. */
const KINDS_REQUIRING_ORIGINAL_TODAY: ReadonlySet<SnapshotKind> = new Set<
  SnapshotKind
>([
  "closed_dates_future",
]);

// ─── 1. computeConfirmToken ─────────────────────────────────────────────────

/**
 * Arguments for `computeConfirmToken()`. The 5 base fields are required for
 * every kind; the kind-specific fields (`categorySlug`, `originalToday`) are
 * required only when the kind matches.
 */
export interface ComputeConfirmTokenArgs {
  shopId: number;
  kind: SnapshotKind;
  expectedCurrentHash: string;
  mdContentHash: string;
  actorEmail: string;
  /** REQUIRED when kind ∈ {concern_questions_per_category, concern_category_guidelines}; ignored otherwise. */
  categorySlug?: string;
  /** REQUIRED when kind = closed_dates_future. ISO `YYYY-MM-DD`. Ignored otherwise. */
  originalToday?: string;
}

/**
 * Compute the deterministic Pattern S confirm_token. MUST produce the same
 * bytes as the plpgsql apply RPCs' inline formula (per ROUND-6-RESIDUALS
 * E1cf-N2):
 *
 *   sha256(shop_id || ':' || kind || ':' || expected_current_hash || ':' ||
 *          md_content_hash || ':' || actor_email [|| ':' || category_slug]
 *                                  [|| ':' || original_today])
 *
 * Used by:
 *   - E4 V2 catalog uploaders to compute the token for dry_run response
 *   - E5a-e legacy uploader Pattern S refactors to compute the token
 *   - Anywhere the TS side needs to verify a confirm_token matches.
 *
 * Token mismatch path in the apply RPC RAISEs
 * `'revert_blocked: confirm_token_mismatch: …'`.
 *
 * @returns hex-encoded SHA-256 (64 chars lowercase) — matches pgcrypto's
 *          `encode(digest(text, 'sha256'), 'hex')` output byte-for-byte.
 *
 * @throws if `kind` is not in the canonical allow-list, or if a kind-specific
 *         field is required but missing.
 */
export async function computeConfirmToken(
  args: ComputeConfirmTokenArgs,
): Promise<string> {
  if (!SNAPSHOT_KIND_ALLOWLIST.has(args.kind)) {
    throw new Error(
      `computeConfirmToken: kind "${args.kind}" not in canonical allow-list (10 kinds)`,
    );
  }
  if (KINDS_REQUIRING_CATEGORY_SLUG.has(args.kind)) {
    if (!args.categorySlug || args.categorySlug.length === 0) {
      throw new Error(
        `computeConfirmToken: kind "${args.kind}" REQUIRES categorySlug (got ${JSON.stringify(args.categorySlug)})`,
      );
    }
  }
  if (KINDS_REQUIRING_ORIGINAL_TODAY.has(args.kind)) {
    if (!args.originalToday || !/^\d{4}-\d{2}-\d{2}$/.test(args.originalToday)) {
      throw new Error(
        `computeConfirmToken: kind "${args.kind}" REQUIRES originalToday in YYYY-MM-DD form (got ${JSON.stringify(args.originalToday)})`,
      );
    }
  }

  // Build the colon-delimited base input. Order is LOAD-BEARING — plpgsql
  // formula concatenates in this exact sequence (per E1cf-N2 + each apply
  // RPC's header comment).
  let input = `${args.shopId}:${args.kind}:${args.expectedCurrentHash}:${args.mdContentHash}:${args.actorEmail}`;

  if (KINDS_REQUIRING_CATEGORY_SLUG.has(args.kind)) {
    input += `:${args.categorySlug}`;
  }
  if (KINDS_REQUIRING_ORIGINAL_TODAY.has(args.kind)) {
    input += `:${args.originalToday}`;
  }

  // sha256Hex is already defined above (line ~343) — reuse for byte-parity
  // with the apply RPCs' pgcrypto `encode(digest(text, 'sha256'), 'hex')`.
  return await sha256Hex(input);
}

// ─── 2. computeCanonicalAfterState ─────────────────────────────────────────

/**
 * Arguments for `computeCanonicalAfterState()`. Uses a service-role
 * SupabaseClient because the canonical-state query reads from tables whose
 * RLS policies may not permit the caller's auth context. The apply / revert
 * RPCs run as SECURITY DEFINER so they bypass RLS; the TS-side helper
 * needs equivalent read access via service_role.
 */
export interface ComputeCanonicalAfterStateArgs {
  kind: SnapshotKind;
  supabase: SupabaseClient;
  shopId: number;
  /** The p_snapshot JSONB equivalent — same shape the apply path emits. */
  snapshot: Record<string, unknown>;
}

/**
 * TS-side mirror of plpgsql `canonical_state_<kind>(p_shop_id, p_snapshot)`.
 * Emits the pipe-delimited canonical text per ADR-025 byte-for-byte
 * identically to the matching plpgsql serializer in migration
 * `20260526000100_revert_md_upload_dispatch.sql` (lines 518-1138).
 *
 * Used by:
 *   - E4 V2 catalog uploader modifications to populate
 *     `expected_after_state_canonical` AFTER write (post-mutation read)
 *   - Revert-path diff diagnostics when TS code needs the current canonical
 *     state for human-readable display
 *
 * The 5 NEW legacy apply RPCs (PLAN §4.1-4.5) compute their own
 * `expected_after_state_canonical` server-side via `canonical_state_<kind>`
 * — they do NOT use this TS helper.
 *
 * @throws on unknown kind, missing snapshot fields, or Supabase query error.
 *
 * Byte-parity contract per ADR-025 + E1b-N3: a future E10 integration test
 * will seed deterministic data, call BOTH plpgsql `canonical_state_<kind>`
 * (via Supabase RPC) AND this TS helper, and assert the two TEXT outputs
 * are byte-for-byte identical.
 */
export async function computeCanonicalAfterState(
  args: ComputeCanonicalAfterStateArgs,
): Promise<string> {
  const { kind, supabase, shopId, snapshot } = args;
  if (!SNAPSHOT_KIND_ALLOWLIST.has(kind)) {
    throw new Error(
      `computeCanonicalAfterState: kind "${kind}" not in canonical allow-list (10 kinds)`,
    );
  }

  switch (kind) {
    case "testing_services_v2":
      return await canonicalStateTestingServicesV2(supabase, shopId);
    case "routine_services_v2":
      return await canonicalStateRoutineServicesV2(supabase, shopId);
    case "concern_subcategories_descriptions_v2":
      return await canonicalStateSubcategoryDescriptionsV2(supabase, shopId);
    case "concern_subcategories_map_v2":
      return await canonicalStateSubcategoryServiceMapV2(supabase, shopId);
    case "concern_questions_required_facts_v2":
      return await canonicalStateQuestionRequiredFactsV2(supabase, shopId);
    case "concern_questions_flat":
      return await canonicalStateConcernQuestionsFlat(supabase, shopId);
    case "concern_questions_per_category":
      return await canonicalStateConcernCategoryUpload(supabase, shopId, snapshot);
    case "concern_category_guidelines":
      return await canonicalStateConcernCategoryGuideline(supabase, shopId, snapshot);
    case "appointment_default_limits":
      return await canonicalStateAppointmentDefaultLimits(supabase, shopId);
    case "closed_dates_future":
      return await canonicalStateClosedDatesFuture(supabase, shopId, snapshot);
  }
}

// ─── 3. canonicalizeDiff ───────────────────────────────────────────────────

/**
 * Allow-list of object keys whose values are SET-typed arrays — i.e., array
 * order is NOT semantically meaningful so we sort for stability. Per PLAN
 * §4.8: keys ending in `_keys` or `_ids`, plus `surfaces`.
 */
function isSetTypedArrayKey(key: string): boolean {
  if (key === "surfaces") return true;
  if (key.endsWith("_keys")) return true;
  if (key.endsWith("_ids")) return true;
  return false;
}

/**
 * Stable JSON canonicalization for the `diff_summary` JSONB column. Used
 * (indirectly) by `computeConfirmToken()` callers that derive the
 * `md_content_hash` / `expected_current_hash` inputs, and by tests that
 * compare diff_summary across runs.
 *
 * Rules per PLAN §4.8:
 *   - Object keys ALWAYS sorted alphabetically
 *   - Set-typed arrays sorted (allow-list: keys ending in `_keys` or
 *     `_ids`, plus `surfaces`)
 *   - Ordered arrays preserved (everything not in the sort allow-list)
 *   - NULL → `null`
 *   - Numbers as-is
 *   - Strings JSON-escaped, double-quoted
 *
 * Test invariant: `canonicalizeDiff({z: 1, a: 2}) === '{"a":2,"z":1}'`.
 */
export function canonicalizeDiff(diff: Record<string, unknown>): string {
  return stringifyCanonical(diff, /* parentKey */ undefined);
}

function stringifyCanonical(value: unknown, parentKey: string | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Sort only if parent key is in the set-typed allow-list. Otherwise
    // preserve order (ordered arrays like `questions[]`, `options[]`).
    const items = value.map((x) => stringifyCanonical(x, undefined));
    if (parentKey !== undefined && isSetTypedArrayKey(parentKey)) {
      // Sort the already-stringified array elements lexicographically for
      // determinism. Mirrors plpgsql `jsonb_agg(elem ORDER BY elem)`.
      items.sort();
    }
    return "[" + items.join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k], k)}`,
    );
    return "{" + parts.join(",") + "}";
  }
  return "null";
}
