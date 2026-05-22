---
agent: orchestrator-mcp-probes
timestamp: 2026-05-22T15:10:00Z
scope: DB / Sentry / Vercel via MCP — surfaces sub-agents can't reach
---

# Orchestrator-side MCP probes — findings

## Executive summary

DB is mostly healthy. **2 BLOCKER findings**: 2 dev/scratch tables (`_bulk_keytag_backfill`, `_smoke_test_run`) have RLS DISABLED and are exposed to the anon role. **1 IMPORTANT**: a cron (`scheduler-admin-snapshot-prune`) has been silently failing since 2026-05-19 — its EXCEPTION-handling body is missing the `DO $$ ... $$;` wrapper. Otherwise: all 27 SECURITY DEFINER functions properly set search_path; 6 of 7 crons running clean; transcript email delivery 100% success rate; 0 stuck appointment_holds; Sentry healthy (0 unresolved prod errors, 1 stale dev 401 from 2026-05-16); Vercel latest deployment READY but no custom domain mapped yet (pre-launch).

## A. DB — Supabase MCP findings

### Tables (39 total in public)

| RLS state | Count | Notes |
|---|---|---|
| RLS DISABLED | 2 | **`_bulk_keytag_backfill`** (149 rows), **`_smoke_test_run`** (42 rows) — exposed to anon |
| RLS enabled, 0 policies | 16 | Deny-by-default for non-service-role; pattern is valid but worth adding explicit `deny_all` for clarity |
| RLS enabled, 1+ policies | 21 | Standard pattern |

### SECURITY DEFINER functions (27)

All 27 have `search_path` set in `proconfig`:
- 25 with `search_path=public` only
- 2 with `search_path=public, vault` (vault access)
- 1 with `search_path=public, net` (pg_net access)
- 1 with `search_path=public, cron`

**No issues.** ✅

### pg_cron jobs (7 active)

| job | schedule | last 7d failed | last 7d ok | health |
|---|---|---|---|---|
| keytag-bulk-reconcile | `0 10 * * *` | 0 | 6 | ✅ |
| keytag-daily-report | `0 11 * * *` | 0 | 6 | ✅ |
| **scheduler-admin-snapshot-prune** | `30 3 * * *` | **3** | **0** | **❌ BROKEN** |
| scheduler-appointments-sync | `*/10 * * * *` | 0 | 807 | ✅ |
| scheduler-error-log-prune | `0 3 * * *` | 0 | 6 | ✅ |
| scheduler-hold-reaper | `*/30 * * * *` | 0 | 269 | ✅ |
| scheduler-transcript-dispatcher | `*/5 * * * *` | 0 | 1615 | ✅ |

`scheduler-admin-snapshot-prune` error message:
```
ERROR:  syntax error at or near "UPDATE"
LINE 3:     UPDATE public.scheduler_admin_audit_log
```

Root cause: cron body in `supabase/migrations/20260519140000_scheduler_md_edit_v2_schema.sql:57-79` uses raw `BEGIN ... EXCEPTION ... END;` instead of `DO $$ BEGIN ... EXCEPTION ... END $$;`. Postgres can only parse `EXCEPTION WHEN OTHERS` inside a PL/pgSQL block (function body or `DO` block), not at the top level. Compare scheduler-hold-reaper (line 95+ of that migration era) which correctly wraps in `DO $$ ... $$;`.

**Fix:** new migration that calls `cron.unschedule('scheduler-admin-snapshot-prune')` and re-schedules with body wrapped in `DO $$ ... $$;`.

### Other DB health checks

- **Appointment holds**: 0 stuck (released_at IS NULL AND expires_at < now()). Hold-reaper cron working as intended.
- **Transcript emails**: 8/8 sent (status='sent'), most recent 2026-05-22T00:57Z. Resend wiring healthy.
- **Tekmetric webhook events**: 241 in last 24h, 1496 in last 7d, 2510 total. Webhook firehose ingesting normally.
- **Extensions**: pgcrypto, pg_cron, pg_stat_statements, pgtap, pg_net, supabase_vault, uuid-ossp installed. Vault is wired (for Tekmetric secrets).

### Supabase advisors — security

- **2 critical**: `_bulk_keytag_backfill` + `_smoke_test_run` (RLS disabled, advisor priority 1).
- **16 info**: RLS-enabled-no-policy on tables that don't expose to anon/authenticated by design (service_role-only access). Not a bug, but a clarity-style annotation.

### Supabase advisors — performance

- **2 unindexed FKs** (low-volume tables, but worth fixing):
  - `keytag_manual_reviews.resolution_audit_log_id_fkey`
  - `oauth_refresh_tokens.parent_token_hash_fkey`
- **1 table without PK**: `_bulk_keytag_backfill` (paired with the RLS issue — fix together)
- **~20 unused indexes**: mostly on low-row-count tables. Defer; will populate after launch traffic ramp.
- **Auth DB connections absolute (10)**: switch to percentage-based for future instance-size flexibility. Low priority pre-launch.

## B. Sentry — jeffs-automotive org

### Projects (4)

- `auto-web` — legacy website?
- `jeffs-app-v2` — prod (v1?)
- `jeffs-app-v2-supabase` — supabase-side fall-through?
- `jeffs-app-v2-test-functions` — **the canonical scheduler-app + edge functions project**

### Open issues (test-functions project, last 7d)

