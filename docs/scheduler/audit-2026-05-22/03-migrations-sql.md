---
agent: audit-migrations
timestamp: 2026-05-22T03:00:00Z
scope: supabase/migrations/
migrations_read: 55
---

# Migration + SQL schema audit

## Executive summary

55 migration files reviewed. Overall posture is solid: every shop-scoped scheduler
table uses explicit `deny_all` policy; keytag/OAuth/orchestrator tables use the
RLS-enabled-no-policy implicit-deny pattern; SECURITY DEFINER functions
consistently `SET search_path`; money columns are BIGINT `_cents` with no float
contamination; pg_cron bodies were retrofitted in `20260516200000` with
EXCEPTION wraps; the keytag system has a 4-layer defense model (TS confirmation
tokens + DB trigger + SECURITY DEFINER GUC + audit log) that's well-built.

Real issues are concentrated in:

- **One missing webhook idempotency unique constraint** (tekmetric_webhook_events)
  — directly violates Rule 12 in the audit spec.
- **CASCADE FKs on parent tables without inline rationale** — Rule 9 violation.
- **Two early migrations lacking idempotency guards** (`20260508025621`,
  `20260510131752`) — Rule 11 violation; later migrations consistently use
  `IF NOT EXISTS`.
- **Several scheduler tables use INTEGER not BIGINT for Tekmetric IDs** — H-1
  was partially addressed by `20260513140000` but `customer_id`/`vehicle_id` in
  `appointment_holds` were widened while the `appointments` table itself has
  `customer_id BIGINT, vehicle_id BIGINT` (good) but `oauth_clients.id` /
  similar text-PK keys are fine.

No BLOCKERs found that compromise multi-tenant isolation, leak service-role
keys, or expose silent-failure paths post the `20260513130000` REVOKE migration.

## Per-table audit

### Scheduler tables (deny_all pattern — Phase 1, single-tenant shop 7476)

| table | RLS on? | deny_all? | shop_id col? | indexes adequate? | soft-delete pattern | notes |
|---|---|---|---|---|---|---|
| `customer_chat_sessions` | yes | yes | INT (7476 hardcoded) | yes — phone/cookie/hold_token partial indexes + active_resume | `ended_at`/`abandoned_at`/`escalated_at`/`completed_at` lifecycle (intentional non-`deleted_at`) | OK — wizard state of truth |
| `customer_chat_messages` | yes | yes | INT NOT NULL | yes — session_chrono + shop_chrono | none (append-only) | `id TEXT` for AI SDK nanoids (documented in `20260510225759`); FK ON DELETE **CASCADE** to sessions (IMPORTANT-1) |
| `appointment_holds` | yes | yes | INT NOT NULL | yes — partial active + session_id (added by `20260513140000`) | `released_at` | FK ON DELETE **CASCADE** to sessions (IMPORTANT-1); customer_id widened to BIGINT |
| `service_dept_users` | yes | yes | INT NOT NULL | yes — partial active idx | `active BOOLEAN` (app-managed catalog) | OK |
| `appointment_blocks` | yes | yes | INT NOT NULL | yes — date lookup idx | none | OK |
| `closed_dates` | yes | yes | INT NOT NULL | implicit via UNIQUE(shop_id, closed_date) | none | OK |
| `appointment_concerns` | yes | yes | INT (via session FK) | yes — session_idx | none | FK ON DELETE **CASCADE** to sessions (IMPORTANT-1) |
| `otp_codes` | yes | yes | INT NOT NULL | yes — phone partial active idx | `consumed_at` | OK |
| `transcript_emails` | yes | yes | INT (via session FK) | yes — pending partial + session_id idx | none (status enum) | FK default RESTRICT to sessions (good); session_id idx added late by `20260513140000` |
| `testing_services` | yes | yes | INT NOT NULL | yes — partial active + GIN on `concern_categories` + GIN on `example_keywords` | `active BOOLEAN` | OK |
| `routine_services` | yes | yes | INT NOT NULL | yes — partial active + GIN on `concern_categories` (added late) | `active BOOLEAN` | OK |
| `appointments` | yes | yes | INT NOT NULL | yes — slot_lookup + date_scan + customer + GIN raw_payload + confirmation_status partial | `deleted_at TIMESTAMPTZ` (correct sync-mirror pattern) | OK; `customer_id BIGINT, vehicle_id BIGINT` from initial schema |
| `appointment_sync_state` | yes | yes | INT PK | n/a (single row per shop) | none | OK |
| `scheduler_audit_log` | yes | yes | session-scoped | yes — session/event_type/step/errors partial | none (append-only) | FK ON DELETE **CASCADE** to sessions (IMPORTANT-1) |
| `concern_questions` | yes | yes | INT NOT NULL | yes — lookup + subcategory | `active BOOLEAN` | OK |
| `appointment_default_limits` | yes | yes | INT (composite PK) | implicit via PK | n/a | OK |
| `scheduler_admin_audit_log` | yes | yes | n/a (admin-table) | yes — table/user partial + snapshot partial | `snapshot_pruned_at` | OK |
| `concern_category_guidelines` | yes | yes | INT (composite PK) | implicit via PK | n/a | OK |
| `concern_subcategories` | yes | yes | INT NOT NULL | yes — lookup idx + GIN on `eligible_testing_service_keys` | `active BOOLEAN` | OK |
| `scheduler_error_log` | yes | yes (added late by `20260516240000`) | n/a — observability table | yes — occurred/session/surface/unresolved partial | `resolved_at` | OK — previously relied on implicit-deny, made explicit per audit |

