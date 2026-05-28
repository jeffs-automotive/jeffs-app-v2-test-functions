# Round-6 cross-verify residuals — punch-list for builders

## CLOSURE STATUS — edge-parity SHIPPED (2026-05-26, commit `4443d77`)

| Group | Status | Where to verify |
|---|---|---|
| R6-B1 — ADR-005 inventory count | CLOSED in E1b | Migration `20260526000100_revert_md_upload_dispatch.sql` applies NO-GRANT triple per signature; verified via `pg_proc` query post-Migration B. ADR-005 now says "25 internal functions." |
| R6-B2 — `lock_surface_for_kind` missing from inventory | CLOSED in E1b | Function exists in `20260526000100`; PLAN.md §3 + ADR-006 + ADR-INDEX updated. |
| R6-B3 — `canonical_state_concern_category_upload` scope | CLOSED in E1b | Serializer covers BOTH `concern_subcategories` + `concern_questions` per category; aligns with `exportConcernCategoryMd` from E6. |
| R6-B4 — ADR-005 Consequences stale "GRANT TO service_role" wording | CLOSED in ADR-Fix #21 + #22 (Restructure round 4) | Consequences paragraph rewritten; only 6 outer-callable entry points carry GRANT, all 25 internal functions follow NO-GRANT pattern. |
| Round-6 IMPORTANTs (R6-I1–N) | Mostly CLOSED via subsequent ADR-Fix rounds + 21 Migration B fixes (Fix #1–#27) | See `.claude/memory/scheduler/scheduler_system_architecture.md` §8 + §13. Any residual operational items absorbed into `docs/scheduler/DEFERRED-AUDIT-ITEMS.md`. |
| E10 — pgTAP + Vitest test matrix | PENDING — separate /feature-start cycle | Per PLAN §10; tracked at task #223 in session state + listed under "Known deferred items" in scheduler arch doc § 15 (TEST-4). |

**E1b status update (2026-05-26):** Migration A (E1a) + dispatch migration (E1b) authored. R6-B1 + R6-B2 + R6-B3 + R6-B4 all CLOSED in E1b. Sub-agent author surfaced 7 new open items; Chris's call: accept agent's pipe-delimited canonical-format design → ADR-025 written as supersession of ADR-024 §3. 2 surgical fixes applied inline (closed_dates id removal + WITH ORDINALITY for required_facts). 3 new E1b-derived coordination items added below (E1b-N1 / E1b-N2 / E1b-N3).


**Status:** Documented 2026-05-26 at the close of pre-implementation cross-verify (6 rounds total: 3 monolithic-plan rounds → ADR restructure → 3 ADR-fix rounds). Chris's call: ship to `/feature-implement` and let builder agents close these as they go.

> **Note (2026-05-27 doc-consolidation pass):** This file documented the punch-list AT THE TIME OF /feature-implement transition. The work has now shipped. Per-residual closure happened across many commits + ADR-Fix rounds; the table above gives the high-level resolution map. The full residual list below is preserved as a historical reference for the builder mindset — DO NOT mark new BLOCKERs against this file.

**Trend:** 16 → 6 → 4 → 4 BLOCKERs across rounds 3-6. The final 4 BLOCKERs are documentation drift introduced BY the round-5 fixes themselves (count math + missing-function-in-inventory), NOT structural design problems. The design itself stabilized after round-4 ADR restructure.

**How builders should use this file:** read it BEFORE starting any migration / SQL / TS implementation. Each residual has a specific anchor point in the codebase + the canonical resolution. Builders MUST close every BLOCKER as part of their implementation work; IMPORTANTs are strongly preferred but can be deferred IF surfaced explicitly.

---

## BLOCKERs (close during implementation, not after)

### R6-B1 · ADR-005 inventory says "15 internal functions" — actual count is 25

- **Where it appears:** `docs/scheduler/edge-parity/decisions/ADR-005-outer-only-service-role-entry-point.md` heading + "Internal set" intro paragraph + table heading
- **Math:** 1 inner RPC + 10 revert handlers + 1 `lock_surface_for_kind` + 1 `lock_targets_for_kind` + 1 `compute_current_canonical_for_kind` + 10 `canonical_state_<kind>` serializers + 1 `compute_unified_diff` = **25 functions**
- **Resolution:** when implementing migration `20260526000100_revert_md_upload_dispatch.sql` (and the handler migrations 00200/00300/00400), apply the canonical NO-GRANT triple to EVERY internal function — count by signature, not by "family":
  ```sql
  REVOKE EXECUTE ON FUNCTION public.<name>(<arg list>) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.<name>(<arg list>) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.<name>(<arg list>) FROM service_role;
  ```
- **Verify post-apply:** `SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND proname IN (<25 names>);` then for each, `SELECT has_function_privilege('service_role', p.oid, 'EXECUTE') FROM pg_proc p WHERE proname = '<name>';` MUST return `false` for all 25.

### R6-B2 · `lock_surface_for_kind` missing from migration inventories

- **Where it appears:**
  - `docs/scheduler/edge-parity/PLAN.md` §3 migrations table row for `20260526000100_revert_md_upload_dispatch.sql` lists outer + inner RPCs + lock_targets_for_kind + compute_current_canonical_for_kind + 10 canonical_state_<kind> + compute_unified_diff — but NOT `lock_surface_for_kind`
  - `docs/scheduler/edge-parity/decisions/ADR-006-migration-apply-order.md` E1b row has the same omission
  - `docs/scheduler/edge-parity/decisions/INDEX.md` ADR-006 canonical-answer summary
- **Why it's load-bearing:** `lock_surface_for_kind` is the cornerstone of Phase 1 (per ADR-024 + ADR-Fix #17 + #22 + #23). Without it implemented, the 5 NEW apply RPCs + inner revert RPC's `lock_targets_for_kind` Phase 1 call all FAIL at runtime.
- **Resolution:** when implementing `20260526000100_revert_md_upload_dispatch.sql`, create `lock_surface_for_kind(p_shop_id INTEGER, p_kind TEXT) RETURNS VOID` per ADR-024 (full canonical body + closed allow-list of 10 snapshot_kinds + NO-GRANT triple). CREATE this function BEFORE `lock_targets_for_kind` (which calls it).
- **Verify post-apply:** `SELECT proname FROM pg_proc WHERE proname = 'lock_surface_for_kind';` returns one row.

### R6-B3 · `apply_concern_category_upload` snapshot scope writes BOTH tables; canonical_state must cover both

- **Where it appears:** ADR-024 lock-scope table for `concern_questions_per_category` (line 31 prior to edits) AND apply_concern_category_upload row in lock-target table; ADR-024 canonical_state table row for `canonical_state_concern_category_upload`
- **Risk:** if `canonical_state_concern_category_upload` only reads/serializes `concern_questions` (matching the snapshot_kind name) but apply writes BOTH `concern_subcategories` AND `concern_questions`, the staleness check at step 6 misses drift on the `concern_subcategories` side. A revert could overwrite legitimate subcategory edits.
- **Canonical resolution (per ADR-024 already says):** `canonical_state_concern_category_upload` MUST serialize the FULL per-category state — BOTH `concern_subcategories` rows for the category AND `concern_questions` rows for the category — in byte-identical form to `apply_concern_category_upload`'s post-mutation serializer. The kind name `concern_questions_per_category` is historical and understates the scope; see the naming-drift glossary in PLAN.md §7.
- **Resolution for builders:** when implementing `canonical_state_concern_category_upload` (in migration `20260526000100`), source the serializer from `exportConcernCategoryMd` (NEW per PLAN §5.2) which exports BOTH tables. Write a pgTAP test that compares `canonical_state_concern_category_upload(shop_id, snapshot)` byte-for-byte against the TS `exportConcernCategoryMd` output for the same `(shop_id, category)` scope.

### R6-B4 · ADR-005 Consequences contains stale "every other SECURITY DEFINER function … GRANT TO service_role" wording

- **Where it appears:** `docs/scheduler/edge-parity/decisions/ADR-005-outer-only-service-role-entry-point.md` Consequences section, paragraph beginning "The cost is one documented deviation…"
- **Stale claim:** "Every other SECURITY DEFINER function in the feature follows the standard `REVOKE … FROM PUBLIC/anon/authenticated + GRANT … TO service_role` triple."
- **Actual:** after ADR-Fix #21 + #22, the 6 outer-callable entry points get the GRANT and the 15 (actually 25) internal functions do NOT.
- **Resolution:** treat this paragraph as documentation-debt; when implementing, follow the explicit Decision table not the Consequences prose. If you're reading ADR-005 from this comment, mentally substitute: "Every internal SECURITY DEFINER function in the feature follows the NO-GRANT pattern."

---

## IMPORTANTs (preferred to close, can defer with explicit flag)

### R6-I1 · "ALL writers" wording in ADR-012 + ADR-024 still slips through

- `ADR-012` Decision Phase 1 bullet + Consequences "Any concurrent same-shop writer to the same surface… blocks"
- `ADR-024` section "0. lock_surface_for_kind" intro: "serializes ALL writers to the same surface"
- **Canonical wording per ADR-Fix #20 + #23:** "serializes COOPERATIVE writers (writers that call `lock_surface_for_kind` first) — the 5 NEW apply RPCs + revert RPC. V2 TS upload paths are non-cooperative; tracked SEC-17."

### R6-I2 · PLAN.md "How to read this plan" references SEC-12 through SEC-16, missing SEC-17 + SEC-18

- `PLAN.md` paragraph: "Deferred follow-ups: `../DEFERRED-AUDIT-ITEMS.md` SEC-12 through SEC-16 (this feature) + OBS-9 (retention)"
- **Update to:** "SEC-12 through SEC-18 (this feature) + OBS-9" — SEC-17 was added in ADR-Fix #7 (surface-lock forward-looking guard) + SEC-18 was added in ADR-Fix #11 (actor_email rename). SEC-17 was extended in ADR-Fix #23 (V2 TS retrofit explicit).

### R6-I3 · Helper-family taxonomy inconsistent (3 vs 4 vs 5)

- ADR-024 Context says "Three helper families"
- ADR-024 Decision says "FOUR helper families"
- ADR-005 says "4 helper families"
- Actual list: 5 distinct buckets (lock_surface_for_kind, lock_targets_for_kind, compute_current_canonical_for_kind, 10 × canonical_state_<kind>, compute_unified_diff)
- **Canonical count for build:** 5 helper families = 14 distinct function signatures (1 + 1 + 1 + 10 + 1). The grant taxonomy is per-signature, not per-family.

### R6-I4 · ADR-005 owner-chain caveat too narrow

- `ADR-005` Consequences caveat: "the no-grant design depends on outer + inner sharing the same function owner"
- **Should be:** "the no-grant design depends on all 6 outer-callable entry points (outer RPC + 5 apply RPCs) sharing a compatible function-owner chain with all 25 internal functions (inner RPC + 10 handlers + 14 helpers)."

### R6-I5 · SEC-17 callable-helper problem: future writers must call `lock_surface_for_kind` but it's NO-GRANT

- Per ADR-Fix #22, `lock_surface_for_kind` is NO-GRANT for service_role.
- Per ADR-Fix #23 + SEC-17, future writers (V2 TS uploaders, cron jobs, edge functions) MUST call it.
- **Contradiction:** Edge functions running as service_role cannot call a NO-GRANT function.
- **Two viable resolutions** (operator's choice when SEC-17 is addressed):
  - (a) Each future writer is wrapped in its OWN SECURITY DEFINER plpgsql function (which can call `lock_surface_for_kind` via owner chain) — adds an indirection layer per writer.
  - (b) Expose a service_role-callable thin RPC wrapper `lock_surface_for_kind_public(p_shop_id, p_kind)` that calls the internal helper — single RPC documented as the public entry point for SEC-17 adoption.
- **Canonical for SEC-17 implementation:** option (b) is simpler; document the exception in the implementing ADR.

### R6-I6 · PLAN.md immutability rule still says "ADRs are IMMUTABLE" without the pre-implementation exception

- `PLAN.md` "How to read this plan" line 16: "ADRs are IMMUTABLE. If a decision changes, write a NEW ADR that supersedes the prior; do not edit accepted ADRs."
- **Should be:** "ADRs are IMMUTABLE once the feature has shipped. See INDEX.md 'Pre-implementation cross-verify exception' for the canonical rule on pre-ship edits."

### R6-I7 · ADR-005 doesn't account for `list_scheduler_admin_audit_log` MCP tool + 2 exporters in inventory

- These are TS code paths (orchestrator-mcp + exporter TS funcs), NOT SECURITY DEFINER SQL functions.
- **Add to ADR-005 Decision intro:** "Out of scope for this inventory: TypeScript surfaces — `list_scheduler_admin_audit_log` MCP tool, `export_concern_category_md` exporter, `export_concern_category_guideline_md` exporter. These run as edge-function code, not SECURITY DEFINER SQL. Their security model is the orchestrator-mcp service_role gate (Layer 1 of ADR-016)."

### R6-I8 · Migration B `mv` step is two separate commands; mixed-state risk

- PLAN.md §3 "Canonical staging mechanic": `mv supabase/migrations-staged/20260526100000_*.sql supabase/migrations/ && mv supabase/migrations-staged/20260526100001_*.sql supabase/migrations/`
- **Risk:** if first `mv` succeeds and second fails, state is mixed (file 1 in migrations/, file 2 still in migrations-staged/).
- **Resolution:** wrap in a tiny shell guard: `set -e; ls supabase/migrations-staged/20260526100000_*.sql supabase/migrations-staged/20260526100001_*.sql >/dev/null && mv supabase/migrations-staged/20260526100000_*.sql supabase/migrations-staged/20260526100001_*.sql supabase/migrations/` — single `mv` call moves BOTH files atomically (POSIX `mv` with multiple sources is one syscall sequence; if it fails partway, the recovery shape is single-file-not-multi-file).

---

---

## E1a-DEPLOY runbook (NEW 2026-05-26 after first push)

**Discovered:** Supabase CLI 2.100.x sends multi-statement migration files through pgx pipeline mode. `CREATE INDEX CONCURRENTLY` rejects pipeline execution with SQLSTATE 25001. The `-- supabase: skip-tx-wrap` directive is NOT recognized by this CLI version. The original Part 2 file (4 CONCURRENT statements in one file) failed on the 2nd statement, leaving an INVALID first index on the live audit_log.

**Permanent fix in repo:** Migration A Part 2 is now 4 separate single-statement files (`20260526000001` through `20260526000004`). Each file has the `-- supabase: skip-tx-wrap` header for future-CLI compatibility AND as intent documentation. The CLI treats each file as its own pipeline batch; a single-statement batch runs CONCURRENTLY fine.

**Recovery runbook if `supabase db push` ever fails on a CONCURRENT migration:**

1. Query for INVALID indexes:
   ```sql
   SELECT i.relname, ix.indisvalid
   FROM pg_index ix
   JOIN pg_class i ON i.oid = ix.indexrelid
   WHERE i.relname IN (<index names from the failed migration>);
   ```
2. For each `indisvalid = false`: `DROP INDEX CONCURRENTLY IF EXISTS public.<name>;` via Supabase MCP `execute_sql` (handles single-statement CONCURRENTs cleanly).
3. Re-create via execute_sql or psql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS public.<name> ON ...;` — one statement at a time.
4. Mark migration as applied so CLI doesn't try to re-push: `supabase migration repair --status applied <timestamp> --linked`.
5. Verify in pg_index that `indisvalid = true` on every expected index.

**Forward-looking guard for future CONCURRENT migrations:** ONE CREATE INDEX CONCURRENTLY per file. Period. Same rule for VACUUM, REINDEX CONCURRENTLY, ALTER SYSTEM, and any other operation that Postgres rejects inside transactions or pipelines.

---

## E2-derived coordination notes (NEW 2026-05-26 after TS shared helpers sub-agent)

### E2-N1 · Postgres `jsonb_agg(...)::TEXT` emits space-after-comma — applied to TS sortedTextArray + orderedTextArray

E2 sub-agent flagged a likely byte-parity gap: Postgres `jsonb_agg(elem ORDER BY elem)::TEXT` emits `["a", "b", "c"]` (space-after-comma), `{"a": 1, "b": 2}` (space-after-comma AND space-after-colon). JS `JSON.stringify` emits `["a","b","c"]` (no space). Verified via MCP `execute_sql` on the test DB 2026-05-26. Fix applied inline to `sortedTextArray` + `orderedTextArray` in `scheduler-admin-md.ts` — they now use manual `"[" + arr.map(s => JSON.stringify(s)).join(", ") + "]"` to match Postgres exactly. `canonicalJsonbText` was already correct (used `join(", ")` + space-after-colon).

Affects byte-parity for these columns on 4 kinds: `example_keywords`, `concern_categories`, `positive_examples`, `negative_examples`, `synonyms`, `eligible_testing_service_keys`. E10 byte-parity tests should explicitly cover all 6.

### E2-N2 · 57 audit-log inline insert call sites identified for E4/E5 refactor

E2 sub-agent enumerated every site in `scheduler-admin.ts` (33 sites + `logAdminAudit()` helper at L108) and `scheduler-admin-catalog.ts` (24 sites + `_logAudit()` helper at L641). All sites currently pass `audit: {oauth_client_id, display_name}` WITHOUT `shop_id`. The new E2-authored `logAuditEntry()` REQUIRES `shopId` (throws on missing/non-positive). E4 + E5 builders MUST thread the caller's `shopId` through (always available — every uploader takes `shopId: number` as its 2nd parameter) AND replace inline-insert sites with `logAuditEntry()` calls. The old `logAdminAudit()` + `_logAudit()` helpers should be deleted in the refactor PR.

---

## E1c-f-derived coordination notes (NEW 2026-05-26 after handler + apply RPC sub-agent)

### E1cf-N1 · `appointment_default_limits` is composite PK `(shop_id, day_of_week)`, NOT UUID

E1c-f sub-agent caught a docs/code discrepancy: prior ADR-024 prose said "(UUID PK)" but the actual schema per `20260513000100_scheduler_phase1_new_tables.sql` line 119 is composite `PRIMARY KEY (shop_id, day_of_week)`. E1b dispatch already had the correct SQL (sub-agent verified line 421 of `20260526000100_revert_md_upload_dispatch.sql` uses `day_of_week = ANY(v_int_ids::INT[])`). ADR-024 line 117 + Status line have been corrected (2026-05-26). Future ADRs / docs referencing ADL should specify composite PK + snapshot keys are day_of_week integers `0..6`. ADR-015 + ADR-019 already mention the composite constraint in the absent-key TOCTOU analysis — no changes needed there.

### E1cf-N2 · Apply RPC confirm_token formula — E2 TS computeConfirmToken() MUST match

The 5 apply RPCs compute a deterministic confirm_token using this formula (documented in each apply RPC's header comment):

```
sha256(shop_id || ':' || kind || ':' || expected_current_hash || ':' || md_content_hash || ':' || actor_email)
```

Plus kind-specific suffixes:
- `apply_concern_category_upload`: `+ ':' || category_slug`
- `apply_concern_category_guideline_upload`: `+ ':' || category_slug`
- `apply_closed_dates_upload`: `+ ':' || original_today::TEXT`

E2's TS helper `computeConfirmToken(args)` MUST produce the exact same bytes for the same inputs (using WebCrypto `crypto.subtle.digest('SHA-256', ...)` + hex-encode for byte-parity with plpgsql `extensions.digest(..., 'sha256')` + `encode(..., 'hex')`). Token mismatch → `'revert_blocked: confirm_token_mismatch: …'` RAISE inside the apply RPC at apply mode.

### E1cf-N3 · `apply_closed_dates_upload` uses ON CONFLICT DO NOTHING for added — operational call

The sub-agent chose `ON CONFLICT (shop_id, closed_date) DO NOTHING` for newly-added dates. Rationale: defensive — a misclassified-add (date that already exists) becomes a silent no-op rather than a hard error. Trade-off: the existing TS uploader's behavior was to fail with `upsert failed`. If strict-fail semantics are preferred operationally, change to `DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source` — but the `modified` branch already handles updates, so DO UPDATE on `added` could double-write. Recommend: keep DO NOTHING as the conservative default; add a Sentry warning log when `ROW_COUNT < expected_added_count` so misclassification is observable.

### E1cf-N4 · `apply_concern_category_upload` p_diff shape contract (E5e TS-side coordination)

Sub-agent designed p_diff with nested shape that E5e's TypeScript refactor of `uploadConcernCategoryMd` MUST produce verbatim:

```ts
{
  subcategories: { added: SubcategoryRow[], modified: SubcategoryRow[], deactivated: string[] /* ids */ },
  questions:     { added: QuestionWithSlug[], modified: QuestionRow[], deactivated: string[] /* ids */ }
}

type QuestionWithSlug = QuestionRow & { slug_of_sub: string };  // resolves subcategory_id by slug for newly-INSERTed subs
```

E5e author must populate p_diff in this exact shape. The `slug_of_sub` field on questions is load-bearing: newly-INSERTed subcategories don't have ids yet at p_diff construction time, so the apply RPC needs the slug to resolve the id from the freshly-INSERTed sub batch via `v_sub_id_by_slug` JSONB map.

### E1cf-N5 · `v_sub_id_by_slug` JSONB merge order (informational)

In `apply_concern_category_upload`, the merge `v_sub_id_by_slug || jsonb_object_agg(slug, id)` means existing rows win on slug-collision. Sub-agent verified: newly-INSERTed rows have unique slugs (the INSERT would have failed otherwise on the unique constraint); UPDATEs don't change slugs in this code path. No collision possible in current design. If future refactor allows slug renaming, the merge order needs reconsideration.

---

## E1b-derived coordination notes (NEW 2026-05-26 after sub-agent author + ADR-025)

### E1b-N1 · E5e (apply_concern_category_upload) MUST use exact snapshot field names from E1b

The E1b sub-agent author chose these snapshot JSONB field names for the `concern_questions_per_category` snapshot (matching ADR-024 row 7):
- `subcategories_before` — JSONB object keyed by subcategory id → row
- `added_subcategory_ids` — JSONB array of newly-inserted subcategory ids
- `questions_before` — JSONB object keyed by question id → row
- `added_question_ids` — JSONB array of newly-inserted question ids

E5e author (apply_concern_category_upload Pattern S refactor) MUST populate the snapshot with EXACTLY these field names. Any deviation breaks `canonical_state_concern_category_upload` and `lock_targets_for_kind` Kind 7 branch. If a different name is operationally preferred at E5e time, file a NEW ADR documenting the rename + update E1b's dispatch migration in lockstep (this is post-ship; supersession protocol applies — see INDEX.md "Why ADRs").

### E1b-N2 · Inner step 1 IF NOT FOUND classification (informational)

Inner RPC step 1 (`SELECT … FOR UPDATE NOWAIT` on parent audit row) includes an `IF NOT FOUND` defensive check after lock acquisition, mapping to `revert_blocked: not_found` (consistent with STEP 0d's Branch-2 mapping). Race window: between outer STEP 0d's SELECT (which confirmed existence) and inner step 1's lock acquisition, a concurrent retention-prune or admin hard-delete COULD remove the row. Probability is microseconds-tight; operational severity is low. If a future incident shows the race is hitting more than expected, reconsider classifying as `crashed` instead (race-on-deletion is unusual enough to be system-bug class).

### E1b-N3 · Verifier reframing per ADR-025 — byte-parity test contract

PLAN §10 testing approach has been updated (this commit) to specify: the byte-parity tests for `canonical_state_<kind>` (plpgsql) compare against `computeCanonicalAfterState()` (TS, E2), NOT against existing TS MD exporters. E10 test author MUST:
- Author one integration test per kind (10 tests) that calls both functions with identical input + asserts byte-for-byte TEXT equality
- Use deterministic seed data (no `gen_random_uuid()` between test runs)
- Run within `supabase/tests/integration/canonical_state_parity.test.ts` (new file) — pgTAP can't easily invoke TS helpers; this is a TS-side integration test using the Supabase test client

If E2's `computeCanonicalAfterState()` is not yet authored when E10 begins, defer this test class to a follow-up — the apply RPCs (E1f) can still verify their own byte-parity via the snapshot round-trip (apply emits `expected_after_state_canonical`, immediate revert re-derives from `canonical_state_<kind>`, comparison should byte-match).

---

## What was deferred to /feature-implement (NOT residual — feature scope)

These are NOT cross-verify residuals — they're feature work documented in the plan:

- E1a–E1g: apply 6 migrations (Migration A + dispatch + 3 handlers + apply RPCs)
- E2: TS shared helpers (`logAuditEntry`, `canonicalizeDiff`, `computeConfirmToken`, `computeCanonicalAfterState`)
- E3: 2 backfill scripts (snapshot_kind + audit-log shop_id PHASE 1/2)
- E4: V2 catalog uploaders emit `expected_after_state_canonical` + `after_hash`
- E5a–e: refactor 5 legacy uploaders to Pattern S
- E6: 2 new exporters (concern category guideline + concern category)
- E7: `list_scheduler_admin_audit_log` MCP tool
- E8: replace `revertMdUpload` with 50-60-line TS wrapper
- E9: chat-instructions update for Pattern S two-step flow
- E10: all tests (Vitest + pgTAP + curl smoke)
- E11a–f: deploy + backfill + Migration B + live smoke
- E12: resume schedulerconfig feature (post-edge-parity)

## What was deferred to DEFERRED-AUDIT-ITEMS.md (post-Phase-1 hardening, NOT this feature)

- SEC-12: forward-looking guard — future closed_dates mutation paths must take 2-arg advisory lock
- SEC-13: schema-stability guard — future migration dropping natural composite unique key must extend lock_targets_for_kind
- SEC-14: trigger on `scheduler_admin_revert_attempts.revert_audit_log_id` semantic correctness
- SEC-15: Phase 1.5 — extend `lock_targets_for_kind` per-key advisory locks for all kinds + 5 apply RPCs (closes narrower absent-key TOCTOU within snapshot scope)
- SEC-16: trigger enforcing `attempts.shop_id = referenced upload.shop_id`
- SEC-17: forward-looking guard — future surface writers must adopt Phase 1 surface lock (extended in ADR-Fix #23 to explicitly include V2 TS uploader retrofit)
- SEC-18: rename `actor_email` → `actor_label` + add strict-email `actor_email` column with CHECK + identity-resolution backfill
- OBS-9: retention cron for `scheduler_admin_revert_attempts` (90/91/365-day pattern)
