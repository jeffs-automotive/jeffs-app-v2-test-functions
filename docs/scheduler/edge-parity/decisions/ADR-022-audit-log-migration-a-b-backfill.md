# ADR-022: scheduler_admin_audit_log Migration A (additive) + Migration B (NOT NULL) + backfill script

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.2 single-migration design + v0.3 unconditional NULL→-1 UPDATE inside Migration B. Distilled from CV-B1 (split into A + B) + CV3-A-I1 (Deno backfill script with PHASE 1/PHASE 2 gating) + X-FIX-#14 (idempotent ADD CONSTRAINT + CREATE INDEX CONCURRENTLY outside BEGIN) + cross-verify rounds 1-3.
**Superseded by:** (none)

## Context

The `scheduler_admin_audit_log` table needs a `shop_id` column for multi-tenant safety (eligibility filtering in `list_scheduler_admin_audit_log`, scoping in `revert_md_upload_apply`), plus revert linkage columns (`successor_revert_id`, `reverts_upload_id`), plus new indexes, plus the new `scheduler_admin_revert_attempts` table.

Doing all of this in one migration was the v0.2 design. It broke under three pressures: (1) the old code in flight at deploy time doesn't yet write `shop_id`, so a `NOT NULL` column added in the same migration as code rollout creates a race; (2) historical pre-migration rows have no `shop_id` to recover — they need an offline derivation pass against existing per-shop tables; (3) sentinel coercion (NULL → -1) embedded inside the migration would silently mask a failed/skipped backfill (A-I1 Gemini cross-verify finding).

The fix is a two-step staged deploy: Migration A ships the additive changes (NULLABLE `shop_id` + new columns + indexes + attempts table + RLS hardening) early so new code can begin writing immediately; a Deno backfill script derives historical `shop_id`s with operator review of residuals between the two migrations; Migration B then flips `shop_id` to `NOT NULL` only after Chris has explicitly confirmed zero NULLs. Idempotency matters because operators may need to retry partial applies.

## Decision

Four artifacts ship together: Migration A (hybrid transactional + non-transactional concurrent-index tail), the Deno backfill script, Migration B file 1 (transactional NOT NULL transition), and Migration B file 2 (non-transactional concurrent-index refinement via `-- supabase: skip-tx-wrap` directive). Each artifact is gated by its own HUMAN approval step in the deploy timeline.

**1. Migration A — `20260526000000_scheduler_admin_audit_log_hardening_part_a.sql` (additive, applies at E1a):**

The migration has a HYBRID shape: a transactional block (additive DDL on the
live audit_log + full setup of the brand-new attempts table) followed by a
non-transactional CONCURRENT-index tail for the 4 indexes that touch the live
`scheduler_admin_audit_log`. CONCURRENT index creation cannot run inside an
explicit transaction, and standard `CREATE INDEX` on a populated audit_log
would take an ACCESS EXCLUSIVE lock that blocks every uploader, exporter, and
list-tool reader for the duration of the build. The split puts the new-table
indexes (which are cheap because the table is empty) inside BEGIN, and the
live-table indexes outside as CONCURRENTLY.

```sql
-- ─────────────────────────────────────────────────────────────────────
-- PART 1 — Transactional additive DDL
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- pgcrypto extension for digest() (per ADR-017 search_path)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PE-1: CHECK loosen so revert_upload operation can INSERT
ALTER TABLE public.scheduler_admin_audit_log
  DROP CONSTRAINT IF EXISTS scheduler_admin_audit_log_operation_check;
ALTER TABLE public.scheduler_admin_audit_log
  ADD CONSTRAINT scheduler_admin_audit_log_operation_check
    CHECK (operation IN ('upload_md','manual_change','export_md','revert_upload'));

-- PE-2 part 1: shop_id NULLABLE (backfill in script; Migration B will SET NOT NULL)
ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS shop_id INTEGER NULL;

-- PE-3: revert linkage columns
ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS successor_revert_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverts_upload_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL;

-- scheduler_admin_revert_attempts table (per ADR-020) + its 4 attempts-side indexes.
-- These index creations are SAFE inside BEGIN because the table is brand-new
-- with zero rows and zero concurrent writers — non-concurrent CREATE INDEX
-- takes negligible time and the ACCESS EXCLUSIVE lock is contention-free.
CREATE TABLE IF NOT EXISTS public.scheduler_admin_revert_attempts ( ... );
-- (see ADR-020 for full schema, constraints, COMMENTs, and the 4 attempts-table indexes:
--  outcome_idx, shop_idx, upload_idx, pending_partial_idx)

-- RLS hardening (per ADR-018)
ALTER TABLE public.scheduler_admin_revert_attempts ENABLE ROW LEVEL SECURITY;
-- DO-block-wrapped CREATE POLICY RESTRICTIVE deny-all + REVOKE/GRANT triple
ALTER TABLE public.scheduler_admin_audit_log ENABLE ROW LEVEL SECURITY;
-- Same RESTRICTIVE deny-all + REVOKE/GRANT triple for audit_log

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- PART 2 — Non-transactional CONCURRENT index tail for live audit_log
-- ─────────────────────────────────────────────────────────────────────
-- CREATE INDEX CONCURRENTLY cannot run inside an explicit transaction.
-- Supabase CLI wraps each migration file in an implicit transaction by
-- default; we work around that by either (a) splitting these into their
-- own migration files OR (b) using --skip-tx-wrap. Default approach here
-- is (a) — separate companion migration `20260526000001_audit_log_concurrent_indexes.sql`
-- whose body is JUST the four statements below. The file timestamp keeps
-- them in apply order immediately after Part 1.
--
-- IF a single-file approach is preferred, set the migration's first line to
-- `-- supabase: skip-tx-wrap` (Supabase CLI 1.95+ honors this directive)
-- and inline the statements below; otherwise keep them in the companion file.

-- Race-defense partial unique index: one successful revert per upload
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_one_successful_revert_idx
  ON public.scheduler_admin_audit_log (reverts_upload_id)
  WHERE reverts_upload_id IS NOT NULL AND error_message IS NULL;

-- Indexes for list_scheduler_admin_audit_log tool
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_shop_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, occurred_at DESC)
  WHERE shop_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, table_name, operation, occurred_at DESC)
  WHERE shop_id IS NOT NULL;

-- GIN expression index for surfaces[] filter (per ADR-021)
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surfaces_gin_idx
  ON public.scheduler_admin_audit_log
  USING GIN ((diff_summary->'surfaces'));
```

