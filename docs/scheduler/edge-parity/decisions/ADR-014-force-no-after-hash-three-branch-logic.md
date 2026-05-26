# ADR-014: force_no_after_hash 3-branch staleness logic

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 logic where `force_no_after_hash=true` bypassed canonical-vs-current comparison even when `expected_after_state_canonical` was present. Distilled from X-FIX-#22 + cross-verify rounds 2+3 (Gemini + GPT chunk 3 BLOCKERs both agreed).
**Superseded by:** (none)

## Context

`p_force_no_after_hash` exists as an operator override for snapshots that were captured before `expected_after_state_canonical` and `after_hash` were added to the snapshot envelope (pre-CV2-B3 / pre-2026-05-26 rows). Without the flag, those legacy snapshots would be permanently un-revertable because the staleness check has no expected value to compare against — a regression nobody wants the first time an operator tries to revert a 28-day-old MD upload.

The v0.5 collapsed form, however, gave the flag too broad a scope. Its staleness predicate ran roughly: `IF after_hash IS NULL AND canonical IS NOT NULL AND NOT force THEN compare canonical-to-canonical`. When an operator passed `force=true` AND the snapshot DID carry `expected_after_state_canonical` (a mid-period snapshot — has canonical, just missing after_hash), the canonical comparison was bypassed even though it COULD have run. That defeats verification when verification is possible — the opposite of the flag's intent. Both Gemini and GPT round-3 chunk 3 BLOCKERs flagged this independently.

## Decision

Inner RPC step 6 (staleness check) is split into three ordered branches with precisely-scoped responsibilities. The force flag's reach is restricted to branch 1 — the only branch where verification is genuinely impossible.

```sql
v_expected_canonical := v_snapshot->>'expected_after_state_canonical';

-- Branch 1: hard fail (or accept force) when truly blind — no hash AND no canonical
IF v_snapshot_after_hash IS NULL AND v_expected_canonical IS NULL THEN
  IF NOT COALESCE(p_force_no_after_hash, FALSE) THEN
    RAISE EXCEPTION 'revert_blocked: cannot_safely_verify: pre-2026-05-26 snapshot has no expected_after_state_canonical / after_hash; pass force_no_after_hash=true to override (logged + flagged for review)';
  END IF;
  -- else: force=true accepted; no canonical content to verify against; proceed
  --       (audit-row diff body will be informational only)
END IF;

-- Branch 2: hash fast-path — when after_hash present
IF v_snapshot_after_hash IS NOT NULL AND v_snapshot_after_hash <> v_current_head_hash THEN
  RAISE EXCEPTION 'staleness_check_failed: current state differs from expected post-upload state; diff=%',
    public.compute_unified_diff(
      COALESCE(v_expected_canonical, '<<expected_after_state_canonical not stored in this pre-CV2-B3 snapshot>>'),
      v_current_canonical, 50);
END IF;

-- Branch 3: canonical fallback — ALWAYS fires when after_hash absent but canonical present.
-- Force flag does NOT bypass this branch; its purpose is ONLY branch 1.
IF v_snapshot_after_hash IS NULL AND v_expected_canonical IS NOT NULL THEN
  IF v_expected_canonical <> v_current_canonical THEN
    RAISE EXCEPTION 'staleness_check_failed: current state differs from expected post-upload state (canonical-fallback, no after_hash on this snapshot); diff=%',
      public.compute_unified_diff(v_expected_canonical, v_current_canonical, 50);
  END IF;
END IF;
```

Precise scope of `force_no_after_hash=true`:

- **Branch 1** (no hash AND no canonical): force flag CAN bypass `cannot_safely_verify`. This is the only legitimate use.
- **Branch 2** (hash present): force flag has NO effect. Hash comparison is cheap and authoritative; nothing to override.
- **Branch 3** (no hash BUT canonical present): force flag has NO effect. Canonical-to-canonical comparison still fires. An operator pulling the override is saying "no hash to check" — they still get the check when canonical is available.

Forced overrides are audit-flagged. The step-10 audit-row INSERT writes `'forced_no_after_hash_check', (COALESCE(p_force_no_after_hash, FALSE) AND v_snapshot_after_hash IS NULL)` into `diff_summary` JSONB. Operators querying the audit log can find every revert that used the override.

## Consequences

The force flag now has precise, defensible scope: it bypasses `cannot_safely_verify` ONLY when both `after_hash` AND `expected_after_state_canonical` are absent on the snapshot. Mid-period snapshots that have canonical but no hash still get the canonical-fallback verification fired — operators cannot accidentally skip verification by reflexively passing `force=true`. The intent of the override (allow revert of genuinely-unverifiable legacy snapshots) is preserved; the intent of staleness (always verify when verification is possible) is also preserved.

Operationally, branch 3's "always fires" guarantee means the canonical-fallback path is the load-bearing safety net for every snapshot captured between CV2-B3 (canonical added) and whatever future date `after_hash` becomes universally populated. The cost is one extra string comparison on the slow path — acceptable. The audit `forced_no_after_hash_check` flag remains TRUE only when the operator override actually bypassed a check (branch 1 force-accepted), not on every revert call that happened to pass `force=true` against a snapshot with canonical or hash present.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.1 inner RPC step 6 (the 3-branch IF block at lines 1790-1835 + the rationale comment block at lines 1791-1806)
- Related ADRs: ADR-012 (lock-then-staleness ordering — step 4 → step 6), ADR-015 (absent-key TOCTOU residual)
