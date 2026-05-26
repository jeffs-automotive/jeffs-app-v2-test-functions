# ADR-019: Handler invariants — UPSERT pattern + row-count check + FK tenant validation

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.3 "shop_id enforcement is SUFFICIENT" framing where `ON CONFLICT (id) DO UPDATE SET shop_id = p_shop_id` could HIJACK a foreign-shop row. Distilled from X-FIX-AGENT-B + cross-verify rounds 1+2 (GPT BLOCKER X7 + IMPORTANT "Snapshot tampering protection is overstated").
**Superseded by:** (none)

## Context

Multi-tenant write safety in the revert handlers cannot rest on a single rule. A tampered or corrupted snapshot can attack the system along three independent surfaces:

1. **The conflict-target surface.** A snapshot row's `id` may already exist in ANOTHER shop's row. A naive `ON CONFLICT (id) DO UPDATE SET shop_id = p_shop_id` HIJACKS that row into the caller's tenant.
2. **The silent-skip surface.** A handler that defends by skipping cross-shop conflicts (correct) but says nothing when it does (wrong) leaves the operator unaware that a snapshot tampering attempt was just blocked.
3. **The FK-reference surface.** Postgres FK constraints enforce EXISTENCE of the referenced row but NOT TENANT-correctness. A tampered snapshot carrying a `subcategory_id` pointing at another shop's subcategory passes per-row FK validation while producing a new row in our shop that references an out-of-tenant parent.

Three invariants — applied TOGETHER on every handler — close all three surfaces. None can be removed without re-opening one of them.

## Decision

### Invariant 1 — UPSERT pattern (WRONG vs RIGHT)

WRONG pattern (v0.3 — DO NOT do this):
```sql
INSERT INTO testing_services (id, shop_id, name, ..., active)
SELECT (rec->>'id')::UUID, p_shop_id, rec->>'name', ..., (rec->>'active')::BOOLEAN
  FROM jsonb_each(p_snapshot->'before') AS s(key, rec)
ON CONFLICT (id) DO UPDATE SET
  shop_id = p_shop_id,                  -- ← HIJACKS another shop's row if id collides
  name = EXCLUDED.name, ...,
  active = EXCLUDED.active;
```

The `DO UPDATE SET shop_id = p_shop_id` clause moves a colliding foreign-shop row INTO the caller's shop — the exact opposite of multi-tenant integrity.

RIGHT pattern (v0.4+ — REQUIRED for every handler):
```sql
WITH attempted AS (
  INSERT INTO testing_services (id, shop_id, name, ..., active)
  SELECT (rec->>'id')::UUID, p_shop_id, rec->>'name', ..., (rec->>'active')::BOOLEAN
    FROM jsonb_each(p_snapshot->'before') AS s(key, rec)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, ...,
    active = EXCLUDED.active
    WHERE testing_services.shop_id = p_shop_id   -- ← SKIPS cross-shop conflict-target
  RETURNING 1
)
SELECT count(*) INTO v_actual_writes FROM attempted;
```

The INSERT-clause `shop_id = p_shop_id` ensures NEW rows go to the caller's tenant. The DO UPDATE WHERE clause ensures EXISTING rows in another tenant are NOT hijacked — they are skipped at UPSERT time.

**Preferred alternative — tenant-scoped composite unique key as conflict target.** Several tables already declare composite unique keys including `shop_id`:
- `closed_dates(shop_id, closed_date)`
- `concern_subcategories(shop_id, category, slug)`
- `concern_category_guidelines(shop_id, category)` (composite PK)

When such a key exists, use IT as the conflict target instead of the global `id`:
```sql
ON CONFLICT (shop_id, closed_date) DO UPDATE SET ...
```
This makes cross-shop hijack STRUCTURALLY IMPOSSIBLE: a snapshot row carrying `(shop=A, date=X)` cannot conflict with an existing `(shop=B, date=X)` row because the conflict target keys include `shop_id`.

### Invariant 5 — Row-count check (cross-shop UPSERT-hijack detection)

Every UPSERT in every handler MUST compare actual writes to expected snapshot row count:

