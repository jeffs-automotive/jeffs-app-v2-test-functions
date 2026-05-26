# ADR-021: list_scheduler_admin_audit_log — surface filter + eligibility reasons union

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 over-broad surface filter `WHERE table_name = ? OR diff_summary->'surfaces' ? ?` + 10-reason union including `current_state_drift`. Distilled from X-FIX-#15 + X-FIX-#26 + cross-verify rounds 1-3.
**Superseded by:** (none)

## Context

The `list_scheduler_admin_audit_log` MCP tool exposes filtered audit-log rows with a per-row revert-eligibility hint. Two concerns drove this ADR:

**(1) Logical surfaces share physical tables.** Three logical surfaces share `table_name='concern_subcategories'` (`subcategory_descriptions`, `subcategory_service_map`, `concern_subcategories`) and two share `table_name='concern_questions'` (`question_required_facts`, `concern_questions`). A pure `WHERE table_name = ?` filter overmatches; a pure `WHERE diff_summary->'surfaces' ? ?` filter misses legacy rows that predate the `surfaces[]` column. The v0.5 OR-combination overmatched in the opposite direction — it returned modern rows whose `surfaces[]` did NOT contain the requested surface (because the `table_name` branch fired alongside). Per-surface disambiguation requires conditionally choosing the matching branch based on whether the row has `surfaces[]` populated, with NULL-safety against legacy rows whose `diff_summary` is NULL entirely.

**(2) The list tool's eligibility hint is a STRICT SUBSET of the canonical reason_code enum.** ADR-007 defines the full reason_code enum used by `revert_md_upload_attempt` for authoritative rejection classification. The list tool runs cheap-to-compute pre-flight checks at query time — it cannot perform per-kind canonical-state reads (would be O(N × per-kind compute) across the result set) nor session-scoped checks (confirm-token state lives in a single dry_run/apply pair). The reasons union must therefore EXCLUDE drift-aware + session-scoped reasons; `current_state_drift` in particular CANNOT appear in the list-tool union because it requires reading + canonicalizing target-table state per snapshot_kind.

## Decision

**Part 1 — Surface filter SQL (conditional fallback with COALESCE NULL safety):**

```sql
-- Use $1/$2 positional placeholders (PostgreSQL canonical form). DO NOT use `?` as a
-- placeholder here — `?` is also the JSONB key-exists operator, which causes visual
-- ambiguity AND in some SQL drivers parser-collision when the same statement contains
-- both `diff_summary ? 'surfaces'` (JSONB op) and `?` (placeholder). Explicit
-- `$1`/`$2` removes both concerns.
WHERE
  -- Modern rows: prefer surfaces[] when present.
  (COALESCE(diff_summary ? 'surfaces', FALSE) AND diff_summary->'surfaces' ? $1)
  OR
  -- Legacy fallback: rows without surfaces[] (or NULL diff_summary) match by table_name only.
  (NOT COALESCE(diff_summary ? 'surfaces', FALSE) AND table_name = $2)
```

The two positional placeholders take DIFFERENT values: `$1` = the requested SURFACE verbatim (e.g., `'question_required_facts'`); `$2` = the MAPPED PHYSICAL TABLE NAME (e.g., `'concern_questions'`). The mapping lives in the TS wrapper as `SURFACE_TO_TABLE: Record<SurfaceFilter, string>` covering all 10 logical surfaces (`routine_services`, `testing_services`, `subcategory_descriptions`, `subcategory_service_map`, `question_required_facts`, `concern_questions`, `concern_subcategories`, `concern_category_guidelines`, `appointment_default_limits`, `closed_dates`). Wrapper passes `params = [surfaceFilter, SURFACE_TO_TABLE[surfaceFilter]]`. Why two values: modern rows match on `surfaces[]` precision (logical surface name); legacy rows have no `surfaces[]` so fallback is by `table_name` (physical name) — without the mapping, the fallback branch would never match for shared-table surfaces.

**Part 2 — `revert_eligibility.reasons` union (9 values, STRICT SUBSET of ADR-007 enum):**

