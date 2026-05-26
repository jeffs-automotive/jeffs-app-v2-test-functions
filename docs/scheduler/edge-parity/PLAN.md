# scheduler-edge-parity — Implementation plan

**Status:** Ready for `/feature-implement` (pending cross-verify)
**Authored:** 2026-05-26 (clean rewrite after archived predecessor accumulated contradictions across 3 cross-verify rounds + 27 incremental fixes)
**Archived predecessor:** `archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md`

## How to read this plan

This document is a **build guide**, not a design rationale. Every "why is this the way it is?" question answers from the Architecture Decision Records:

- **Canonical decisions:** `decisions/INDEX.md` + `decisions/ADR-001..ADR-024`
- **Research inputs:** `research/research-01..04-*.md`
- **Deferred follow-ups:** `../DEFERRED-AUDIT-ITEMS.md` SEC-12 through SEC-16 (this feature) + OBS-9 (retention)
- **Cross-verify history:** `.claude/work/archive/edge-parity/cross-verify-history/` (26 artifacts; reference for ADR rationale)

ADRs are IMMUTABLE. If a decision changes, write a NEW ADR that supersedes the prior; do not edit accepted ADRs.

---

## 1. Goal

Close 4 edge-side gaps that block the `/schedulerconfig` admin UI (paused; resumes after this feature ships):

1. **New `list_scheduler_admin_audit_log` MCP tool** — admin-app needs to enumerate prior uploads with revert-eligibility metadata
2. **Missing exporters** — `export_concern_category_guideline_md` + `export_concern_category_md` for round-trip parity
3. **Pattern S backfill** for 5 legacy uploaders (`uploadConcernQuestionsMd`, `uploadConcernCategoryMd`, `uploadConcernCategoryGuidelineMd`, `uploadAppointmentDefaultLimitsMd`, `uploadClosedDatesMd`) — add `dry_run` + `expected_confirm_token` + `pre_state_snapshot` capture
4. **Extend `revertMdUpload`** to cover all 10 legacy tables via per-snapshot_kind dispatch — outer/inner RPC split (per ADR-001) + 10 revert handlers + 5 apply RPCs + attempt-trail observability (per ADR-002)

Plus 6 pre-existing revert-path bugs discovered during research (CHECK constraint, shop_id, race conditions, etc.) — all addressed by the new revert architecture.

---

## 2. References

### Canonical decisions (ADRs)

See `decisions/INDEX.md` for the table of contents. The 24 ADRs cluster as:

| Cluster | ADRs | Topic |
|---|---|---|
| Architecture | ADR-001 to ADR-006 | RPC split, attempt-row contract, transaction control, handler shape, security entry point, migration order |
| Reason code & errors | ADR-007 to ADR-011 | Canonical enum, classifier, sanitized error_message, 3-tier redaction, snapshot_kind_unknown special case |
| Concurrency/TOCTOU | ADR-012 to ADR-015 | Lock-then-staleness ordering, closed_dates advisory lock, force_no_after_hash logic, absent-key TOCTOU |
| Multi-tenant security | ADR-016 to ADR-019 | 4-layer defense, search_path, RLS RESTRICTIVE, handler Invariants 1+5+6 |
| Schema | ADR-020 to ADR-022 | Attempts table, audit-log read tool, Migration A+B+backfill |
| Helpers | ADR-023 to ADR-024 | compute_unified_diff, dispatch helpers |

### Research inputs

- `research/research-01-audit-log-read-tool.md` — list tool requirements
- `research/research-02-missing-exporters.md` — exporter parity research
- `research/research-03-pattern-s-backfill.md` — refactor design for 5 legacy uploaders
- `research/research-04-revert-extension.md` — revert dispatch design

### Stack invariants (unchanged by this feature)

- Supabase CLI 2.98.2 (`functions invoke` does NOT exist; use `curl.exe` for invocation)
- Test Supabase project: ref `itzdasxobllfiuolmbxu` in us-east-1 (NOT prod `lrsazdxnbtjczpvngcud`)
- Tekmetric shop_id: `7476`
- Vercel AI SDK pinned at `ai@^5`, `@ai-sdk/anthropic@^2`, `zod@^4`
- Anthropic models: Opus 4.7, Sonnet 4.6, Haiku 4.5
- Windows 11; Bash tool runs git-bash; PowerShell denied

---

## 3. Migrations

8 migration files apply in lexicographic filename order per ADR-006. Apply at E1a-f; Migration B's 2 files at E11e (after backfill).

**CRITICAL — Migration B staging location.** Supabase CLI's `supabase db push` applies ALL pending migrations in `supabase/migrations/` on every invocation. If Migration B's two files are committed to `supabase/migrations/` at E1a time, the E1a push will apply them all — bypassing the HUMAN GATE at E11e and racing against backfill PHASE 1/2. The plan therefore keeps Migration B's two files in a STAGING directory `supabase/migrations-staged/` until E11d completes.

**Canonical staging mechanic (NOT gitignored — committed at PR time):** the two Migration B files ARE committed to the repo under `supabase/migrations-staged/` from the feature PR onward, so they exist in every fresh checkout (CI, dev, prod deploy env). The directory `supabase/migrations-staged/` is NOT under `supabase/migrations/` and therefore is NOT seen by `supabase db push`. Step E11e is a two-command sequence: `mv supabase/migrations-staged/20260526100000_*.sql supabase/migrations/ && mv supabase/migrations-staged/20260526100001_*.sql supabase/migrations/`, then `supabase db push`. The CLI sees 2 new pending migrations (lexicographic order: file 1 transactional → file 2 with `-- supabase: skip-tx-wrap` non-transactional), skips the 6 already-applied files, and applies the new ones in order. **After successful apply, the operator MUST commit the moved files to the repo** (drift between the remote migration history and the local `supabase/migrations/` contents is a Supabase-tooling failure mode — fresh checkouts would not see the applied migrations as files, even though the remote DB records them as applied).