```sql
IF v_actual_writes < (SELECT count(*) FROM jsonb_each(p_snapshot->'before')) THEN
  RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt on <table>: snapshot carries % rows but only % were writable in shop %',
    (SELECT count(*) FROM jsonb_each(p_snapshot->'before')),
    v_actual_writes, p_shop_id
    USING ERRCODE = '42501';
END IF;
```

If Invariant 1's `WHERE target.shop_id = p_shop_id` filter silently skipped a foreign-shop conflict, the row count comes back short → RAISE surfaces it as a structured rejection per ADR-007's `cross_shop_hijack_attempt` enum.

Even with the preferred-alternative tenant-scoped conflict target (where cross-shop hijack is structurally impossible), the row-count check still surfaces OTHER anomalies (corrupted snapshot, advisory-lock collision, race-condition skips). Keep the check for symmetry + future-proofing.

### Invariant 6 — FK target tenant pre-validation

Every handler that UPSERTs rows carrying FK columns MUST pre-validate every distinct FK target value:

```sql
-- Validate FK target tenant correctness BEFORE upserting questions_before.
WITH referenced AS (
  SELECT DISTINCT (rec->>'subcategory_id')::BIGINT AS sub_id
    FROM jsonb_each(p_snapshot->'questions_before') AS s(key, rec)
   WHERE rec->>'subcategory_id' IS NOT NULL
), resolved AS (
  SELECT r.sub_id
    FROM referenced r
    JOIN concern_subcategories cs ON cs.id = r.sub_id
   WHERE cs.shop_id = p_shop_id   -- ← FK target must be in caller's tenant
)
SELECT (SELECT count(*) FROM referenced), (SELECT count(*) FROM resolved)
  INTO v_referenced_count, v_resolved_count;

IF v_resolved_count < v_referenced_count THEN
  RAISE EXCEPTION 'revert_blocked: fk_target_tenant_mismatch: snapshot references % distinct subcategory_id values but only % resolve in shop % (likely tampered snapshot or stale references); manual recovery required',
    v_referenced_count, v_resolved_count, p_shop_id
    USING ERRCODE = '42501';
END IF;
```

The classifier (per ADR-008) maps `fk_target_tenant_mismatch` to canonical `fk_broken` (single enum for all FK-related rejections per ADR-007).

**Which handlers need Invariant 6:** any handler whose snapshot rows carry an FK column. The per-category handler (`questions_before.subcategory_id` → `concern_subcategories.id`) is the canonical example. `concern_questions_flat` if its snapshot carries `subcategory_id`. `closed_dates_future` has no FKs — Invariant 6 is a no-op there.

## Consequences

- **Closes cross-shop UPSERT-hijack** (Invariants 1 + 5): the WHERE-filtered DO UPDATE refuses to mutate foreign-shop rows; the row-count check converts the silent skip into a loud `cross_shop_hijack_attempt` rejection.
- **Closes cross-tenant FK reference** (Invariant 6): tampered snapshots referencing a foreign-shop parent are blocked BEFORE the write runs, with a specific `fk_target_tenant_mismatch` diagnostic naming the failing column and missing count.
- **Load-bearing on BOTH apply and revert.** Apply writes the snapshot that revert later trusts; both code paths read prior writes and depend on the same invariants holding. Removing any invariant on either path silently re-opens the matching attack surface.
- **Defense-in-depth, not redundancy.** Invariant 1 prevents the handler from MUTATING someone else's row. Invariant 5 catches the skip (loud RAISE instead of silent success). Invariant 6 prevents the handler from WRITING a new row in our shop that REFERENCES someone else's parent. Each protects a different shape; removing one leaves a hole the others cannot cover.
- **Cost:** N row-count checks + N FK pre-validation queries per handler (where N is the number of UPSERT targets and FK columns). Negligible compared to the UPSERT itself; pre-validation queries are indexed-PK joins.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.2 Invariant 1 + Invariant 5 + Invariant 6
- Related ADRs: ADR-007 (canonical reason_code enum — these invariants raise `cross_shop_hijack_attempt` + `fk_target_tenant_mismatch`/`fk_broken`), ADR-016 (L4 of multi-tenant defense), ADR-024 (lock_targets_for_kind — lock predicate scope must match these invariants)