**Operator post-apply check.** After Part 2 completes, run
`SELECT indexname, indisvalid FROM pg_indexes JOIN pg_index ON ... WHERE indexname LIKE 'scheduler_admin_audit_log_%_idx';`
to verify every index has `indisvalid = true`. A failed concurrent build leaves
the index in `INVALID` state — the next migration's `IF NOT EXISTS` would skip
it silently, leaving the table without the planned index. Drop any INVALID
index manually and re-run the corresponding CREATE INDEX CONCURRENTLY before
proceeding to E1b (backfill script).

**2. Backfill script — `scripts/backfill-audit-log-shop-id.ts` (Deno, runs at E11b-d):**

```
PHASE 1 — Derivation (idempotent, no destructive writes):
  For each row WHERE shop_id IS NULL:
    derive shop_id by:
      (a) reading the snapshot's row data and looking up the matching per-shop
          table row (e.g., for a testing_services upload, look at
          snapshot.before's first row's shop_id)
      (b) if (a) yields nothing usable, leave shop_id NULL and log row id +
          table_name + occurred_at for operator review
    UPDATE audit row with derived shop_id (if any)
  End loop.
  PHASE 1 report: N rows updated; M rows left NULL (printed with ids + occurred_at + table_name).

PHASE 2 — Gated sentinel UPDATE (only runs after explicit Chris approval):
  IF M > 0 AND --apply-sentinel-now flag passed AND interactive prompt confirmed:
    UPDATE scheduler_admin_audit_log SET shop_id = -1 WHERE shop_id IS NULL;
    Log: "applied sentinel shop_id=-1 to {M} historical rows per operator confirmation."
  ELSE IF M > 0:
    Log non-zero exit: "Migration B will FAIL until either (1) all NULL rows backfilled
      to real shop_ids manually OR (2) operator re-runs this script with --apply-sentinel-now."
```

The sentinel `-1` is PERMANENT (never re-derived). List tool surfaces sentinel rows with `revert_eligibility.reasons = ['shop_id_unknown_pre_migration_backfill']` per ADR-021.

**3. Migration B — applied as TWO companion files (NOT NULL transition + concurrent-index refinement, applies at E11e):**

Migration B SPLITS into two sibling files because `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` cannot run inside any transaction — and the Supabase CLI wraps each migration file in an implicit transaction by default. Putting a transactional block + post-COMMIT concurrent ops in the SAME file relies on the outer Supabase-wrap NOT being in effect, which is brittle. The clean shape is one transactional file followed by one non-transactional file.

**File 1 — `20260526100000_scheduler_admin_audit_log_hardening_part_b1_set_not_null.sql`:**

```sql
-- Transactional file. Supabase CLI's implicit BEGIN/COMMIT wrap is fine here
-- (ALTER COLUMN SET NOT NULL + ADD CONSTRAINT are transactional DDL).

-- HARD CHECK: fail loud if any NULL shop_id rows remain (backfill PHASE 2 was skipped)
DO $$
DECLARE null_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM public.scheduler_admin_audit_log WHERE shop_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration B blocked: % NULL shop_id rows remain. Run scripts/backfill-audit-log-shop-id.ts PHASE 1/2 first.', null_count;
  END IF;
END $$;

ALTER TABLE public.scheduler_admin_audit_log
  ALTER COLUMN shop_id SET NOT NULL;

-- Idempotent ADD CONSTRAINT via DO-block (no IF NOT EXISTS for constraints).
-- NOTE: catches duplicate_object by NAME only; a same-name but weaker constraint
-- would be silently accepted. Operators verify post-deploy via
-- `\d scheduler_admin_audit_log` that the constraint definition matches.
DO $$
BEGIN
  ALTER TABLE public.scheduler_admin_audit_log
    ADD CONSTRAINT scheduler_admin_audit_log_shop_id_valid_check
      CHECK (shop_id > 0 OR shop_id = -1);
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- constraint exists from prior partial-apply; safe no-op
END $$;
```