**E11e re-run semantics — NOT shell-level idempotent.** The SQL is idempotent (both files use `IF NOT EXISTS` / `IF EXISTS` / DO-block `EXCEPTION WHEN duplicate_object`). The shell `mv` step is NOT idempotent: after a successful move, `supabase/migrations-staged/20260526100000_*.sql` no longer exists, so a naive re-run of E11e fails on the first `mv`. Recovery procedure for a partial-failure E11e: if `mv` succeeded but `supabase db push` failed, the files are already in `supabase/migrations/` — re-run JUST `supabase db push` (Supabase CLI is idempotent on `db push`). If `mv` failed before completion: confirm both files moved or both files NOT moved (no mixed state), then either rerun the failed `mv` OR roll the moved file back to `migrations-staged/`.

**Pre-E11e validation (operator runbook):** before running the `mv` + `supabase db push`, the operator MUST verify exactly two files exist at `supabase/migrations-staged/20260526100000_*.sql` and `supabase/migrations-staged/20260526100001_*.sql` (e.g., `ls -1 supabase/migrations-staged/ | wc -l` must return 2; `ls supabase/migrations-staged/20260526100000_*.sql` and `ls supabase/migrations-staged/20260526100001_*.sql` must each return exactly one file). A missing or overbroad glob can silently skip Migration B or move the wrong files. This check is a hook-level safety gate; the orchestrator (or operator) MUST run it and confirm before proceeding.

**Why NOT gitignored:** a gitignored staging directory means the files would not exist in a fresh checkout. The CI/deploy pipeline (or operator on a clean clone) would have no files to move. Failure mode: E11e silently no-ops, the operator believes Migration B applied but the NOT NULL transition never landed, and the next migration push could fail or behave incorrectly. Committed-at-PR-time + manual `mv` is the more-robust path.

