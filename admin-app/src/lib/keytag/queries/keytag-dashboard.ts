// keytag-dashboard.ts — the live pool snapshot for the admin-app Dashboard tab.
//
// Ported (Node idiom) from the edge source-of-truth:
//   - supabase/functions/_shared/keytag-dashboard-data.ts (buildKeytagDashboardData)
//   - supabase/functions/_shared/tools/keytag-dashboard-tool.ts
//     (getKeytagDashboardTool / toGridTile → KeytagDashboardResult)
//
// The ONLY mechanical changes from the edge source are: the
// `@supabase/supabase-js` import specifier (was `npm:@supabase/supabase-js@2`),
// extensionless relative imports, and importing `buildTekmetricRoUrl` from the
// local `tekmetric-ro-url` port. The query logic, filters, ordering, stale
// math, and output shaping are IDENTICAL so the direct read matches the
// orchestrator path byte-for-byte. Pure DB read — no Tekmetric walk (customer
// names come from the denormalized keytags.customer_name column).

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTekmetricRoUrl } from "./tekmetric-ro-url";

/**
 * Days-since-last-activity threshold beyond which a held tag is "stale".
 * Shared so the email legend, the dashboard, and `LiveStateTab` all compute
 * stale-ness against the SAME cutoff.
 */
export const STALE_DAYS = 3;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeytagRow {
  tag_color: "red" | "yellow";
  tag_number: number;
  status: "available" | "assigned" | "posted_ar" | string;
  ro_id: number | null;
  ro_number: number | null;
  customer_id: number | null;
  customer_name: string | null;
  assigned_at: string | null;
  posted_at: string | null;
  last_activity_at: string | null;
}

export interface StaleTagDetail {
  tag_color: "red" | "yellow";
  tag_number: number;
  ro_id: number;
  ro_number: number;
  customer_name: string;
  days_stale: number;
  ro_url: string;
  category: "wip" | "ar";
}

/**
 * One row in the "Repair Orders Without Key Tags" section.
 *
 * Sourced from `keytag_manual_reviews` rows with `category='ar_no_prior_tag'`
 * AND `resolved_at IS NULL`. For each, we look up the most recent `released`
 * action in `keytag_audit_log` for the same RO to populate the "previously
 * had / released_at" columns — that's what differentiates "manually released
 * yesterday, no action needed" from "never had a tag, needs investigation".
 */
export interface RoWithoutKeytagDetail {
  arn_code: string;
  ro_id: number | null;
  ro_number: number | null;
  ro_url: string;
  status_label: string; // 'A/R' | 'WIP' | etc. — from the review's stored status_name
  prior_tag_color: "red" | "yellow" | null;
  prior_tag_number: number | null;
  released_at: string | null;
  released_source: string | null;
  days_open: number;
}

/** The full pool snapshot consumed by the dashboard tool. */
export interface KeytagDashboardData {
  tags: KeytagRow[];
  inUseCount: number;
  availableCount: number;
  staleCount: number;
  staleDetails: StaleTagDetail[];
  rosWithoutKeytags: RoWithoutKeytagDetail[];
  /** ISO timestamp the snapshot was built. */
  generatedAt: string;
}

/** One cell in the 180-tag grid (R1..R90, Y1..Y90). */
export interface KeytagGridTile {
  tag_color: "red" | "yellow";
  tag_number: number;
  in_use: boolean;
  status: string;
  ro_number: number | null;
}

export interface KeytagDashboardResult {
  ok: true;
  generated_at: string;
  counts: {
    in_use: number;
    available: number;
    stale: number;
    total: number;
  };
  stale: StaleTagDetail[];
  ros_without_tags: RoWithoutKeytagDetail[];
  grid: KeytagGridTile[];
}

// ─── "Repair Orders Without Key Tags" data fetch ─────────────────────────────

/**
 * Map Tekmetric status_name (as stored in the review context at issuance time)
 * to a compact label for the table. Falls back to the raw name when we don't
 * have a known shorthand.
 */