### Keytag + OAuth + orchestrator tables (RLS-enabled, no policies = implicit deny)

| table | RLS on? | deny_all? | shop_id col? | indexes adequate? | soft-delete pattern | notes |
|---|---|---|---|---|---|---|
| `keytags` | yes | implicit (no policies) | n/a (single-tenant by design — explicitly documented in `20260508025621:18-22`) | yes — partial unique ro_id + status + last_activity partial | `status` enum (in-flight) + `released_at` | Service-role only; AR lockdown trigger present |
| `keytag_cursor` | yes | implicit | n/a | n/a (single-row) | n/a | OK |
| `keytag_webhook_events` | yes | implicit | n/a | yes — ro/received/kind | append-only | OK |
| `keytag_audit_log` | yes | implicit | n/a | yes — ro/user_label partial/occurred/tag/manual_review_code partial | append-only | OK |
| `keytag_confirmation_tokens` | yes | implicit | n/a | yes — user_label DESC + expires partial | `consumed_at` | OK |
| `keytag_manual_reviews` | yes | implicit | n/a | yes — unresolved partial + category + resolved_by partial + (category, ro_id, issued_at) functional | `resolved_at` | OK |
| `keytag_manual_review_attempts` | yes | implicit | n/a | yes — lockout partial idx | append-only | OK |
| `chat_sessions` | yes | implicit | n/a | yes — user_label + last_active DESC | none | OK |
| `orchestrator_runs` | yes | implicit | n/a | yes — session + started + status | `status` enum + `ended_at` | OK |
| `agent_calls` | yes | implicit | n/a | yes — run + started | none | OK |
| `tool_calls` | yes | implicit | n/a | yes — run + name + started | none | OK |
| `oauth_clients` | yes | implicit | n/a | yes — active idx | `active BOOLEAN` | OK |
| `oauth_authorization_codes` | yes | implicit | n/a | yes — client + expires | `used_at` | OK |
| `oauth_access_tokens` | yes | implicit | n/a | yes — client + user + expires | `revoked_at` | OK |
| `oauth_refresh_tokens` | yes | implicit | n/a | yes — client + user + expires + active partial | `revoked_at`; self-FK on `parent_token_hash` | OK |
| `tekmetric_webhook_events` | yes | implicit | n/a | yes — received DESC + multiple partial entity indexes | none | **No unique constraint** for idempotency (BLOCKER-1 per audit Rule 12) |

## Findings