| File | Contents | Apply step | ADR refs |
|---|---|---|---|
| `20260526000000_scheduler_admin_audit_log_hardening_part_a.sql` | Migration A Part 1 (transactional, Supabase wrap): pgcrypto extension; audit_log additive columns (shop_id NULLABLE, successor_revert_id, reverts_upload_id); CHECK loosen for 'revert_upload' operation; scheduler_admin_revert_attempts table + 5 attempts-side indexes; RLS RESTRICTIVE deny-all on both tables (ADR-018); table-level REVOKE/GRANT triple on both tables | E1a | ADR-020, ADR-022, ADR-018, ADR-017 |
| `20260526000001_audit_log_concurrent_indexes.sql` | Migration A Part 2a: `one_successful_revert_idx` UNIQUE CONCURRENTLY. ONE statement per file required — Supabase CLI 2.100.x sends multi-statement files in pgx pipeline mode → SQLSTATE 25001 if mixed with CONCURRENTLY. `-- supabase: skip-tx-wrap` directive on line 1 is intent-only (no-op on this CLI version) | E1a | ADR-022 |
| `20260526000002_audit_log_idx_shop_recent.sql` | Migration A Part 2b: `shop_recent_idx` CONCURRENTLY | E1a | ADR-022 |
| `20260526000003_audit_log_idx_surface_recent.sql` | Migration A Part 2c: `surface_recent_idx` CONCURRENTLY | E1a | ADR-022 |
| `20260526000004_audit_log_idx_surfaces_gin.sql` | Migration A Part 2d: `surfaces_gin_idx` GIN expression index CONCURRENTLY | E1a | ADR-022 |
| `20260526000100_revert_md_upload_dispatch.sql` | Outer + inner RPCs; lock_targets_for_kind; compute_current_canonical_for_kind; 10 canonical_state_\<kind\> serializers; compute_unified_diff | E1b | ADR-001, ADR-005, ADR-008, ADR-024, ADR-023 |
| `20260526000200_revert_handlers_v2.sql` | `revert_testing_services_v2` + `revert_routine_services_v2` | E1c | ADR-004, ADR-019 |
| `20260526000300_revert_handlers_v2_subcategories.sql` | `revert_subcategory_descriptions_v2` + `revert_subcategory_service_map_v2` + `revert_question_required_facts_v2` | E1d | ADR-004, ADR-019 |
| `20260526000400_revert_handlers_legacy.sql` | `revert_concern_questions_flat` + `revert_concern_category_upload` + `revert_concern_category_guideline` + `revert_appointment_default_limits` + `revert_closed_dates_future` | E1e | ADR-004, ADR-013, ADR-019 |
| `20260526000500_apply_handlers_uploads.sql` | 5 apply RPCs for the 5 legacy uploaders: `apply_concern_questions_flat_upload`, `apply_concern_category_upload`, `apply_concern_category_guideline_upload`, `apply_appointment_default_limits_upload`, `apply_closed_dates_upload` | E1f | ADR-019 |
| `20260526000600_list_audit_log_rpc.sql` | `list_scheduler_admin_audit_log_filtered(p_shop_id, p_surface_filter, p_table_filter, p_only_successful, p_limit)` SECURITY DEFINER RPC for the E7 list-audit-log MCP tool. 7th outer-callable entry point per ADR-005. ADR-021 conditional-COALESCE surface-filter SQL inside the function body | E7 | ADR-005, ADR-017, ADR-021 |
| `20260526100000_scheduler_admin_audit_log_hardening_part_b1_set_not_null.sql` | Migration B file 1 (transactional): HARD CHECK on residual NULL shop_id rows; ALTER COLUMN shop_id SET NOT NULL; idempotent ADD CONSTRAINT `scheduler_admin_audit_log_shop_id_valid_check CHECK (shop_id > 0 OR shop_id = -1)` via DO-block — explicit OR-clause permits sentinel `-1` rows that backfill PHASE 2 wrote for historical rows whose shop_id couldn't be derived | E11e | ADR-022 |
| `20260526100001_scheduler_admin_audit_log_hardening_part_b2_concurrent_indexes.sql` | Migration B file 2 (non-transactional, header `-- supabase: skip-tx-wrap`): DROP/CREATE INDEX CONCURRENTLY with `WHERE shop_id > 0` narrowed predicate (replaces Migration A's `WHERE shop_id IS NOT NULL`) — sentinel `-1` rows are INTENTIONALLY excluded from query-path indexes per ADR-022 Consequences (they are surfaced via list-tool reason `shop_id_unknown_pre_migration_backfill`, never queried via the shop-scoped indexes) | E11e | ADR-022 |

Plus 1 Deno backfill script:

| File | Purpose | Apply step |
|---|---|---|
| `scripts/backfill-audit-log-shop-id.ts` | PHASE 1 derive shop_id; PHASE 2 gated `--apply-sentinel-now` UPDATE NULL→-1 | E11b-d (gated) |

---

## 4. Server-side refactors (5 legacy uploaders → Pattern S)

Each uploader refactored to the canonical Pattern S anatomy per research-03 §1:

```
BEFORE:                                   AFTER:
parse → validate → fetch                  parse → validate → fetch
       → write (immediate apply)                 → compute diff (no write)
       → audit-log                               → compute confirm_token
                                                 → if dry_run: return diff + token (no write)
                                                 → re-verify expected_confirm_token (INSIDE apply RPC)
                                                 → capture pre_state_snapshot (with snapshot_kind)
                                                 → write (INSIDE apply RPC, atomic with audit-row)
```

Each uploader's apply phase moves into a SECURITY DEFINER plpgsql RPC. Each apply RPC's FIRST action is `PERFORM public.lock_surface_for_kind(p_shop_id, '<snapshot_kind>')` per ADR-024 (Phase 1 surface lock — load-bearing: serializes the apply path against any in-flight revert of the same surface, so the revert's whole-surface canonical read at step 5 cannot drift mid-flight). After the surface lock, the RPC takes row-level locks on every existing row referenced by the diff, re-verifies current-state hash against `p_audit.expected_current_hash`, performs the mutations, writes the audit row with `pre_state_snapshot` + `expected_after_state_canonical` (computed AFTER writes by re-reading persisted rows + serializing via `canonical_state_<kind>`), and returns `audit_log_id` — all in one transaction.

**Surface-lock acquisition order (MANDATORY across all 5 apply RPCs):** (1) `lock_surface_for_kind` FIRST → (2) per-row locks in canonical sorted order. `apply_closed_dates_upload` ALSO takes per-date advisory locks per ADR-013 — surface lock first, then per-date locks in sorted-date order, then per-row locks. Any deviation from this order creates deadlock potential against the revert path that uses the same canonical order via `lock_targets_for_kind`.

### 4.1 `uploadConcernQuestionsMd` (flat) — `snapshot_kind=concern_questions_flat`

- Apply RPC: `apply_concern_questions_flat_upload(p_shop_id, p_snapshot, p_diff, p_audit)`
- Replaces TS loop at `scheduler-admin.ts:1003-1056`
- Snapshot: `{before: {<id>: row}, added_keys: [<new_ids>]}`

### 4.2 `uploadConcernCategoryMd` (per-category, 2-table) — `snapshot_kind=concern_questions_per_category`

- Apply RPC: `apply_concern_category_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)`
- Significant refactor: today's apply is INTERLEAVED with the diff. Split into clean diff phase, then apply.
- Snapshot scoped to ONE `category_slug`; covers BOTH `concern_subcategories` + `concern_questions`
- DEFAULT_OPTIONS warning surfaced in dry_run report

### 4.3 `uploadConcernCategoryGuidelineMd` (single-row composite PK) — `snapshot_kind=concern_category_guidelines`

- Apply RPC: `apply_concern_category_guideline_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)`
- Trivial refactor: one fetch, one decide-insert-vs-update, one write — wrapped in apply RPC for atomicity with audit row
- Snapshot: `{before: {<category>: existing|null}, added_keys: existing ? [] : [category]}`
- Revert handles BOTH update-back AND hard-delete (when original was INSERT)

### 4.4 `uploadAppointmentDefaultLimitsMd` (7-row complete-replace) — `snapshot_kind=appointment_default_limits`

- Apply RPC: `apply_appointment_default_limits_upload(p_shop_id, p_snapshot, p_diff, p_audit)`
- Easy refactor: function already computes `adds[] + mods[]` before apply
- Keep current semantic: omitting a `day_of_week` from MD = leave the row alone (no soft-delete on omission)
- Snapshot: `{before: {<id>: row}, added_keys: [<new_ids>]}`

### 4.5 `uploadClosedDatesMd` (future-only add/delete) — `snapshot_kind=closed_dates_future`

- Apply RPC: `apply_closed_dates_upload(p_shop_id, p_snapshot, p_diff, p_audit)`
- Takes per-date `pg_advisory_xact_lock(shop_id::INT, hashtext(closed_date::TEXT))` for every date in `p_diff.added ∪ modified ∪ deactivated` in sorted-date order per ADR-013
- `original_today` (computed in shop TZ Postgres-side) preserves "past closures are immutable history" invariant
- Snapshot: `{snapshot_kind: "closed_dates_future", before: {<date>: row}, added_keys: [<dates>], original_today: 'YYYY-MM-DD'}`

### 4.6 Tool-registry edits (5 entries in `scheduler-tools.ts`)

Per research-03 §5, each of the 5 tool blocks gets:
- Description rewritten to call out the two-step flow (mirrors V2's wording verbatim)
- `inputSchema` extended with `dry_run: z.boolean().optional().default(true)` + `expected_confirm_token: z.string().optional()`
- `execute` body passes the new fields through

### 4.7 V2 catalog uploaders — emit `expected_after_state_canonical`

`_uploadCatalogV2` (testing + routine) + 3 V2 sub-surface uploaders (`uploadSubcategoryDescriptionsMdV2`, `uploadSubcategoryServiceMapMdV2`, `uploadQuestionRequiredFactsMdV2`) ALREADY use Pattern S but need to write BOTH:
- `snapshot.expected_after_state_canonical` (full canonical-MD post-apply state — read from persisted rows after write)
- `snapshot.after_hash` (derived: `encode(digest(expected_after_state_canonical, 'sha256'), 'hex')`)

V2 uploaders are TypeScript code paths. Hash computation uses WebCrypto / `crypto.subtle.digest('SHA-256', ...)` for byte-parity with pgcrypto's `digest(text, 'sha256')`. Both produce the same 256-bit hex digest.

### 4.8 Shared helpers

- `computeConfirmToken(mdHash, canonicalDiff)` in `scheduler-admin-md.ts` — replaces inline sha256 in `_uploadCatalogV2` + 5 new legacy paths
- `canonicalizeDiff(diffSummary)` — sorts ONLY set-typed arrays (allow-list: keys ending in `_keys` or `_ids`, plus `surfaces`); preserves order on ordered arrays (`questions[]`, `options[]`); object keys always sorted
- `logAuditEntry()` consolidation in `scheduler-admin-md.ts` — REQUIRES `shopId` parameter

---

## 5. Missing exporters (2 new functions)

Per research-02 §5 + §6:

### 5.1 `exportConcernCategoryGuidelineMd({ category_slug })`

- Reads `concern_category_guidelines` filtered by `(shop_id, category)`
- Emits MD matching `parseConcernCategoryGuidelineMd` round-trip contract
- Returns `{ md_content, row_count }` (row_count = 0 means no row yet — UI seeds new)
- Tool registry: `export_concern_category_guideline_md` in `scheduler-tools.ts`

### 5.2 `exportConcernCategoryMd({ category_slug })`

- Reads BOTH `concern_subcategories` AND `concern_questions` filtered by `(shop_id, category, active=true)`
- Resolves H1 display label from `concern_category_guidelines` (fall-back: title-cased slug)
- Emits hierarchical MD matching `parseConcernCategoryMd` round-trip contract
- Uses index position (NOT DB `display_order`) for question numbering — stable round-trip
- Tool registry: `export_concern_category_md` in `scheduler-tools.ts`

Refactor for testability: extract pure `serializeConcernCategoryMd(subs, questions, label)` + `serializeConcernCategoryGuidelineMd(state, slug)` helpers so the serializer can be unit-tested without a SupabaseClient.

---

## 6. New MCP tool — `list_scheduler_admin_audit_log`

Per ADR-021 for the full contract. Summary:

### 6.1 Input schema

```ts
inputSchema: z.object({
  surface_filter: z.enum([
    "routine_services", "testing_services",
    "subcategory_descriptions", "subcategory_service_map", "question_required_facts",
    "concern_questions", "concern_subcategories", "concern_category_guidelines",
    "appointment_default_limits", "closed_dates",
  ]).optional(),
  limit: z.number().int().min(1).max(50).optional(),  // default 10
  only_successful: z.boolean().optional(),            // default false
  only_revertable: z.boolean().optional(),            // default false (hint, not authoritative — see ADR-021)
}),
```

### 6.2 Surface → table_name mapping

Per ADR-021. Conditional fallback SQL:

```sql
-- Use $1/$2 positional placeholders (avoids `?` ambiguity with JSONB key-exists `?` operator — see ADR-021).
WHERE
  (COALESCE(diff_summary ? 'surfaces', FALSE) AND diff_summary->'surfaces' ? $1)
  OR
  (NOT COALESCE(diff_summary ? 'surfaces', FALSE) AND table_name = $2)
```

Wrapper passes 2 positional placeholders: `$1 = surfaceFilter`, `$2 = SURFACE_TO_TABLE[surfaceFilter]`.

### 6.3 Output shape

Per ADR-021 for the full TypeScript interface (includes `occurred_at`, NOT `uploaded_at` — matches DB column name).

### 6.4 Auth

Inside the existing `if (includeAdminTools && audit)` block at `scheduler-tools.ts:798`. orchestrator-mcp is admin-only at the request boundary; no extra gate.

### 6.5 30-day cutoff

Even if `snapshot_pruned_at IS NULL`, treat `occurred_at < now() - interval '30 days'` as eligibility reason `over_30_day_cutoff` (per ADR-007 enum naming).

---

## 7. Revert dispatch architecture

Per ADR-001 (outer/inner RPC split), ADR-002 (attempt-row contract), ADR-024 (dispatch helpers). High-level:

```
Client → orchestrator-mcp (Layer 1 auth, ADR-016)
     → service_role + p_shop_id + p_actor_email
     → outer RPC: revert_md_upload_attempt
         → STEP 0 guards (per ADR-002 — including STEP 0d upload-existence pre-check)
         → INSERT pending attempt row (outer's transaction frame, survives subtransaction rollback)
         → BEGIN
             inner RPC: revert_md_upload_apply (12-step per ADR-012)
                 → step 1: SELECT FOR UPDATE NOWAIT on parent audit row
                 → step 2: eligibility (operation, snapshot, 30-day cutoff)
                 → step 3: dry-run/apply parameter-invariant guard
                 → step 4: lock_targets_for_kind (per ADR-024)
                 → step 5: compute_current_canonical_for_kind (per ADR-024)
                 → step 6: 3-branch staleness check (per ADR-014)
                 → step 7: dry-run early return (returns confirm_token; NO mutations)
                 → step 8: apply-mode token re-verify
                 → step 9: dispatch CASE → call per-kind revert handler (per ADR-004 + ADR-019)
                 → step 10: INSERT audit row + merge details JSONB
                 → step 11: UPDATE parent.successor_revert_id
                 → step 12: RETURN
         EXCEPTION WHEN OTHERS
             → classify per ADR-008 (regex + allow-list)
             → snapshot_kind_unknown → outcome='crashed' per ADR-011
             → sanitize error_message per ADR-009
             → UPDATE attempt row to terminal outcome
             → RETURN structured result (NEVER re-RAISE)
         END
     → TS wrapper classifies on outcome (NOT error_message); emits Sentry per ADR-010
```

10 per-snapshot_kind revert handlers (all per ADR-004 return shape + ADR-019 invariants).

**Canonical 6-column kind mapping (single source of truth).** The 10 `snapshot_kind` values, their paired handler / canonical-state / apply-or-TS-uploader / MD-exporter / surface_filter enum value live in ONE table. Any new code path MUST consult this table for naming — drift between snapshot_kind, function name, and surface_filter enum value is a recurring pre-cross-verify failure mode that this table eliminates. Plural↔singular and `concern_subcategories_*` ↔ `subcategory_*` mismatches in function names are INTENTIONAL pre-existing naming inherited from the legacy codebase; the mapping table makes them explicit so future readers don't read the mismatch as a typo.

| # | snapshot_kind | snapshot.before key shape (CRITICAL — see E11f-smoke-fix warning below) | Handler (plpgsql, this feature) | canonical_state (plpgsql, this feature, per ADR-024) | Apply path (5 legacy = this feature's NEW plpgsql RPC; 5 V2 = pre-existing TS uploader) | MD exporter (TS) | `surface_filter` enum value (per §6) | Delete strategy |
|---|---|---|---|---|---|---|---|---|
| 1 | `testing_services_v2` | `service_key` TEXT (catalog.ts:590) — value carries no `id` | `revert_testing_services_v2` | `canonical_state_testing_services_v2` | TS: `_uploadCatalogV2('testing_services', ...)` | `exportTestingServicesMdV2` | `testing_services` | soft (active=false) |
| 2 | `routine_services_v2` | `service_key` TEXT (catalog.ts:590, shared `_uploadCatalogV2`) — value carries no `id` | `revert_routine_services_v2` | `canonical_state_routine_services_v2` | TS: `_uploadCatalogV2('routine_services', ...)` | `exportRoutineServicesMdV2` | `routine_services` | soft |
| 3 | `concern_subcategories_descriptions_v2` | `"<cat>/<slug>"` TEXT composite (catalog.ts:2103) — value carries `id` BIGINT | `revert_subcategory_descriptions_v2` | `canonical_state_subcategory_descriptions_v2` | TS: `uploadSubcategoryDescriptionsMdV2` | `exportSubcategoryDescriptionsMdV2` | `subcategory_descriptions` | UPSERT-only (no adds) |
| 4 | `concern_subcategories_map_v2` | `"<cat>::<slug>"` TEXT composite (catalog.ts:1423) — value carries `id` BIGINT | `revert_subcategory_service_map_v2` | `canonical_state_subcategory_service_map_v2` | TS: `uploadSubcategoryServiceMapMdV2` | `exportSubcategoryServiceMapMdV2` | `subcategory_service_map` | UPSERT-only |
| 5 | `concern_questions_required_facts_v2` | `"qid_<id>"` TEXT (catalog.ts:2649) — value carries `id` BIGINT | `revert_question_required_facts_v2` | `canonical_state_question_required_facts_v2` | TS: `uploadQuestionRequiredFactsMdV2` | `exportQuestionRequiredFactsMdV2` | `question_required_facts` | UPSERT-only |
| 6 | `concern_questions_flat` | `String(id)` "42" (scheduler-admin.ts:1036) — value carries `id` BIGINT | `revert_concern_questions_flat` | `canonical_state_concern_questions_flat` | NEW plpgsql: `apply_concern_questions_flat_upload` | `exportConcernQuestionsMd` | `concern_questions` | soft |
| 7 | `concern_questions_per_category` | nested: `subcategories_before` keyed by `String(id)` + `questions_before` keyed by `String(id)` (scheduler-admin.ts:2311/2394) — values carry `id` BIGINT | `revert_concern_category_upload` | `canonical_state_concern_category_upload` | NEW plpgsql: `apply_concern_category_upload` | `exportConcernCategoryMd` (NEW per §5.2) | `concern_subcategories` | soft — both tables |
| 8 | `concern_category_guidelines` | category slug TEXT (scheduler-admin.ts:2890) — composite PK `(shop_id, category)` | `revert_concern_category_guideline` | `canonical_state_concern_category_guideline` | NEW plpgsql: `apply_concern_category_guideline_upload` | `exportConcernCategoryGuidelineMd` (NEW per §5.1) | `concern_category_guidelines` | **hard DELETE** added |
| 9 | `appointment_default_limits` | `String(day_of_week)` "3" (scheduler-admin.ts:1429) — composite PK `(shop_id, day_of_week)` per E1cf-N1 | `revert_appointment_default_limits` | `canonical_state_appointment_default_limits` | NEW plpgsql: `apply_appointment_default_limits_upload` | `exportAppointmentDefaultLimitsMd` | `appointment_default_limits` | **hard DELETE** added |
| 10 | `closed_dates_future` | DATE string "2026-12-25" (scheduler-admin.ts:1771) — DATE column lookup | `revert_closed_dates_future` | `canonical_state_closed_dates_future` | NEW plpgsql: `apply_closed_dates_upload` | `exportClosedDatesMd` (filtered to future) | `closed_dates` | **conditional hard DELETE** (past-date immutability per ADR-004 details JSONB) |

**⚠️ Snapshot-key vs DB-column WARNING (added 2026-05-26 after E11f-smoke-fix discovery):**

The snapshot's `before`-object JSONB-key shape is NOT always the row's PK. For kinds 1-2 (V2 catalogs) the key IS the natural identity (`service_key` TEXT), NOT the UUID `id` column. For kinds 3-5 the key is a TEXT *display label* and the actual `id` BIGINT comes from the row VALUE (`snapshot.before[key].id`). For kind 6 the key IS the `id` (stringified). For kinds 7-10 the key matches the natural-identity column on a composite PK.

**ANY new `lock_targets_for_kind` branch, `revert_<kind>` handler, or `apply_<table>_upload` RPC MUST check the snapshot-key shape table above before writing the DB-column lookup.** The E1b dispatch sub-agent assumed UUID-id lookup for all 10 kinds; smoke-test surfaced 22P02 cast crashes on kinds 1-5. Migration `20260526000700_fix_snapshot_key_types.sql` corrected the existing handlers; future handlers must consult this column or repeat the bug.

**Naming-drift glossary** (read this if a function name reads as misspelled):
- `subcategory_*` vs `concern_subcategories_*` — `concern_subcategories` is the table name; function names use the shorter `subcategory_*` form for readability (pre-existing TS uploader naming).
- `concern_questions_per_category` ↔ `concern_category_upload` — kind name describes the data shape (questions, scoped per category); function name describes the operation (category upload — which handles both subcategories AND questions for one category).
- `concern_category_guidelines` (plural kind) ↔ `concern_category_guideline` (singular function) — kind name plural because the audit-log row records "guidelines changed"; function name singular because each operation acts on ONE row (composite PK is `(shop_id, category)` — one row per category).
- `concern_questions_required_facts_v2` ↔ `question_required_facts_v2` — kind name uses the table name (`concern_questions`); function uses the shorter `question_*` form.
- All `*_v2` suffixes — the 5 V2 uploaders/handlers are vintage-2 of pre-existing surfaces; kept verbatim to match the existing audit_log rows' `diff_summary.kind` value.

### TS wrapper (`revertMdUpload` in `scheduler-admin-catalog.ts`)

~50-60 lines. Responsibilities:
1. Pass through `dry_run` + `expected_confirm_token` parameters
2. Call `sb.rpc('revert_md_upload_attempt', {...}).single()` and unwrap
3. Classify on `outcome` (NOT `error_message`); emit Sentry per ADR-010 when outcome IN ('rejected','crashed')
4. Return structured `{ ok, outcome, reason_code, error_message, attempt_id, ... }` result

All dispatch + handler logic + audit-row INSERT lives in plpgsql RPCs.

---

## 8. Chat-instructions update (Claude Desktop)

Per research-03 §6, update `docs/chat-instructions/scheduler/` (path TBD — confirm during E9) to instruct the orchestrator on the two-step Pattern S flow for each refactored uploader:

```
For each `upload_*_md` tool:
  1. Call with required args (md_content) and OMIT `dry_run` — it defaults to true.
     The tool returns a diff + a `confirm_token`.
  2. Present the diff to the user. Get explicit "yes" in a NEW turn.
  3. Re-call with `dry_run: false` + `expected_confirm_token: <token from step 1>`.
```

HARD DEPLOY GATE (E11-pre): the chat-instructions PR must merge before E11a (orchestrator-mcp deploy). Verify with a structured Sentry canary: if `dry_run=false + expected_confirm_token unset` ever fires after E11a, the prompt update didn't land.

---

## 9. Build order

| Step | Action | Gate |
|---|---|---|
| E1a | Apply Migration A (Migration B files NOT YET in `supabase/migrations/` — staged under `supabase/migrations-staged/` per §3 staging note) | HUMAN GATE — `supabase db push` |
| E1b | Apply revert_md_upload_dispatch.sql | Same push |
| E1c | Apply revert_handlers_v2.sql | Same push |
| E1d | Apply revert_handlers_v2_subcategories.sql | Same push |
| E1e | Apply revert_handlers_legacy.sql | Same push |
| E1f | Apply apply_handlers_uploads.sql | Same push |
| E1g | Verify via `mcp__supabase__list_migrations` + `mcp__supabase__get_advisors` | — |
| E2 | Shared helpers (TS): `logAuditEntry()` consolidation; `canonicalizeDiff()`; `computeConfirmToken()`; **`computeCanonicalAfterState(kind, supabase, shopId, snapshot)` — 10 kind handlers emitting the pipe-delimited structured format per ADR-025.** Used by (a) E4 V2 catalog uploader modifications to populate `expected_after_state_canonical` post-write AND (b) revert-path diff diagnostics. The 5 NEW legacy apply RPCs (§4.1-4.5) compute their `expected_after_state_canonical` inside the plpgsql apply RPC via `canonical_state_<kind>` per ADR-024. **Byte-parity contract per ADR-025: `canonical_state_<kind>` (plpgsql) MUST equal `computeCanonicalAfterState()` (TS) for the same (shop_id, snapshot) — NOT against the existing TS MD exporters (which keep their admin-app UI role only).** | — |
| E3 | Backfill scripts authored: `scripts/backfill-snapshot-kind.ts` (writes snapshot_kind on existing V2 audit rows); `scripts/backfill-audit-log-shop-id.ts` per ADR-022 PHASE 1/2 | — |
| E4 | Update existing V2 uploaders to emit BOTH `expected_after_state_canonical` AND `after_hash` per §4.7 | — |
| E5 | Refactor 5 legacy uploaders → Pattern S (one PR per uploader: E5a guideline, E5b appointment_default_limits, E5c closed_dates, E5d concern_questions_flat, E5e concern_category) | — |
| E6 | Implement 2 new exporters per §5 | — |
| E7 | Implement `list_scheduler_admin_audit_log` tool per §6 + ADR-021 | — |
| E8 | Replace `revertMdUpload` with ~50-60-line TS wrapper per §7 | — |
| E9 | Update chat-instructions per §8 | HARD DEPLOY GATE — must merge before E11a |
| E10 | Write all tests (Vitest unit + pgTAP RLS + curl smoke battery) per §10 | — |
| E11a | `supabase functions deploy orchestrator-mcp` | HUMAN GATE |
| E11b | Run `backfill-snapshot-kind.ts` against test branch | HUMAN GATE |
| E11c | Run `backfill-audit-log-shop-id.ts` PHASE 1 (derive-only) | HUMAN GATE |
| E11d | Chris reviews PHASE 1 report; if M>0: backfill manually OR re-run with `--apply-sentinel-now` (PHASE 2) | HUMAN GATE |
| E11e | Move Migration B files from `supabase/migrations-staged/` → `supabase/migrations/` (both `_part_b1_set_not_null.sql` and `_part_b2_concurrent_indexes.sql`); then `supabase db push` — applies both new files in lexicographic order (Part B1 transactional first, Part B2 with `-- supabase: skip-tx-wrap` second) | HUMAN GATE |
| E11f | Live smoke battery (per §10) | — |
| E12 | Resume schedulerconfig feature | — |

---

## 10. Testing approach

Mirrors existing test patterns in `tools/scheduler-admin-catalog.test.ts` (pure helpers, Deno-native, JSR `@std/assert`).

### Per-uploader (E5a-e)

18 test cases per uploader from research-03 §8 — focus on diff + token determinism, dry_run never writes, token mismatch path, FK-broken handling. Extract `computeXyzDiff(currentRows, parsedRows)` as a pure helper.

### Per-exporter (E6)

Round-trip: `parseFn(serializeFn(state)) === state`. One test per exporter per research-02 §8. DB-backed smoke: `upload(export(current)) === no-op` (relies on SHA-256 duplicate-upload fast-path).

### Audit-log read tool (E7)

Pure-fn eligibility computation: feed synthetic audit rows, assert correct `reasons[]` for each rejection cause per ADR-021. 9 rejection causes × 2 (eligible/ineligible boundary) = 18 cases minimum. Plus surface-filter conditional-fallback tests (modern surfaces[] match vs legacy table_name fallback vs NULL diff_summary safety).

### Revert extension (E8) — pgTAP + Deno

Per research-04 §8: ~7 cases per new handler + 7 shared-invariant cases. SQL test files run via `supabase test db` against the local Supabase test instance:

- `supabase/tests/database/revert_handlers.test.sql` — pgTAP tests for the 10 revert handlers (Invariant 1 RIGHT pattern, Invariant 5 row-count check, Invariant 6 FK validation)
- `supabase/tests/database/dispatch_helpers.test.sql` — pgTAP tests for `lock_targets_for_kind` (10 branches) + `compute_current_canonical_for_kind` (dispatch + each canonical_state_\<kind\>) + `compute_unified_diff` (FILTER aggregate + truncation marker)
- **Byte-parity tests for ADR-025 contract** — for each of the 10 kinds, an integration test that: (1) seeds known table state for `(shop_id, snapshot_scope)`, (2) calls `canonical_state_<kind>(shop_id, snapshot)` plpgsql via Supabase RPC, (3) calls `computeCanonicalAfterState(kind, supabase, shopId, snapshot)` TS helper from E2, (4) asserts the two TEXT outputs are byte-for-byte identical. Drift surfaces as test failure, not as production false-positive `current_state_drift`
- `supabase/tests/database/revert_outer_inner.test.sql` — pgTAP for outer RPC EXCEPTION classifier (per ADR-008 — every canonical enum + the snapshot_kind_unknown→crashed reclassification) + STEP 0d upload-existence pre-check (per ADR-002)

Plus 5 Deno smoke tests (one per refactored uploader) + 1 audit-log-list test file.

### Live smoke (E11f) — curl battery

- Each refactored uploader with `dry_run` omitted → assert `dry_run: true` + `confirm_token` populated
- Each with `dry_run: false, expected_confirm_token: <wrong>` → assert `outcome='rejected', reason_code='confirm_token_mismatch'`
- Each with correct token → assert apply succeeds + `audit_log_id` returned
- Audit-log read tool → assert each returned row has populated `revert_eligibility`
- Revert dry_run happy path: `outcome='dry_run_success'`, attempt row written
- Revert dry_run + non-null token → `outcome='rejected', reason_code='dry_run_token_present'` (per ADR-007)
- Revert apply concurrent-edit race (X13): assert `outcome='rejected', reason_code='current_state_drift'` (canonical enum per ADR-007 — NOT `staleness_check_failed` which is the inner-RPC RAISE prefix)
- Step-ordering audit (instrument NOTICE on each step; strip after pass)
- Concurrent revert: spawn 2 parallel apply calls on same upload_id → one succeeds, other fails with `another_revert_in_progress` OR `successor_revert_exists`
- Cross-shop isolation: one shop's actor on another shop's audit row → `outcome='rejected', reason_code='not_found'` per ADR-002 STEP 0d
- Per-kind lock_targets_for_kind sanity (each of 10 kinds): valid snapshot → `v_lock_count > 0`; nonexistent snapshot key → `v_lock_count = 0` (acceptable — staleness check at step 6 catches divergence)

---

## 11. File inventory

### New files (14)

**Migrations (7):**
- `supabase/migrations/20260526000000_scheduler_admin_audit_log_hardening_part_a.sql`
- `supabase/migrations/20260526000001_audit_log_concurrent_indexes.sql` (Part 2a — one_successful_revert)
- `supabase/migrations/20260526000002_audit_log_idx_shop_recent.sql` (Part 2b)
- `supabase/migrations/20260526000003_audit_log_idx_surface_recent.sql` (Part 2c)
- `supabase/migrations/20260526000004_audit_log_idx_surfaces_gin.sql` (Part 2d)
- `supabase/migrations/20260526000100_revert_md_upload_dispatch.sql`
- `supabase/migrations/20260526000200_revert_handlers_v2.sql`
- `supabase/migrations/20260526000300_revert_handlers_v2_subcategories.sql`
- `supabase/migrations/20260526000400_revert_handlers_legacy.sql`
- `supabase/migrations/20260526000500_apply_handlers_uploads.sql`
- `supabase/migrations/20260526000600_list_audit_log_rpc.sql` (E7 — added 2026-05-26)
- `supabase/migrations/20260526100000_scheduler_admin_audit_log_hardening_part_b1_set_not_null.sql`
- `supabase/migrations/20260526100001_scheduler_admin_audit_log_hardening_part_b2_concurrent_indexes.sql`

**Scripts (2):**
- `scripts/backfill-snapshot-kind.ts`
- `scripts/backfill-audit-log-shop-id.ts`

**Tests (5):**
- `supabase/tests/database/revert_handlers.test.sql` (pgTAP)
- `supabase/tests/database/dispatch_helpers.test.sql` (pgTAP)
- `supabase/tests/database/revert_outer_inner.test.sql` (pgTAP)
- `supabase/functions/_shared/tools/scheduler-admin-legacy.test.ts` (Deno; 5 refactored uploaders + canonicalizeDiff)
- `supabase/functions/_shared/tools/scheduler-admin-audit-log-list.test.ts` (Deno; 9-reason union per ADR-021)

### Modified files (4)

- `supabase/functions/_shared/scheduler-admin-md.ts` — add `computeConfirmToken` + `logAuditEntry()` consolidated helper + `canonicalizeDiff` + `computeCanonicalAfterState(kind, supabase, shopId, snapshot)` per ADR-025 (10 kind handlers emitting the canonical pipe-delimited format byte-for-byte matching `canonical_state_<kind>` plpgsql output; used by E4 V2 uploader modifications AND revert-path diff diagnostics)
- `supabase/functions/_shared/tools/scheduler-admin.ts` — refactor 5 uploaders + add 2 exporters; ~+500 / -300 lines net
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` — REPLACED `revertMdUpload` with ~50-60-line TS wrapper per §7 (calls outer RPC via `sb.rpc(...).single()`; classifies on `outcome`; Sentry emission per ADR-010)
- `supabase/functions/_shared/scheduler-tools.ts` — update 5 legacy tool blocks for Pattern S; add 2 exporter blocks; add 1 new list-audit-log block; ~+150 / -50 lines net

### Updated docs (4)

- `docs/chat-instructions/scheduler/` — add two-step flow doc per §8
- `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` — already contains SEC-12 through SEC-16 (no edits needed; cross-referenced by ADRs)
- `docs/scheduler/future-release-notes.md` — note orchestrator-side breaking change (dry_run default change)
- `.claude/memory/scheduler_system_architecture.md` — update Pattern S inventory + revert dispatch shape (per MEMORY.md rule)

---

## 12. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Migration A or B fails to apply; OR backfill script PHASE 1 surfaces residual NULL rows that operator doesn't gate-approve via PHASE 2 → Migration B's HARD CHECK aborts | Apply to test branch FIRST; verify via `mcp__supabase__get_advisors`; staged commit so test-branch rollback is `git revert` + `supabase db reset` (NOT for production — production uses forward migration / restore) |
| Snapshot-kind backfill heuristic misclassifies an existing V2 row | Deno script logs every classification decision; manual spot-check; idempotent so re-run is safe |
| Refactoring `uploadConcernCategoryMd` (most complex 2-table uploader) introduces a regression | Pure-fn diff helper makes diff phase unit-testable; live smoke before deploy; revert-from-snapshot is the safety net if a bad upload lands |
| Claude Desktop chat-instructions update misses the deploy window → every admin upload silently no-ops for hours | HARD DEPLOY GATE per E9 + E11-pre; smoke test via Claude Desktop immediately post-deploy; structured Sentry canary fires if dry_run=false + missing token happens |
| Outer/inner RPC pair returns `55P03` (lock_not_available) under unrelated long-running queries holding the parent audit row | Outer's classifier maps `55P03` → `another_revert_in_progress` per ADR-007; TS wrapper surfaces clean "another revert is in progress" error; client retries OK |
| Absent-key TOCTOU race materializes in production (per ADR-015) — silent overwrite of concurrent same-shop insert | Operational risk bounded by single-shop / single-admin deployment profile; audit-log forensics monitoring per ADR-015 detects post-hoc; Phase 1.5 (SEC-15) lands proper fix if observed |
| DB layer can't authorize `p_shop_id` (per ADR-016 L1 limit) — compromised service_role bearer could pass any shop_id | orchestrator-mcp is the trust boundary; 4-layer defense closes everything DOWN-stream; future evolution path (employees table + auth.uid()) documented |
| Tests rely on chainable Supabase mock that doesn't exist yet | Keep diff-computation pure; defer apply-path tests to pgTAP + curl smoke; if a mock is needed later, mirror `_shared/test-helpers.ts:createMockSupabaseClient()` |

---

## 13. Cross-verify checklist

After E10 completes (all tests written), run:

```bash
node scripts/ai-review.mjs \
  --what "scheduler-edge-parity implementation: outer/inner two-RPC revert dispatch (ADR-001) + 5 Pattern-S refactored uploaders + 5 apply RPCs + 10 revert handlers + scheduler_admin_revert_attempts table + audit-log read tool + 2 new exporters + Migration A/B split + chat-instructions update + TS-wrapper Sentry emission" \
  supabase/functions/_shared/scheduler-admin-md.ts \
  supabase/functions/_shared/tools/scheduler-admin.ts \
  supabase/functions/_shared/tools/scheduler-admin-catalog.ts \
  supabase/functions/_shared/scheduler-tools.ts \
  supabase/migrations/20260526000000_*.sql \
  supabase/migrations/20260526000100_*.sql \
  supabase/migrations/20260526000200_*.sql \
  supabase/migrations/20260526000300_*.sql \
  supabase/migrations/20260526000400_*.sql \
  supabase/migrations/20260526000500_*.sql \
  supabase/migrations/20260526100000_*.sql \
  scripts/backfill-snapshot-kind.ts \
  scripts/backfill-audit-log-shop-id.ts
```

Plus an ADR-conformance cross-verify before /feature-implement:

```bash
node scripts/ai-review.mjs \
  --what "scheduler-edge-parity ADR collection — 24 ADRs + lean PLAN.md; check for contradictions BETWEEN ADRs (each ADR should be internally consistent + cross-references should resolve) AND between ADRs + PLAN.md" \
  docs/scheduler/edge-parity/PLAN.md \
  docs/scheduler/edge-parity/decisions/INDEX.md \
  docs/scheduler/edge-parity/decisions/ADR-001-outer-inner-two-rpc-split.md \
  docs/scheduler/edge-parity/decisions/ADR-002-attempt-row-insertion-contract.md \
  # ... (all 24 ADRs)
```

---

## 14. Open questions

None blocking. The 24 ADRs cover every locked decision. If a new design question arises during implementation:
1. Write a new ADR in `decisions/ADR-NNN-{slug}.md` documenting the decision
2. If it supersedes an existing ADR, update the Supersedes/Superseded-by headers in both
3. Update `decisions/INDEX.md` to add the new ADR row
4. Cross-reference from the relevant PLAN.md section
5. NEVER edit accepted ADRs

Deferred operational follow-ups (in `docs/scheduler/DEFERRED-AUDIT-ITEMS.md`):
- **OBS-9** — retention cron for `scheduler_admin_revert_attempts` (designed 90-day online → archive at 91 → hard-delete at 365)
- **SEC-12** — forward-looking guard: any future closed_dates mutation path must adopt the 2-arg advisory lock pattern (per ADR-013)
- **SEC-13** — schema-stability guard: future migration dropping a natural composite unique key must extend lock_targets_for_kind advisory locks
- **SEC-14** — trigger enforcing `revert_audit_log_id` semantic correctness (currently outer RPC is only writer)
- **SEC-15** — Phase 1.5: extend lock_targets_for_kind with advisory key-namespace locks for all kinds + 5 apply RPCs (per ADR-015 — closes the open absent-key TOCTOU race)
- **SEC-16** — trigger enforcing `attempts.shop_id = referenced upload.shop_id` (currently outer RPC STEP 0d is only enforcer)
