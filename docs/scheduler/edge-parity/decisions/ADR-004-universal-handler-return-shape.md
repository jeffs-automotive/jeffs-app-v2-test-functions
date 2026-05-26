# ADR-004: Universal handler return shape

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.3 3-column shape `(restored INT, deactivated INT, deleted INT)`. Distilled from X-FIX-AGENT-C + cross-verify chunk-3 X-RETURN-SHAPE BLOCKER findings.
**Superseded by:** (none)

## Context

The inner RPC dispatches to one of 10 per-`snapshot_kind` revert handlers via a single CASE block that invokes every handler through the same `SELECT * INTO v_stats FROM <handler>(p_shop_id, v_snapshot)` pattern. A non-uniform return shape would force the CASE arms to coerce per-kind types into a common local variable, multiplying maintenance cost every time a handler's metadata surface evolves.

The v0.3 3-column shape `(restored INT, deactivated INT, deleted INT)` proved insufficient when `revert_closed_dates_future` needed to surface `skipped_past_dates` arrays back to the operator — there was no carrier for typed handler-specific metadata. Per-kind composite return types or a separate normalizer layer were considered and rejected; both pushed complexity into the dispatch site and broke the symmetric CASE pattern.

The chosen alternative is a single shared return shape with a typed JSONB extension slot.

## Decision

Every per-`snapshot_kind` revert handler returns `TABLE(restored INT, deactivated INT, deleted INT, details JSONB)`. The 4th `details` column is the typed metadata carrier.

- 9 of 10 handlers return `'{}'::JSONB` for `details` — zero-cost no-op.
- Only `revert_closed_dates_future` populates it, with `{skipped_past_dates_restore: [...], skipped_past_dates_delete: [...]}` per the past-date-immutability invariant (the handler skips dates that have drifted into the past since the original upload).
- The inner RPC's audit-row INSERT merges `v_stats.details` into `diff_summary` via JSONB concat, with `COALESCE` guarding against a NULL details column nulling out the whole `diff_summary`:

```sql
INSERT INTO public.scheduler_admin_audit_log (..., diff_summary)
VALUES (
  ...,
  jsonb_build_object(
    'restored',    v_stats.restored,
    'deactivated', v_stats.deactivated,
    'deleted',     v_stats.deleted
  )
  || COALESCE(v_stats.details, '{}'::JSONB)
);
```

Operators querying the audit log see handler-specific metadata under `audit_log.diff_summary.<handler-key>` alongside the standard restored/deactivated/deleted counts.

**Boundary with the attempt-row `metadata` column (per ADR-020):** these are SEPARATE surfaces. Handler `details` flows into the AUDIT-ROW's `diff_summary` and records WHAT the revert did to the data. The attempt-row's `metadata JSONB NULL` is owned by the outer RPC and records HOW the revert attempt was processed (observability). The inner RPC NEVER writes to the attempt table's `metadata` column directly.

## Consequences

- Forward-compatible: future handlers (FK-resolution hints, dropped-row notices, partial-completion flags, integrity warnings) can surface their own metadata without a signature-change cascade across the dispatch CASE, the inner RPC's audit-row INSERT, and every existing handler.
- The dispatch CASE block stays symmetric — one `SELECT * INTO v_stats` shape for every kind.
- The audit-log merge is a one-line JSONB concat with a defensive `COALESCE`.
- Cost: the uniform 4-column signature is carried by 9 handlers that never populate `details`. This is judged acceptable — `'{}'::JSONB` is effectively free, and the alternative (per-kind shape divergence) is the explicit anti-goal.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.2 Invariant 7 (return-shape contract) + §8.2 `revert_closed_dates_future` handler (sole populator of `details`)
- Related ADRs: ADR-001 (outer/inner split — dispatch CASE block lives in the inner RPC); ADR-020 (attempt-row `metadata` column boundary)