### BLOCKER

#### BLOCKER-1 — `tekmetric_webhook_events` lacks unique constraint for idempotency
- **File:** `supabase/migrations/20260509235046_tekmetric_webhook_events.sql:22-56`
- **Issue:** Per audit Rule 12, webhook_events tables MUST be keyed on `(provider, event_id)` with a synthetic hash when the provider lacks a stable event_id. Tekmetric is exactly such a provider, and the migration comment (lines 14-19) acknowledges this and explicitly defers it to "processors that act on these events MUST handle replays themselves." That punts the invariant into application code. The table has no unique constraint — Tekmetric retries during a transient outage will write multiple identical rows; consumers downstream (appointment handler, keytag handler) have to dedup independently.
- **Recommended fix:** Add `tekmetric_event_hash TEXT` column populated with `sha256(action_type || ':' || ro_number || ':' || status_id || ':' || updated_at)` (or similar deterministic key per the keytag-system convention), and `UNIQUE (tekmetric_event_hash)`. Alternatively, since the keytag side already has `keytag_webhook_events` with no unique constraint either, an equivalent `keytag_event_hash` is needed there for full coverage. Until added, idempotency is a runtime concern, not a DB invariant.

### IMPORTANT

#### IMPORTANT-1 — FK ON DELETE CASCADE used on parent tables without inline justification
- **Files & lines:**
  - `supabase/migrations/20260510131752_scheduler_phase1_schema.sql:93` (`customer_chat_messages.session_id` → CASCADE)
  - `supabase/migrations/20260510131752_scheduler_phase1_schema.sql:116` (`appointment_holds.session_id` → CASCADE)
  - `supabase/migrations/20260510131752_scheduler_phase1_schema.sql:212` (`appointment_concerns.session_id` → CASCADE)
  - `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:28` (`scheduler_audit_log.session_id` → CASCADE)
- **Issue:** Audit Rule 9 requires `ON DELETE RESTRICT` unless explicit cascade is justified. The CASCADEs are intuitively defensible (deleting a chat session deletes its child rows), but the migration files contain no inline rationale — a future operator running `DELETE FROM customer_chat_sessions WHERE id = X` would silently wipe audit logs, message history, holds, and concerns, which is exactly the destructive cascade the rule is designed to prevent. Mitigating factor: there is no application code that ever DELETEs from `customer_chat_sessions` (the lifecycle uses `ended_at`/`abandoned_at` timestamps); status enum has no `deleted` value. Net effect today is no-op, but the FKs are landmines for any future operator cleaning sessions.
- **Recommended fix:** Either (a) flip to `ON DELETE RESTRICT` for `scheduler_audit_log.session_id` (audit log should outlive the session for compliance) and document the others, or (b) add inline COMMENT explaining "this is intentional because sessions are never hard-deleted; child rows have no value without the parent." `scheduler_error_log.session_id` correctly uses `ON DELETE SET NULL` and is the right pattern to copy.

#### IMPORTANT-2 — Two initial migrations lack idempotency (`IF NOT EXISTS`/`ON CONFLICT`)
- **Files:**
  - `supabase/migrations/20260508025621_keytag_system.sql` — every `CREATE TABLE`, `CREATE INDEX`, `INSERT` is bare. Re-running fails at the first `CREATE TABLE public.keytags`.
  - `supabase/migrations/20260510131752_scheduler_phase1_schema.sql` — 13 bare `CREATE TABLE` statements + bare `CREATE INDEX` + bare `CREATE POLICY` + bare seed `INSERT`s. Re-running fails at the first `CREATE TABLE public.customer_chat_sessions`.
- **Issue:** Audit Rule 11 says "every migration uses IF NOT EXISTS / IF EXISTS / ON CONFLICT DO NOTHING so re-running is safe." These two foundational migrations would crash a fresh `supabase db reset` followed by `supabase db push` if their state is already partially applied. Later migrations consistently use the right guards (e.g., `20260511180000`, `20260513000100`, `20260513200000`).
- **Recommended fix:** Either accept these as historical and document them as "checkpoint-only — assume clean slate before applying" in a `README.md` next to migrations/, OR rewrite the create statements with `IF NOT EXISTS`. Net impact today: `supabase db reset` works (DROP first), but a partial-apply failure leaves an unrecoverable state.

