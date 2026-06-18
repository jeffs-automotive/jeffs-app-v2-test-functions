// listManualReviews — browse/search manual reviews for the admin-app list UI.
//
// The original manual-review surface was lookup-by-code ONLY (you needed the
// 6-char code from an email). This tool backs the admin-app `/keytags` Manual
// Reviews tab's scannable LIST: it returns review rows (open and/or resolved)
// with the fields the row + its expanded panel need, plus client-friendly
// free-text search over review code, key tag, and RO#.
//
// Read-only. NOT subject to the brute-force lockout that guards
// `lookup_manual_review` — that protects against code-guessing; this is a
// browse over the operator's own shop data behind the admin Entra gate.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  ManualReviewCategory,
  ManualReviewContext,
  ManualReviewOption,
} from "../manual-review.ts";

/** One row in the Manual Reviews list. */
export interface ManualReviewListItem {
  code: string;
  category: ManualReviewCategory;
  issue_summary: string;
  ro_id: number | null;
  ro_number: number | null;
  tag_color: "red" | "yellow" | null;
  tag_number: number | null;
  options: ManualReviewOption[];
  /** Full context JSONB — used by the expanded row's detail view. */
  context: ManualReviewContext;
  issued_at: string;
  resolved_at: string | null;
  resolved_choice: string | null;
  resolved_by_user_label: string | null;
}

export interface ListManualReviewsResult {
  ok: true;
  /** Number of rows returned (after the search filter). */
  count: number;
  /** Total UNRESOLVED reviews in the shop (ignores search) — for a headline badge. */
  open_count: number;
  results: ManualReviewListItem[];
}

export interface ListManualReviewsArgs {
  /** When true (default), return only unresolved reviews. */
  only_open?: boolean;
  /** Free-text filter over review code, key tag, and RO#. */
  search?: string;
  /** Max rows. Default 200; ignored-ish when searching (we widen to scan). */
  limit?: number;
}

interface RawReviewRow {
  code: string;
  category: string;
  issue_summary: string;
  context: Record<string, unknown> | null;
  options: unknown;
  issued_at: string;
  resolved_at: string | null;
  resolved_choice: string | null;
  resolved_by_user_label: string | null;
}

/** Map a raw DB row to a list item, pulling ro/tag out of the context JSONB. */
export function toListItem(row: RawReviewRow): ManualReviewListItem {
  const ctx = (row.context ?? {}) as ManualReviewContext;
  const roId = typeof ctx.ro_id === "number" ? ctx.ro_id : null;
  const roNumber = typeof ctx.ro_number === "number" ? ctx.ro_number : null;
  const tagColor =
    ctx.tag_color === "red" || ctx.tag_color === "yellow" ? ctx.tag_color : null;
  const tagNumber = typeof ctx.tag_number === "number" ? ctx.tag_number : null;
  return {
    code: row.code,
    category: row.category as ManualReviewCategory,
    issue_summary: row.issue_summary,
    ro_id: roId,
    ro_number: roNumber,
    tag_color: tagColor,
    tag_number: tagNumber,
    options: Array.isArray(row.options) ? (row.options as ManualReviewOption[]) : [],
    context: ctx,
    issued_at: row.issued_at,
    resolved_at: row.resolved_at,
    resolved_choice: row.resolved_choice,
    resolved_by_user_label: row.resolved_by_user_label,
  };
}

/**
 * Forgiving free-text match over a review's CODE, KEY TAG, and RO#.
 *
 *   - Code: alphanumeric substring, dash-insensitive ("orp4xk" → ORP-4XKZ9P).
 *   - Key tag: any of "r5" / "red5" / "red 5" / "5" (when the query has letters
 *     it's treated as a tag/code, never an RO#).
 *   - RO#: numeric substring, only when the query is purely numeric.
 *
 * Empty query matches everything.
 */
export function reviewMatchesSearch(
  item: ManualReviewListItem,
  rawSearch: string,
): boolean {
  const q = rawSearch.trim().toLowerCase();
  if (!q) return true;

  const qAlnum = q.replace(/[^a-z0-9]/g, "");
  const hasLetters = /[a-z]/.test(q);

  // Code (dash-insensitive substring)
  const codeNorm = item.code.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (qAlnum && codeNorm.includes(qAlnum)) return true;

  // Key tag
  if (item.tag_color && item.tag_number !== null) {
    const c = item.tag_color;
    const candidates = [
      (c === "red" ? "r" : "y") + item.tag_number, // r5 / y45
      c + item.tag_number, // red5
      c + " " + item.tag_number, // red 5
      String(item.tag_number), // 5
    ].map((s) => s.replace(/\s+/g, ""));
    const qTag = q.replace(/\s+/g, "");
    if (candidates.includes(qTag)) return true;
  }

  // RO# (numeric-only queries)
  if (!hasLetters && item.ro_number !== null) {
    const digits = q.replace(/[^0-9]/g, "");
    if (digits && String(item.ro_number).includes(digits)) return true;
  }

  return false;
}

export async function listManualReviewsTool(
  sb: SupabaseClient,
  args: ListManualReviewsArgs,
): Promise<ListManualReviewsResult> {
  const onlyOpen = args.only_open ?? true;
  const search = (args.search ?? "").trim();
  // When searching, widen the scan so a match isn't hidden below the limit;
  // the shop's review volume is low (tens, not thousands).
  const cap = search ? 1000 : Math.min(Math.max(args.limit ?? 200, 1), 1000);

  let query = sb
    .from("keytag_manual_reviews")
    .select(
      "code, category, issue_summary, context, options, issued_at, resolved_at, resolved_choice, resolved_by_user_label",
    )
    .order("issued_at", { ascending: false })
    .limit(cap);
  if (onlyOpen) {
    query = query.is("resolved_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`list_manual_reviews query failed: ${error.message}`);
  }

  let items = ((data ?? []) as RawReviewRow[]).map(toListItem);
  if (search) {
    items = items.filter((it) => reviewMatchesSearch(it, search));
  }

  // Total unresolved (ignores search + only_open) — a stable headline badge.
  const { count: openCount } = await sb
    .from("keytag_manual_reviews")
    .select("*", { count: "exact", head: true })
    .is("resolved_at", null);

  return {
    ok: true,
    count: items.length,
    open_count: openCount ?? items.filter((i) => !i.resolved_at).length,
    results: items,
  };
}
