// keytag-bulk-reconcile
//
// Reconciles our keytags table against Tekmetric's current WIP + A/R repair
// orders. Designed for two callers:
//
//   1. Ad-hoc bulk backfill — run once after this function ships to assign
//      tags to every backlog WIP + A/R RO that doesn't already have one
//      and write correct `last_activity_at` + `posted_at` so the morning
//      report's staleness math is honest.
//
//   2. Nightly pg_cron — runs before the morning report so any webhook the
//      live handler missed gets caught, and all dates are refreshed to the
//      latest Tekmetric values. This is the safety net for Tekmetric's
//      occasionally-unreliable webhook delivery (see investigation
//      2026-05-11 — RO 152354 transitioned to WIP with NO webhook).
//
// FORWARD pass (per Tekmetric RO in WIP+A/R lists):
//   - Tag missing → assign_next_keytag (with last_activity_at from updatedDate),
//                   if A/R also mark_keytag_posted with real postedDate.
//                   PATCH Tekmetric keyTag to "R<n>" / "Y<n>".
//   - Tag present → refresh last_activity_at (touch_keytag_activity) so
//                   staleness math uses current Tekmetric updatedDate.
//                   If A/R and our row is still 'assigned', flip to
//                   'posted_ar' with the real postedDate.
//                   If our row is 'posted_ar' but Tekmetric shows WIP,
//                   revert (A/R un-posted regression).
//                   If overwrite=true OR Tekmetric.keytag doesn't match
//                   our DB, re-PATCH Tekmetric.
//
// REVERSE pass (per in-use tag in our DB not seen in WIP+A/R lists):
//   - GET that RO's current state from Tekmetric:
//       statusId=1 (Estimate)    → keep tag, touch activity. Unapprove
//                                  regression. Keys still in shop.
//       statusId=2 (WIP)         → unexpected (forward pass should've
//                                  caught) — just refresh.
//       statusId=3 (Completed)   → keep tag, touch activity. Work done,
//                                  awaiting post.
//       statusId=5 (POSTED_PAID) → release as orphan + add to email digest.
//       statusId=6 (A/R)         → unexpected — call mark_posted defensively.
//       404 / missing            → release as orphan + add to email digest.
//
// At end of run: if any orphans were released, send an email to
// service@jeffsautomotive.com listing them so the service team can verify
// (and fix manually via Claude Desktop if the release was a mistake).
//
// Auth: Pattern A bearer check (same as keytag-daily-report).
//
// Query params:
//   overwrite=true    Re-PATCH Tekmetric even when its keytag field already
//                     matches our DB. Used for the one-shot migration from
//                     legacy manual tags to R/Y color-coded.
//   dry_run=true      Don't write anything. Returns the action plan only.
//   skip_email=true   Don't send the orphan-release email even if orphans
//                     are detected. Used for ad-hoc testing.
//
// Returns JSON summary of actions taken, suitable for logging in
// orchestrator-mcp tools or pg_cron audit.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricFetch,
  tekmetricGetJson,
  TekmetricPage,
  TekmetricRepairOrder,
} from "../_shared/tekmetric-client.ts";
import {
  TEKMETRIC_API_BASE,
  TEKMETRIC_RO_STATUS,
  ENV_NAMES,
} from "../_shared/tekmetric.ts";
import {
  formatKeytag,
  parseKeytag,
  TagColor,
} from "../_shared/keytag-format.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import {
  issueManualReview,
  type ManualReviewOption,
} from "../_shared/manual-review.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

// Pagination: Tekmetric's max size per page is 100.
const PAGE_SIZE = 100;

// Throttle PATCHes so we stay well under the 600 req/min Tekmetric prod limit.
// Average reconcile ≈ 150 ROs; at 10/sec we finish in ~15s.
const PATCH_DELAY_MS = 100;

// ── Types ───────────────────────────────────────────────────────────────────

// The shared TekmetricRepairOrder interface doesn't include updatedDate, so
// extend it here. (Field is present in the API response; just not declared
// upstream because no other caller needed it yet.)
interface RepairOrderWithUpdated extends TekmetricRepairOrder {
  updatedDate?: string | null;
}

interface ReconcileResult {
  ro_id: number;
  ro_number: number;
  tekmetric_status_id: number;
  tekmetric_status_name: string;
  action:
    | "assigned_new"           // forward pass — RO seen in WIP/AR, no tag yet
    | "marked_posted"          // forward pass — flipped assigned → posted_ar
    | "reverted"               // forward OR reverse pass — flipped posted_ar → assigned
    | "touched"                // forward OR reverse pass — refreshed last_activity_at only
    | "repatched"              // forward pass — re-PATCHed Tekmetric to match DB
    | "released_orphan"        // reverse pass — RO is gone or paid; tag released (LEGACY)
    | "manual_review_issued"   // ORP / ARN / DRF / REG / PAF — review code generated, email sent
    | "noop"
    | "error";
  tag_color?: TagColor;
  tag_number?: number;
  tag_string?: string;
  patch_ok?: boolean;
  patch_error?: string;
  detail?: string;
  error?: string;
  /** When a manual review code was issued for this RO during this reconcile. */
  manual_review_code?: string;
  /** True when the result came from the reverse pass (DB-driven, GETs the RO individually). */
  reverse_pass?: boolean;
}

// ── Manual-review option presets (per-category) ─────────────────────────────

