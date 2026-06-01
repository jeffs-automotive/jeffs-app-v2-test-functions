// keytag-daily-report
//
// Daily 7 AM Eastern Resend email summarizing the keytag pool state:
//   - Counts: in use / available / stale (>3 days posted_ar without release)
//   - Stale-tag table: tag id, customer name, RO#, days-stale, Tekmetric link
//   - Full 180-tag grid (R1..R90, Y1..Y90) — available green, in-use shaded red
//
// Triggered by pg_cron (jobname: keytag-daily-report) at 0 11 * * * UTC
// = 7 AM EDT. In winter (EST) this drops to 6 AM — acceptable for a
// morning ops digest.
//
// Auth: Pattern A bearer check (same as the scheduler functions).
//
// Email surface:
//   From: Jeff's Automotive Key Tags <alerts@jeffsautomotive.com>
//   To:   service@jeffsautomotive.com
//   Idempotency-Key: keytag-daily-report:YYYY-MM-DD (prevents Resend
//     double-sends if pg_cron retries within a 24h window)
//
// Env vars:
//   RESEND_API_KEY            — required
//   KEYTAG_REPORT_TO_EMAIL    — override To address (default service@)
//   KEYTAG_REPORT_FROM_EMAIL  — override From line (default alerts@)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricGetJson,
} from "../_shared/tekmetric-client.ts";
import {
  buildTekmetricRoUrl,
  ENV_NAMES,
} from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { withSentryScope } from "../_shared/sentry-edge.ts";
import { sendResendEmail } from "../_shared/resend-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);
const REPORT_TO_EMAIL =
  Deno.env.get("KEYTAG_REPORT_TO_EMAIL") ?? "service@jeffsautomotive.com";
const REPORT_FROM_EMAIL =
  Deno.env.get("KEYTAG_REPORT_FROM_EMAIL") ??
  "Jeff's Automotive Key Tags <alerts@jeffsautomotive.com>";

const STALE_DAYS = 3;

// Brand palette (matches scheduler-app + Jeff's Automotive identity)
const BRAND_PRIMARY = "#96003C"; // burgundy
const BRAND_ACCENT = "#D2B487"; // gold
const AVAILABLE_BG = "#1f4d2a";
const AVAILABLE_TEXT = "#a8e3b1";
const INUSE_BG = "#5a2528";
const INUSE_TEXT = "#f0a8a8";

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface KeytagRow {
  tag_color: "red" | "yellow";
  tag_number: number;
  status: "available" | "assigned" | "posted_ar" | string;
  ro_id: number | null;
  ro_number: number | null;
  customer_id: number | null;
  assigned_at: string | null;
  posted_at: string | null;
  last_activity_at: string | null;
}

