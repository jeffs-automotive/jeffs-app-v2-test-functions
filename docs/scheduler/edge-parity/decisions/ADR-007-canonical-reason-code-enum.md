# ADR-007: Canonical reason_code enum

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 free-form "trimmed text after prefix" classifier behavior. Distilled from cross-verify rounds 2-3 (GPT chunk 3 BLOCKER "reason_code is not actually Sentry-safe" + Gemini chunks 1+3 IMPORTANT "reason_code populated with sensitive data").
**Superseded by:** (none)

## Context

The outer classifier writes `reason_code` to `revert_attempts` rows, and downstream alerting forwards rows tagged `outcome='crashed'` (and a sampled subset of `'rejected'`) to Sentry. The v0.5 design used `substring(SQLERRM from ':\s*(.*)')` — i.e., everything after the first colon — as `reason_code`. Cross-verify round 2 (GPT) and round 3 (Gemini) both flagged this as a multi-tenant data-leak vector: handler RAISE messages routinely embedded row IDs, customer-supplied free text, FK target values, and snapshot fragments. Any one of those exception messages becomes the Sentry event title and a high-cardinality grouping key.

The fix is a **closed allow-list** of short machine-readable enum values. Verbose human-readable detail still has a home — `error_detail` (`TEXT NULL` per ADR-020 schema, DB-only, never forwarded to Sentry — carries `SQLSTATE:CONSTRAINT_NAME:SQLERRM` concatenation per ADR-009; NOT JSONB despite earlier draft prose) — but `reason_code` itself becomes safe for ingestion, alerting, and CHECK-constraint enforcement.

## Decision

Every `RAISE EXCEPTION 'revert_blocked: ...'` callsite (and the outer classifier's synthesized values) MUST use the format:

```
'revert_blocked: <enum>: <verbose detail>'
```

The outer classifier extracts ONLY `<enum>` via regex `revert_blocked:\s+([a-z0-9_]+)`. Verbose detail after the second colon flows to `error_detail` (DB-only). Unknown enums fall back to `unclassified_revert_blocked` so Sentry alerts fire but no row-specific data escapes through `reason_code`.

The canonical enum allow-list:

| `reason_code` enum | Outcome | Raised by | When |
|---|---|---|---|
| `not_found` | rejected | Inner step 1 | parent audit row not found (or sentinel `shop_id=-1` row) |
| `not_upload_md` | rejected | Inner step 2 | audit row's `operation <> 'upload_md'` |
| `successor_revert_exists` | rejected | Inner step 2 | already-successful revert recorded |
| `snapshot_pruned` | rejected | Inner step 2 | snapshot was pruned by retention cron |
| `no_snapshot` | rejected | Inner step 2 | `pre_state_snapshot IS NULL` |
| `over_30_day_cutoff` | rejected | Inner step 2 | `occurred_at < now() - 30 days` (renamed from `30_day_cutoff` — leading digit broke enum regex) |
| `table_not_supported` | rejected | Inner step 2 | snapshot_kind couldn't be resolved + table not in legacy fallback |
| `snapshot_kind_unknown` | **crashed** (system bug — see ADR-011) | Inner step 9 dispatch ELSE | handler missing for a snapshot_kind that passed step-2 eligibility |
| `dry_run_token_present` | rejected | Inner step 3 | `p_dry_run AND p_expected_confirm_token IS NOT NULL` (caller bug) |
| `cannot_safely_verify` | rejected | Inner step 6 + list-tool eligibility hint (per ADR-021 Part 2) | pre-X-FIX-AGENT-E snapshot has no `after_hash` + no `expected_after_state_canonical`. Attempt-time: + no `p_force_no_after_hash=TRUE`. List-tool surfaces the same enum at query time as an eligibility hint (cheap static check). |
| `cross_shop_hijack_attempt` | rejected | Handler Invariant 5 row-count check | snapshot row count > actual writes (cross-shop conflict skipped) |
| `fk_target_tenant_mismatch` | rejected | Handler Invariant 6 FK pre-validation | snapshot FK target in another shop. NOTE: classifier maps this to canonical `fk_broken` (single enum for ALL FK-related rejections to simplify Sentry grouping + CHECK constraints) |
| `fk_broken` | rejected | Handler post-mutation FK catch + Invariant 6 mapping | FK target deleted via direct DB / non-tracked tool, OR cross-tenant FK target |
| `snapshot_invalid` | rejected | Per-handler input validators | missing/empty required snapshot fields (e.g., `v_category` NULL in per-category handler) |
| `unclassified_revert_blocked` | rejected | Classifier fallback | RAISE message didn't match any canonical enum — surfaces unknown rejection paths to operators |
| `another_revert_in_progress` | rejected | Outer classifier — SQLSTATE 55P03 | parallel revert holding the FOR UPDATE NOWAIT lock |
| `unique_violation` | crashed | Outer classifier — SQLSTATE 23505 (any constraint name except the one partial index) | data-integrity bug |
| `confirm_token_mismatch` | rejected | Outer classifier — prefix `confirm_token_mismatch:` | apply called with stale/wrong token |
| `current_state_drift` | rejected | Outer classifier — prefix `staleness_check_failed:` | canonical state changed between dry_run + apply |
| `NULL` | crashed | Outer classifier — generic ELSE | unexpected exception with no recognizable prefix |

**Enum naming rules:**
- Lowercase + underscore: `[a-z0-9_]+`
- No leading digit (broke the regex extractor): `over_30_day_cutoff`, NOT `30_day_cutoff`
- Short + machine-readable; verbose detail belongs in `error_detail`

**Adding a new enum requires:**
1. Add the row to the table in this ADR
2. Extend the IN(…) allow-list in the §4.4 outer classifier (see ADR-008)
3. Update every handler RAISE callsite to use the canonical format
4. Update the §7.3 `revert_eligibility.reasons` union if the new enum should surface in list-tool eligibility too (see ADR-021)

## Consequences

- **Sentry payloads are safe by construction.** Even if a handler RAISE leaks a row ID or FK value in the verbose-detail tail, that tail goes only to `error_detail` (DB-only). The Sentry-forwarded `reason_code` is one of ~20 known strings.
- **CHECK constraint on `revert_attempts.reason_code`** can enforce the allow-list at the DB layer (defense in depth — a handler that emits an off-list enum is caught at INSERT time, not at alert time).
- **Verbose human-readable detail is preserved.** Operators triaging a single failed revert read `error_detail` from the row; the enum tells the alert system how to group and route.
- **Classifier extraction logic** is specified in ADR-008. Sanitized `error_message` rules are in ADR-009. 3-tier redaction (`reason_code` / `error_message` / `error_detail`) is in ADR-010. The `snapshot_kind_unknown` special case is in ADR-011.
- **Future enum additions are a coordinated change** — touching this ADR, the classifier allow-list, every handler callsite, and the eligibility union must happen together. Drift between any of those four surfaces is a correctness bug.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §3b "Canonical reason_code enum" table
- Related ADRs: ADR-008 (classifier), ADR-009 (sanitized error_message), ADR-010 (3-tier redaction), ADR-011 (snapshot_kind_unknown special case)
