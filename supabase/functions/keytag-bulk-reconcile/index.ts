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
import { TEKMETRIC_RO_STATUS } from "../_shared/tekmetric.ts";
import { checkSchedulerBearer, unauthorizedResponse } from "../_shared/scheduler-auth.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { issueManualReview } from "../_shared/manual-review.ts";
import { backfillCustomerNames } from "../_shared/keytag-customer-name.ts";
import { SHOP_ID, PATCH_DELAY_MS, sb } from "./config.ts";
import { type ReconcileResult, type OrphanReleaseDetail, type ReconcileSummary } from "./types.ts";
import { fetchAllByStatus, sleep } from "./tekmetric-fetchers.ts";
import { getExistingTagsByRoId, getAllInUseTags, getPoolCounts } from "./db-helpers.ts";
import { reconcileOne } from "./reconcile.ts";
import { reverseReconcileOne } from "./reverse-reconcile.ts";

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

    // ── CUSTOMER-NAME BACKFILL / SELF-HEAL ───────────────────────────────
    // Fill keytags.customer_name for any in-use tag still missing it (the
    // existing backlog on first run, plus any assign-time miss thereafter:
    // a failed Tekmetric fetch, or the manual-review assign sites that don't
    // carry a customerId). Best-effort, dedup'd + paced, never fails the run,
    // skipped on dry_run.
    if (!dryRun) {
      const bf = await backfillCustomerNames(sb, SHOP_ID, { delayMs: PATCH_DELAY_MS });
      if (bf.filled > 0) {
        console.log(
          JSON.stringify({
            level: "info",
            msg: "keytag_customer_names_backfilled",
            scanned: bf.scanned,
            filled: bf.filled,
          }),
        );
      }
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

    // If any per-RO reconciliation recorded a failed DB write, this run is
    // degraded. The Sentry cron check-in is fire-and-forget (the SQL wrapper
    // fires status=ok regardless of our HTTP response — migration 20260523022303),
    // so a non-2xx alone is invisible to the cron monitor; the captureMessage
    // below is the ONLY surface that fires for a degraded run. The 207 is a
    // harmless HTTP signal for future direct callers.
    if (summary.actions.error > 0) {
      const erroredRos = results
        .filter((r) => r.action === "error")
        .map((r) => ({ ro_id: r.ro_id, ro_number: r.ro_number, error: r.error }));
      try {
        Sentry.withScope((scope) => {
          scope.setTag("shop_id", String(SHOP_ID));
          scope.setTag("event", "reconcile_per_ro_errors");
          scope.setContext("reconcile", {
            error_count: summary.actions.error,
            total_results: results.length,
            dry_run: dryRun,
            errored_ros: erroredRos.slice(0, 50),
          });
          Sentry.captureMessage(
            `keytag-bulk-reconcile completed with ${summary.actions.error} per-RO error(s)`,
            "error",
          );
        });
      } catch {
        console.warn(JSON.stringify({ level: "warning", msg: "reconcile_degraded_sentry_capture_failed" }));
      }
      return new Response(JSON.stringify(summary), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Top-level failure: the inner catch swallows the throw, so withSentryScope
    // never sees it — capture explicitly (obs-hardening 2026-06-01).
    Sentry.captureException(e, {
      tags: { shop_id: String(SHOP_ID), surface: "keytag-bulk-reconcile" },
    });
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
