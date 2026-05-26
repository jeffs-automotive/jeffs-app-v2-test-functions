# ADR-015: Absent-key TOCTOU honest analysis + Phase 1.5 deferral

**Status:** Accepted (2026-05-26) — Known residual risk; deferred fix per SEC-15
**Supersedes:** v0.5+IMPORTANTs over-optimistic analysis that claimed canonical drift detection closed the race for all snapshot_kinds. Distilled from X-FIX-#9 (over-optimistic) → X-FIX-#25 (honest rewrite) + cross-verify rounds 2+3 (GPT chunks 3+4 BLOCKERs).
**Superseded by:** (none — when Phase 1.5 ships with advisory key-namespace locks for all kinds, a new ADR will supersede this)

## Context

`SELECT … FOR UPDATE` locks ROWS, not the KEY NAMESPACE. If a row is ABSENT at lock time, no lock is acquired on that key — a concurrent transaction can INSERT into the gap between the inner RPC's step-4 lock and the handler's UPSERT/DELETE.

The race window the earlier (v0.5+IMPORTANTs X-FIX-#9) analysis missed: when the ORIGINAL upload DELETED a row, the post-upload canonical state expects that row absent. Revert dry-run observes absent. Apply step 4 lock acquires nothing (no row to lock). Step 5 canonical compute observes absent (matches expected). Step 6 hash check passes. A concurrent transaction INSERTs a row at that key between step 6 and the handler's UPSERT-restore. The handler's `ON CONFLICT (id) DO UPDATE WHERE shop_id = p_shop_id` silently overwrites the concurrent insert. Canonical drift detection cannot catch this because BOTH observations showed "absent" — the concurrent insert happens AFTER step 5.

The prior analysis over-credited canonical drift detection. This ADR records the honest per-kind status and the rationale for shipping Phase 1 with the residual gap.

## Decision

Phase 1 ships with the following per-kind protection status. Two cases ARE OPEN and will not be closed in Phase 1. Operational risk is bounded by the current single-shop / single-admin-at-a-time deployment profile and forensics monitoring in the audit log.

| Kind / path | Status | Why |
|---|---|---|
| `closed_dates_future` (apply + revert) | **CLOSED** | Explicit per-`(shop_id, date)` advisory locks per ADR-013. Protects the key namespace, not just rows. Two-sided lock acquisition. |
| Hard-DELETE handlers on existing rows OR on `added_keys` (CCG, ADL revert paths) | **CLOSED** | Row exists at lock time AND the table's natural composite unique constraint (CCG `(shop_id, category)`; ADL `(shop_id, day_of_week)`) prevents concurrent INSERT of a colliding row — Postgres index lock fires `23505 unique_violation` → concurrent transaction rolls back. |
| UPSERT-from-`before` where row was concurrently HARD-DELETED between dry-run and apply | **CLOSED** | Canonical hash at step 5 includes row presence/absence; concurrent DELETE changes row count → step-6 hash compare diverges → `current_state_drift` RAISE. |
| **UPSERT-restore-of-originally-DELETED-row** | **OPEN** | Both dry-run and step-5 observe "absent" (which IS the expected post-upload state). Step-6 hash passes. Concurrent INSERT between step 6 and handler UPSERT → handler silently overwrites via `ON CONFLICT (id) DO UPDATE WHERE shop_id = p_shop_id`. Canonical drift detection cannot catch this. |
| **Apply-RPC INSERT of a NEW key** | **OPEN** | Apply RPC locks rows from `p_snapshot.before` (pre-upload existing rows); NEW-key INSERTs from `p_diff.added` have no pre-existing row to lock. Concurrent INSERT of the same key races with apply's INSERT → `ON CONFLICT (id) DO UPDATE` silently overwrites. |

**Affected paths for the two OPEN cases:** the 4 non-closed_dates apply RPCs (`apply_concern_questions_flat_upload`, `apply_concern_category_upload`, `apply_concern_category_guideline_upload`, `apply_appointment_default_limits_upload`) AND their revert counterparts. `closed_dates` is structurally immune via ADR-013.

**Proper fix (deferred to Phase 1.5 — SEC-15):** extend `lock_targets_for_kind` (ADR-024) to take advisory key-namespace locks for ALL kinds, not just `closed_dates_future`. Same surgery for the 5 apply RPCs. Total: 9 helper branches + 5 apply RPCs = 14 sites + per-kind sorted-key acquisition order to avoid deadlocks + concurrent-insert race tests for each kind. Estimated effort: ~50-100 lines of new SQL.

**Why deferred (not landed in Phase 1):**

- Operational risk is bounded by the current deployment profile: single shop (Jeff's Automotive, `shop_id=7476`), single admin at a time. Same-shop concurrent uploads of the same surface are operationally rare; admins coordinate sessions out-of-band.
- The natural-key conflict-target pattern (Invariant 1's preferred alternative — `ON CONFLICT (shop_id, …)`) shrinks the race for tables with tenant-scoped unique keys (concern_subcategories, concern_category_guidelines).
- Adding ~14 sites of SQL + tests to Phase 1 expands the BLOCKER fix surface for the first deploy; Phase 1.5 lands after Phase 1 burns in and either confirms the race materializes (priority) or confirms it doesn't (lower priority).

## Consequences

**Phase 1 has known open race surface.** The two OPEN cases above can cause silent data corruption if a concurrent same-shop INSERT races with our apply or revert on the SAME natural key between step 6 (hash check) and the handler's UPSERT/INSERT. `ON CONFLICT (id) DO UPDATE WHERE shop_id = p_shop_id` will silently overwrite the concurrent insert; no exception is raised; canonical drift detection cannot retroactively detect it.

**Phase 1 race-incident forensics.** Audit-log row content carries enough metadata to detect post-hoc silent overwrites:
- Unexpected `revert_audit_log_id` chain — a successful revert whose `expected_after_state_canonical` doesn't match what you would expect from the original apply's `expected_after_state_canonical`.
- Two close-in-time apply rows for the same `table_name` + same `shop_id` where the second's `pre_state_snapshot` shows a row not in the first's `expected_after_state_canonical`.

If ANY silent-overwrite incident is observed in production after Phase 1 ships, SEC-15 implementation is expedited — the race materialized.

**Future-reader requirement.** Any new handler kind added to this system must EITHER (a) take advisory key-namespace locks (matching ADR-013's pattern for closed_dates), OR (b) explicitly document why the per-kind race is structurally closed (natural unique constraint protection like CCG / ADL). Adding a kind that fails both criteria without documentation re-opens this gap silently and erodes the audit-log forensics signal (a real silent overwrite becomes indistinguishable from a normal apply of the new kind).

**What Phase 1.5 will deliver.** A new ADR will supersede this one once the advisory key-namespace lock extension lands across all kinds + apply RPCs, with the per-kind sorted-key acquisition order documented as the deadlock-avoidance contract.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.2 Invariant 2 "Absent-key TOCTOU analysis (REWRITTEN …)" — the honest-rewrite section with the per-kind table verbatim and deferral rationale.
- Deferred follow-up: `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` SEC-15 (Phase 1.5 — extend `lock_targets_for_kind` advisory locks to all kinds + 5 apply RPCs).
- Related ADRs: ADR-012 (lock-targets-before-staleness — establishes the helper call ordering), ADR-013 (closed_dates advisory lock — the ONE kind that already closes the race), ADR-024 (`lock_targets_for_kind` helper — where Phase 1.5 fixes will land).
