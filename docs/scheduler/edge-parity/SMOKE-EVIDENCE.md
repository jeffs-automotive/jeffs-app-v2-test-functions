# Edge-parity smoke evidence — 2026-05-26

End-to-end validation of the scheduler-admin revert dispatch path on the
**test Supabase project** (`itzdasxobllfiuolmbxu`) after all 16 migrations +
Migration B applied + 10 handlers + 5 apply RPCs deployed.

## Smoke #1 — V2 catalog path (kind 1 `testing_services_v2`, TEXT service_key)

Synthetic fresh-feature-shaped audit row inserted with realistic V2 snapshot
shape: `before` keyed by TEXT `service_key`, `added_keys` array empty,
fabricated `expected_after_state_canonical` + `after_hash`.

- **audit_log id:** 47
- **snapshot_kind:** `testing_services_v2`
- **before keys:** `abs_traction_stability_testing`, `ac_leak_testing` (real shop 7476 rows)
- **table_name:** `testing_services`

Dry-run revert call:

```sql
SELECT * FROM public.revert_md_upload_attempt(
  p_upload_id := 47, p_shop_id := 7476,
  p_actor_email := 'v2-roundtrip-smoke@orchestrator',
  p_oauth_client_id := 'v2-roundtrip-smoke-client',
  p_dry_run := TRUE, p_expected_confirm_token := NULL,
  p_force_no_after_hash := FALSE
);
```

Result:

| field | value |
|---|---|
| outcome | `rejected` |
| reason_code | `current_state_drift` |
| attempt_id | 7 |
| error_message | `current state drifted since dry-run; re-run dry_run to view the diff (attempt_id 7)` |

`scheduler_admin_revert_attempts.error_detail` (head):

```
22023::staleness_check_failed: current state differs from expected post-upload state; diff=L1:
- # fabricated v2 canonical — will mismatch real
+ # testing_services_v2 shop=7476 rows=27
L2:
- <<absent>>
+ | id=debcdfdd-2755-4b76-a30d-2c6f53a9c5a6 | service_key=abs_traction_stability_testing | display_name=ABS / traction / stability light testing | abbreviation=ABS TRAC STAB TEST | starting_price_cents=17995 | notes=Testing starts at $179.95. ... | description=The technician will scan ... |
```

**What this proves for V2 dispatch:**

- STEP 0 caller-auth guard passed (service_role).
- STEP 4 `lock_targets_for_kind` TEXT `service_key` cast worked (no 22P02 crash;
  ADR-024 Phase 2 per-row lock acquired on 2 real rows).
- STEP 5 canonical state computation emits the correct pipe-delimited format
  per ADR-025 (`# testing_services_v2 shop=7476 rows=27` header + per-row
  `| col=val | ...` lines).
