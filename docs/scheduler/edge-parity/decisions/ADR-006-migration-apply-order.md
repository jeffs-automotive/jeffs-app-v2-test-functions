# ADR-006: Migration apply order — timestamp-aligned, dispatch first

**Status:** Accepted (2026-05-26)
**Supersedes:** Two prior decisions: (1) v0.5 original timestamp order (which was correct but undocumented); (2) a subsequent reordering attempt (which was based on a misunderstanding of PL/pgSQL symbol resolution and was reverted).
**Superseded by:** (none)

## Context

Supabase CLI applies migration files in lexicographic filename order — there is no manifest, no dependency graph, no opt-in topological sort. The 8 migration files for this feature (6 applied at E1a-f, then 2 Migration B files at E11e via the staging-directory mechanic) MUST be ordered such that the lexicographic apply sequence matches the conceptual layering PLAN.md §9 documents. Any divergence between prose ordering and timestamp ordering produces a deploy that either succeeds in the wrong order (silent semantic drift) or fails mid-push (partial-deploy footgun).

Two PostgreSQL behaviors shape the ordering:

1. **PL/pgSQL defers symbol resolution to call time.** Per Postgres docs: "Because there is no compile-time check that the referenced function exists, the function is found and verified at execution time." A function body may CREATE cleanly even when functions it CALLs do not yet exist; resolution failure surfaces only when the function is actually invoked.
2. **Apply RPCs depend on the `canonical_state_<kind>` serializers** defined inside the dispatch migration. The dispatch migration also CREATEs `lock_targets_for_kind`, `compute_current_canonical_for_kind`, and `compute_unified_diff` — the entire helper layer that every downstream RPC composes against.

Combined: dispatch must come first as the structural foundation; handlers and apply RPCs follow.

## Decision

The canonical 8-file apply order (Migration B is split into 2 sibling files per ADR-022 to honor the `CREATE INDEX CONCURRENTLY` cannot-be-in-transaction constraint):