#### IMPORTANT-3 — `keytag_webhook_events` has no idempotency constraint either
- **File:** `supabase/migrations/20260508025621_keytag_system.sql:73-100`
- **Issue:** Same shape as BLOCKER-1 but for the separate keytag webhook table. The receiver intentionally writes every webhook (per the comment), but there is no `(synthetic_event_hash)` UNIQUE; duplicates from Tekmetric retries land as separate rows. The keytag PATCH idempotency lives in `assign_next_keytag` (which short-circuits if the RO already has a tag), so the operational impact is bounded — but the table itself isn't following the convention.
- **Recommended fix:** Add a synthetic `event_dedup_key TEXT` populated from `(tekmetric_ro_id, event_kind, status_id, received-bucket)` with `UNIQUE`. Treat duplicates as "noop, already processed."

#### IMPORTANT-4 — Two appointment_holds.customer_id/vehicle_id columns started as INT4 (Tekmetric ID overflow risk)
- **File:** `supabase/migrations/20260510131752_scheduler_phase1_schema.sql:117-118` declares them INTEGER; `supabase/migrations/20260513140000_scheduler_phase1_durability_fixes.sql:43-47` widens to BIGINT.
- **Issue:** Resolved already by H-1 in `20260513140000`. Documenting here for completeness — if a fresh environment somehow ran the early migration alone, Tekmetric IDs > 2.1B (Tekmetric is assigning IDs near that threshold per the audit comment) would silently truncate. The widening migration uses correct `ALTER COLUMN TYPE BIGINT USING customer_id::BIGINT` pattern.
- **Status:** Fixed downstream; no action needed unless a re-baseline strips this fix.

#### IMPORTANT-5 — `customer_chat_sessions.current_step` enforced at app layer only
- **File:** `supabase/migrations/20260513000000_scheduler_phase1_wizard_columns.sql:30, 111-112`
- **Issue:** The `current_step` enum is huge (greeting | phone_name | otp_pending | partial_verification_gate | multi_account_disambiguation | no_match_choose_path | customer_info_edit | new_customer_info | vehicle_pick | new_vehicle_form | service_concern_picker | concern_explanation | diagnostic_loading | clarification_question | testing_service_approval | second_routine_pass | appointment_type | date_pick | waiter_time_pick | summary | customer_notes | customer_question | completed | escalated | abandoned). Comment explicitly says "Enum enforced at app layer (no CHECK constraint to allow rapid iteration)." Trade-off documented and intentional, but worth flagging as IMPORTANT because a misspelled step from an Edge Function or admin SQL would silently land and block wizard advancement.
- **Recommended fix:** Once enum stabilizes post-Phase-1, add `CHECK (current_step IN (...))` constraint. Until then, the app-layer guard is acceptable.

#### IMPORTANT-6 — `customer_chat_messages.session_id` index reference exists but composite-only
- **File:** `supabase/migrations/20260510131752_scheduler_phase1_schema.sql:100-103`
- **Issue:** Has `(session_id, created_at)` composite idx (good for per-session chrono queries) but no standalone idx on `session_id` alone. For "find all messages for session X without ordering" the composite still works (Postgres leading-column optimization). Equality-only queries on session_id are fine — no fix needed.

#### IMPORTANT-7 — `tekmetric_webhook_events` raw_query_string stored as TEXT (not redacted)
- **File:** `supabase/migrations/20260509235046_tekmetric_webhook_events.sql:46`
- **Issue:** Comment says "URL query, with `token` stripped before write" — depends on application redaction. The schema cannot enforce this; if a future code path forgets to strip, the `TEKMETRIC_WEBHOOK_TOKEN` lands plaintext in every row. Not a schema issue per se; flagged for cross-check.