`"not_upload_md"` | `"snapshot_pruned"` | `"no_snapshot"` | `"table_not_supported"` | `"upload_failed"` (upload row's `error_message IS NOT NULL` — original upload had a partial-write failure; NOT the v0.5-removed `'failed'` revert-attempt outcome) | `"successor_revert_exists"` | `"over_30_day_cutoff"` (renamed from `30_day_cutoff` per ADR-007 naming rules — no leading digits) | `"shop_id_unknown_pre_migration_backfill"` | `"cannot_safely_verify"` (the same enum ADR-007 lists for the inner-step-6 rejection — the static condition "snapshot lacks BOTH `after_hash` AND `expected_after_state_canonical`" is cheaply discernible from the audit row, so the list-tool surfaces it at query time; the attempt path surfaces the SAME enum at attempt time when the operator did NOT pass `p_force_no_after_hash=TRUE`. Using one enum across both surfaces eliminates the prior `after_hash_check_unavailable` ↔ `cannot_safely_verify` drift flagged in cross-verify chunk 2).

INTENTIONALLY OMITTED from this union (vs. ADR-007 canonical enum) — and why:
- `current_state_drift` — requires per-kind canonical-state read + hash compute; only determinable at revert-attempt time (surfaces via `revert_md_upload_attempt → reason_code='current_state_drift'`).
- `confirm_token_mismatch` — only meaningful within a single dry_run/apply session; not a property of the audit row.
- `cross_shop_hijack_attempt`, `fk_target_tenant_mismatch`, `fk_broken`, `dry_run_token_present`, `snapshot_invalid`, `unique_violation`, `another_revert_in_progress`, `unclassified_revert_blocked`, `not_found`, `snapshot_kind_unknown` — all attempt-time conditions; not statically discernible from the audit row. (`cannot_safely_verify` is the one exception — promoted into the included union per the §"Part 2" note above.)

Cheap-eligibility computation predicates (all CHEAP — audit-row columns + one O(1) successor-revert lookup + inline snapshot_kind resolution against the 10 known kinds + legacy fallback): `operation <> 'upload_md'` → `not_upload_md`; `pre_state_snapshot IS NULL` → `no_snapshot`; `snapshot_pruned_at IS NOT NULL` → `snapshot_pruned`; upload row `error_message IS NOT NULL` → `upload_failed`; `occurred_at < now() - INTERVAL '30 days'` → `over_30_day_cutoff`; `shop_id IS NULL OR shop_id <= 0` → `shop_id_unknown_pre_migration_backfill`; snapshot_kind unresolvable → `table_not_supported`; one follow-up `WHERE reverts_upload_id IN (...)` → `successor_revert_exists`; snapshot present but missing `after_hash` AND `expected_after_state_canonical` → `cannot_safely_verify`.

## Consequences

Modern rows (post-v0.5, every new audit row carries `surfaces[]`) get precision matching via the JSONB `?` operator. Legacy rows (pre-v0.5 OR NULL `diff_summary`) fall back to `table_name`-only matching, which shrinks over time as legacy rows age past the 30-day cutoff. NULL-safety against `diff_summary IS NULL` is handled by `COALESCE(... , FALSE)` (SQL three-valued logic would otherwise reduce the WHERE clause to NULL → false in both branches without the COALESCE, leaving NULL-diff rows uncovered). The UI gets a cheap eligibility hint suitable for enabling/disabling the Revert button without per-row drift compute. The AUTHORITATIVE eligibility answer always comes from calling `revert_md_upload_attempt` directly, which runs the full attempt path and surfaces drift / token-mismatch / attempt-time rejections via ADR-008's classifier. Cost: 2 SQL placeholders instead of 1, plus a 10-entry `SURFACE_TO_TABLE` mapping table maintained in the TS wrapper alongside the `SurfaceFilter` enum.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §7.2 (surface filter SQL + wrapper contract) + §7.3 (output shape + reasons union with subset comment) + §7.4 (eligibility computation — what's cheap vs expensive)
- Related ADRs: ADR-007 (canonical reason_code enum — the superset)