| Step | Filename | What it creates |
|---|---|---|
| E1a-1 | `20260526000000_scheduler_admin_audit_log_hardening_part_a.sql` | Migration A Part 1 (transactional): pgcrypto, audit_log additive schema (shop_id NULLABLE + successor_revert_id + reverts_upload_id), operation CHECK loosen, `scheduler_admin_revert_attempts` table + 5 attempts-side indexes (zero-row table; safe inside transaction), RLS RESTRICTIVE policies + REVOKE/GRANT triple on both tables |
| E1a-2 | `20260526000001_audit_log_concurrent_indexes.sql` | Migration A Part 2 (non-transactional via `-- supabase: skip-tx-wrap`): 4 CREATE INDEX CONCURRENTLY on the LIVE audit_log table (one_successful_revert + shop_recent + surface_recent + GIN surfaces). Cannot run inside the Supabase wrap. Lexicographic order ensures it applies AFTER Part 1 (which adds the referenced columns) |
| E1b | `20260526000100_revert_md_upload_dispatch.sql` | Outer + inner RPCs + `lock_surface_for_kind` + `lock_targets_for_kind` + `compute_current_canonical_for_kind` + 10 `canonical_state_<kind>` serializers + `compute_unified_diff` (4 helper families = 14 internal function signatures per R6-B1 + R6-B2) |
| E1c | `20260526000200_revert_handlers_v2.sql` | testing_services + routine_services revert handlers |
| E1d | `20260526000300_revert_handlers_v2_subcategories.sql` | subcategory descriptions + map + question_required_facts revert handlers |
| E1e | `20260526000400_revert_handlers_legacy.sql` | per-category + guideline + appointment_default_limits + closed_dates + concern_questions_flat revert handlers |
| E1f | `20260526000500_apply_handlers_uploads.sql` | 5 apply RPCs for the 5 legacy uploaders |
| E11e-1 | `20260526100000_scheduler_admin_audit_log_hardening_part_b1_set_not_null.sql` | Migration B file 1 (transactional): HARD CHECK on residual NULLs, ALTER COLUMN shop_id SET NOT NULL, idempotent shop_id_valid_check constraint |
| E11e-2 | `20260526100001_scheduler_admin_audit_log_hardening_part_b2_concurrent_indexes.sql` | Migration B file 2 (non-transactional via `-- supabase: skip-tx-wrap`): DROP/CREATE INDEX CONCURRENTLY with `WHERE shop_id > 0` predicate (replaces Migration A's `WHERE shop_id IS NOT NULL`) |

**Why dispatch (00100) comes BEFORE handlers (00200-00400):** the dispatch RPC's inner CASE references `revert_<kind>(p_shop_id, v_snapshot)` handlers. Those references are CHECKed only when the dispatch is actually CALLed. The first dispatch call does not land until orchestrator-mcp is deployed at step E11a — by which time E1c-e have already applied and every handler exists. Creating dispatch before handlers compiles cleanly because PL/pgSQL symbol resolution is lazy.

**Why dispatch (00100) comes BEFORE apply RPCs (00500):** apply RPCs CALL the `canonical_state_<kind>` serializers defined in the dispatch migration. Symbol resolution is technically lazy here too, but the dependency direction is real: helpers before consumers. Putting apply RPCs after dispatch matches the conceptual layering and makes the dependency graph readable from filename order alone.

**Why Part B (100000 / 100001) comes LAST:** Part B's `CREATE INDEX CONCURRENTLY` cannot run inside a BEGIN block and operates on the populated table after the backfill script has run. The 5-digit jump from 00500 to 100000 is intentional — it leaves filename slots for any mid-cycle additive migrations without renumbering Part B.

**CRITICAL — Migration B staging-directory rule.** Supabase CLI's `supabase db push` applies ALL pending migrations in `supabase/migrations/` on every invocation. To preserve the HUMAN GATE at E11e, Migration B's two files (`20260526100000_*part_b1*.sql` and `20260526100001_*part_b2*.sql`) MUST NOT live in `supabase/migrations/` at E1a time — otherwise the E1a push applies them prematurely.

**Canonical staging mechanic:** Migration B's two files are COMMITTED to the repo under `supabase/migrations-staged/` (NOT gitignored — committed at PR time so they exist in every fresh checkout). The directory is OUTSIDE `supabase/migrations/` and therefore invisible to `supabase db push`. The deploy timeline:
- During E1a-f: both Migration B files live in `supabase/migrations-staged/`. The E1a push only sees the 6 files E1a-E1f.
- At E11e: the orchestrator (or operator) verifies exactly the two expected files exist in `supabase/migrations-staged/`, runs the explicit `mv` to move both into `supabase/migrations/`, then runs `supabase db push`. The CLI sees 2 new pending migrations (E11e-1 and E11e-2), skips the 6 already-applied ones, and applies the new ones in lexicographic order (file 1 transactional → file 2 with `-- supabase: skip-tx-wrap` non-transactional).

See PLAN.md §3 "Canonical staging mechanic" + "Pre-E11e validation" for the operational detail and the pre-move validation gates. ADR-022 documents why the two-file split is necessary inside Migration B itself.

## Consequences

The partial-deploy footgun is bounded by the absence of any caller. If `supabase db push` halts at any step E1a-E1f, the database contains a partial set of RPCs whose internal references may not resolve at call time. However, orchestrator-mcp — the sole production caller — is deployed at step E11a, which is AFTER the full migration push completes successfully. Between E1a and E11a there are no callers; the partial state is dormant. Operators monitor the migration push for failures; E11a deploy is gated on E1g verification via `mcp__supabase__list_migrations` + `mcp__supabase__get_advisors`.

Filename-order = prose-order is a load-bearing invariant. Any future migration added to this feature must either slot into the existing 6-digit window with a filename that preserves the conceptual ordering, or extend after 100000 with the same dependency-first discipline. Renumbering an already-deployed migration is forbidden — once a timestamp ships to any environment it is immutable.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.6 (the full apply-order table, including the correction narrative that reverted the misguided reordering attempt)
- Related ADRs: ADR-022 (Migration A + B + backfill), ADR-024 (dispatch helpers including canonical_state serializers)