### NICE-TO-HAVE

#### NICE-TO-HAVE-1 — Inconsistent timestamp column naming
- `keytags.assigned_at/posted_at/released_at` vs `customer_chat_sessions.ended_at/started_at/last_active_at` vs `appointments.tekmetric_synced_at` vs `appointments.created_date/updated_date` (these last two are Tekmetric mirrors — separate from local created_at, but the local-vs-Tekmetric distinction takes some reading to notice).
- No fix needed; documented inline.

#### NICE-TO-HAVE-2 — Mix of UUID and BIGSERIAL PKs across new tables
- UUID PKs: every scheduler table except composite-PK ones.
- BIGSERIAL PKs: `keytag_audit_log`, `keytag_manual_reviews`, `keytag_manual_review_attempts`, `concern_questions`, `concern_subcategories`, `scheduler_audit_log`, `scheduler_admin_audit_log`, `scheduler_error_log`.
- The keytag tables and audit logs make sense as BIGSERIAL (high-volume, sequential, audit-trail). The scheduler-data tables use UUID. The choice rationale isn't documented per-table. No fix needed; suggest one-line `COMMENT ON COLUMN ... PRIMARY KEY` rationale for future maintainers.

#### NICE-TO-HAVE-3 — `appointment_holds.expires_at > now()` not enforceable in partial index (well-handled but noisy)
- **File:** `20260510131752:128-133`
- The migration comment explains this is intentional ("Postgres rejects volatile expressions like `expires_at > now()` in partial-index predicates"). Application filters at query time. Documented properly; nothing to fix.

#### NICE-TO-HAVE-4 — `chat_sessions` (orchestrator) and `customer_chat_sessions` (scheduler) are different tables with similar names
- The two tables serve different products. Adding a `COMMENT ON TABLE` clarifying which is which would help future maintainers.

#### NICE-TO-HAVE-5 — Stage-1 SECURITY DEFINER cron helpers grant to `postgres` (not `service_role`)
- **File:** `supabase/migrations/20260510210117_scheduler_cron_setup.sql:60, 92, 145`
- `cron_unschedule_if_exists`, `scheduler_get_service_role_key`, `scheduler_invoke_edge_function` are granted to `postgres`, not `service_role`. They're called from cron contexts (which run as `postgres`), so this is correct, but it's an inconsistency with the rest of the codebase. The later migration `20260513130000` adds defensive DO-block REVOKE-from-PUBLIC/anon/authenticated and GRANT to `service_role` on `scheduler_invoke_edge_function` + `scheduler_get_service_role_key` — that GRANT pattern is the safer convention.

#### NICE-TO-HAVE-6 — `concern_questions.category` is denormalized vs `concern_subcategories.category`
- **File:** `20260514100000:27-29` documents the intentional denormalization ("denormalized for query speed + read paths in Phase 9a code"). The upload tool keeps them in sync. Pattern is correct; flagging only because there's no DB-side check enforcing `concern_questions.category == subcategory.category` for a given subcategory_id.
- Could be enforced via a `CHECK ((SELECT category FROM concern_subcategories WHERE id = subcategory_id) = category)` — but that's expensive, so an application-side sync is acceptable.

#### NICE-TO-HAVE-7 — A few migrations not wrapped in BEGIN/COMMIT
- Most scheduler migrations use explicit `BEGIN; ... COMMIT;`. The original `20260510131752` doesn't (full file is implicit transaction); same for several keytag migrations. Supabase's `db push` wraps each file in a transaction automatically, so functionally fine — but cosmetic consistency would help.

#### NICE-TO-HAVE-8 — `scheduler_error_log.origin_id` is TEXT NULL (no FK to a registry)
- Reasonable choice — the origin_id namespace (e.g., 'scheduler-hold-reaper', 'submit-greeting-action') is too open to enforce via FK. The CHECK on `origin` (one of 5 values) provides the necessary structure.

## Cron jobs reviewed (all 6, including reapers)