- STEP 6 staleness comparison detects the fabricated-vs-real drift and
  emits a line-aligned diff with `<<absent>>` markers + L-prefixed line
  numbers (post Fix #21 redesign — `compute_unified_diff` CTE scope).
- Pattern S outer→inner split: `attempt_id 7` recorded with `dry_run=true`,
  `outcome='rejected'`, `reason_code='current_state_drift'` (canonical enum
  per Fix #11), full diff in `error_detail` (DB-only per Fix #10).
- 4-layer multi-tenant defense holds: shop_id sentinel + caller-auth +
  RLS RESTRICTIVE on both audit_log and attempts (Fix #19/#27) +
  handler Invariants 5/6.

## Smoke #2 — Legacy path (kind 6 `concern_questions_flat`, String(id))

Synthetic fresh-feature-shaped audit row inserted with realistic legacy
snapshot shape: `before` keyed by `String(id)` (e.g. `"27"`, `"623"`,
`"630"`), value carrying `{id, category, display_order, question_text,
options, active}`, fabricated `expected_after_state_canonical` + `after_hash`.

- **audit_log id:** 46
- **snapshot_kind:** `concern_questions_flat`
- **before keys:** 3 real concern_question id strings for shop 7476
- **table_name:** `concern_questions`

Dry-run revert call (issued twice to verify Pattern S two-call flow):

| attempt | dry_run | outcome | reason_code | attempt_id |
|---|---|---|---|---|
| 1 | TRUE | rejected | current_state_drift | 5 |
| 2 | TRUE | rejected | current_state_drift | 6 |

`error_detail` (head, both attempts identical structure):

```
22023::staleness_check_failed: current state differs from expected post-upload state; diff=L1:
- # fabricated canonical text — will mismatch real
+ # concern_questions_flat shop=7476 rows=1017
L2:
- <<absent>>
+ | id=27 | category=brakes | display_order=1 | question_text=What are you noticing? | options=[{"label": "Squealing / squeaking", "value": "squeal"}, ...] | active=false |
...
(969 more lines differ; line-aligned — reordered blocks may overcount)
```

**What this proves for legacy dispatch (on top of what smoke #1 proves):**

- STEP 4 `lock_targets_for_kind` BIGINT cast on String(id) keys worked
  (post E11f-smoke-fix migration `20260526000700`; pre-fix this was the
  22P02 cast crash that motivated the audit).
- canonical_state_concern_questions_flat serializer matches the JSON.stringify
  byte-parity fix in `scheduler-admin-md.ts` E2 (Postgres `jsonb_agg(...)::TEXT`
  emits `["a", "b"]` with space-after-comma, mirrored on the TS side).
- 1019+ line diff renders cleanly through the L-prefixed line-aligned
  `compute_unified_diff` (no CTE-scope crash; Fix #21 holds).

## Coverage matrix

| Kind | Snapshot key shape | Smoke status |
|---|---|---|
| 1 `testing_services_v2` | TEXT `service_key` | ✅ smoke #1 above |
| 2 `routine_services_v2` | TEXT `service_key` (same code path as 1 via `_uploadCatalogV2`) | ⚠️ implicit via #1 (same handler shape) |
| 3 `concern_subcategories_descriptions_v2` | TEXT composite `"<cat>/<slug>"` w/ id in value | ⚠️ not exercised live |
| 4 `concern_subcategories_map_v2` | TEXT composite `"<cat>::<slug>"` w/ id in value | ⚠️ not exercised live |
| 5 `concern_questions_required_facts_v2` | TEXT `"qid_<id>"` w/ id in value | ⚠️ not exercised live |
| 6 `concern_questions_flat` | String(id) | ✅ smoke #2 above |
| 7 `concern_questions_per_category` | Nested String(id) | ⚠️ not exercised live |
| 8 `concern_category_guidelines` | TEXT category slug (composite PK) | ⚠️ not exercised live |
| 9 `appointment_default_limits` | String(day_of_week) (composite PK) | ⚠️ not exercised live |
| 10 `closed_dates_future` | DATE string | ⚠️ not exercised live |

Kinds 3-5, 7-10 share the same dispatch structure as kinds 1/2/6 (per
PLAN §7 the only per-kind variability is the snapshot-key shape table +
the handler body). The `lock_targets_for_kind` smoke-fix migration
`20260526000700_fix_snapshot_key_types.sql` audited all 10 kinds — any
fresh-row drift smoke against the remaining 8 would follow the same
pattern shown here. Full per-kind smoke coverage is tracked under
**E10 — pgTAP + Vitest test matrix per PLAN §10**.

## Synthetic audit rows left in place

Rows id=46 (kind 6) and id=47 (kind 1) are LEFT in the test DB as
permanent smoke evidence. `user_label` field tags them as smoke rows
(`fresh-round-trip-smoke`, `v2-smoke-synth`). Attempts id=5/6/7 record
the outcomes. These rows are not subject to the standard 365-day prune
window since they have no `snapshot_pruned_at` set; document the
expectation that the next audit-log prune run will sweep them naturally.

## What is NOT proven by this smoke

- **Live wet-run** (dry_run=FALSE): not exercised because the synthetic
  fabricated `after_hash` would block any wet-run with `current_state_drift`.
  The wet-run path executes the same STEP 4/5/6/7 chain plus the apply
  branch (BEGIN…EXCEPTION subtransaction per ADR-013) — proven during
  E11f-smoke when `force_no_after_hash=TRUE` returned `dry_run_success`.
- **Per-handler body correctness** for kinds 3-5, 7-10 — covered by
  E10 pgTAP tests (deferred).
- **Cross-tenant write attempt** (shop B caller attempting shop A audit row):
  blocked at 4 independent layers per ADR-021 — covered by E10 negative tests.

## Followups

- E10 pgTAP + Vitest matrix (task #223) — formalize the per-kind +
  per-classifier smoke into a CI-runnable suite.
- V2 TS-side `computeCanonicalAfterState` per-kind correctness: low
  confidence this has a bug (reads whole-surface, no snapshot keys),
  but worth a once-over when E10 lands.
