-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E7: list_scheduler_admin_audit_log RPC
-- ════════════════════════════════════════════════════════════════════════
--
-- This file CREATEs ONE SECURITY DEFINER function that the new
-- `list_scheduler_admin_audit_log` MCP tool delegates to. The function
-- runs the ADR-021 surface-filter SQL (conditional COALESCE fallback +
-- JSONB `?` existence operator) with proper positional-parameter
-- binding, returning the raw audit-log rows for TS-side eligibility
-- computation.
--
-- The RPC is an OUTER-CALLABLE entry point per ADR-005 — orchestrator-mcp
-- invokes it via service_role bearer from the `listSchedulerAdminAuditLog`
-- tool wrapper. It is the 7th outer-callable function in the feature
-- (joining revert_md_upload_attempt + the 5 apply_*_upload RPCs). Audit
-- guarantee is N/A — this is a read-only function with no side effects,
-- so the audit-trail invariants of ADR-002 do not apply.
--
-- ────────────────────────────────────────────────────────────────────────
-- Cross-references:
-- ────────────────────────────────────────────────────────────────────────
--   ADR-021 — surface-filter SQL (conditional COALESCE fallback + reasons
--             union of 9 STRICT SUBSET values of the ADR-007 canonical
--             enum). The wrapper TS layer computes the per-row
--             revert_eligibility hint from the raw columns returned here;
--             this RPC's only job is the SQL filter.
--   ADR-005 — outer-callable entry-point set: REVOKE PUBLIC/anon/authenticated
--             + GRANT service_role. orchestrator-mcp's L1 trust boundary
--             gates the admin-tools surface; no additional gate inside
--             this RPC.
--   ADR-017 — SET search_path = pg_catalog, extensions, public, pg_temp.
--             pg_catalog first hardens unqualified built-in calls;
--             extensions for pgcrypto's digest() (unused here but kept
--             for consistency across all SECURITY DEFINER funcs in the
--             feature); public for project tables; pg_temp LAST defeats
--             session-temp shadow attack.
--   ADR-018 — audit_log RLS RESTRICTIVE deny-all set up in Migration A.
--             SECURITY DEFINER context (function owner = postgres) bypasses
--             RLS — that's what permits the read here.
--   ADR-020 — scheduler_admin_revert_attempts table (not read by this RPC;
--             only audit_log). Successor-revert detection (`reverts_upload_id
--             IN (...)`) is run TS-side in a follow-up query for cheap
--             per-row eligibility.
--
-- ────────────────────────────────────────────────────────────────────────
-- Why a dedicated RPC and not PostgREST .filter()?
-- ────────────────────────────────────────────────────────────────────────
-- The Supabase REST builder cannot easily express the conditional COALESCE
-- + JSONB key-exists pair from ADR-021 with positional placeholders:
--   (COALESCE(diff_summary ? 'surfaces', FALSE) AND diff_summary->'surfaces' ? $1)
--   OR
--   (NOT COALESCE(diff_summary ? 'surfaces', FALSE) AND table_name = $2)
-- The PostgREST `?` operator URL-encoding has multiple driver-specific
-- pitfalls (it collides with the URL query-string separator). A thin
-- plpgsql wrapper SECURITY DEFINER function is the cleaner separation
-- and gives us explicit parameter binding identical to the ADR-021 SQL.
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_scheduler_admin_audit_log_filtered(
  p_shop_id          INTEGER,
  p_surface_filter   TEXT,
  p_table_filter     TEXT,
  p_only_successful  BOOLEAN,
  p_limit            INTEGER
) RETURNS TABLE (
  id                    BIGINT,
  occurred_at           TIMESTAMPTZ,
  table_name            TEXT,
  operation             TEXT,
  shop_id               INTEGER,
  user_label            TEXT,
  oauth_client_id       TEXT,
  md_content_hash       TEXT,
  rows_added            INTEGER,
  rows_modified         INTEGER,
  rows_deactivated      INTEGER,
  error_message         TEXT,
  diff_summary          JSONB,
  pre_state_snapshot    JSONB,
  snapshot_pruned_at    TIMESTAMPTZ,
  successor_revert_id   BIGINT,
  reverts_upload_id     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
BEGIN
  -- ─── Parameter validation per ADR-005 outer-callable guard pattern ───
  -- Mirrors revert_md_upload_attempt STEP 0a/b — RAISE for caller bugs;
  -- the RPC is invoked only by orchestrator-mcp which controls the args.
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'p_shop_id must be a positive integer (got %)', p_shop_id
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 50 THEN
    RAISE EXCEPTION 'p_limit must be in [1, 50] (got %)', p_limit
      USING ERRCODE = '22023';
  END IF;
  IF p_only_successful IS NULL THEN
    RAISE EXCEPTION 'p_only_successful must be non-NULL boolean (caller bug — pass an explicit value)'
      USING ERRCODE = '22023';
  END IF;
  -- p_surface_filter + p_table_filter MAY be NULL (no-filter mode); the
  -- ADR-021 SQL clause is conditional on both being non-NULL.

  -- ─── Audit-row SELECT per ADR-021 §"Part 1 — Surface filter SQL" ─────
  -- Includes: shop_id scoping (always); 30-day occurred_at cutoff (always);
  -- optional surface_filter conditional fallback (when both p_surface_filter
  -- and p_table_filter are non-NULL); optional only_successful filter.
  RETURN QUERY
    SELECT
      a.id,
      a.occurred_at,
      a.table_name,
      a.operation,
      a.shop_id,
      a.user_label,
      a.oauth_client_id,
      a.md_content_hash,
      a.rows_added,
      a.rows_modified,
      a.rows_deactivated,
      a.error_message,
      a.diff_summary,
      a.pre_state_snapshot,
      a.snapshot_pruned_at,
      a.successor_revert_id,
      a.reverts_upload_id
    FROM public.scheduler_admin_audit_log a
    WHERE
      a.shop_id = p_shop_id
      AND a.occurred_at >= now() - INTERVAL '30 days'
      -- Surface filter — conditional COALESCE fallback per ADR-021 Part 1.
      -- Modern rows (post-v0.5): match precision via diff_summary->'surfaces' ? p_surface_filter
      -- Legacy rows (pre-v0.5 OR NULL diff_summary): fall back to table_name = p_table_filter
      -- When BOTH p_surface_filter AND p_table_filter are NULL → no-filter mode (entire WHERE branch is TRUE).
      AND (
        p_surface_filter IS NULL
        OR
        (COALESCE(a.diff_summary ? 'surfaces', FALSE)
           AND a.diff_summary->'surfaces' ? p_surface_filter)
        OR
        (NOT COALESCE(a.diff_summary ? 'surfaces', FALSE)
           AND a.table_name = p_table_filter)
      )
      -- only_successful filter
      AND (NOT p_only_successful OR a.error_message IS NULL)
    ORDER BY a.occurred_at DESC
    LIMIT p_limit;
END $$;

-- ─── ADR-005 outer-callable entry point — GRANT TO service_role ─────────
-- This is the 7th outer-callable entry point in the feature (after
-- revert_md_upload_attempt + the 5 apply_*_upload RPCs). The service_role
-- grant is what orchestrator-mcp's listSchedulerAdminAuditLog tool uses
-- to invoke this from edge-function context.
REVOKE EXECUTE ON FUNCTION public.list_scheduler_admin_audit_log_filtered(INTEGER, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_scheduler_admin_audit_log_filtered(INTEGER, TEXT, TEXT, BOOLEAN, INTEGER) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.list_scheduler_admin_audit_log_filtered(INTEGER, TEXT, TEXT, BOOLEAN, INTEGER) TO service_role;

COMMENT ON FUNCTION public.list_scheduler_admin_audit_log_filtered(INTEGER, TEXT, TEXT, BOOLEAN, INTEGER) IS
  'E7 list_scheduler_admin_audit_log RPC — returns up to p_limit raw audit_log rows for the caller shop within the 30-day cutoff. Optional surface filter uses ADR-021 conditional COALESCE fallback: modern rows match via diff_summary->surfaces precision; legacy rows fall back to table_name. When p_surface_filter IS NULL → no-filter mode (caller fetches all surfaces). Read-only — no audit row written. Per-row revert_eligibility is computed TS-side by the wrapper (cheap predicates per ADR-021 §"Cheap-eligibility computation predicates"). Outer-callable per ADR-005 (service_role grant); read-only function so ADR-002 attempt-row contract does not apply.';

-- ════════════════════════════════════════════════════════════════════════
-- END E7 RPC migration
-- ════════════════════════════════════════════════════════════════════════
