# ADR-012: Lock-targets-before-staleness ordering (closes X13 lost-update window)

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.3 ordering where each handler acquired its OWN target-row locks AFTER staleness was validated against an unlocked snapshot. Distilled from X-FIX-AGENT-E + GPT cross-verify BLOCKER X13.
**Superseded by:** (none)

## Context

The inner RPC `revert_md_upload_apply` performs a staleness check that compares the snapshot's stored `after_hash` to a freshly-computed `current_head_hash` over the canonical state of every target row. If the snapshot is stale (head has drifted since the original upload), the RPC must reject so the operator does not revert OVER legitimate post-upload edits.

In v0.3, each per-kind handler acquired its OWN `SELECT … FOR UPDATE` row locks INSIDE the handler body (corresponding to step 9 of today's order). The inner RPC first computed the current canonical state, then ran the staleness comparison, then dispatched to the handler — which only THEN took its locks. A concurrent same-shop editor with write access to those rows could mutate a target row between the staleness check and the handler's lock acquisition. The handler's eventual UPSERT/DELETE would then operate on data that the staleness check had already deemed "current" — but was no longer current by the time the mutation landed. Classic TOCTOU lost-update.

The dry-run path made this worse: a dry-run on drifted state happily returned a confirm token, which the operator could then submit on apply, reverting OVER the legitimate post-upload edits that arrived between dry-run and apply.

## Decision

The inner RPC `revert_md_upload_apply` runs 12 sequential steps. Target-row lock acquisition happens at **step 4** — BEFORE current canonical state is computed (step 5) and BEFORE the staleness `after_hash` comparison runs (step 6).

**Step-ownership note.** STEP 0a/0b/0c live PRIMARILY in the OUTER RPC `revert_md_upload_attempt` per ADR-002 (Branch 3 — outer RAISEs per Postgres convention before opening the BEGIN/EXCEPTION subtransaction); STEP 0d also lives in the outer as Branch 2's `not_found` rejection. By the time the outer's `SELECT … FROM public.revert_md_upload_apply(...)` invokes the inner, the parameters have already passed the outer's STEP 0 checks. The inner duplicates STEP 0a/0b/0c as DEFENSIVE re-checks at its entry — cheap belt-and-suspenders for the SECURITY DEFINER function even though ADR-005's no-service_role-GRANT policy makes direct inner calls structurally hard. The duplicate-check cost is microseconds; the value is that a future GRANT misconfiguration (or owner-role direct call from a migration) cannot land in the lock-target code with malformed parameters. The inner-side STEP 0d is intentionally absent: STEP 0d's purpose (returning a structured `not_found` outcome) only makes sense at the outer where the structured-outcome contract lives; inner failures RAISE per ADR-001 contract.

Canonical inner-side step order:

| Step | Action | Owner |
|---|---|---|
| 0a | Parameter-presence guard (`p_shop_id` NULL/≤0 RAISE; same for `p_upload_id`) | Outer (primary); inner (defensive re-check) |
| 0b | Multi-tenant auth assertion (`p_actor_email` presence) | Outer (primary); inner (defensive re-check) |
| 0c | Boolean parameter null-guard (`p_dry_run`, `p_force_no_after_hash` non-NULL) | Outer (primary); inner (defensive re-check) |
| — | (STEP 0d — upload-existence pre-check — lives only in outer per ADR-002) | Outer ONLY |
| 1 | `SELECT … FOR UPDATE NOWAIT` on parent audit row (NOWAIT → 55P03 if another revert is in flight) | Inner |
| 2 | Validate eligibility (operation, snapshot, 30-day cutoff, snapshot_kind resolves) | Inner |
| 3 | Dry-run / apply parameter-invariant guard (dry_run + token rejected loud) | Inner |
| **4** | **`lock_targets_for_kind(v_kind, p_shop_id, v_snapshot)` — Phase 1 surface lock + Phase 2 per-row locks per ADR-024** | Inner |
| 5 | Compute current canonical state via `compute_current_canonical_for_kind(...)` | Inner |
| 6 | Staleness check: `after_hash` 3-branch per ADR-014 (NULL gate, hash compare, drift diff) | Inner |
| 7 | Dry-run early return: freshly-computed confirm_token; NO mutations; NO audit row | Inner |
| 8 | Apply mode: validate `p_expected_confirm_token` matches `v_token_recomputed`; RAISE on mismatch | Inner |
| 9 | Dispatch via CASE on snapshot_kind → call per-kind revert handler | Inner |
| 10 | INSERT revert audit row (`diff_summary` merges standard keys with `v_stats.details`) | Inner |
| 11 | UPDATE parent.successor_revert_id (atomic with step 10 within inner transaction) | Inner |
| 12 | RETURN structured result | Inner |

Per-kind lock predicates live in `lock_targets_for_kind` (helper specified in ADR-024). The helper runs in TWO phases per ADR-024:
- **Phase 1 (mandatory, all kinds):** per-`(shop_id, snapshot_kind)` advisory surface lock — serializes ALL writers to the same surface for the duration of the revert transaction. This is the lock that closes the wider canonical-read-scope drift class (concurrent writes to rows OUTSIDE the snapshot's per-row scope that would still appear in the whole-surface canonical read at step 5).
- **Phase 2 (per-kind):** `SELECT … FOR UPDATE` scoped by `shop_id = p_shop_id AND id = ANY(<key set>)` where `<key set>` is the union of `before` keys and `added_keys`. The `closed_dates_future` branch additionally takes `pg_advisory_xact_lock` over `(shop_id, closed_date)` for the per-date key namespace.

Handler-internal `SELECT … FOR UPDATE` calls are preserved in handler bodies as defense-in-depth and for readability/refactor safety — but they are NO LONGER load-bearing. Step 4 already holds the rows. Removing the handler-level lock would not re-open the TOCTOU.

## Consequences

The lost-update window between staleness check and handler mutation is closed by Phase 2 per-row locks. The wider canonical-read-scope drift class — concurrent writes to OTHER rows in the same `(shop_id, snapshot_kind)` surface that would silently change the whole-surface canonical read at step 5 — is closed by Phase 1 surface lock (ADR-024). Together: the lock window covers (a) computing current canonical state for staleness comparison at step 5 (Phase 1 prevents foreign-row drift; Phase 2 prevents per-row drift), (b) reading current state for FK validation inside handlers at step 9 (Invariant 6), and (c) applying the actual UPSERT/UPDATE/DELETE at step 9. Any concurrent same-shop writer to the same surface (Phase 1 scope) OR the same rows (Phase 2 scope) blocks at step 4 until the inner RPC commits or rolls back.

Dry-run is now staleness-safe on BOTH paths (dry-run and apply run the same step-4 → step-6 sequence before the dry-run early return at step 7). The operator can no longer receive a confirm token for drifted state.

Cost: locks are held slightly longer than strictly necessary — across the canonical-compute work in step 5 plus the hash/diff comparison in step 6 — before the actual mutation at step 9. In practice this is microseconds-to-milliseconds for the bounded key set per upload (typically 1-200 rows). Phase 1 surface lock cost: concurrent admin writes to the same `(shop_id, kind)` surface serialize behind the revert — correct behavior, see ADR-024 Consequences "Concurrency trade-off". The wall-clock cost is far smaller than the cost of a single lost-update or false-positive-staleness-drift incident.

**Residual risk — non-cooperative writers only.** The Phase 1 surface lock is COOPERATIVE: it serializes writers that take `lock_surface_for_kind` FIRST, not writers that bypass it. Two scopes of residual exist:

1. **For cooperative writers (5 NEW apply RPCs per ADR-Fix #17 + the revert RPC) — no race remains.** Even an absent-key INSERT race (UPSERT-restore of a deleted row that has no current row to lock; apply-INSERT of a brand-new key not in `p_snapshot.before`) is closed: the concurrent INSERT serializes behind Phase 1 surface lock, regardless of whether Phase 2 per-row locks acquired anything for that key. The combination Phase 1 (surface) + Phase 2 (per-row) is correctness-complete for the cooperative-writer set.

2. **For non-cooperative writers — race remains open.** Any writer that mutates a Phase-1 surface WITHOUT first calling `lock_surface_for_kind` bypasses the serialization. Two classes:
   - **In-scope non-cooperative (this feature):** the 5 EXISTING V2 TS upload paths (`_uploadCatalogV2`, `uploadSubcategoryDescriptionsMdV2`, `uploadSubcategoryServiceMapMdV2`, `uploadQuestionRequiredFactsMdV2`) are pre-existing TypeScript code that does NOT call the surface lock. A concurrent V2 upload during a V2 revert can still drift the canonical-current read at step 5 → false-positive `current_state_drift` rejection. Scope per ADR-024 + ADR-Fix #23: V2 retrofit is out of Phase 1 scope; tracked in DEFERRED-AUDIT-ITEMS.md SEC-17.
   - **Out-of-scope non-cooperative (future writers):** any new code path that mutates a Phase-1 surface without taking the lock. Forward-looking guard per SEC-17.

   For non-cooperative writers, the per-key absent-key INSERT race also remains open (Phase 2's per-row lock acquires nothing for a key with no row). The proper sharpening — advisory key-namespace locks for all kinds, mirroring the `closed_dates_future` per-date pattern — is deferred to Phase 1.5 per ADR-015 + SEC-15.

**Operational severity in Phase 1:** the single-admin-at-a-time deployment profile + Phase 1 surface lock universally adopted by the 5 NEW apply RPCs and revert RPC together bound the practical exposure. V2 path retrofit (SEC-17) and per-key advisory locks (SEC-15) are the two follow-on hardening tracks; either can be done independently when operationally justified.

## Sources

- Archived prior plan: `archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.1 inner RPC 12-step pseudocode (steps 0a-12 verbatim ordering)
- Archived prior plan: `archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.2 Invariant 2 "Target-row locking" (v0.3-vs-v0.4 reordering rationale)
- Related ADRs: ADR-001 (outer/inner split), ADR-014 (force_no_after_hash 3-branch — runs in step 6 under step-4 locks), ADR-015 (absent-key TOCTOU residual gap), ADR-024 (`lock_targets_for_kind` helper spec)