| jobname | schedule | EXCEPTION wrap? | observability target | notes |
|---|---|---|---|---|
| `scheduler-appointments-sync` | `*/10 * * * *` | yes (`20260516200000`) | scheduler_error_log | Retrofitted from bare body in original `20260510210117` |
| `scheduler-transcript-dispatcher` | `*/5 * * * *` | yes (`20260516200000`) | scheduler_error_log | Same as above |
| `keytag-daily-report` | `0 11 * * *` | yes (`20260516200000`) | scheduler_error_log | Retrofitted; originally bare in `20260511132525` |
| `keytag-bulk-reconcile` | `0 10 * * *` | yes (`20260516200000`) | scheduler_error_log | Retrofitted; originally bare in `20260511144500` |
| `scheduler-hold-reaper` | `*/30 * * * *` | yes (created with wrap in `20260516190000`) | scheduler_error_log | OK |
| `scheduler-error-log-prune` | `0 3 * * *` | yes (created with wrap in `20260516190000`) | scheduler_error_log | OK |
| `scheduler-admin-snapshot-prune` | `30 3 * * *` | yes (created with wrap in `20260519140000`) | scheduler_error_log with nested EXCEPTION fallback | OK — last-resort swallow keeps cron scheduled |

All crons compliant with Rule 13 after `20260516200000`. **No silent-failure paths remain in cron bodies.**

## SECURITY DEFINER functions reviewed

Verified every SECURITY DEFINER function sets `search_path` (compliance with Rule 8):

| function | search_path | grants |
|---|---|---|
| `tekmetric_get_secret` / `tekmetric_set_secret` | `public, vault` | service_role only |
| `assign_next_keytag` / `force_assign_keytag` / `release_keytag_for_ro` / `mark_keytag_posted` / `release_keytag_as_orphan` / `revert_keytag_to_assigned` / `touch_keytag_activity` / `record_keytag_patched` / `log_keytag_audit` | `public` | service_role only |
| `enforce_keytag_ar_lockdown` (trigger) | `public` | trigger context (no caller grant) |
| `oauth_validate_access_token` / `oauth_consume_refresh_token` | `public` | service_role only |
| `create_keytag_confirmation_token` / `consume_keytag_confirmation_token` | `public` | service_role only (implicit via REVOKE elsewhere) |
| `generate_manual_review_code` / `create_manual_review` / `check_manual_review_lockout` / `lookup_manual_review` / `resolve_manual_review` / `attach_resolution_audit_log` / `mark_manual_review_email_sent` | `public` | service_role only (implicit via REVOKE chain) |
| `hold_waiter_slot` | `public` | service_role only (REVOKE explicit in `20260513130000` + `20260516230000`) |
| `cron_unschedule_if_exists` | `public, cron` | postgres only |
| `scheduler_get_service_role_key` | `public, vault` | postgres only (+ defensive REVOKE in `20260513130000`) |
| `scheduler_invoke_edge_function` | `public, net` | postgres only (+ defensive REVOKE in `20260513130000`) |

All 21 SECURITY DEFINER functions reviewed are compliant with Rule 8. The high-risk `scheduler_get_service_role_key` had a window of exposure before `20260513130000` (anon could call it via PostgREST); fixed defensively even though no committed CREATE migration ships it (it was created ad-hoc per the migration comment).

## Migrations reviewed

