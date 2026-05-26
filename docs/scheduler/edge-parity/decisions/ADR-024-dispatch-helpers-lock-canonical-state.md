# ADR-024: Dispatch helpers — lock_targets_for_kind + canonical_state_<kind> + compute_current_canonical_for_kind

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 `lock_targets_for_kind` branches that had bugs in `concern_category_guidelines` (UUID PK assumption + scalar `before` misread) and `appointment_default_limits` (missing `added_keys` AND prior "UUID PK" misclassification — corrected 2026-05-26: composite PK `(shop_id, day_of_week)`). Distilled from prior fix rounds + cross-verify rounds 1-3. ADR-Fix #7 (2026-05-26) added the mandatory Phase 1 surface lock to close the lock-scope-vs-canonical-read-scope mismatch flagged by Gemini chunk-2 BLOCKER.
**Superseded by:** (none — but ADR-015's Phase 1.5 SEC-15 fix will extend the Phase 2 per-row locks with per-key advisory key-namespace locks for all non-closed_dates kinds; the new Phase 1 surface lock partially mitigates SEC-15 by serializing the broader surface-write class)

## Context

The inner revert RPC (`revert_md_upload_apply`) dispatches across 10 `snapshot_kind` values to lock target rows, compute current canonical state, and call per-kind handlers. Three helper families collaborate to make this work:

1. `lock_targets_for_kind` — acquires row + advisory locks at step 4 of the inner RPC (per ADR-012, BEFORE the staleness check at step 6) so the canonical-current read at step 5 sees a snapshot that no concurrent writer can mutate.
2. `compute_current_canonical_for_kind` — at step 5, dispatches to one of 10 per-kind canonical-state serializers.
3. `canonical_state_<kind>` — 10 per-kind serializers that read the target table(s) for the snapshot's scope and produce canonical-MD output that matches the apply path's post-mutation serialization byte-for-byte (the parity contract used both for `expected_after_state_canonical` on apply and for staleness comparison on revert).

Centralizing into three helper families keeps the per-kind logic at ONE dispatch site (the inner RPC), instead of scattering it across 10 handlers. Future kinds add one row to each family.

## Decision

FOUR helper families ship in `20260526000100_revert_md_upload_dispatch.sql`, all SECURITY DEFINER per ADR-017 search_path (`pg_catalog, extensions, public, pg_temp`). All four are in the **internal set per ADR-005** — they carry the NO-GRANT variant of the canonical function-execute hardening: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role; NO GRANT TO service_role`. Helpers are reachable ONLY via SECURITY DEFINER ownership chain from one of the 6 outer-callable entry points (per ADR-005 — the outer RPC + 5 apply RPCs). The internal-set rationale: a direct service_role call to (e.g.) `canonical_state_concern_questions_per_category(p_shop_id=X, p_snapshot=...)` would expose cross-shop scheduler state for arbitrary `p_shop_id` without going through the dispatch-controlled tenant flow; `lock_surface_for_kind` from outside the controlled flow could acquire locks for arbitrary surface/shop combinations. The NO-GRANT defense closes both surfaces.

**0. `lock_surface_for_kind(p_shop_id INTEGER, p_kind TEXT) RETURNS VOID` — MANDATORY first call by EVERY surface writer.**

Acquires a single per-`(shop_id, snapshot_kind)` advisory transaction lock that serializes ALL writers to the same surface within a single Postgres transaction. Implementation is trivial:

```sql
CREATE OR REPLACE FUNCTION public.lock_surface_for_kind(
  p_shop_id INTEGER, p_kind TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp AS $$
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'lock_surface_for_kind: p_shop_id must be positive (got %)', p_shop_id
      USING ERRCODE = '22023';
  END IF;
  -- Closed allow-list of 10 canonical snapshot_kinds — same set the dispatch
  -- CASE blocks (lock_targets_for_kind + compute_current_canonical_for_kind)
  -- handle. A typo or stale kind string would hash to a DIFFERENT advisory-lock
  -- slot than other cooperative writers expect, silently failing to serialize.
  -- The allow-list catches the typo at lock-acquisition time, not at staleness-
  -- mismatch time hours later.
  IF p_kind IS NULL OR p_kind NOT IN (
    'testing_services_v2',
    'routine_services_v2',
    'concern_subcategories_descriptions_v2',
    'concern_subcategories_map_v2',
    'concern_questions_required_facts_v2',
    'concern_questions_flat',
    'concern_questions_per_category',
    'concern_category_guidelines',
    'appointment_default_limits',
    'closed_dates_future'
  ) THEN
    RAISE EXCEPTION 'lock_surface_for_kind: p_kind=% is not one of the 10 canonical snapshot_kinds per ADR-024 + PLAN §7 canonical mapping', p_kind
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    p_shop_id::INT,                  -- high 32 bits: tenant scope (cross-shop collisions structurally impossible)
    hashtext('surface:' || p_kind)   -- low 32 bits:  kind-namespaced surface (32-bit hashtext — cross-kind collisions within a shop are unlikely but not structurally impossible; consequence is benign over-serialization, not incorrect writes)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) FROM service_role;
-- NOTE: NO GRANT to service_role per ADR-005 internal-set pattern. Callable
-- ONLY via SECURITY DEFINER ownership chain from outer-callable entry points
-- (outer RPC + 5 apply RPCs). Direct service_role calls are deliberately
-- blocked to prevent arbitrary lock acquisition outside the controlled flow.
```

**Required call sites — load-bearing for staleness-check correctness:**

| Call site | When | Why |
|---|---|---|
| `lock_targets_for_kind` (called by inner revert RPC step 4 per ADR-012) | First action inside the helper, BEFORE per-row/per-key locks | Closes the wider canonical-read-scope drift class. Without this, a concurrent admin write to OTHER rows in the same surface drifts the whole-surface canonical read at step 5. |
| `apply_concern_questions_flat_upload` | First action inside the apply RPC, BEFORE any diff/write | Pattern S apply path. Snapshot kind: `concern_questions_flat`. Apply mutates rows that revert may later read for canonical comparison. |
| `apply_concern_category_upload` | Same | Snapshot kind: `concern_questions_per_category`. Apply writes BOTH concern_subcategories + concern_questions for one category. |
| `apply_concern_category_guideline_upload` | Same | Snapshot kind: `concern_category_guidelines`. Single-row composite-PK apply. |
| `apply_appointment_default_limits_upload` | Same | Snapshot kind: `appointment_default_limits`. |
| `apply_closed_dates_upload` | Same — AND ALSO takes per-date advisory locks per ADR-013 | Snapshot kind: `closed_dates_future`. Whole-future-window canonical read scope requires the surface lock even when the per-date locks cover the specific dates being applied. |
| `lock_surface_for_kind` per ADR-024 + every future writer of these 10 surfaces (admin tools, cron jobs, edge functions) | Same | Tracked as SEC-17 forward-looking guard. |

**Lock acquisition order (MANDATORY across all writers — prevents deadlock).** Every code path MUST take locks in this order: (1) `lock_surface_for_kind` FIRST, (2) THEN per-row / per-key / per-date locks in canonical sorted order (per ADR-013 for closed_dates; per ascending PK for other kinds). A code path that takes per-row locks first and then the surface lock can deadlock against the canonical order. Verified-pattern reference: `lock_targets_for_kind` Phase 1 → Phase 2 sequence below.

**1. `lock_targets_for_kind(p_kind TEXT, p_shop_id INTEGER, p_snapshot JSONB) RETURNS INTEGER`** — runs in TWO phases:

   **Phase 1 (surface lock — MANDATORY for every kind).** Call `lock_surface_for_kind(p_shop_id, p_kind)` as the FIRST action, before any per-row / per-key lock.

   **Why surface lock is mandatory.** Each `canonical_state_<kind>` serializer reads the WHOLE surface for `(p_shop_id)` (or, for `closed_dates_future`, the whole forward window from `original_today`). The staleness check at step 6 of the inner RPC compares that whole-surface canonical against the snapshot's `expected_after_state_canonical` — also a whole-surface artifact. If the lock scope is narrower than the read scope, a concurrent admin can INSERT or DELETE a row OUTSIDE the snapshot's per-row scope between step 4 (lock) and step 5 (canonical read); that change appears in the canonical-current value, makes the staleness comparison mismatch, and surfaces as a `current_state_drift` rejection unrelated to anything the revert touches. The per-`(shop_id, kind)` surface lock serializes COOPERATIVE writers (writers that call `lock_surface_for_kind` first) behind the revert from lock through commit, eliminating the false-positive staleness window for that cooperative set.

   **Lock is COOPERATIVE — explicit Phase-1 scope.** The lock only works for writers that take it. Phase-1-cooperative writers in this feature (REQUIRED to call `lock_surface_for_kind`):
   1. `revert_md_upload_apply` (inner RPC) — via `lock_targets_for_kind` Phase 1
   2. `apply_concern_questions_flat_upload` (NEW Pattern S apply RPC)
   3. `apply_concern_category_upload` (NEW)
   4. `apply_concern_category_guideline_upload` (NEW)
   5. `apply_appointment_default_limits_upload` (NEW)
   6. `apply_closed_dates_upload` (NEW)

   **NOT Phase-1-cooperative — explicit out-of-scope:**
   - The 5 pre-existing V2 TS upload paths (`_uploadCatalogV2` for testing/routine, `uploadSubcategoryDescriptionsMdV2`, `uploadSubcategoryServiceMapMdV2`, `uploadQuestionRequiredFactsMdV2`) DO NOT call `lock_surface_for_kind`. They were authored before Phase 1 and live in TypeScript (orchestrator-mcp tool handlers calling Supabase via service_role). For these surfaces, a concurrent V2 upload during a V2 revert can still drift the whole-surface canonical read → false-positive `current_state_drift` rejection. **Operational mitigation:** the single-admin-at-a-time deployment profile bounds the practical exposure window. **Tracked remediation:** DEFERRED-AUDIT-ITEMS.md SEC-17 explicitly includes V2 uploader retrofit (add a thin RPC wrapper `lock_surface_for_kind` callable from edge function, or migrate V2 uploaders to Pattern-S-style apply RPCs that take the lock).

   Trade-off for Phase-1-cooperative writers: two concurrent admins reverting two different uploads on the same surface now serialize, AND a Pattern-S apply on the same surface serializes behind an in-flight revert (and vice versa) — correct behavior (concurrent overlapping mutations on the same surface are not safe in any case), but operators should expect single-flight throughput per surface per shop while a revert OR Pattern-S apply is in-flight. V2 uploads on a V2 surface during a V2 revert proceed concurrently (no serialization) — see the SEC-17 caveat above.

   **Phase 2 (per-row / per-key locks).** CASE on `snapshot_kind`. Branches whose snapshot CAN include `added_keys` (the `_v2`-versioned per-row UPDATE handlers excluded — those are UPSERT-only across an existing fixed row set) union BEFORE keys ∪ `added_keys` to close the X13 TOCTOU on hard-DELETE paths within the snapshot's row scope. Branches whose snapshot has no concept of adds lock only BEFORE keys. With the Phase 1 surface lock in place, Phase 2's per-row locks are now defense-in-depth (they would also block a concurrent writer that somehow bypassed the surface lock via a future code path that forgot to take it). Lock predicates:

| snapshot_kind | Lock predicate |
|---|---|
| `testing_services_v2` | `testing_services` rows with `id` ∈ before keys ∪ added_keys |
| `routine_services_v2` | `routine_services` rows with `id` ∈ before keys ∪ added_keys |
| `concern_subcategories_descriptions_v2` | `concern_subcategories` rows with `id` ∈ before keys (UPSERT-only — no adds) |
| `concern_subcategories_map_v2` | same |
| `concern_questions_required_facts_v2` | `concern_questions` rows with `id` ∈ before keys |
| `concern_questions_flat` | `concern_questions` rows with `id` ∈ before keys ∪ added_keys |
| `concern_questions_per_category` | BOTH `concern_subcategories` AND `concern_questions`. Locks subcategory ids in subcategories_before + added_subcategory_ids + ALL DISTINCT subcategory_id values referenced in questions_before row values (closes the FK-target-not-in-before lock gap). Plus question ids in questions_before + added_question_ids. |
| `concern_category_guidelines` | `concern_category_guidelines` rows with `category` ∈ before keys ∪ added_keys. NO `id` column — composite PK `(shop_id, category)`. Snapshot is keyed by category slug per §5.3, NOT by a scalar `id`. |
| `appointment_default_limits` | `appointment_default_limits` rows with `day_of_week` ∈ before keys ∪ added_keys (COMPOSITE PK `(shop_id, day_of_week)` — corrected 2026-05-26 after E1b dispatch authoring + E1c-f handler authoring both confirmed the actual schema per migration 20260513000100 line 119. Prior ADR-024 prose said "UUID PK" — that was wrong; the actual implementation in `20260526000100_revert_md_upload_dispatch.sql` `lock_targets_for_kind` Kind 9 branch correctly uses `day_of_week = ANY(v_int_ids::INT[])`. Snapshot keys are day_of_week integers `0..6`. Per ADR-015 + ADR-019 row, the natural composite unique constraint also closes the absent-key TOCTOU class for this surface.) |
| `closed_dates_future` | `pg_advisory_xact_lock(p_shop_id::INT, hashtext(closed_date::TEXT))` for EVERY date in before keys ∪ added_keys, in sorted-date order per ADR-013 |

Implementation notes: `v_int_ids` is `BIGINT[]` (handles both INTEGER PKs and BIGSERIAL without overflow); `v_ids` is `UUID[]` for UUID-PK tables; `v_dates` is `DATE[]` for closed_dates. ELSE branch RAISEs `revert_blocked: snapshot_kind_unknown: ...` (per ADR-007 + ADR-011 — system bug, reclassified to crashed, not rejected). Postgres re-locks idempotently, so the per-category branch's separate locks on subcategories appearing in BOTH `subcategories_before` AND in `questions_before` row values do not double-account in `v_lock_count`.

**2. `compute_current_canonical_for_kind(p_kind TEXT, p_shop_id INTEGER, p_snapshot JSONB) RETURNS TEXT`** — single CASE block dispatching to one of 10 per-kind serializers; ELSE RAISEs `revert_blocked: snapshot_kind_unknown: ...` (same reclassification path as the lock helper).

**3. `canonical_state_<kind>(p_shop_id INTEGER, p_snapshot JSONB) RETURNS TEXT`** — 10 serializers, each reading the target table(s) for the snapshot's scope and emitting canonical MD. Source-of-truth scopes:

| Function | Reads | Mirrors |
|---|---|---|
| `canonical_state_testing_services_v2` | `testing_services` for `(p_shop_id)` (whole-surface) | apply_testing_services post-mutation serializer |
| `canonical_state_routine_services_v2` | `routine_services` for `(p_shop_id)` | apply_routine_services serializer |
| `canonical_state_subcategory_descriptions_v2` | `concern_subcategories.description` cols for `(p_shop_id)` | exportSubcategoryDescriptionsMdV2 |
| `canonical_state_subcategory_service_map_v2` | `concern_subcategories.service_map_*` cols for `(p_shop_id)` | exportSubcategoryServiceMapMdV2 |
| `canonical_state_question_required_facts_v2` | `concern_questions.required_facts` for `(p_shop_id)` | exportQuestionRequiredFactsMdV2 |
| `canonical_state_concern_questions_flat` | All `concern_questions` for `(p_shop_id)` (flat shape) | exportConcernQuestionsMd |
| `canonical_state_concern_category_upload` | `concern_subcategories` + `concern_questions` for `(p_shop_id, category)` per per-category snapshot scope | exportConcernCategoryMd |
| `canonical_state_concern_category_guideline` | `concern_category_guidelines` for `(p_shop_id, <category>)` where `<category>` is derived from `jsonb_object_keys(p_snapshot->'before')` ∪ `p_snapshot->'added_keys'` (CCG snapshot is keyed by category slug per §5.3, NOT a top-level scalar field) | exportConcernCategoryGuidelineMd |
| `canonical_state_appointment_default_limits` | `appointment_default_limits` for `(p_shop_id)` | exportAppointmentDefaultLimitsMd |
| `canonical_state_closed_dates_future` | `closed_dates` for `(p_shop_id)` WHERE `closed_date >= (p_snapshot->>'original_today')::DATE` | exportClosedDatesMd (filtered) |

## Consequences

Single CASE block to maintain per kind; future kinds add one row to each of the three helpers (Phase 2 lock branch + dispatch branch + new serializer). The Phase 1 surface lock is a single uniform statement at the top of `lock_targets_for_kind` — no per-kind variation needed. The byte-parity contract between each `canonical_state_<kind>` and its paired apply-path serializer is load-bearing — any drift (extra trailing newline, different float precision, different sort order) produces false-positive `current_state_drift` rejections on every revert. Tests for these 10 functions live in the pgTAP parity test suite (per the lean PLAN). Without the explicit `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role` triple on every helper function, PostgreSQL grants EXECUTE to PUBLIC by default — these serializers read cross-shop scheduler state, so direct PUBLIC access would be a tenant-isolation leak.

**Concurrency trade-off (load-bearing).** The Phase 1 surface lock serializes ALL writers to the `(shop_id, snapshot_kind)` surface during a revert's lock-through-commit window. Concurrent reverts of two different uploads on the same surface within the same shop will now queue rather than interleave — correct behavior (concurrent overlapping reverts on the same surface are unsafe regardless), but operators should expect single-flight throughput per surface per shop during a revert. Apply paths for the same surface that take the same surface lock will also queue behind an in-flight revert. Apply paths for OTHER surfaces in the same shop are unaffected (kind is part of the lock key). Cross-shop everything is unaffected (shop_id is in the high 32 bits of the advisory lock).

**Honest residual #1 — absent-key race within snapshot scope (SEC-15 deferred).** Even with Phase 1 surface lock + Phase 2 per-row locks, `SELECT … FOR UPDATE` locks ROWS not the KEY NAMESPACE within a snapshot. For UPSERT-restore-of-originally-DELETED-row + apply-INSERT-of-new-key on the 4 non-closed_dates surfaces, the row doesn't exist at lock time → Phase 2's per-row lock acquires nothing for that key. The Phase 1 surface lock now serializes against the most common race (concurrent admin writes to OTHER keys in the surface), but absent-key races WITHIN the snapshot's per-key scope still need the Phase 1.5 SEC-15 fix (per-kind advisory key-namespace locks matching the `closed_dates_future` pattern). ADR-015 documents this; SEC-15 is the targeted fix. The Phase 1 surface lock dramatically reduces the operational severity of SEC-15 by eliminating the wider drift class.

**Honest residual #2 — operator must remember to take the surface lock in any future surface writer.** Any new code path that mutates a surface (admin tools, cron jobs, future apply RPCs for new uploaders, edge functions) MUST also take the per-`(shop_id, kind)` surface advisory lock before mutating, otherwise it bypasses the serialization the revert path depends on. This forward-looking guard is tracked in DEFERRED-AUDIT-ITEMS.md SEC-17 (NEW 2026-05-26, added with ADR-Fix #7) — future surface writers MUST adopt the surface-lock pattern.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.3 `lock_targets_for_kind` helper + per-snapshot_kind canonical-serializer functions table + `compute_current_canonical_for_kind` dispatch
- Cross-verify finding (ADR-Fix #7): `.claude/work/ai-review-2026-05-26T15-08-15Z.md` Gemini chunk-2 BLOCKER "Lock scope is narrower than canonicalization read scope, breaking staleness detection"
- Related ADRs: ADR-012 (lock-targets-before-staleness — step 4 calls `lock_targets_for_kind`, now Phase 1 + Phase 2), ADR-013 (closed_dates 2-arg advisory lock — implemented in the Phase 2 closed_dates_future branch), ADR-015 (absent-key TOCTOU — deferred Phase 1.5 fix extends Phase 2 per-row locks with per-key advisory locks), ADR-018 (RLS RESTRICTIVE on tables; analog function-grant triple lives here), ADR-019 (handler invariants — lock predicate must match conflict-target scope)
- Deferred follow-up: `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` SEC-17 (NEW 2026-05-26 — forward-looking guard: future surface writers must adopt the Phase 1 per-`(shop_id, kind)` surface-lock pattern)
