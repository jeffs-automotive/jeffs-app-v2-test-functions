// keytag-dashboard-data.ts
//
// COPY for the @jeffs/keytag-core read package (Phase 0 build-seam spike,
// 2026-06-26). Verbatim copy of `supabase/functions/_shared/keytag-dashboard-data.ts`
// EXCEPT the SupabaseClient import is the bare specifier `@supabase/supabase-js`
// (resolved by Node/Next directly and by Deno via this package's deno.json
// import map) instead of the Deno-style `npm:@supabase/supabase-js@2`. The
// import is `import type` → erased at runtime; only typecheck/bundle resolve it.
//
// SINGLE SOURCE OF TRUTH for the keytag "pool snapshot" used by BOTH:
//   - the 7 AM `keytag-daily-report` email (renders this data to HTML), and
//   - the admin-app `/keytags` Dashboard tab.
//
// Customer names come straight from the denormalized `keytags.customer_name`
// column — a PURE DB read, NO per-customer Tekmetric walk.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTekmetricRoUrl } from "./tekmetric.ts";

/**
 * Days-since-last-activity threshold beyond which a held tag is "stale".
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

export interface TekmetricCustomerSubset {
  firstName?: string | null;
  lastName?: string | null;
  // Business customers store the company name in firstName + empty lastName,
  // and the human contact in contactFirstName + contactLastName.
  contactFirstName?: string | null;
  contactLastName?: string | null;
}

export interface TekmetricRepairOrderSubset {
  id: number;
  customer?: TekmetricCustomerSubset | null;
  customerId?: number | null;
}

/** The full pool snapshot consumed by the email + the dashboard tool. */
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

// ─── Customer display-name helper ────────────────────────────────────────────

/**
 * Coalesces a Tekmetric customer payload into a single display string.
 */
export function customerDisplayName(c: TekmetricCustomerSubset): string | null {
  const first = (c.firstName ?? "").trim();
  const last = (c.lastName ?? "").trim();
  if (first || last) return `${first} ${last}`.trim();
  const cFirst = (c.contactFirstName ?? "").trim();
  const cLast = (c.contactLastName ?? "").trim();
  if (cFirst || cLast) return `${cFirst} ${cLast}`.trim();
  return null;
}

// ─── "Repair Orders Without Key Tags" data fetch ─────────────────────────────

/**
 * Map Tekmetric status_name to a compact label for the table.
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
 * to the latest `released` action in `keytag_audit_log` (if any).
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
    // operator surfaces count: 'claude_desktop' and 'admin_app'.
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
 * stale tags, and the unresolved-ARN "repair orders without key tags" rows.
 *
 * @throws if the `keytags` query fails (the snapshot can't be built without
 *   the pool). ARN/customer lookups fail soft (logged, empty/"Unknown").
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

  // Stale = any in-use tag (WIP or A/R) whose last activity is older than
  // STALE_DAYS. The reconcile cron refreshes last_activity_at nightly.
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60_000);
  const staleRaw = tags.filter(
    (t) =>
      (t.status === "assigned" || t.status === "posted_ar") &&
      t.last_activity_at !== null &&
      new Date(t.last_activity_at) < cutoff,
  );

  // Oldest first (highest priority to investigate)
  staleRaw.sort((a, b) => {
    const aTime = a.last_activity_at
      ? new Date(a.last_activity_at).getTime()
      : 0;
    const bTime = b.last_activity_at
      ? new Date(b.last_activity_at).getTime()
      : 0;
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
