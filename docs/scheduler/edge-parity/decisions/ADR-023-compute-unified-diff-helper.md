# ADR-023: compute_unified_diff helper (single CTE statement with FILTER aggregate)

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 two-SELECT design that referenced the `numbered` CTE in both statements (PostgreSQL CTEs are scoped to a single statement; second SELECT failed with "relation does not exist"). Distilled from the truncation-count bug fix → CTE scope redesign + cross-verify rounds 2-3.
**Superseded by:** (none)

## Context

Staleness rejections on the revert path need an operator-facing diff body that shows expected-vs-current canonical-MD content so the operator can decide whether to investigate, force-revert, or abandon. The diff is only ever needed on the slow path — i.e., when ADR-014's branch 2 (`after_hash` fast-path) returns inequality, or branch 3 (canonical fallback when `after_hash` is absent but `expected_after_state_canonical` is present) detects mismatch. In the happy case (hash equality) the helper is never called.

The helper has two output requirements that interact: (1) render up to `p_max_lines` differing aligned rows with line-number prefixes; (2) compute the TOTAL count of differing rows so that, if total > emitted, a truncation marker can be appended ("… N more lines differ"). A naive "render then count what was rendered" approach silently loses the total. A naive "two separate SELECTs against the same CTE" approach fails at runtime because PostgreSQL scopes CTEs to a single statement — the second SELECT sees `relation "numbered" does not exist`.

A line-aligned diff (NOT a true unified-diff / LCS / Myers-style alignment) is enough for v0.5 operator triage. True LCS is non-trivial in PL/pgSQL and not worth the cost for a path that fires only on rare staleness rejections; if precision is needed later, the operator can run a TS-side `diff` library against `error_detail` client-side.

## Decision

ONE SELECT against the `numbered` CTE that simultaneously aggregates the truncated rendering and the unfiltered total. The `FILTER (WHERE diff_row <= p_max_lines)` clause on `string_agg` emits only the slice; the unfiltered `COUNT(*)` sees every differing row. Both compute in the same statement, eliminating the CTE-scope error. The truncation marker is appended only when `v_total_diffs > p_max_lines`.

```sql
CREATE OR REPLACE FUNCTION public.compute_unified_diff(
  p_expected TEXT, p_current TEXT, p_max_lines INTEGER DEFAULT 50
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_diff_lines        TEXT;
  v_total_diffs       INTEGER;
  v_truncation_marker TEXT := '';
BEGIN
  WITH expected_lines AS (
    SELECT line, ord FROM regexp_split_to_table(COALESCE(p_expected, ''), E'\n')
      WITH ORDINALITY AS s(line, ord)
  ),
  current_lines AS (
    SELECT line, ord FROM regexp_split_to_table(COALESCE(p_current, ''), E'\n')
      WITH ORDINALITY AS s(line, ord)
  ),
  aligned AS (
    SELECT COALESCE(e.ord, c.ord) AS ord, e.line AS expected_line, c.line AS current_line
    FROM expected_lines e FULL OUTER JOIN current_lines c ON e.ord = c.ord
    WHERE e.line IS DISTINCT FROM c.line
  ),
  numbered AS (
    SELECT ord, expected_line, current_line,
           row_number() OVER (ORDER BY ord) AS diff_row
    FROM aligned
  )
  -- Single SELECT: FILTER aggregate on string_agg + unfiltered COUNT(*).
  -- Both aggregates compute against the same CTE in one statement.
  SELECT
    string_agg(
      format(E'L%s:\n- %s\n+ %s', ord,
             COALESCE(expected_line, '<<absent>>'),
             COALESCE(current_line,  '<<absent>>')),
      E'\n' ORDER BY ord
    ) FILTER (WHERE diff_row <= p_max_lines),
    COUNT(*)
  INTO v_diff_lines, v_total_diffs
  FROM numbered;

  IF v_total_diffs > p_max_lines THEN
    v_truncation_marker := format(
      E'\n... (%s more lines differ; line-by-line — reordered blocks may overcount)',
      v_total_diffs - p_max_lines);
  END IF;

  RETURN COALESCE(v_diff_lines, '<<no differences detected (NULL-vs-NULL or both empty)>>')
         || v_truncation_marker;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) TO service_role;
```

The function lives in the dispatch migration (`20260526000100_revert_md_upload_dispatch.sql`) alongside the inner RPC and `lock_targets_for_kind`.

## Consequences

CTE scope error fixed — single statement, runtime-safe. Truncation marker actually fires because `COUNT(*)` (no FILTER) sees the unfiltered total even though `string_agg` only renders the slice. The diff is honestly framed as line-aligned (not true LCS): an insertion at line 1 makes every subsequent line "differ" because line numbers shift, and the count reflects that mis-alignment rather than semantic drift. The function name `compute_unified_diff` is retained for backward compatibility with prior plan revisions; documentation here is the load-bearing description of what it actually does. Only the slow path pays the diff-computation cost — happy-case reverts (hash equality) never call the helper. Output is informational only and flows to `scheduler_admin_revert_attempts.error_detail` per ADR-010 redaction policy (DB-only); NEVER to Sentry tags and NEVER to the public-facing `error_message`. `COALESCE` on NULL inputs prevents crashes on pre-CV2-B3 snapshots that may carry only the hash without canonical content.

## Sources
- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.3 `compute_unified_diff` helper (the post-CTE-scope-redesign REVISED block with the FILTER aggregate; honest-framing prose for line-aligned vs LCS)
- Related ADRs: ADR-014 (force_no_after_hash 3-branch — branches 2 + 3 call this helper), ADR-010 (redaction — output goes to error_detail only)
