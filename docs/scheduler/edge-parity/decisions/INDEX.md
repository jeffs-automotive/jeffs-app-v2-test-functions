# scheduler-edge-parity — Architecture Decision Records (ADR) INDEX

**Created:** 2026-05-26 — after 3 rounds of cross-verify on the original v0.5+IMPORTANTs+round3 monolithic plan accumulated unfixable contradictions across ~4300 lines. Restructured into ADR pattern per industry standard (AWS Prescriptive Guidance, Microsoft Azure WAF, IcePanel).

**Why ADRs:** Each ADR is IMMUTABLE once accepted **and the feature has shipped**. If a decision changes post-ship, write a NEW ADR that supersedes the prior one. Old ADR's status changes to `Superseded by ADR-NNN`. This pattern prevents the contradiction-accumulation problem that plagued the v0.1–v0.5+IMPORTANTs+round3 monolithic plan: every "fix" added text without removing prior contradicting text.

**Pre-implementation cross-verify exception (documented 2026-05-26 after rounds 4-5):** during the pre-implementation cross-verify cycle (rounds 4, 5, 6+ before any `/feature-implement` happens), accepted ADRs MAY be edited in-place to close BLOCKER / IMPORTANT findings from cross-verify. The edit is documentation hygiene, not a decision change — the canonical answer doesn't shift, just gets sharper. Each edit cycle's changes are recorded in the marker file's `adr_fix_iteration_*` entry + each affected ADR's `Supersedes` line lists the `ADR-Fix #N` ID. Post-implementation (first migration applied OR first commit on the implement branch), in-place edits STOP and the supersession protocol takes over. Rationale: pre-ship edits avoid the explosion of ADR-Fix-corrigendum ADRs that would result from writing a new superseder for every minor inline correction; post-ship the supersession rigor matters because the prior ADR's claims are baked into deployed code.

**How to read these:**
- This `INDEX.md` is the table of contents — links every ADR + 1-sentence canonical answer
- Each ADR is its own file: `ADR-NNN-{slug}.md`, 50-100 lines
- The lean `../PLAN.md` references ADRs by number — never duplicates a decision

**Archived materials:**
- Original PLAN.md: `../archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` (4326 lines, accumulated contradictions from 27 incremental fixes)
- 26 cross-verify artifacts: `.claude/work/archive/edge-parity/cross-verify-history/`
- Research artifacts: `../research/research-{01-04}-*.md` (still valid input)
- Deferred audit items: `../../DEFERRED-AUDIT-ITEMS.md` (SEC-12 through SEC-16 cover this feature)

---

## ADR template (every file must conform)