export function labelStatus(statusName: string): string {
  const s = (statusName || "").toUpperCase();
  if (s === "POSTED" || s.includes("A/R") || s.includes("RECEIVABLE")) {
    return "A/R";
  }
  if (s.includes("WORKING") || s.includes("WIP") || s.includes("APPROVED")) {
    return "WIP";
  }
  if (s.includes("ESTIMATE")) return "Estimate";
  if (s.includes("POSTED_PAID") || s.includes("PAID")) return "Paid";
  if (!statusName) return "—";
  return statusName;
}

/**
 * Pulls every unresolved ARN (`ar_no_prior_tag`) manual review and joins each
 * to the latest `released` action in `keytag_audit_log` (if any). Skips rows
 * whose most-recent release was a manual `claude_desktop` / `admin_app` release
 * (the advisor already handled those).
 */
async function fetchRosWithoutKeytags(
  sb: SupabaseClient,
  shopId: number,
): Promise<RoWithoutKeytagDetail[]> {
  const { data: reviews, error } = await sb
    .from("keytag_manual_reviews")
    .select("code, context, issued_at")
    .eq("category", "ar_no_prior_tag")
    .is("resolved_at", null)
    .order("issued_at", { ascending: true });
  if (error) {
    console.error(
      JSON.stringify({
        level: "warning",
        msg: "ros_without_keytags_query_failed",
        detail: error.message,
      }),
    );
    return [];
  }

  const out: RoWithoutKeytagDetail[] = [];
  const nowMs = Date.now();

  for (const r of reviews ?? []) {
    const ctx = (r.context ?? {}) as {
      ro_id?: number | null;
      ro_number?: number | null;
      tekmetric_status_name?: string | null;
    };
    const roId = typeof ctx.ro_id === "number" ? ctx.ro_id : null;
    const roNumber = typeof ctx.ro_number === "number" ? ctx.ro_number : null;
    const statusName = (ctx.tekmetric_status_name ?? "").toString();
    const statusLabel = labelStatus(statusName);

    let priorColor: "red" | "yellow" | null = null;
    let priorNumber: number | null = null;
    let releasedAt: string | null = null;
    let releasedSource: string | null = null;

    const roIdSafe =
      roId !== null && Number.isInteger(roId) && Number.isSafeInteger(roId);
    const roNumberSafe =
      roNumber !== null &&
      Number.isInteger(roNumber) &&
      Number.isSafeInteger(roNumber);

    if (roIdSafe || roNumberSafe) {
      const orClauses: string[] = [];
      if (roIdSafe) orClauses.push(`ro_id.eq.${roId}`);
      if (roNumberSafe) orClauses.push(`ro_number.eq.${roNumber}`);

      const { data: rel, error: relErr } = await sb
        .from("keytag_audit_log")
        .select("tag_color, tag_number, occurred_at, source")
        .or(orClauses.join(","))
        .eq("action", "released")
        .order("occurred_at", { ascending: false })
        .limit(1);

      if (relErr) {
        console.error(
          JSON.stringify({
            level: "warning",
            msg: "ros_without_keytags_audit_lookup_failed",
            ro_id: roId,
            ro_number: roNumber,
            detail: relErr.message,
          }),
        );
      } else if (rel && rel.length > 0) {
        const row = rel[0] as {
          tag_color: "red" | "yellow" | null;
          tag_number: number | null;
          occurred_at: string;
          source: string | null;
        };
        priorColor = row.tag_color;
        priorNumber = row.tag_number;
        releasedAt = row.occurred_at;
        releasedSource = row.source;
      }
    }

    const issuedAtMs = r.issued_at
      ? new Date(r.issued_at as string).getTime()
      : nowMs;
    const daysOpen = Math.floor((nowMs - issuedAtMs) / (24 * 60 * 60_000));

    // Skip rows whose most-recent release was a manual HUMAN release — the
    // advisor explicitly released the tag and doesn't need a reminder. Both
    // operator surfaces count: 'claude_desktop' (Claude Desktop) and 'admin_app'
    // (the /keytags dashboard, post the 2026-06-24 provenance split).
    if (releasedSource === "claude_desktop" || releasedSource === "admin_app") {
      continue;
    }

    out.push({
      arn_code: r.code as string,
      ro_id: roId,
      ro_number: roNumber,
      ro_url: roId !== null ? buildTekmetricRoUrl({ roId, shopId }) : "",
      status_label: statusLabel,
      prior_tag_color: priorColor,
      prior_tag_number: priorNumber,
      released_at: releasedAt,
      released_source: releasedSource,
      days_open: daysOpen,
    });
  }

  return out;
}