interface StaleTagDetail {
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
 * AND `resolved_at IS NULL`. For each, we look up the most recent
 * `released` action in `keytag_audit_log` for the same RO to populate the
 * "previously had / released_at" columns — that's what differentiates
 * "manually released yesterday, no action needed" from "never had a tag,
 * needs investigation".
 *
 * Added 2026-05-23 to replace the per-issue Resend email path. The user
 * manually released ~100 A/R tags in a single day and got 100 individual
 * emails the next morning; consolidating into this section solves that.
 */
interface RoWithoutKeytagDetail {
  arn_code: string;
  ro_id: number | null;
  ro_number: number | null;
  ro_url: string;
  status_label: string; // 'A/R' | 'WIP' | etc. — sourced from the review's stored Tekmetric status_name
  /** Last keytag known to have been on this RO (per audit log), or null. */
  prior_tag_color: "red" | "yellow" | null;
  prior_tag_number: number | null;
  /** ISO timestamp of the most recent `released` action, or null when none found. */
  released_at: string | null;
  /** 'claude_desktop' | 'webhook' | 'reconcile' — informs the visual hint. */
  released_source: string | null;
  /** Days since the ARN was issued — used to highlight stale entries. */
  days_open: number;
}

interface TekmetricCustomerSubset {
  firstName?: string | null;
  lastName?: string | null;
  // Business customers store the company name in firstName + empty lastName,
  // and the human contact in contactFirstName + contactLastName. Carmax,
  // Nazareth Key, Flexicon all follow this pattern. Falling back to these
  // contact fields covers the rare case where firstName is also blank.
  contactFirstName?: string | null;
  contactLastName?: string | null;
}

interface TekmetricRepairOrderSubset {
  id: number;
  customer?: TekmetricCustomerSubset | null;
  customerId?: number | null;
}

/**
 * Coalesces a customer payload into a single display string. Priority:
 *   1. firstName + lastName  (covers people + businesses where the company
 *      name is in firstName, e.g. "Carmax", "Nazareth Key", "Flexicon")
 *   2. contactFirstName + contactLastName  (rare fallback for businesses
 *      where firstName is blank but a human contact is recorded)
 * Returns null if no usable name could be extracted.
 */
function customerDisplayName(c: TekmetricCustomerSubset): string | null {
  const first = (c.firstName ?? "").trim();
  const last = (c.lastName ?? "").trim();
  if (first || last) return `${first} ${last}`.trim();
  const cFirst = (c.contactFirstName ?? "").trim();
  const cLast = (c.contactLastName ?? "").trim();
  if (cFirst || cLast) return `${cFirst} ${cLast}`.trim();
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDays(daysOld: number): string {
  return daysOld === 1 ? "1 day" : `${daysOld} days`;
}

function tagLabel(c: "red" | "yellow", n: number): string {
  return `${c === "red" ? "R" : "Y"}${n}`;
}

function ymdEastern(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function todayLongEastern(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * Builds a Map<customerId, displayName> for every unique customer_id in the
 * stale list. Dedupes (Carmax often appears 7+ times in a single report run)
 * and serializes with a small inter-request delay so we stay well under
 * Tekmetric's 600/min rate limit. The previous per-row Promise.all approach
 * was sending 91+ simultaneous customer fetches and the 429 storm came back
 * as silent "Unknown" rows.
 */
async function buildCustomerNameMap(
  customerIds: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = Array.from(new Set(customerIds.filter((id) => id !== null)));
  // ~8/sec well under Tekmetric prod's 10/sec. Serialized for predictability.
  const DELAY_MS = 125;
  for (const id of unique) {
    try {
      const cust = await tekmetricGetJson<TekmetricCustomerSubset>(
        sb,
        `/customers/${id}`,
        { shop: SHOP_ID },
      );
      const name = cust ? customerDisplayName(cust) : null;
      if (name) map.set(id, name);
    } catch {
      // 4xx / 5xx / network — leave unmapped; caller renders "Unknown"
    }
    if (DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  return map;
}

/**
 * Fallback for rows where customer_id is null in our keytags table — pull
 * the inline customer off the RO endpoint. Called only for the rare null-
 * customer_id case; the common path uses buildCustomerNameMap.
 */
async function fetchNameViaRo(roId: number): Promise<string | null> {
  try {
    const ro = await tekmetricGetJson<TekmetricRepairOrderSubset>(
      sb,
      `/repair-orders/${roId}`,
      { shop: SHOP_ID },
    );
    return ro?.customer ? customerDisplayName(ro.customer) : null;
  } catch {
    return null;
  }
}

// ─── "Repair Orders Without Key Tags" data fetch ─────────────────────────────

/**
 * Pulls every unresolved ARN (`ar_no_prior_tag`) manual review and joins each
 * to the latest `released` action in `keytag_audit_log` (if any), so the
 * email can show the prior key tag + when it left the RO.
 *
 * Rationale: when an advisor manually releases a tag (action='released',
 * source='claude_desktop'), the released_at column + tag color/number give
 * the team an instant "this is the one I released yesterday, no action
 * needed" signal at triage time. True ARNs (RO went A/R having never
 * been tagged) have no released row — those are the ones the team should
 * actually investigate.
 *
 * Added 2026-05-23 alongside the per-issue email suppression in
 * `issueManualReview`.
 */
async function fetchRosWithoutKeytags(): Promise<RoWithoutKeytagDetail[]> {
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

    // Look up the most recent `released` action for this RO. Tag color/number
    // + occurred_at populate the "previously had" + "Released" columns.
    let priorColor: "red" | "yellow" | null = null;
    let priorNumber: number | null = null;
    let releasedAt: string | null = null;
    let releasedSource: string | null = null;

    // Guard against non-integer ro_id / ro_number coming from a malformed
    // review context (defensive — Tekmetric should always send integers).
    // Same pattern used by `keytag-bulk-reconcile`'s PostgREST .or() guard.
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

    // 2026-05-23 (refinement): SKIP rows whose most-recent release was
    // manual (source='claude_desktop'). The service advisor explicitly
    // released the tag — typically because the keys left the shop — and
    // doesn't need a daily reminder.
    //
    // Keep the row IF:
    //   - No release in audit log at all (true ARN: RO went A/R without
    //     ever being tagged in our system).
    //   - Most-recent release was by webhook or reconcile (auto-release
    //     paths — those CAN leave a stale tag-less A/R record worth
    //     investigating).
    //
    // The 90-day audit-log retention bounds the "forgotten manual
    // release" edge case: if the manual release happened > 90 days ago
    // and got pruned, this filter doesn't catch it and the row appears
    // in the email. Acceptable — the advisor has had > 90 days to
    // resolve it; surfacing it again is a useful reminder.
    if (releasedSource === "claude_desktop") {
      continue;
    }

    out.push({
      arn_code: r.code as string,
      ro_id: roId,
      ro_number: roNumber,
      ro_url:
        roId !== null
          ? buildTekmetricRoUrl({ roId, shopId: SHOP_ID })
          : "",
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

/**
 * Map Tekmetric status_name (as stored in the review context at issuance
 * time) to a compact label for the table. Falls back to the raw name when
 * we don't have a known shorthand. The 4 statuses ARN reviews are normally
 * issued for: POSTED (A/R) is most common; the others are defensive in
 * case the bulk-reconcile path ever broadens.
 */
function labelStatus(statusName: string): string {
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

function fmtReleasedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

// ─── Email HTML builder ──────────────────────────────────────────────────────

function buildReportHtml(args: {
  tags: KeytagRow[];
  inUseCount: number;
  availableCount: number;
  staleCount: number;
  staleDetails: StaleTagDetail[];
  rosWithoutKeytags: RoWithoutKeytagDetail[];
}): string {
  const {
    tags,
    inUseCount,
    availableCount,
    staleCount,
    staleDetails,
    rosWithoutKeytags,
  } = args;
  const today = todayLongEastern();

  const reds = tags
    .filter((t) => t.tag_color === "red")
    .sort((a, b) => a.tag_number - b.tag_number);
  const yellows = tags
    .filter((t) => t.tag_color === "yellow")
    .sort((a, b) => a.tag_number - b.tag_number);

  // 90 tags / 15 cols = 6 even rows per color. Cells are width:auto inside a
  // table-layout:fixed table so every row stays the same width and no cell
  // is clipped in narrower email-client viewports (the prior 18-col layout
  // overflowed and the rightmost tag of each row was cut off in Gmail web).
  const GRID_COLS = 15;

  function tagCell(t: KeytagRow): string {
    const used = t.status !== "available";
    const bg = used ? INUSE_BG : AVAILABLE_BG;
    const fg = used ? INUSE_TEXT : AVAILABLE_TEXT;
    return `<td style="background:${bg};color:${fg};padding:6px 2px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:12px;border:1px solid #222;border-radius:3px;font-weight:600;width:${Math.floor(100 / GRID_COLS)}%;">${tagLabel(t.tag_color, t.tag_number)}</td>`;
  }

  function buildGridRows(rowTags: KeytagRow[], cols = GRID_COLS): string {
    const rows: string[] = [];
    for (let i = 0; i < rowTags.length; i += cols) {
      const slice = rowTags.slice(i, i + cols);
      const cells = slice.map(tagCell).join("");
      rows.push(`<tr>${cells}</tr>`);
    }
    return rows.join("");
  }

  const redGrid = buildGridRows(reds);
  const yellowGrid = buildGridRows(yellows);

  const staleSection =
    staleCount === 0
      ? `<p style="margin:0;color:#888;font-style:italic;">No stale tags. 👍</p>`
      : `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Tag</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Status</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Customer</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">RO #</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Last activity</th>
            </tr>
          </thead>
          <tbody>
            ${staleDetails
              .map(
                (s) => `<tr>
                <td style="padding:8px;border-bottom:1px solid #333;font-family:monospace;color:${INUSE_TEXT};font-weight:600;">${tagLabel(s.tag_color, s.tag_number)}</td>
                <td style="padding:8px;border-bottom:1px solid #333;font-size:11px;color:#ddd;font-weight:600;">${s.category === "wip" ? `<span style="background:#3a3a52;color:#a8b0e3;padding:2px 8px;border-radius:3px;">WIP</span>` : `<span style="background:#52443a;color:#e3c8a8;padding:2px 8px;border-radius:3px;">A/R</span>`}</td>
                <td style="padding:8px;border-bottom:1px solid #333;color:#e0e0e0;">${escapeHtml(s.customer_name)}</td>
                <td style="padding:8px;border-bottom:1px solid #333;"><a href="${s.ro_url}" style="color:${BRAND_ACCENT};text-decoration:none;">RO ${s.ro_number}</a></td>
                <td style="padding:8px;border-bottom:1px solid #333;color:#bbb;">${fmtDays(s.days_stale)} ago</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  // "Repair Orders Without Key Tags" section. Added 2026-05-23 as the
  // consolidation surface for ARN (`ar_no_prior_tag`) reviews. Mirrors
  // the stale-tags pattern: always show the section header so the team
  // sees a positive "no issues" signal on quiet days; render a 👍 message
  // when the filtered list is empty.
  //
  // Rows are pre-filtered in fetchRosWithoutKeytags() to drop entries
  // whose most-recent release was a manual claude_desktop release (the
  // advisor explicitly handled those — no daily reminder needed). What
  // remains: ROs whose most-recent release was via webhook/reconcile
  // OR ROs that never had a release in the audit log (true ARN cases —
  // RO went A/R without ever being tagged in our system).
  const roNoTagSection =
    rosWithoutKeytags.length === 0
      ? `
    <h2 style="margin:32px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Repair Orders Without Key Tags</h2>
    <p style="margin:0 0 12px 0;color:#999;font-size:13px;">A/R repair orders with no key tag tracked in our system. Manually-released tags are filtered out automatically (you already know the keys are gone). The remaining list is repair orders that ended up in A/R via auto-release (webhook/reconcile) or that never had a tag.</p>
    <p style="margin:0;color:#888;font-style:italic;">No repair orders without key tags. 👍</p>`
      : `
    <h2 style="margin:32px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Repair Orders Without Key Tags</h2>
    <p style="margin:0 0 12px 0;color:#999;font-size:13px;">A/R repair orders with no key tag tracked in our system. Manually-released tags are filtered out automatically (you already know the keys are gone). Rows here are auto-released (webhook/reconcile) tags whose RO is still in A/R OR repair orders that never had a tag — those are worth investigating. Resolve any row in Claude Desktop with <code style="background:#1f1f1f;padding:1px 6px;border-radius:3px;font-family:'SF Mono',Menlo,monospace;color:${BRAND_ACCENT};">code ARN-XXXXXX option ...</code>.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">RO #</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Status</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Key Tag</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Released</th>
        </tr>
      </thead>
      <tbody>
        ${rosWithoutKeytags
          .map((r) => {
            const roCell =
              r.ro_url && r.ro_number !== null
                ? `<a href="${r.ro_url}" style="color:${BRAND_ACCENT};text-decoration:none;">RO ${r.ro_number}</a>`
                : r.ro_number !== null
                  ? `RO ${r.ro_number}`
                  : "—";
            const statusBadge =
              r.status_label === "A/R"
                ? `<span style="background:#52443a;color:#e3c8a8;padding:2px 8px;border-radius:3px;font-weight:600;">A/R</span>`
                : r.status_label === "WIP"
                  ? `<span style="background:#3a3a52;color:#a8b0e3;padding:2px 8px;border-radius:3px;font-weight:600;">WIP</span>`
                  : `<span style="color:#bbb;">${escapeHtml(r.status_label)}</span>`;
            const tagCellText =
              r.prior_tag_color && r.prior_tag_number !== null
                ? tagLabel(r.prior_tag_color, r.prior_tag_number)
                : "—";
            const tagCellHtml =
              tagCellText === "—"
                ? `<span style="color:#666;">—</span>`
                : `<span style="font-family:'SF Mono',Menlo,monospace;font-weight:600;color:${INUSE_TEXT};">${tagCellText}</span>`;
            const releasedCellHtml = r.released_at
              ? `<span style="color:#bbb;">${fmtReleasedAt(r.released_at)}</span>`
              : `<span style="color:#666;">—</span>`;
            return `<tr>
              <td style="padding:8px;border-bottom:1px solid #333;">${roCell}</td>
              <td style="padding:8px;border-bottom:1px solid #333;font-size:11px;">${statusBadge}</td>
              <td style="padding:8px;border-bottom:1px solid #333;">${tagCellHtml}</td>
              <td style="padding:8px;border-bottom:1px solid #333;">${releasedCellHtml}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Key Tag Daily Report — ${today}</title>
</head>
<body style="margin:0;padding:0;background:#1a1a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:820px;margin:0 auto;padding:24px;background:#262626;">

    <h1 style="margin:0;color:${BRAND_PRIMARY};font-size:24px;border-bottom:2px solid ${BRAND_ACCENT};padding-bottom:8px;">Key Tag Daily Report</h1>
    <p style="margin:8px 0 24px 0;color:#999;">${today}</p>

    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:24px;">
      <tr>
        <td style="background:#1f1f1f;padding:16px;border-radius:4px;border:1px solid #333;text-align:center;width:33%;">
          <div style="font-size:32px;font-weight:700;color:${BRAND_PRIMARY};">${inUseCount}</div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">In Use</div>
        </td>
        <td style="background:#1f1f1f;padding:16px;border-radius:4px;border:1px solid #333;text-align:center;width:33%;">
          <div style="font-size:32px;font-weight:700;color:${BRAND_PRIMARY};">${availableCount}</div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Available</div>
        </td>
        <td style="background:#1f1f1f;padding:16px;border-radius:4px;border:1px solid #333;text-align:center;width:33%;">
          <div style="font-size:32px;font-weight:700;color:${BRAND_PRIMARY};">${staleCount}</div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Stale (&gt;${STALE_DAYS} days)</div>
        </td>
      </tr>
    </table>

    <h2 style="margin:24px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Stale tags</h2>
    <p style="margin:0 0 12px 0;color:#999;font-size:13px;">In-use tags (WIP or A/R) whose Tekmetric repair order hasn't had any activity in more than ${STALE_DAYS} days. WIP rows mean a car has been sitting in the shop without progress; A/R rows mean a car has been waiting on payment for too long. Investigate whether the customer picked up, or whether the RO needs to be advanced.</p>
    ${staleSection}
    ${roNoTagSection}

    <h2 style="margin:32px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Red tags (R1–R90)</h2>
    <table role="presentation" style="border-collapse:separate;border-spacing:3px;width:100%;table-layout:fixed;">${redGrid}</table>

    <h2 style="margin:24px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Yellow tags (Y1–Y90)</h2>
    <table role="presentation" style="border-collapse:separate;border-spacing:3px;width:100%;table-layout:fixed;">${yellowGrid}</table>

    <p style="margin:16px 0 0 0;font-size:12px;color:#777;">
      <span style="background:${AVAILABLE_BG};color:${AVAILABLE_TEXT};padding:3px 10px;border-radius:3px;font-family:monospace;font-weight:600;">available</span>
      &nbsp;
      <span style="background:${INUSE_BG};color:${INUSE_TEXT};padding:3px 10px;border-radius:3px;font-family:monospace;font-weight:600;">in use</span>
    </p>

    <h2 style="margin:32px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Legend</h2>
    <p style="margin:0;font-size:13px;color:#aaa;line-height:1.5;">
      A tag is released automatically when the RO is posted-paid (status 5) or when an A/R balance is paid. If a tag has been stale for many days, the customer may have already picked up — use the Claude skill to release it manually.
    </p>

    <p style="margin:32px 0 0 0;font-size:11px;color:#666;border-top:1px solid #333;padding-top:12px;">
      Generated automatically by keytag-daily-report. Schedule: 7:00 AM Eastern, daily.
    </p>
  </div>
</body>
</html>`;
}

// ─── Resend send ─────────────────────────────────────────────────────────────

async function sendViaResend(args: {
  subject: string;
  html: string;
  idempotencyKey: string | null;
}): Promise<{
  ok: boolean;
  resend_id?: string;
  error?: string;
  status: number;
  deduped?: boolean;
}> {
  // HTTP transport extracted to _shared/resend-client.ts (file-size-refactor
  // batch 1). Behavior preserved: optional idempotency key, 409 = deduped
  // success, resend id parsed from the 2xx body.
  const r = await sendResendEmail({
    from: REPORT_FROM_EMAIL,
    to: REPORT_TO_EMAIL,
    subject: args.subject,
    html: args.html,
    idempotencyKey: args.idempotencyKey ?? undefined,
  });
  return {
    ok: r.ok,
    status: r.status,
    resend_id: r.id,
    error: r.error,
    deduped: r.deduped,
  };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve((req) => withSentryScope(req, "keytag-daily-report", async () => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }
  const auth = checkSchedulerBearer(req, "keytag-daily-report");
  if (!auth.ok) {
    await logEdgeError(sb, {
      surface: "keytag-daily-report/auth",
      origin_id: "keytag-daily-report",
      level: "warning",
      error_code: `auth_${auth.reason ?? "unknown"}`,
      message: auth.reason ?? null,
      context: auth.diagnostic ? { diagnostic: auth.diagnostic } : null,
    });
    return unauthorizedResponse(auth);
  }

  // `?force=true` bypasses Resend's idempotency-key dedup. Used for
  // ad-hoc smoke tests when we've already sent today's email but want
  // to verify a layout / content change. Daily cron NEVER passes this.
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // Pull all keytags
  const { data: rows, error } = await sb
    .from("keytags")
    .select(
      "tag_color, tag_number, status, ro_id, ro_number, customer_id, assigned_at, posted_at, last_activity_at",
    )
    .order("tag_color")
    .order("tag_number");

  if (error) {
    return jsonResponse(
      { ok: false, error: `keytags query: ${error.message}` },
      500,
    );
  }

  const tags = (rows ?? []) as KeytagRow[];

  // Counts
  const inUseCount = tags.filter(
    (t) => t.status === "assigned" || t.status === "posted_ar",
  ).length;
  const availableCount = tags.filter((t) => t.status === "available").length;

  // Stale = any in-use tag (WIP or A/R) whose Tekmetric-side last activity is
  // older than STALE_DAYS. The reconcile cron refreshes last_activity_at from
  // Tekmetric.updatedDate (for WIP) or .postedDate (for A/R) every night, so
  // a stuck-in-shop car shows up here within 4 days of nothing happening.
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60_000);
  const staleRaw = tags.filter(
    (t) =>
      (t.status === "assigned" || t.status === "posted_ar") &&
      t.last_activity_at !== null &&
      new Date(t.last_activity_at) < cutoff,
  );

  // Sort stale tags: oldest first (highest priority to investigate)
  staleRaw.sort((a, b) => {
    const aTime = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const bTime = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return aTime - bTime;
  });

  // Resolve customer names: dedupe customer_ids and fetch serially so we
  // don't blow past Tekmetric's 600/min rate limit. The previous approach
  // (Promise.all over all stale rows) was triggering 429s that silently
  // dropped rows to "Unknown" — particularly for repeat-business customers
  // like Carmax that show up 7+ times in a single report.
  const uniqueCustomerIds = staleRaw
    .map((t) => t.customer_id)
    .filter((id): id is number => id !== null);
  const nameMap = await buildCustomerNameMap(uniqueCustomerIds);

  const staleDetails: StaleTagDetail[] = [];
  for (const t of staleRaw) {
    let customerName: string | null = null;
    if (t.customer_id !== null) {
      customerName = nameMap.get(t.customer_id) ?? null;
    }
    // Fallback for rows with null customer_id OR customer-endpoint miss
    if (!customerName && t.ro_id !== null) {
      customerName = await fetchNameViaRo(t.ro_id);
    }
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
        t.ro_id !== null
          ? buildTekmetricRoUrl({ roId: t.ro_id, shopId: SHOP_ID })
          : "",
      category: t.status === "posted_ar" ? "ar" : "wip",
    });
  }

  // 2026-05-23: pull unresolved ARN reviews + their last-release audit
  // rows to populate the "Repair Orders Without Key Tags" section.
  // Failures are non-fatal — the rest of the report still ships.
  const rosWithoutKeytags = await fetchRosWithoutKeytags();

  const html = buildReportHtml({
    tags,
    inUseCount,
    availableCount,
    staleCount: staleRaw.length,
    staleDetails,
    rosWithoutKeytags,
  });
  const noTagCount = rosWithoutKeytags.length;
  const subject =
    noTagCount > 0
      ? `Key Tags: ${inUseCount} in use, ${availableCount} available, ${staleRaw.length} stale, ${noTagCount} A/R without tag`
      : `Key Tags: ${inUseCount} in use, ${availableCount} available, ${staleRaw.length} stale`;
  const idempotencyKey = force ? null : `keytag-daily-report:${ymdEastern()}`;

  const send = await sendViaResend({ subject, html, idempotencyKey });
  if (!send.ok) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "keytag_daily_report_send_failed",
        status: send.status,
        detail: send.error,
      }),
    );
    return jsonResponse(
      {
        ok: false,
        error: `resend_send_failed: ${send.error}`,
        status: send.status,
      },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    in_use: inUseCount,
    available: availableCount,
    stale: staleRaw.length,
    ar_without_tag: noTagCount,
    resend_id: send.resend_id ?? null,
    idempotency_key: idempotencyKey,
    forced: force,
    deduped: send.deduped ?? false,
  });
}));