function orphanOptions(roNumber: number, priorTag: string): ManualReviewOption[] {
  return [
    {
      key: "release",
      label: `Release ${priorTag}`,
      description: `Mark ${priorTag} available and return it to the round-robin pool. Pick this if the keys are confirmed gone (RO canceled, paid, or replaced and the customer has the keys).`,
    },
    {
      key: "keep_tag",
      label: `Keep ${priorTag} held`,
      description: `Leave ${priorTag} on RO #${roNumber} in our records. Pick this if the keys are still in the shop — for instance, the RO was renumbered and the new RO has the same physical tag, or someone is still working on it.`,
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Don't change anything. Send the situation to Chris for review. Pick this if you're unsure.",
    },
  ];
}

function arnOptions(roNumber: number): ManualReviewOption[] {
  return [
    {
      key: "track_tag",
      label: `Record a tag on the keys for RO #${roNumber}`,
      description: "Tell us which color + number is physically on the keys. We'll add it to our system (we won't write to Tekmetric — A/R repair orders are locked there).",
      needs_tag_input: true,
    },
    {
      key: "no_tag",
      label: "No tag is on these keys",
      description: "The keys don't have a physical tag on them (left without one, picked up by a vendor, etc.). We'll leave this RO alone in our system.",
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris — pick this if you don't know.",
    },
  ];
}

function driftOptions(roNumber: number, priorTag: string): ManualReviewOption[] {
  return [
    {
      key: "use_prior_tag",
      label: `Re-confirm ${priorTag} is on the keys`,
      description: `The same physical tag (${priorTag}) is still on the keys. We'll re-attach it in our system AND write it to Tekmetric so everyone sees it.`,
    },
    {
      key: "use_different_tag",
      label: "A different tag is on the keys",
      description: "Tell us the color + number that's physically on the keys for this RO. We'll record it.",
      needs_tag_input: true,
    },
    {
      key: "assign_new",
      label: "Assign a fresh tag (round-robin)",
      description: "The keys don't have a tag yet but need one. We'll pick the next available tag, write it to Tekmetric, and you can put it on the keys.",
    },
    {
      key: "no_tag",
      label: "Don't tag this RO",
      description: `The keys aren't in the shop or RO #${roNumber} doesn't need a tag right now.`,
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris — pick this if you're unsure.",
    },
  ];
}

function patchFailOptions(): ManualReviewOption[] {
  return [
    {
      key: "retry_patch",
      label: "Retry writing to Tekmetric",
      description: "Try the same write again. Pick this if you suspect the failure was a temporary Tekmetric outage.",
    },
    {
      key: "release_and_redo",
      label: "Release the tag and start over",
      description: "Release the tag in our system, then assign a fresh one (will retry the Tekmetric write). Use this if the Tekmetric record is too out-of-sync to recover cleanly.",
    },
    {
      key: "accept_unsynced",
      label: "Keep the tag in our system without Tekmetric",
      description: "Leave our records as-is. The Tekmetric Key Tag field stays blank. Advisors will see our system's data but not Tekmetric's.",
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris.",
    },
  ];
}

interface OrphanReleaseDetail {
  ro_id: number;
  ro_number: number;
  tag_color: TagColor;
  tag_number: number;
  prior_status: "assigned" | "posted_ar";
  reason: string;
  tekmetric_status_at_release: string;
}

interface ReconcileSummary {
  started_at: string;
  completed_at: string;
  duration_ms: number;
  shop_id: number;
  dry_run: boolean;
  overwrite: boolean;
  tekmetric_wip_count: number;
  tekmetric_ar_count: number;
  reverse_pass_count: number;
  actions: {
    assigned_new: number;
    marked_posted: number;
    reverted: number;
    touched: number;
    repatched: number;
    released_orphan: number;
    manual_review_issued: number;
    noop: number;
    error: number;
  };
  pool: { in_use: number; available: number };
  /** 6-char codes issued during this run (ORP / DRF / REG / ARN / PAF). */
  manual_review_codes: string[];
  /** LEGACY: pre-manual-review orphan-email path. Now always empty; kept for backwards compatibility. */
  orphan_email: {
    attempted: boolean;
    sent: boolean;
    error?: string;
    orphans: OrphanReleaseDetail[];
  };
  results: ReconcileResult[];
}

// ── Supabase client (service role) ──────────────────────────────────────────

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Tekmetric fetchers ──────────────────────────────────────────────────────

/**
 * Fetches a single RO from Tekmetric. Returns null if Tekmetric returns 404
 * (RO deleted) — caller treats that as an orphan-release trigger.
 */