// ─── The snapshot builder ────────────────────────────────────────────────────

/**
 * Build the full keytag pool snapshot. Reads `keytags`, computes counts +
 * stale tags (names from the denormalized keytags.customer_name), and the
 * unresolved-ARN "repair orders without key tags" rows.
 *
 * @throws if the `keytags` query fails (the snapshot can't be built without
 *   the pool). ARN lookups fail soft (logged, empty/"Unknown").
 */
export async function buildKeytagDashboardData(
  sb: SupabaseClient,
  shopId: number,
): Promise<KeytagDashboardData> {
  const { data: rows, error } = await sb
    .from("keytags")
    .select(
      "tag_color, tag_number, status, ro_id, ro_number, customer_id, customer_name, assigned_at, posted_at, last_activity_at",
    )
    .order("tag_color")
    .order("tag_number");
  if (error) {
    throw new Error(`keytags query: ${error.message}`);
  }

  const tags = (rows ?? []) as KeytagRow[];

  const inUseCount = tags.filter(
    (t) => t.status === "assigned" || t.status === "posted_ar",
  ).length;
  const availableCount = tags.filter((t) => t.status === "available").length;

  // Stale = any in-use tag (WIP or A/R) whose Tekmetric-side last activity is
  // older than STALE_DAYS. The reconcile cron refreshes last_activity_at nightly.
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60_000);
  const staleRaw = tags.filter(
    (t) =>
      (t.status === "assigned" || t.status === "posted_ar") &&
      t.last_activity_at !== null &&
      new Date(t.last_activity_at) < cutoff,
  );

  // Oldest first (highest priority to investigate)
  staleRaw.sort((a, b) => {
    const aTime = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const bTime = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return aTime - bTime;
  });

  // Customer names come straight from the denormalized keytags.customer_name
  // (captured at assign + backfilled nightly) — pure DB read, no Tekmetric walk.
  const staleDetails: StaleTagDetail[] = [];
  for (const t of staleRaw) {
    const customerName = t.customer_name?.trim() || null;
    const daysStale = t.last_activity_at
      ? Math.floor(
          (Date.now() - new Date(t.last_activity_at).getTime()) /
            (24 * 60 * 60_000),
        )
      : 0;
    staleDetails.push({
      tag_color: t.tag_color,
      tag_number: t.tag_number,
      ro_id: t.ro_id ?? 0,
      ro_number: t.ro_number ?? 0,
      customer_name: customerName ?? "Unknown",
      days_stale: daysStale,
      ro_url:
        t.ro_id !== null ? buildTekmetricRoUrl({ roId: t.ro_id, shopId }) : "",
      category: t.status === "posted_ar" ? "ar" : "wip",
    });
  }

  const rosWithoutKeytags = await fetchRosWithoutKeytags(sb, shopId);

  return {
    tags,
    inUseCount,
    availableCount,
    staleCount: staleDetails.length,
    staleDetails,
    rosWithoutKeytags,
    generatedAt: new Date().toISOString(),
  };
}

// ─── The dashboard tool (reshape to KeytagDashboardResult) ───────────────────

/** Map a full keytag row to a lean grid tile (pure). */
export function toGridTile(t: KeytagRow): KeytagGridTile {
  return {
    tag_color: t.tag_color,
    tag_number: t.tag_number,
    in_use: t.status !== "available",
    status: t.status,
    ro_number: t.ro_number,
  };
}

export async function getKeytagDashboardTool(
  sb: SupabaseClient,
  shopId: number,
): Promise<KeytagDashboardResult> {
  const d = await buildKeytagDashboardData(sb, shopId);
  return {
    ok: true,
    generated_at: d.generatedAt,
    counts: {
      in_use: d.inUseCount,
      available: d.availableCount,
      stale: d.staleCount,
      total: d.tags.length,
    },
    stale: d.staleDetails,
    ros_without_tags: d.rosWithoutKeytags,
    grid: d.tags.map(toGridTile),
  };
}