**File 2 — `20260526100001_scheduler_admin_audit_log_hardening_part_b2_concurrent_indexes.sql`:**

```sql
-- supabase: skip-tx-wrap
--
-- NON-TRANSACTIONAL file. The `-- supabase: skip-tx-wrap` directive (Supabase
-- CLI ≥1.95) tells the CLI NOT to wrap this file in an implicit transaction.
-- CREATE/DROP INDEX CONCURRENTLY cannot run inside any transaction, so this
-- directive is REQUIRED — without it the statements below fail at runtime
-- with `CREATE INDEX CONCURRENTLY cannot be executed within a transaction`.
--
-- This file recreates the two narrowed audit-log indexes whose Migration A
-- versions used `WHERE shop_id IS NOT NULL` (Migration A's NULLABLE state).
-- After Migration B File 1, shop_id is NOT NULL and every row has shop_id
-- either > 0 (real tenant) or = -1 (sentinel). The narrower `WHERE shop_id > 0`
-- predicate excludes sentinel rows from these query-path indexes (operators
-- never paginate audit_log for shop_id=-1 from the normal admin UI).

DROP INDEX CONCURRENTLY IF EXISTS public.scheduler_admin_audit_log_shop_recent_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.scheduler_admin_audit_log_surface_recent_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_shop_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, occurred_at DESC)
  WHERE shop_id > 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, table_name, operation, occurred_at DESC)
  WHERE shop_id > 0;
```

**Why split into TWO files instead of one with skip-tx-wrap:** File 1 is transactional DDL (SET NOT NULL + ADD CONSTRAINT) — if a partial-apply hits an error after SET NOT NULL but before ADD CONSTRAINT, the txn wrap rolls back cleanly. File 2's concurrent ops are not transactional regardless; running them in their own file means a failed concurrent build (leaving the index `INVALID`) doesn't affect File 1's already-committed state. The split also lets operators retry just the affected file without re-running the HARD CHECK.

**Post-apply validation:** after both files apply, run
`SELECT indexname, indisvalid FROM pg_indexes JOIN pg_index ON ... WHERE indexname IN ('scheduler_admin_audit_log_shop_recent_idx','scheduler_admin_audit_log_surface_recent_idx');`
to verify `indisvalid = true` on both. INVALID indexes from a failed concurrent build must be dropped manually and File 2 re-run.

**Why CREATE INDEX CONCURRENTLY at all:** `scheduler_admin_audit_log` is a live append-only audit log. Non-concurrent index recreation takes an ACCESS EXCLUSIVE lock for the entire DROP+CREATE window, blocking ALL readers/writers (uploaders, exporters, list-audit-log tool calls). Concurrent variants take only SHARE UPDATE EXCLUSIVE — readers/writers continue.

## Consequences

Two-step staged deploy with operator review between gives operators a window to inspect derivation residuals before committing to the sentinel-coercion path. The PHASE 1 report names every NULL row by id + table_name + occurred_at; Chris can choose to manually backfill specific rows (preserving revert eligibility) before deciding whether to apply the `-1` sentinel to the rest.

Idempotency on every DDL statement (`IF NOT EXISTS`, `DROP ... IF EXISTS`, DO-block `EXCEPTION WHEN duplicate_object`) means a partial-apply failure mid-migration can be retried safely. The DO-block ADD CONSTRAINT catches duplicate_object by name only — a same-name but weaker constraint would be silently accepted; operators can verify post-deploy via `\d scheduler_admin_audit_log`. Similarly, CREATE INDEX CONCURRENTLY IF NOT EXISTS can mask invalid leftover indexes from a prior failed concurrent build (visible via `\di+` index status). Both are minor risks with manual verification paths.

Lock-window safety on production-sized audit logs comes from CREATE INDEX CONCURRENTLY in Migration B's post-COMMIT block. The 4 audit-log indexes Migration A creates inside BEGIN are tolerable at Phase 1 ship (table is small; only admin-tool mutations write here), but the pattern is documented for future migration if growth makes the lock window unacceptable.

Sentinel `-1` is PERMANENT: list tool surfaces sentinel rows with `shop_id_unknown_pre_migration_backfill` reason so operators can see them but cannot revert them; the eligibility computation in `list_scheduler_admin_audit_log` flags them non-revertable; the inner RPC's `WHERE shop_id = p_shop_id` automatically excludes them from positive-shop callers. The backfill is run once and the result becomes permanent state — no periodic re-derivation.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.1 (Migration A SQL) + §4.2 (backfill script PHASE 1/2) + §4.3 (Migration B SQL) + §4.6 (apply order)
- Related ADRs: ADR-006 (migration apply order — A first, B last), ADR-018 (RLS RESTRICTIVE deploys with Migration A), ADR-020 (attempts table created in Migration A), ADR-021 (list tool surfaces shop_id_unknown sentinel rows)