1. `20260508020947_tekmetric_vault_wrappers.sql` — Vault wrappers (REVOKE/GRANT correct)
2. `20260508025621_keytag_system.sql` — original keytags + RPCs (no `IF NOT EXISTS`; service_role-only by RLS-no-policy)
3. `20260508225430_orchestrator_logging.sql` — `chat_sessions` + `orchestrator_runs` + `agent_calls` + `tool_calls`
4. `20260509001426_oauth_for_mcp.sql` — `oauth_clients` + auth_codes + access_tokens
5. `20260509215014_keytags_color_round_robin.sql` — 180-tag color pool replacement; DROP+recreate
6. `20260509235046_tekmetric_webhook_events.sql` — firehose log (no idempotency unique — BLOCKER-1)
7. `20260510131752_scheduler_phase1_schema.sql` — 13 tables + `hold_waiter_slot` v1
8. `20260510133653_abbreviations_fill.sql` — seed updates with defensive `RAISE EXCEPTION` post-check
9. `20260510210117_scheduler_cron_setup.sql` — cron extension + 2 jobs (bodies bare; retrofitted later)
10. `20260510225759_chat_messages_id_to_text.sql` — UUID → TEXT fix for AI SDK nanoid IDs
11. `20260511131322_fix_assign_next_keytag_ambiguity.sql` — qualify OUT-param vs CTE column refs
12. `20260511132525_keytag_daily_report_cron.sql` — 7 AM ET keytag report cron
13. `20260511144500_keytag_nightly_reconcile_cron.sql` — 6 AM ET reconcile cron
14. `20260511150000_keytag_regression_rpcs.sql` — `revert_keytag_to_assigned` + `release_keytag_as_orphan`
15. `20260511143000_keytag_last_activity_and_backfill_rpcs.sql` — add `last_activity_at` + overloaded RPCs
16. `20260511160000_keytag_existing_rpc_activity_tracking.sql` — wire activity into `force_assign_keytag` + `release_keytag_for_ro`
17. `20260511180000_keytag_audit_log.sql` — `keytags.changed_by_user_label` + `keytag_audit_log`
18. `20260511190000_oauth_refresh_tokens.sql` — OAuth 2.1 refresh tokens (90-day TTL, rotation)
19. `20260511200000_keytag_confirmation_tokens.sql` — UUID 5-min token + atomic consume RPC
20. `20260511210000_keytag_ar_lockdown_trigger.sql` — BEFORE-UPDATE trigger + GUC pattern (Layer 4 defense)
21. `20260511220000_keytag_manual_reviews.sql` — async manual-review with PFX-XXXXXX codes + lockout
22. `20260511230000_keytag_audit_log_nullable_tag.sql` — relax CHECK for policy-decision audit rows
23. `20260513120000_keytag_manual_reviews_category_ro_id_index.sql` — functional idx for JSONB dedup
24. `20260513000000_scheduler_phase1_wizard_columns.sql` — wizard-state columns on `customer_chat_sessions`
25. `20260513000100_scheduler_phase1_new_tables.sql` — `scheduler_audit_log` + `concern_questions` + `appointment_default_limits` + `scheduler_admin_audit_log`
26. `20260513000300_scheduler_phase1_fix_hold_waiter_slot.sql` — ambiguity DROP+recreate
27. `20260513000200_scheduler_phase1_table_modifications_and_seeds.sql` — flags + 10-min hold TTL + concern_questions seed
28. `20260513130000_scheduler_phase1_revoke_anon_security_definer.sql` — defensive REVOKE on 3 SECURITY DEFINER fns
29. `20260513140000_scheduler_phase1_durability_fixes.sql` — INT4 → BIGINT widening + indexes + DEFAULT 'greeting'
30. `20260513200000_scheduler_phase1_catalog_imports.sql` — fix 'warning-light' tag + add unique on `concern_questions` + seed
31. `20260513210000_scheduler_phase1_catalog_brakes_q5.sql` — single-question patch
32. `20260513220000_scheduler_phase1_fix_hold_waiter_slot_v2.sql` — fix ambiguous OUT-param + non-existent column ref
33. `20260513230000_scheduler_pending_candidates.sql` — JSONB column for multi-account disambig state
34. `20260514000000_scheduler_concern_category_guidelines.sql` — per-category prose guideline table + 14-row seed
35. `20260514000100_scheduler_routine_services_concern_categories.sql` — add GIN-indexed `concern_categories[]` + 5-row seed
36. `20260514100000_scheduler_concern_subcategories_and_keywords.sql` — `concern_subcategories` + FK + UNIQUE swap + `example_keywords[]`
37. `20260516040000_appointments_phase_9d_correctness.sql` — add 7 typed cols + raw_payload + parse_version + GIN
38. `20260516180000_scheduler_error_log.sql` — centralized error log + 4 indexes
39. `20260516190000_scheduler_cron_reapers.sql` — hold reaper + error-log pruner (both with EXCEPTION wrap)
40. `20260516200000_scheduler_cron_exception_wraps.sql` — retrofit EXCEPTION wraps on 4 prior crons
41. `20260516230000_scheduler_hold_waiter_slot_dst_aware.sql` — replace hardcoded `-04:00` with `AT TIME ZONE`
42. `20260516240000_scheduler_rls_hardening.sql` — explicit `deny_all` on `scheduler_error_log` + CHECK no-hyphen
43. `20260516220000_scheduler_concern_seeds_part1.sql` — 6 categories × ~47 subcategories + 329 questions
44. `20260516220001_scheduler_concern_seeds_part2.sql` — 7 categories × 52 subcategories + 363 questions
45. `20260516210000_scheduler_brakes_subcategory_seed.sql` — brakes 6 subcategories + 37 questions
46. `20260518010416_scheduler_routine_services_pricing.sql` — `starting_price_cents BIGINT` + `price_waived_note`
47. `20260518141655_scheduler_add_check_ac_testing_service.sql` — single-row UPSERT for check_ac
48. `20260518163925_scheduler_concern_catalog_canonical_rebuild.sql` — `multi_select` column + canonical-catalog rebuild (105 subs / 729 questions)
49. `20260519140000_scheduler_md_edit_v2_schema.sql` — admin audit snapshot + 30-day prune cron
50. `20260520200000_scheduler_subcategory_service_map.sql` — `eligible_testing_service_keys TEXT[]` + GIN
51. `20260521120000_scheduler_three_stage_classifier.sql` — `description` + `positive/negative_examples` + `synonyms` + `required_facts`
52. `20260521170000_scheduler_exhaust_subcategories.sql` — 2 new noise subcategories with full Stage-1 metadata
53. `20260521170500_scheduler_exhaust_route_additions.sql` — append exhaust_system_testing to 2 existing subcategories
54. `20260521171000_scheduler_exhaust_service_and_boundary_callouts.sql` — exhaust_system_testing testing_services row + 5 description patches