```markdown
# ADR-NNN: {Decision title}

**Status:** Accepted (2026-05-26)
**Supersedes:** {list of X-FIX-#N markers / prior decisions from archived PLAN.md}
**Superseded by:** (none)

## Context
{1-3 paragraphs: what's the situation, what problem are we solving, what constraints apply}

## Decision
{1-3 paragraphs: ONE canonical answer. SQL/code examples if needed. NO history, NO alternatives "we considered." Just the active decision.}

## Consequences
{1-3 paragraphs: what this enables, what it costs, what's now harder, what's now impossible}

## Sources
- Archived PLAN.md section reference: `archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §{section}
- Cross-verify findings: `.claude/work/archive/edge-parity/cross-verify-history/{filename}` — {finding ID/quote}
- Related ADRs: ADR-{N}, ADR-{M}
```

---

## The 25 canonical decisions (ADR-024 §3 partially superseded by ADR-025 — see Helpers cluster)

### Architecture (6 ADRs)

| ADR | Decision | Canonical answer |
|---|---|---|
| **ADR-001** | Outer/inner two-RPC split | `revert_md_upload_attempt` (outer, public-facing) wraps `revert_md_upload_apply` (inner, dispatch + handlers) in PL/pgSQL `BEGIN…EXCEPTION`. Outer returns structured outcome for any INNER-path result and the EXCEPTION block never re-RAISEs. STEP 0a/0b/0c (pre-inner parameter guards) RAISE per Postgres convention BEFORE the EXCEPTION block opens (ADR-002 Branch 3); STEP 0d returns Branch-2 `rejected/not_found` without RAISE. Inner RAISEs on any failure. |
| **ADR-002** | Attempt-row insertion contract | Outer RPC inserts a `scheduler_admin_revert_attempts` row IF parameters are valid AND upload exists in caller's tenant (STEP 0d pre-check). Calls that fail STEP 0 RAISE per Postgres convention. Nonexistent-upload calls return `{outcome: 'rejected', reason_code: 'not_found', attempt_id: NULL}` without writing a row. |
| **ADR-003** | PL/pgSQL transaction-control pattern | Use nested `BEGIN…EXCEPTION WHEN OTHERS THEN END` block, NOT literal `SAVEPOINT` SQL (which doesn't compile in PL/pgSQL functions). When prose says "SAVEPOINT" it means the BEGIN/EXCEPTION block. Inner is a function (`SELECT FROM`), not a procedure (`CALL`). |
| **ADR-004** | Universal handler return shape | Every revert handler returns `TABLE(restored INT, deactivated INT, deleted INT, details JSONB)`. The 4th `details` column is JSONB metadata (9 handlers return `'{}'::JSONB`; only `revert_closed_dates_future` populates `{skipped_past_dates_restore, skipped_past_dates_delete}`). Outer's audit-row INSERT merges `details` into `diff_summary` via JSONB concat. |
| **ADR-005** | Outer-callable entry points vs internal set (extended per ADR-Fix #21 + E7) | 7 outer-callable entry points carry full `REVOKE PUBLIC/anon/authenticated + GRANT TO service_role` triple: `revert_md_upload_attempt` (outer RPC, ADR-001 audit guarantee) + 5 apply RPCs (`apply_concern_questions_flat_upload`, `apply_concern_category_upload`, `apply_concern_category_guideline_upload`, `apply_appointment_default_limits_upload`, `apply_closed_dates_upload` — each with Pattern S dry_run + expected_confirm_token guard INSIDE the RPC body) + **`list_scheduler_admin_audit_log_filtered`** (NEW E7, read-only RPC for the audit-log read tool per ADR-021). 15 internal functions carry NO GRANT to service_role (REVOKE triple plus explicit `REVOKE FROM service_role`): inner RPC `revert_md_upload_apply` + 10 revert handlers + 4 helper families (`lock_surface_for_kind`, `lock_targets_for_kind`, `compute_current_canonical_for_kind`, 10 × `canonical_state_<kind>`, `compute_unified_diff`). Internal functions are callable ONLY via SECURITY DEFINER ownership chain from one of the 7 outer-callable entry points. |
| **ADR-006** | Migration apply order — timestamp-aligned, dispatch first, Migration B split + staged | Migrations apply in lexicographic filename order (Supabase CLI behavior): 00000 part_a → 00100 dispatch → 00200/00300/00400 handlers → 00500 apply_handlers_uploads → 100000 part_b1_set_not_null (transactional) → 100001 part_b2_concurrent_indexes (`-- supabase: skip-tx-wrap` directive). Migration B's two files are COMMITTED under `supabase/migrations-staged/` until E11e (operator moves them into `supabase/migrations/` after backfill PHASE 2 confirmation, then runs `supabase db push`). Dispatch RPC CREATEs cleanly even though handlers don't exist yet because PL/pgSQL defers function-body symbol resolution to CALL time. Apply RPCs (00500) depend on `canonical_state_<kind>` serializers from dispatch (00100). The PLAN §9 prose ordering and the file timestamp ordering MUST match. |

### Reason code & error handling (5 ADRs)

| ADR | Decision | Canonical answer |
|---|---|---|
| **ADR-007** | Canonical reason_code enum | The full closed allow-list of `reason_code` values lives in this ADR's table. Every `RAISE EXCEPTION 'revert_blocked: <enum>: <verbose>'` callsite uses an enum from the list. Enum names use `[a-z0-9_]+` and never lead with a digit (e.g., `over_30_day_cutoff`, NOT `30_day_cutoff`). |
| **ADR-008** | Classifier extracts enum prefix via regex + allow-list | Outer's EXCEPTION block extracts `reason_code` via `substring(v_sqlerrm from 'revert_blocked:\s+([a-z0-9_]+)')` + IN(…) allow-list check. Unknown values map to `'unclassified_revert_blocked'` (Sentry-safe fallback that surfaces but doesn't leak). Verbose text after the second colon flows to `error_detail` (DB-only). |
| **ADR-009** | Sanitized public-facing error_message | Outer RPC's RETURN row sets `error_message := v_sanitized_error_message` (CASE on `outcome × reason_code` → templated short summary that includes only `attempt_id` for operator pivot). Raw `v_sqlerrm` (which can carry inline staleness diff with customer-facing scheduler MD) flows ONLY to `error_detail` (DB-only). |
| **ADR-010** | Three-tier redaction policy | Each surface (Sentry / RPC return → TS / DB attempt row) gets a different redaction level. Canonical table: `reason_code` everywhere; `error_message` sanitized in Sentry+RPC, not in DB (no such column); `error_detail` DB-only; `attempt_id` everywhere as pivot key; `actor_email` Sentry+DB; `confirm_token` never (hash only in DB). |
| **ADR-011** | snapshot_kind_unknown reclassified to crashed | The classifier special-cases `snapshot_kind_unknown` to `outcome='crashed'` (system bug — missing handler for a kind that passed eligibility) instead of the default `revert_blocked:` → rejected mapping. Engineering on-call is paged; operators are NOT told to "try again later" for a problem requiring deploy. |

### Concurrency / TOCTOU (4 ADRs)

| ADR | Decision | Canonical answer |
|---|---|---|
| **ADR-012** | Lock-targets-before-staleness ordering | Inner RPC step 4 (`lock_targets_for_kind`) runs BEFORE step 5 (compute current canonical) and step 6 (staleness check). Closes X13 lost-update window. Locks are held through steps 5/6/7+ until inner RPC commits or rolls back. |
| **ADR-013** | closed_dates per-date advisory lock — surface-lock-FIRST + per-date sorted | Both apply AND revert paths take `lock_surface_for_kind(p_shop_id, 'closed_dates_future')` FIRST per ADR-024, THEN `pg_advisory_xact_lock(p_shop_id::INT, hashtext(v_date::TEXT))` for every date in the operation set, in sorted-date order via PL/pgSQL `FOR LOOP` (sorted in a subquery alone doesn't guarantee execution order). The 2-arg form is the canonical form (NOT the legacy single-arg `hashtext('closed_date:...')`). Shop_id in high 32 bits + date hash in low 32 bits = 64-bit collision space. |
| **ADR-014** | force_no_after_hash 3-branch logic | (1) Hard fail / accept force only when truly blind (both `after_hash` AND `expected_after_state_canonical` absent). (2) Hash fast-path when `after_hash` present. (3) Canonical fallback ALWAYS fires when `after_hash` absent but canonical present — force flag does NOT bypass canonical-vs-current comparison. |
| **ADR-015** | Absent-key TOCTOU honest analysis + Phase 1.5 deferral | The absent-key race is OPEN for UPSERT-restore-of-originally-DELETED-row + apply-INSERT-of-new-key on the 4 non-closed_dates surfaces. Canonical drift detection does NOT close it (both readings show "absent"). Proper fix (extend `lock_targets_for_kind` advisory key-namespace locks to all kinds) deferred to Phase 1.5 (DEFERRED-AUDIT-ITEMS.md SEC-15). Bounded by single-shop/single-admin operational profile. Audit-log forensics monitoring documented for race-incident detection. |

### Multi-tenant security (4 ADRs)

| ADR | Decision | Canonical answer |
|---|---|---|
| **ADR-016** | 4-layer multi-tenant defense | (L1) Caller identity at orchestrator-mcp (SERVICE_ROLE + X-Actor-Email OR OAuth bearer). (L2) DB-layer REVOKE EXECUTE FROM PUBLIC/anon/authenticated + GRANT TO service_role on every SECURITY DEFINER function. (L3) STEP 0a/0b/0c/0d presence + sanity guards inside RPCs. (L4) Handler Invariants 5 (cross-shop UPSERT-hijack row-count check) + 6 (FK target tenant validation). NOTE: this is NOT complete tenant authorization — a service_role caller can still pass a foreign `p_shop_id`. The model assumes orchestrator-mcp is the trust boundary for shop_id authorization. |
| **ADR-017** | SECURITY DEFINER search_path = pg_catalog, extensions, public, pg_temp | Every SECURITY DEFINER function in the feature sets `SET search_path = pg_catalog, extensions, public, pg_temp`. pg_catalog first hardens against pg_catalog-builtin shadowing. extensions second so unqualified `digest(...)` from pgcrypto resolves to `extensions.digest(...)` (Supabase installs pgcrypto to `extensions` schema). public third for project tables. pg_temp LAST forces explicit ordering — without an explicit entry, PostgreSQL searches pg_temp implicitly FIRST, allowing a session-created TEMP TABLE to shadow privileged unqualified references. |
| **ADR-018** | RLS RESTRICTIVE deny-all policies on both tables | Both `scheduler_admin_audit_log` (existing) and `scheduler_admin_revert_attempts` (new) get RESTRICTIVE deny-all RLS policies. RESTRICTIVE is logical-AND with PERMISSIVE policies, so any future PERMISSIVE allow policy is forced false. Defensive ENABLE RLS before policy creation. Policy creation wrapped in DO-block (catch `duplicate_object`) for idempotency. |
| **ADR-019** | Handler invariants — UPSERT pattern + row-count + FK validation | (Invariant 1) `INSERT … ON CONFLICT (id) DO UPDATE … WHERE target.shop_id = p_shop_id` skips foreign-shop conflict-targets instead of hijacking. (Invariant 5) Post-write row-count comparison RAISEs `cross_shop_hijack_attempt` if expected > actual writes. (Invariant 6) FK target tenant pre-validation RAISEs `fk_target_tenant_mismatch` (canonical enum is `fk_broken` per ADR-007; this is the inline RAISE prefix that maps to `fk_broken` per the classifier). |

### Schema (3 ADRs)

| ADR | Decision | Canonical answer |
|---|---|---|
| **ADR-020** | scheduler_admin_revert_attempts table | New table at Migration A. Columns: `id BIGSERIAL PK`, `attempted_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ NULL`, `upload_id BIGINT NOT NULL REFERENCES scheduler_admin_audit_log(id) ON DELETE RESTRICT`, `shop_id INTEGER NOT NULL CHECK (shop_id > 0)`, `actor_email TEXT`, `oauth_client_id TEXT`, `dry_run BOOLEAN NOT NULL`, `outcome TEXT NOT NULL CHECK IN ('pending','dry_run_success','success','rejected','crashed')`, `reason_code TEXT NULL`, `error_detail TEXT NULL`, `metadata JSONB NULL`, `dry_run_confirm_token_hash TEXT NULL`, `revert_audit_log_id BIGINT NULL REFERENCES scheduler_admin_audit_log(id)`. 5 named pairwise-scope CHECK constraints (token_hash_scope, completed_at_invariant, audit_log_scope, dry_run_outcome_scope, success_field_scope) plus 1 inline `CHECK (shop_id > 0)` on the shop_id column. See ADR-020 body for full DDL + index list. |
| **ADR-021** | Audit-log read tool surface filter + reasons union | Surface filter is conditional fallback: `WHERE (COALESCE(diff_summary ? 'surfaces', FALSE) AND diff_summary->'surfaces' ? <surface>) OR (NOT COALESCE(diff_summary ? 'surfaces', FALSE) AND table_name = <mapped_table>)`. Wrapper passes 2 params: surface verbatim + mapped physical table name. `revert_eligibility.reasons` union has 9 cheap-to-compute values, a STRICT SUBSET of ADR-007's canonical enum. |
| **ADR-022** | scheduler_admin_audit_log Migration A + Migration B + backfill script | Migration A: additive (shop_id NULLABLE, successor_revert_id, reverts_upload_id, 4 indexes including GIN on `diff_summary->'surfaces'`, RESTRICTIVE RLS policy). Backfill script (Deno) phase 1 derives shop_id; phase 2 gated sentinel UPDATE NULL→-1. Migration B: idempotent DO-block ADD CONSTRAINT `(shop_id > 0 OR shop_id = -1)`, ALTER TABLE … SET NOT NULL on shop_id, DROP/CREATE INDEX CONCURRENTLY outside BEGIN block for lock-window safety. |

### Helpers (3 ADRs)

| ADR | Decision | Canonical answer |
|---|---|---|
| **ADR-023** | compute_unified_diff helper | Single CTE statement with FILTER aggregate: `SELECT string_agg(...) FILTER (WHERE diff_row <= p_max_lines), COUNT(*) INTO v_diff_lines, v_total_diffs FROM numbered`. Line-aligned diff (NOT a true LCS unified diff — name retained for compat). Truncation marker fires when total > p_max_lines. Used only on staleness rejection slow path. |
| **ADR-025** | canonical_state_<kind> emits pipe-delimited structured format (NOT mirror existing TS MD exporters) | Per E1b dispatch-author Open Item #1 (2026-05-26): `canonical_state_<kind>` plpgsql serializers emit stable structured `\| col1=value1 \| col2=value2 \|` per-row format aggregated per (shop_id, snapshot). Byte-parity contract is between `canonical_state_<kind>` (plpgsql) and a NEW `computeCanonicalAfterState()` TS helper (E2), NOT against the existing TS MD exporters (which keep their admin-app UI role only). Closes the cosmetic-drift false-positive class. Supersedes ADR-024 §3 "Mirrors" column wording. |
| **ADR-024** | Dispatch helpers — lock_surface_for_kind + lock_targets_for_kind (Phase 1+Phase 2) + canonical_state_<kind> + compute_current_canonical_for_kind | 4 helpers in `20260526000100_revert_md_upload_dispatch.sql`. **`lock_surface_for_kind(shop_id, kind)`** — MANDATORY first call by every surface writer (revert RPC + 5 apply RPCs + SEC-17 future writers); takes per-`(shop_id, kind)` advisory transaction lock. `lock_targets_for_kind(kind, shop_id, snapshot)` — Phase 1: delegates to lock_surface_for_kind; Phase 2: 10 CASE branches with per-row / per-key locks (CCG keyed by category slug, ADL/others keyed by id, branches with adds union BEFORE keys ∪ added_keys). `compute_current_canonical_for_kind(kind, shop_id, snapshot)` — dispatches to one of 10 `canonical_state_<kind>(shop_id, snapshot)` serializers. **Each `canonical_state_<kind>` reads target table(s) for the snapshot's scope + serializes to stable pipe-delimited structured format per ADR-025 (NOT mirror existing TS MD exporters — §3 "Mirrors" column wording is superseded).** Lock acquisition order across ALL writers: surface lock FIRST, then per-row/per-key/per-date in canonical sorted order. |

---

## Dispatch brief for parallel ADR-writing agents

Each ADR-writing agent gets:
1. The Index entry for ITS ADR (decision + canonical answer)
2. Verbatim source quotes from the archived PLAN.md + relevant cross-verify findings
3. The ADR template
4. Strict instructions: write ONLY `decisions/ADR-NNN-{slug}.md`; do NOT edit other files; do NOT read other ADRs (avoid contradiction propagation); use the canonical answer from the Index as the load-bearing answer
5. Output length target: 50-100 lines per ADR

Agents dispatched in waves (4-6 in parallel per wave) to manage transcript noise. Total: ~3-4 hours wall-clock.
