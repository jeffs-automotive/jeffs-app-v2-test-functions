# ADR-013: closed_dates per-date advisory lock — 2-arg 64-bit-key form

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 single-arg `pg_advisory_xact_lock(hashtext('closed_date:' || shop_id || ':' || closed_date))` (32-bit key, vulnerable to cross-pair collision). Distilled from cross-verify round 3 (GPT chunk 4 BLOCKER: "closed_dates apply path advisory lock 1-arg vs 2-arg contradiction").
**Superseded by:** (none)

## Context

`closed_dates` mutations (admin uploads + reverts of those uploads) target a key namespace defined by `(shop_id, closed_date)`. The dangerous scenario is a *phantom insert*: two concurrent operations both compute "no row exists for date D" because the row isn't there yet, then both proceed to INSERT. Per-row `SELECT … FOR UPDATE` cannot block this — there is no row to lock. The only way to serialize key-namespace mutations is to take an advisory lock on the key itself before checking presence and before writing.

The legacy v0.5 form was a SINGLE-ARG advisory lock: `pg_advisory_xact_lock(hashtext('closed_date:' || p_shop_id::TEXT || ':' || closed_date::TEXT))`. That packs the entire compound key into one 32-bit `hashtext` value. Two unrelated `(shop_id, date)` pairs that collide in the 32-bit hash space then block each other unnecessarily, and — more concerning — cross-tenant collisions become possible at scale.

The canonical form is the TWO-ARG variant `pg_advisory_xact_lock(int4, int4)`, which uses two 32-bit ints as the combined 64-bit key. Putting `shop_id` in the high 32 bits makes cross-tenant collisions structurally impossible; the low 32 bits hold the date hash, scoping any residual collision to a single tenant.

## Decision

Both the apply path (`apply_closed_dates_upload`) AND the revert handler (`revert_closed_dates_future`) acquire **(1) `lock_surface_for_kind(p_shop_id, 'closed_dates_future')` FIRST per ADR-024** (Phase 1 surface lock — closes the whole-future-window canonical-read drift class), **(2) THEN per-date advisory locks** via the 2-arg form, for every date in the operation set, in sorted-date order:

```sql
-- For EVERY date in the operation set:
--   apply path:  p_diff.added ∪ modified ∪ deactivated
--   revert path: snapshot.before keys ∪ snapshot.added_keys
--
-- Sorted ascending to prevent deadlocks against overlapping mutators.
--
-- CRITICAL: must be a PL/pgSQL FOR LOOP. A `PERFORM fn(...) FROM (SELECT ... ORDER BY)`
-- form does NOT guarantee execution order — Postgres's executor is free to evaluate
-- volatile functions in any sequence, and the ORDER BY only orders the result
-- relation, not embedded function-call evaluation. The FOR LOOP is the only
-- canonical pattern that guarantees lock acquisition follows sort order, which
-- is the property the deadlock-avoidance argument depends on.
DECLARE
  v_date DATE;
BEGIN
  FOR v_date IN
    SELECT d
    FROM unnest(v_dates_array) AS d
    ORDER BY d ASC
  LOOP
    PERFORM pg_advisory_xact_lock(
      p_shop_id::INT,              -- high 32 bits: tenant scope
      hashtext(v_date::TEXT)       -- low 32 bits:  date hash
    );
  END LOOP;
END;
```

Date rendering uses `v_date::TEXT` (Postgres default `YYYY-MM-DD` for DATE, locale-independent in the project's session config). For extra hardening against future DateStyle drift, `to_char(v_date, 'YYYY-MM-DD')` may be substituted; the cast suffices today.

## Consequences

Apply and revert are now fully two-sided serialized at the key-namespace level: every mutator on `(shop_id, date)` waits on the same advisory lock, so phantom-insert races are closed even when no row yet exists. Cross-shop collisions are structurally impossible — the high 32 bits of the lock key always hold the tenant id, so two different shops can never contend on the same advisory lock. Within a single shop, two different dates can in theory collide on the 32-bit `hashtext` of the date string, but the contention window is limited to one tenant and is bounded by the per-RPC transaction lifetime.

Sorted-date acquisition order prevents the classic deadlock where transaction A holds date D1 and waits for D2 while transaction B holds D2 and waits for D1. Both order ascending, so the second arrival queues behind the first cleanly.

Cost is one `pg_advisory_xact_lock` call per date per transaction — cheap (in-memory hash table in shared memory), automatically released at transaction end. No DB schema changes required.

Forward-looking guard: every FUTURE code path that mutates `closed_dates` (admin tools, cron jobs, edge functions, server actions) MUST adopt this exact lock form before touching a `(shop_id, date)` row. One-sided serialization re-opens the phantom-insert window. Tracked in `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` SEC-12.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §5.5 "Per-date advisory locks (NOT just FOR UPDATE)" + §8.3 `lock_targets_for_kind` `closed_dates_future` branch (lines 3348, 3544-3545)
- Deferred follow-up: `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` SEC-12 (forward-looking guard)
- Related ADRs: ADR-012 (lock-targets-before-staleness — step 4 calls this lock), ADR-024 (`lock_targets_for_kind` helper)