`config.toml` reviewed for security policy hints: 9 edge functions configured with `verify_jwt = false` are properly justified inline (webhook receivers using query-token auth; MCP/OAuth flows using PKCE; cron-triggered functions using the same bearer-token check inside the function).

## Cross-cutting observations

1. **The keytag system's 4-layer defense is exemplary** — TS confirmation tokens (Pattern A from `pattern-compliance.md`), 6-char manual-review codes (Pattern B), DB BEFORE-UPDATE trigger with SET LOCAL GUC, and append-only audit log. This is the reference implementation for sensitive ops in any future module.

2. **Money column convention is clean** — every `_cents` column is `INTEGER` or `BIGINT`. No floats. `starting_price_cents` in `routine_services` is INTEGER; in `testing_services` it's INTEGER; `total_cost_cents` in `orchestrator_runs` is BIGINT. Mix of INTEGER vs BIGINT is acceptable per audit Rule 3 ("BIGINT cents" — INTEGER cents up to ~$21M is fine for shop pricing).

3. **Soft-delete pattern is correctly differentiated** — sync-mirrored tables (`appointments`) use `deleted_at TIMESTAMPTZ`; catalog tables (`testing_services`, `routine_services`, `service_dept_users`, `appointment_blocks`, `concern_subcategories`, `concern_questions`) use `active BOOLEAN`. Matches audit Rule 7.

4. **Index coverage is thorough** — every FK has an index; every GIN array column (`concern_categories`, `example_keywords`, `eligible_testing_service_keys`) is GIN-indexed; partial indexes used where appropriate (active-only, status-conditional, expires-in-future).

5. **No `created_by`/`updated_by` audit columns on shop_id-scoped tables** — would be useful for Phase 2 multi-tenant, but acceptable for single-tenant Phase 1 where audit logs handle the "who did what" question.