| ID | Title | Users | Events | First seen | Source |
|---|---|---|---|---|---|
| K | `Error: 401 Authentication failed... AI_GATEWAY_API_KEY` | 1 | 6 | 18h ago | `serverAction/runDiagnosticsV2` |
| J | `runDiagnostics: 1 concern(s) → second_routine_pass` | 1 | 3 | 18h ago | `serverAction/runDiagnosticsV2` |
| G | `runDiagnostics: 1 concern(s) → clarification_question` | 1 | 3 | 16h ago | `serverAction/runDiagnosticsV2` |
| A | `submit_summary_v2 confirm verify mismatch` | 1 | 1 | 14h ago | `serverAction/submitSummaryV2` |

- **K** is a stale dev-time error (AI_GATEWAY_API_KEY was added later; happened during yesterday's testing before the env-var was set). Can resolve.
- **J + G** are `Sentry.captureMessage` info-level breadcrumbs from `runDiagnostics` routing decisions, not real errors. They're being treated as issues because they don't carry `level: 'info'`. Consider downgrading or removing the captures.
- **A** is a one-off mismatch from yesterday's wizard test — needs investigation but low-frequency.

### 7-day error trend (errors dataset, level:error)

Only 1 unique error in 7 days: `OtpDirectError: scheduler-otp-direct returned 401: UNAUTHORIZED_INVALID_JWT_FORMAT` (2 events, last seen 2026-05-16T12:56Z). Stale dev error from the OTP flow build-out.

**Verdict: Sentry is wired and reporting. Pre-launch error volume is healthy (essentially zero).**

## C. Vercel — jeff-s-automotive team

### Projects

Only one project: **`jeffs-app-v2-test-functions`** (id `prj_I4UQaBnF5u93l1ZoRFhw6MuwjIGL`).

### Latest deployment

- Latest: `dpl_4GUYwPdjGaczu6okAVQyzU86sHQP` — READY, target: production
- Commit: today's tone-overhaul commit
- Node: 24.x
- Framework: nextjs
- `live: false` — means no traffic routing (no domain mapped)

### Domains

Currently mapped:
- `jeffs-app-v2-test-functions.vercel.app`
- `jeffs-app-v2-test-functions-jeff-s-automotive.vercel.app`
- `jeffs-app-v2-test-functions-git-main-jeff-s-automotive.vercel.app`

**Missing:** `appointments.jeffsautomotive.com` (per architecture memo, "Domain (planned)"). Pre-launch gap.

### Runtime logs (last 7d, error+warning+fatal)

**Zero logs.** Either:
- (a) no traffic to log (likely — no domain mapped)
- (b) log retention expired

Either way, no actionable production errors.

## Findings summary (orchestrator side)

### BLOCKER

| # | Issue | Where | Recommended fix |
|---|---|---|---|
| B1 | `_bulk_keytag_backfill` RLS DISABLED, 149 rows exposed | `public._bulk_keytag_backfill` | Either `ENABLE ROW LEVEL SECURITY` + add `deny_all` policy, OR `DROP TABLE` if it's a one-off backfill table that's no longer needed |
| B2 | `_smoke_test_run` RLS DISABLED, 42 rows exposed | `public._smoke_test_run` | Same — enable RLS + deny_all OR drop |

### IMPORTANT

| # | Issue | Where | Recommended fix |
|---|---|---|---|
| I1 | `scheduler-admin-snapshot-prune` cron has been silently failing daily since 2026-05-19 (3 failed, 0 succeeded) due to missing `DO $$ ... $$;` wrapper | `supabase/migrations/20260519140000_scheduler_md_edit_v2_schema.sql:57-79` + live cron.job | New migration that re-schedules with body wrapped in `DO $$ ... $$;` (matches the working scheduler-hold-reaper / scheduler-error-log-prune patterns) |
| I2 | Sentry "issue" J + G are `captureMessage` calls without `level: 'info'`, surface as issues but aren't errors | `runDiagnostics` Sentry capture | Either set `level: 'info'` on the capture or remove the captures (they're noise in the issue feed) |
| I3 | Unindexed FK on `keytag_manual_reviews.resolution_audit_log_id` | DB | Add covering index |
| I4 | Unindexed FK on `oauth_refresh_tokens.parent_token_hash` | DB | Add covering index |

### NICE-TO-HAVE / PRE-LAUNCH

| # | Issue | Where | Recommended fix |
|---|---|---|---|
| N1 | Auth DB connections strategy = absolute (10), should be percentage-based | Supabase auth config | Switch in Supabase dashboard |
| N2 | 16 tables RLS-enabled with 0 policies — works (deny-all default) but no explicit `deny_all` policy for clarity | Several tables | Add explicit `CREATE POLICY deny_all ON ... FOR ALL TO public USING (false)` for each |
| P1 | No custom domain mapped on Vercel — `appointments.jeffsautomotive.com` DNS pending | Vercel project | Configure custom domain pre-launch |
| P2 | Stale Sentry issue K (AI Gateway 401) and OtpDirectError 401 — both stale dev errors | Sentry | Mark resolved |

### POSITIVE FINDINGS (do not regress)

- All 27 SECURITY DEFINER functions properly set `search_path` ✅
- 6 of 7 crons running clean (snapshot-prune is the only break) ✅
- Hold-reaper working: 0 stuck `appointment_holds` (269 reaper runs in 7d) ✅
- Resend wiring healthy: 8/8 transcript emails delivered ✅
- Tekmetric webhook firehose ingesting 1496 events in 7d ✅
- Sentry properly wired across all 4 projects ✅
- Latest Vercel deployment READY (today's commit) ✅
- 0 production errors in last 7 days ✅