async function fetchRoOrNull(
  roId: number,
): Promise<RepairOrderWithUpdated | null> {
  const res = await tekmetricFetch(sb, `/repair-orders/${roId}`, {
    method: "GET",
    query: { shop: SHOP_ID },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Tekmetric GET /repair-orders/${roId} → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as RepairOrderWithUpdated;
}

async function fetchAllByStatus(
  statusId: number,
): Promise<RepairOrderWithUpdated[]> {
  const out: RepairOrderWithUpdated[] = [];
  let page = 0;
  while (true) {
    const json = await tekmetricGetJson<TekmetricPage<RepairOrderWithUpdated>>(
      sb,
      "/repair-orders",
      {
        shop: SHOP_ID,
        repairOrderStatusId: statusId,
        size: PAGE_SIZE,
        page,
        sort: "updatedDate,desc",
      },
    );
    out.push(...json.content);
    if (json.last || json.content.length < PAGE_SIZE) break;
    page += 1;
  }
  return out;
}

async function patchKeytagToTekmetric(
  roId: number,
  keyTagString: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await tekmetricFetch(sb, `/repair-orders/${roId}`, {
      method: "PATCH",
      query: { shop: SHOP_ID },
      body: { keyTag: keyTagString },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── DB helpers ──────────────────────────────────────────────────────────────

interface ExistingTag {
  tag_color: TagColor;
  tag_number: number;
  status: "assigned" | "posted_ar" | "available";
}

async function getExistingTagsByRoId(
  roIds: number[],
): Promise<Map<number, ExistingTag>> {
  const map = new Map<number, ExistingTag>();
  if (roIds.length === 0) return map;
  const { data, error } = await sb
    .from("keytags")
    .select("ro_id, tag_color, tag_number, status")
    .in("ro_id", roIds);
  if (error) {
    throw new Error(`Bulk keytags lookup failed: ${error.message}`);
  }
  for (const row of data ?? []) {
    map.set(row.ro_id as number, {
      tag_color: row.tag_color as TagColor,
      tag_number: row.tag_number as number,
      status: row.status as "assigned" | "posted_ar" | "available",
    });
  }
  return map;
}

interface InUseTagRow {
  ro_id: number;
  ro_number: number | null;
  tag_color: TagColor;
  tag_number: number;
  status: "assigned" | "posted_ar";
}

/**
 * Returns every keytag row currently held (status = assigned OR posted_ar).
 * Used by the reverse pass to detect tags whose RO is no longer in the
 * WIP/AR forward-list (and therefore needs an individual GET to determine
 * its current Tekmetric state).
 */
async function getAllInUseTags(): Promise<InUseTagRow[]> {
  const { data, error } = await sb
    .from("keytags")
    .select("ro_id, ro_number, tag_color, tag_number, status")
    .in("status", ["assigned", "posted_ar"]);
  if (error) {
    throw new Error(`In-use tags query failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ro_id: r.ro_id as number,
    ro_number: (r.ro_number as number | null) ?? null,
    tag_color: r.tag_color as TagColor,
    tag_number: r.tag_number as number,
    status: r.status as "assigned" | "posted_ar",
  }));
}

async function getPoolCounts(): Promise<{ in_use: number; available: number }> {
  const { data, error } = await sb
    .from("keytags")
    .select("status");
  if (error) {
    throw new Error(`Pool count query failed: ${error.message}`);
  }
  let inUse = 0;
  let available = 0;
  for (const r of data ?? []) {
    if (r.status === "available") available += 1;
    else inUse += 1;
  }
  return { in_use: inUse, available };
}

// ── Per-RO reconciliation ───────────────────────────────────────────────────

async function reconcileOne(
  ro: RepairOrderWithUpdated,
  existing: ExistingTag | undefined,
  overwrite: boolean,
  dryRun: boolean,
): Promise<ReconcileResult> {
  const statusId = ro.repairOrderStatus.id;
  const statusName = ro.repairOrderStatus.name;
  const updatedDate = ro.updatedDate ?? null;
  const postedDate = ro.postedDate ?? null;

  const isAR = statusId === TEKMETRIC_RO_STATUS.POSTED_AR;
  const isWIP = statusId === TEKMETRIC_RO_STATUS.WIP;

  // For staleness math: WIP uses updatedDate; A/R uses postedDate (when set)
  // and falls back to updatedDate.
  const lastActivityAt = isAR
    ? (postedDate ?? updatedDate)
    : updatedDate;

  const base: ReconcileResult = {
    ro_id: ro.id,
    ro_number: ro.repairOrderNumber,
    tekmetric_status_id: statusId,
    tekmetric_status_name: statusName,
    action: "noop",
  };

  try {
    // ── Branch A: RO has no tag in our DB → assign + (mark_posted if A/R) + PATCH ──
    if (!existing) {
      // ── A/R WITHOUT PRIOR TAG (ARN manual review) ──
      // Tekmetric platform constraint: A/R repair orders refuse PATCH
      // ("Repair Order must be active to update data"). Per Chris's
      // 2026-05-11 directive, we DON'T just skip these — the keys may
      // physically have a tag on them. Issue an ARN manual review so the
      // service team can record what's on the keys (system-only, no
      // Tekmetric PATCH).
      if (isAR) {
        // Dedup is now enforced inside issueManualReview() per Chris's
        // 2026-05-13 directive — any prior review for this ro_id (any
        // category, resolved or pending) short-circuits with created=false.
        // The prior local ARN-only dedup was a subset of that and removed
        // with this commit.
        if (!dryRun) {
          // 2026-05-23 (refinement): skip ARN issuance entirely when the
          // most-recent `released` action in keytag_audit_log was a
          // manual release by a service advisor (source='claude_desktop').
          // The advisor explicitly released the tag — typically because
          // the keys left the shop while the RO sat in A/R — and doesn't
          // need a daily reminder.
          //
          // Defensive guard: same Number.isSafeInteger pattern as the
          // PostgREST .or() injection fix in Plan 03 Phase 3A. Skip the
          // lookup on malformed ro_id / ro_number and let the ARN issue
          // (fail-open on the manual-release check is safer than
          // accidentally skipping a real warning).
          const roIdSafeForRelLookup =
            Number.isInteger(ro.id) && Number.isSafeInteger(ro.id);
          const roNumberSafeForRelLookup =
            Number.isInteger(ro.repairOrderNumber) &&
            Number.isSafeInteger(ro.repairOrderNumber);

          if (roIdSafeForRelLookup || roNumberSafeForRelLookup) {
            const orClauses: string[] = [];
            if (roIdSafeForRelLookup) orClauses.push(`ro_id.eq.${ro.id}`);
            if (roNumberSafeForRelLookup) {
              orClauses.push(`ro_number.eq.${ro.repairOrderNumber}`);
            }
            const { data: relRows, error: relErr } = await sb
              .from("keytag_audit_log")
              .select("source, occurred_at")
              .or(orClauses.join(","))
              .eq("action", "released")
              .order("occurred_at", { ascending: false })
              .limit(1);

            if (relErr) {
              // Log + continue (fail open — better to issue a possibly-
              // unnecessary ARN than silently swallow a real anomaly).
              await logEdgeError(sb, {
                surface: "keytag-bulk-reconcile/manual_release_lookup",
                origin_id: "keytag-bulk-reconcile",
                level: "warning",
                error_code: "audit_lookup_failed",
                message: relErr.message,
                context: { ro_id: ro.id, ro_number: ro.repairOrderNumber },
              });
            } else if (
              relRows &&
              relRows.length > 0 &&
              (relRows[0] as { source: string | null }).source ===
                "claude_desktop"
            ) {
              return {
                ...base,
                action: "noop",
                detail: "skipped: prior manual release in audit log",
              };
            }
          }

          // 2026-05-23: sendEmail:false — ARN reviews are consolidated
          // into the 7 AM keytag-daily-report's "Repair Orders Without
          // Key Tags" section. The review row + audit log entry are still
          // written; only the per-issue Resend email is suppressed.
          //
          // Why: after the user manually released ~100 A/R keytags in a
          // single day, the per-issue email path produced 100 individual
          // emails the next morning. The daily-digest surface gives one
          // table with RO# / status / prior tag / released-when context,
          // which is what the service team actually needs at triage time.
          const issued = await issueManualReview({
            sb,
            category: "ar_no_prior_tag",
            context: {
              ro_id: ro.id,
              ro_number: ro.repairOrderNumber,
              tekmetric_status_name: statusName,
            },
            options: arnOptions(ro.repairOrderNumber),
            issueSummary: `A/R RO #${ro.repairOrderNumber} has no key tag tracked in our system. The keys may or may not have a physical tag.`,
            auditSource: "cron",
            sendEmail: false,
          });
          if (!issued.created) {
            return {
              ...base,
              action: "noop",
              detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ARN issued`,
            };
          }
          return {
            ...base,
            action: "manual_review_issued",
            detail: `ARN ${issued.code} (A/R no prior tag — email suppressed, included in daily-report)`,
            manual_review_code: issued.code,
          };
        }
        return {
          ...base,
          action: "noop",
          detail: "(dry run) would issue ARN manual review",
        };
      }

      // ── DRIFT-PREVENTION GATE (manual review variant) ──
      // If THIS RO has prior keytag history, we don't silently auto-assign.
      // Issue a DRF or REG manual review so the service team can record what
      // tag is on the physical keys.
      //
      // PLAN-03 Phase 3A (I-SEC-5) — PostgREST .or() takes a raw string
      // interpolation. ro.id + ro.repairOrderNumber come from a Tekmetric
      // API listing; if Tekmetric ever ships malformed types we'd inject
      // garbage into the PostgREST parser. Guard with Number.isSafeInteger
      // before interpolation; skip lookup (= "no prior history found")
      // when invalid. See keytag-tekmetric-webhook for the canonical pattern.
      const roIdSafe = Number.isInteger(ro.id) && Number.isSafeInteger(ro.id);
      const roNumberSafe =
        Number.isInteger(ro.repairOrderNumber) &&
        Number.isSafeInteger(ro.repairOrderNumber);
      if (!roIdSafe || !roNumberSafe) {
        Sentry.withScope((scope) => {
          scope.setTag("event", "invalid_ro_id_or_number");
          scope.setContext("invalid_ids", {
            ro_id_type: typeof ro.id,
            ro_id_safe: roIdSafe,
            ro_number_type: typeof ro.repairOrderNumber,
            ro_number_safe: roNumberSafe,
          });
          Sentry.captureMessage(
            "Tekmetric WIP listing has invalid ro_id or ro_number type",
            "warning",
          );
        });
        return {
          ...base,
          action: "noop",
          detail: "skipped: invalid ro_id or ro_number type in Tekmetric response",
        };
      }
      const { data: priorHistoryRows } = await sb
        .from("keytag_audit_log")
        .select("id, action, occurred_at, tag_color, tag_number, reason")
        .or(`ro_id.eq.${ro.id},ro_number.eq.${ro.repairOrderNumber}`)
        .neq("action", "manual_review_issued") // skip prior review-issuance rows
        .order("occurred_at", { ascending: false })
        .limit(3);
      const priorHistory = priorHistoryRows?.[0];
      if (priorHistory) {
        // De-dup: don't issue if an unresolved DRF/REG already exists for this RO
        const { data: existingReview } = await sb
          .from("keytag_manual_reviews")
          .select("code")
          .in("category", ["work_approved_drift", "ar_regression"])
          .is("resolved_at", null)
          .filter("context->>ro_id", "eq", String(ro.id))
          .limit(1)
          .maybeSingle();
        if (existingReview) {
          return {
            ...base,
            action: "noop",
            detail: `existing manual review ${existingReview.code} pending for this RO`,
          };
        }

        // Distinguish REG vs DRF: REG = the prior history shows the RO was in
        // A/R recently (marked_posted somewhere in last few entries) AND
        // last action was released.
        const wasInAR = priorHistoryRows!.some(
          (h) =>
            h.action === "marked_posted" ||
            (h.action === "released" && /ar_balance|posted_ar|ar_paid|payment_made/i.test(h.reason ?? "")),
        );
        const category =
          priorHistory.action === "released" && wasInAR
            ? "ar_regression"
            : "work_approved_drift";

        if (!dryRun) {
          const priorTag = priorHistory.tag_color && priorHistory.tag_number
            ? `${priorHistory.tag_color === "red" ? "Red" : "Yellow"} ${priorHistory.tag_number}`
            : "the previous tag";
          const issued = await issueManualReview({
            sb,
            category,
            context: {
              ro_id: ro.id,
              ro_number: ro.repairOrderNumber,
              tag_color: priorHistory.tag_color,
              tag_number: priorHistory.tag_number,
              prior_action: priorHistory.action,
              prior_action_at: priorHistory.occurred_at,
            },
            options: driftOptions(ro.repairOrderNumber, priorTag),
            issueSummary:
              category === "ar_regression"
                ? `RO #${ro.repairOrderNumber} came back from A/R into WIP, but ${priorTag} was already released earlier.`
                : `RO #${ro.repairOrderNumber} is in WIP but has prior key-tag history (last: ${priorHistory.action}).`,
            auditSource: "cron",
          });
          if (!issued.created) {
            return {
              ...base,
              action: "noop",
              detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ${category === "ar_regression" ? "REG" : "DRF"} issued`,
            };
          }
          return {
            ...base,
            action: "manual_review_issued",
            detail: `${category === "ar_regression" ? "REG" : "DRF"} ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
            manual_review_code: issued.code,
          };
        }
        return {
          ...base,
          action: "noop",
          detail: `(dry run) would issue ${category} manual review`,
        };
      }

      if (dryRun) {
        return { ...base, action: "assigned_new", detail: "(dry run)" };
      }
      const { data: assignRows, error: assignErr } = await sb.rpc(
        "assign_next_keytag",
        {
          p_ro_id: ro.id,
          p_ro_number: ro.repairOrderNumber,
          p_customer_id: ro.customerId,
          p_vehicle_id: ro.vehicleId,
          p_advisor_id: ro.serviceWriterId,
          p_technician_id: ro.technicianId,
          p_last_activity_at: lastActivityAt,
        },
      );
      if (assignErr) {
        return { ...base, action: "error", error: `assign_rpc: ${assignErr.message}` };
      }
      const assigned = Array.isArray(assignRows) ? assignRows[0] : assignRows;
      if (!assigned?.tag_color) {
        return { ...base, action: "error", error: "pool_exhausted" };
      }
      const color = assigned.tag_color as TagColor;
      const number = assigned.tag_number as number;
      const wire = formatKeytag(color, number);

      // For A/R, also mark posted with the real postedDate
      if (isAR) {
        const { error: postErr } = await sb.rpc("mark_keytag_posted", {
          p_ro_id: ro.id,
          p_posted_at: postedDate,
          p_last_activity_at: lastActivityAt,
        });
        if (postErr) {
          // Roll back — DB ended up inconsistent
          await sb.rpc("release_keytag_for_ro", {
            p_ro_id: ro.id,
            p_reason: "rollback_mark_posted_failed",
          });
          return {
            ...base,
            action: "error",
            error: `mark_posted_after_assign: ${postErr.message}`,
          };
        }
      }

      const patch = await patchKeytagToTekmetric(ro.id, wire);
      // Record the PATCH result on the keytag row for audit + future cleanup.
      // (Webhook handler already does this; reconcile must too for parity.)
      await sb.rpc("record_keytag_patched", {
        p_ro_id: ro.id,
        p_success: patch.ok,
        p_error: patch.error ?? null,
      });

      // Tekmetric PATCH failed → issue PAF manual review (keep DB assignment).
      if (!patch.ok) {
        const priorTag = `${color === "red" ? "Red" : "Yellow"} ${number}`;
        const issued = await issueManualReview({
          sb,
          category: "tekmetric_patch_fail",
          context: {
            ro_id: ro.id,
            ro_number: ro.repairOrderNumber,
            tag_color: color,
            tag_number: number,
            patch_error: patch.error,
          },
          options: patchFailOptions(),
          issueSummary: `Nightly reconcile assigned ${priorTag} to RO #${ro.repairOrderNumber} but Tekmetric refused our write to its Key Tag field.`,
          auditSource: "cron",
        });
        if (!issued.created) {
          return {
            ...base,
            action: "noop",
            tag_color: color,
            tag_number: number,
            tag_string: wire,
            patch_ok: false,
            patch_error: patch.error,
            detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new PAF issued`,
          };
        }
        return {
          ...base,
          action: "manual_review_issued",
          tag_color: color,
          tag_number: number,
          tag_string: wire,
          patch_ok: false,
          patch_error: patch.error,
          manual_review_code: issued.code,
          detail: `PAF ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
        };
      }

      // Audit-log entry for successful reconcile assignment
      await sb.rpc("log_keytag_audit", {
        p_tag_color: color,
        p_tag_number: number,
        p_action: "assigned",
        p_source: "reconcile",
        p_ro_id: ro.id,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "available",
        p_new_status: isAR ? "posted_ar" : "assigned",
        p_user_label: null,
        p_reason: isAR
          ? "reconcile:wip_or_ar_no_tag_first_time_ar"
          : "reconcile:wip_no_tag_first_time",
        p_tekmetric_patch_ok: patch.ok,
        p_tekmetric_patch_error: patch.error ?? null,
      });

      return {
        ...base,
        action: "assigned_new",
        tag_color: color,
        tag_number: number,
        tag_string: wire,
        patch_ok: patch.ok,
        patch_error: patch.error,
        detail: isAR ? "assigned+marked_posted" : "assigned",
      };
    }

    // ── Branch B: RO has tag, refresh last_activity_at + maybe flip ──
    const wire = formatKeytag(existing.tag_color, existing.tag_number);

    // Forward-pass regression: tag is posted_ar but Tekmetric shows WIP
    // → un-posted from A/R back to WIP. Revert the tag.
    const needsRevertToAssigned =
      isWIP && existing.status === "posted_ar";
    // Forward-pass forward-direction: tag is assigned but Tekmetric shows
    // A/R → webhook for "Sent to A/R" was missed.
    const needsFlipToPosted = isAR && existing.status === "assigned";

    let flippedAction: "marked_posted" | "reverted" | null = null;

    if (!dryRun && needsRevertToAssigned) {
      const { error: revertErr } = await sb.rpc(
        "revert_keytag_to_assigned",
        {
          p_ro_id: ro.id,
          p_last_activity_at: lastActivityAt,
        },
      );
      if (revertErr) {
        return {
          ...base,
          action: "error",
          error: `revert_to_assigned: ${revertErr.message}`,
          tag_color: existing.tag_color,
          tag_number: existing.tag_number,
          tag_string: wire,
        };
      }
      // Audit-log entry for forward-pass revert
      await sb.rpc("log_keytag_audit", {
        p_tag_color: existing.tag_color,
        p_tag_number: existing.tag_number,
        p_action: "reverted",
        p_source: "reconcile",
        p_ro_id: ro.id,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "posted_ar",
        p_new_status: "assigned",
        p_user_label: null,
        p_reason: "reconcile:forward_pass_ar_unposted_back_to_wip",
      });
      flippedAction = "reverted";
    } else if (!dryRun && needsFlipToPosted) {
      const { error: postErr } = await sb.rpc("mark_keytag_posted", {
        p_ro_id: ro.id,
        p_posted_at: postedDate,
        p_last_activity_at: lastActivityAt,
      });
      if (postErr) {
        return {
          ...base,
          action: "error",
          error: `mark_posted_flip: ${postErr.message}`,
          tag_color: existing.tag_color,
          tag_number: existing.tag_number,
          tag_string: wire,
        };
      }
      // Audit-log entry for forward-pass flip-to-posted
      await sb.rpc("log_keytag_audit", {
        p_tag_color: existing.tag_color,
        p_tag_number: existing.tag_number,
        p_action: "marked_posted",
        p_source: "reconcile",
        p_ro_id: ro.id,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "assigned",
        p_new_status: "posted_ar",
        p_user_label: null,
        p_reason: "reconcile:forward_pass_assigned_seen_as_ar_in_tekmetric",
      });
      flippedAction = "marked_posted";
    } else if (!dryRun && lastActivityAt) {
      // Just refresh the activity clock
      await sb.rpc("touch_keytag_activity", {
        p_ro_id: ro.id,
        p_last_activity_at: lastActivityAt,
      });
    }

    // Determine whether Tekmetric's keyTag field matches our DB
    const tekParsed = parseKeytag(ro.keytag);
    const tekMatches =
      tekParsed !== null &&
      tekParsed.color === existing.tag_color &&
      tekParsed.number === existing.tag_number &&
      !tekParsed.legacy; // legacy = bare-number format; needs rewrite

    const shouldPatch = overwrite || !tekMatches;
    let patch: { ok: boolean; error?: string } | null = null;
    if (!dryRun && shouldPatch) {
      patch = await patchKeytagToTekmetric(ro.id, wire);
    }

    let action: ReconcileResult["action"];
    let detail: string;
    if (flippedAction === "reverted") {
      action = "reverted";
      detail = shouldPatch
        ? "reverted_posted_ar_to_assigned+re_patched"
        : "reverted_posted_ar_to_assigned";
    } else if (flippedAction === "marked_posted") {
      action = "marked_posted";
      detail = shouldPatch
        ? "flipped_to_posted_ar+re_patched"
        : "flipped_to_posted_ar";
    } else if (shouldPatch) {
      action = "repatched";
      detail = overwrite
        ? "overwrite_tekmetric_keytag"
        : "tekmetric_keytag_mismatch";
    } else {
      action = "touched";
      detail = "last_activity_at_refreshed";
    }

    return {
      ...base,
      action,
      tag_color: existing.tag_color,
      tag_number: existing.tag_number,
      tag_string: wire,
      patch_ok: patch?.ok,
      patch_error: patch?.error,
      detail,
    };
  } catch (e) {
    return {
      ...base,
      action: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Reverse pass — for tags in our DB whose RO didn't appear in WIP/AR ──────

async function reverseReconcileOne(
  tag: InUseTagRow,
  dryRun: boolean,
  orphans: OrphanReleaseDetail[],
): Promise<ReconcileResult> {
  const base: Omit<ReconcileResult, "action"> = {
    ro_id: tag.ro_id,
    ro_number: tag.ro_number ?? 0,
    tekmetric_status_id: 0,
    tekmetric_status_name: "(not yet fetched)",
    tag_color: tag.tag_color,
    tag_number: tag.tag_number,
    tag_string: formatKeytag(tag.tag_color, tag.tag_number),
    reverse_pass: true,
  };

  try {
    let ro: RepairOrderWithUpdated | null;
    try {
      ro = await fetchRoOrNull(tag.ro_id);
    } catch (e) {
      return {
        ...base,
        action: "error",
        error: `reverse_get_ro: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 404 — RO deleted in Tekmetric → ORP manual review (don't auto-release)
    if (ro === null) {
      if (dryRun) {
        return {
          ...base,
          action: "manual_review_issued",
          tekmetric_status_id: 0,
          tekmetric_status_name: "(deleted)",
          detail: "(dry run) would issue ORP manual review (RO 404)",
        };
      }
      // Dedup is now in issueManualReview (any prior review for this ro_id,
      // any category, resolved or pending, short-circuits).
      const priorTag = `${tag.tag_color === "red" ? "Red" : "Yellow"} ${tag.tag_number}`;
      const issued = await issueManualReview({
        sb,
        category: "orphan_release",
        context: {
          ro_id: tag.ro_id,
          ro_number: tag.ro_number,
          tag_color: tag.tag_color,
          tag_number: tag.tag_number,
          tekmetric_status_at_release: "(deleted)",
          reason: "ro_404_tekmetric_deleted",
          prior_status: tag.status,
        },
        options: orphanOptions(tag.ro_number ?? 0, priorTag),
        issueSummary: `${priorTag} is on RO #${tag.ro_number} in our records, but Tekmetric says the RO doesn't exist anymore.`,
        auditSource: "cron",
      });
      if (!issued.created) {
        return {
          ...base,
          action: "noop",
          tekmetric_status_id: 0,
          tekmetric_status_name: "(deleted)",
          detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ORP issued`,
        };
      }
      return {
        ...base,
        action: "manual_review_issued",
        tekmetric_status_id: 0,
        tekmetric_status_name: "(deleted)",
        detail: `ORP ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
        manual_review_code: issued.code,
      };
    }

    base.tekmetric_status_id = ro.repairOrderStatus.id;
    base.tekmetric_status_name = ro.repairOrderStatus.name;

    const statusId = ro.repairOrderStatus.id;
    const statusName = ro.repairOrderStatus.name;
    const updatedDate = ro.updatedDate ?? null;
    const postedDate = ro.postedDate ?? null;

    // Status 5 = POSTED_PAID → ORP manual review (don't auto-release; ask the team)
    if (statusId === TEKMETRIC_RO_STATUS.POSTED_PAID) {
      if (dryRun) {
        return {
          ...base,
          action: "manual_review_issued",
          detail: "(dry run) would issue ORP manual review (posted_paid)",
        };
      }
      // Dedup lives in issueManualReview (universal by ro_id).
      const priorTag = `${tag.tag_color === "red" ? "Red" : "Yellow"} ${tag.tag_number}`;
      const issued = await issueManualReview({
        sb,
        category: "orphan_release",
        context: {
          ro_id: tag.ro_id,
          ro_number: tag.ro_number,
          tag_color: tag.tag_color,
          tag_number: tag.tag_number,
          tekmetric_status_at_release: statusName,
          reason: "posted_paid_missed_release_webhook",
          prior_status: tag.status,
        },
        options: orphanOptions(tag.ro_number ?? 0, priorTag),
        issueSummary: `${priorTag} is on RO #${tag.ro_number} in our records, but Tekmetric shows the RO as posted & paid (the payment notification never reached us).`,
        auditSource: "cron",
      });
      if (!issued.created) {
        return {
          ...base,
          action: "noop",
          detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ORP issued`,
        };
      }
      return {
        ...base,
        action: "manual_review_issued",
        detail: `ORP ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
        manual_review_code: issued.code,
      };
    }

    // Estimate / Completed / WIP / A/R fallback paths: keep tag, but
    // reconcile status + activity timestamp.
    if (statusId === TEKMETRIC_RO_STATUS.WIP) {
      // Tag is held but RO is WIP — should've been caught by forward pass.
      // Either the WIP list was cut off (>100 in a single page would be
      // unusual) or there's a race. Touch activity.
      if (!dryRun && updatedDate) {
        if (tag.status === "posted_ar") {
          await sb.rpc("revert_keytag_to_assigned", {
            p_ro_id: tag.ro_id,
            p_last_activity_at: updatedDate,
          });
          await sb.rpc("log_keytag_audit", {
            p_tag_color: tag.tag_color,
            p_tag_number: tag.tag_number,
            p_action: "reverted",
            p_source: "reconcile",
            p_ro_id: tag.ro_id,
            p_ro_number: tag.ro_number,
            p_prior_status: "posted_ar",
            p_new_status: "assigned",
            p_user_label: null,
            p_reason: "reconcile:reverse_pass_ar_unposted_back_to_wip",
          });
          return {
            ...base,
            action: "reverted",
            detail: "reverse_pass_revert_to_assigned (RO is WIP)",
          };
        }
        await sb.rpc("touch_keytag_activity", {
          p_ro_id: tag.ro_id,
          p_last_activity_at: updatedDate,
        });
      }
      return {
        ...base,
        action: "touched",
        detail: "reverse_pass_wip_refresh",
      };
    }

    if (statusId === TEKMETRIC_RO_STATUS.POSTED_AR) {
      // Tag held, RO is A/R. Forward pass should've caught — refresh anyway.
      if (!dryRun) {
        if (tag.status === "assigned") {
          await sb.rpc("mark_keytag_posted", {
            p_ro_id: tag.ro_id,
            p_posted_at: postedDate,
            p_last_activity_at: postedDate ?? updatedDate,
          });
          await sb.rpc("log_keytag_audit", {
            p_tag_color: tag.tag_color,
            p_tag_number: tag.tag_number,
            p_action: "marked_posted",
            p_source: "reconcile",
            p_ro_id: tag.ro_id,
            p_ro_number: tag.ro_number,
            p_prior_status: "assigned",
            p_new_status: "posted_ar",
            p_user_label: null,
            p_reason: "reconcile:reverse_pass_assigned_seen_as_ar",
          });
          return {
            ...base,
            action: "marked_posted",
            detail: "reverse_pass_flip_to_posted_ar (RO is A/R)",
          };
        }
        if (postedDate ?? updatedDate) {
          await sb.rpc("touch_keytag_activity", {
            p_ro_id: tag.ro_id,
            p_last_activity_at: postedDate ?? updatedDate,
          });
        }
      }
      return {
        ...base,
        action: "touched",
        detail: "reverse_pass_ar_refresh",
      };
    }

    // Status 1 (Estimate) or 3 (Completed): keep tag — keys still in shop
    // or work done awaiting post. Just refresh activity from updatedDate.
    if (!dryRun && updatedDate) {
      await sb.rpc("touch_keytag_activity", {
        p_ro_id: tag.ro_id,
        p_last_activity_at: updatedDate,
      });
    }
    return {
      ...base,
      action: "touched",
      detail: `reverse_pass_${statusName.toLowerCase().replace(/\s+/g, "_")}_keep_tag`,
    };
  } catch (e) {
    return {
      ...base,
      action: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve((req: Request) => withSentryScope(req, "keytag-bulk-reconcile", async () => {
  // Bearer auth (matches keytag-daily-report, transcript-dispatcher, etc.)
  const authCheck = checkSchedulerBearer(req, "keytag-bulk-reconcile");
  if (!authCheck.ok) {
    await logEdgeError(sb, {
      surface: "keytag-bulk-reconcile/auth",
      origin_id: "keytag-bulk-reconcile",
      level: "warning",
      error_code: `auth_${authCheck.reason ?? "unknown"}`,
      message: authCheck.reason ?? null,
      context: authCheck.diagnostic
        ? { diagnostic: authCheck.diagnostic }
        : null,
    });
    return unauthorizedResponse(authCheck);
  }

  const startedAt = new Date();
  const url = new URL(req.url);
  const overwrite = url.searchParams.get("overwrite") === "true";
  const dryRun = url.searchParams.get("dry_run") === "true";
  const skipEmail = url.searchParams.get("skip_email") === "true";

  try {
    // ── FORWARD PASS ──────────────────────────────────────────────────────
    // 1) Pull WIP + A/R lists from Tekmetric (paginated)
    const [wipList, arList] = await Promise.all([
      fetchAllByStatus(TEKMETRIC_RO_STATUS.WIP),
      fetchAllByStatus(TEKMETRIC_RO_STATUS.POSTED_AR),
    ]);

    const allRos = [...wipList, ...arList];
    const forwardRoIdSet = new Set(allRos.map((r) => r.id));

    // 2) Look up existing keytags for all of them in one shot
    const existingMap = await getExistingTagsByRoId(allRos.map((r) => r.id));

    // 3) Reconcile each RO serially (with a tiny PATCH delay to stay under rate
    //    limits and avoid hammering Tekmetric)
    const results: ReconcileResult[] = [];
    for (const ro of allRos) {
      const result = await reconcileOne(
        ro,
        existingMap.get(ro.id),
        overwrite,
        dryRun,
      );
      results.push(result);
      // Only sleep when we actually issued a PATCH (assigned_new or repatched
      // with non-undefined patch_ok). Throttles real network calls; passes
      // through near-instantaneous touch-only iterations.
      const didPatch =
        !dryRun &&
        result.patch_ok !== undefined; // both true and false count as a real PATCH attempt
      if (didPatch) {
        await sleep(PATCH_DELAY_MS);
      }
    }

    // ── REVERSE PASS ──────────────────────────────────────────────────────
    // 4) Pull every in-use tag from our DB; for any whose RO didn't appear
    //    in the forward lists, GET that RO individually to determine state
    //    and act. Typical: a handful of tags whose RO was posted-paid (and
    //    we missed the payment webhook), or rare deletions.
    const inUseTags = await getAllInUseTags();
    const reverseTargets = inUseTags.filter(
      (t) => !forwardRoIdSet.has(t.ro_id),
    );
    const orphans: OrphanReleaseDetail[] = [];
    for (const tag of reverseTargets) {
      const result = await reverseReconcileOne(tag, dryRun, orphans);
      results.push(result);
      // Pace the GETs the same way we pace PATCHes — Tekmetric prod is
      // 600 req/min, our delay keeps us safely under.
      await sleep(PATCH_DELAY_MS);
    }

    // ── LEGACY ORPHAN EMAIL ──────────────────────────────────────────────
    // Orphan auto-release was replaced 2026-05-11 by the manual-review code
    // flow (ORP). Per-orphan emails are now sent by issueManualReview at
    // detection time. Block kept for backwards compatibility — orphans
    // array is always empty going forward.
    const orphanEmail: ReconcileSummary["orphan_email"] = {
      attempted: false,
      sent: false,
      orphans,
    };

    // 5) Compute summary
    const actions = {
      assigned_new: 0,
      marked_posted: 0,
      reverted: 0,
      touched: 0,
      repatched: 0,
      released_orphan: 0,
      manual_review_issued: 0,
      noop: 0,
      error: 0,
    };
    const manualReviewCodes: string[] = [];
    for (const r of results) {
      actions[r.action] = (actions[r.action] ?? 0) + 1;
      if (r.manual_review_code) manualReviewCodes.push(r.manual_review_code);
    }

    const pool = await getPoolCounts();
    const completedAt = new Date();
    const summary: ReconcileSummary = {
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      shop_id: SHOP_ID,
      dry_run: dryRun,
      overwrite,
      tekmetric_wip_count: wipList.length,
      tekmetric_ar_count: arList.length,
      reverse_pass_count: reverseTargets.length,
      actions,
      pool,
      manual_review_codes: manualReviewCodes,
      orphan_email: orphanEmail,
      results,
    };

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("keytag-bulk-reconcile failed:", msg);
    return new Response(
      JSON.stringify({
        ok: false,
        error: msg,
        started_at: startedAt.toISOString(),
        failed_at: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}));
