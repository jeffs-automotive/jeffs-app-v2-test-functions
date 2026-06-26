// audit-history.ts — query keytag_audit_log with optional filters.
//
// Ported (Node idiom) from `getKeytagAuditHistory` (+ its AuditHistoryEntry /
// GetKeytagAuditHistoryResult types) in
// supabase/functions/_shared/tools/keytag-extras.ts. Only that read fn is
// ported — the rest of keytag-extras (whoIsOnTag enrichment, revert/markPosted
// writes, runBulkReconcile) stay on the gateway. The ONLY mechanical changes
// from the edge source are the `@supabase/supabase-js` import specifier and the
// extensionless local import of `TagColor`. The query (gte/lte + optional eq
// filters + `limit+1` truncation probe), the clamping, defaults, and result
// shaping are IDENTICAL so the direct read matches the orchestrator path
// byte-for-byte.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TagColor } from "./keytag-format";

export interface AuditHistoryEntry {
  id: number;
  occurred_at: string;
  tag: string;
  tag_color: TagColor;
  tag_number: number;
  ro_number: number | null;
  action: string;
  prior_status: string | null;
  new_status: string | null;
  source: string;
  user_label: string | null;
  reason: string | null;
  tekmetric_patch_ok: boolean | null;
}

export interface GetKeytagAuditHistoryResult {
  ok: true;
  filters: {
    since: string;
    until: string;
    user_label: string | null;
    tag_color: TagColor | null;
    tag_number: number | null;
    ro_number: number | null;
    action: string | null;
    source: string | null;
  };
  count: number;
  results: AuditHistoryEntry[];
  truncated: boolean;
  message: string;
}

/**
 * Queries the keytag_audit_log with optional filters. Defaults to the last
 * 24 hours, capped at 50 rows. Fetches +1 row to detect truncation.
 */
export async function getKeytagAuditHistory(
  sb: SupabaseClient,
  args: {
    since?: string;
    until?: string;
    user_label?: string;
    tag_color?: TagColor;
    tag_number?: number;
    ro_number?: number;
    action?: string;
    source?: string;
    limit?: number;
  },
): Promise<GetKeytagAuditHistoryResult> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const since = args.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = args.until ?? new Date().toISOString();

  let query = sb
    .from("keytag_audit_log")
    .select(
      "id, occurred_at, tag_color, tag_number, ro_number, action, prior_status, new_status, source, user_label, reason, tekmetric_patch_ok",
    )
    .gte("occurred_at", since)
    .lte("occurred_at", until)
    .order("occurred_at", { ascending: false })
    .limit(limit + 1); // fetch +1 to detect truncation

  if (args.user_label) query = query.eq("user_label", args.user_label);
  if (args.tag_color) query = query.eq("tag_color", args.tag_color);
  if (args.tag_number !== undefined) query = query.eq("tag_number", args.tag_number);
  if (args.ro_number !== undefined) query = query.eq("ro_number", args.ro_number);
  if (args.action) query = query.eq("action", args.action);
  if (args.source) query = query.eq("source", args.source);

  const { data, error } = await query;
  if (error) {
    throw new Error(`keytag_audit_log query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    id: number;
    occurred_at: string;
    tag_color: string;
    tag_number: number;
    ro_number: number | null;
    action: string;
    prior_status: string | null;
    new_status: string | null;
    source: string;
    user_label: string | null;
    reason: string | null;
    tekmetric_patch_ok: boolean | null;
  }>;
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  const results: AuditHistoryEntry[] = trimmed.map((r) => ({
    id: r.id,
    occurred_at: r.occurred_at,
    tag: `${r.tag_color === "red" ? "R" : "Y"}${r.tag_number}`,
    tag_color: r.tag_color as TagColor,
    tag_number: r.tag_number,
    ro_number: r.ro_number,
    action: r.action,
    prior_status: r.prior_status,
    new_status: r.new_status,
    source: r.source,
    user_label: r.user_label,
    reason: r.reason,
    tekmetric_patch_ok: r.tekmetric_patch_ok,
  }));

  return {
    ok: true,
    filters: {
      since,
      until,
      user_label: args.user_label ?? null,
      tag_color: args.tag_color ?? null,
      tag_number: args.tag_number ?? null,
      ro_number: args.ro_number ?? null,
      action: args.action ?? null,
      source: args.source ?? null,
    },
    count: results.length,
    results,
    truncated,
    message: truncated
      ? `Showing ${results.length} most recent entries. There are MORE — narrow the time window or add filters to see them.`
      : results.length === 0
        ? "No audit entries matched the filters."
        : `Found ${results.length} entries.`,
  };
}
