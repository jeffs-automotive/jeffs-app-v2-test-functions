# scheduler-edge-parity — edge-side hardening plan

> Feature: `scheduler-edge-parity` (orchestrator-mcp edge functions)
> Phase: plan (pending `/feature-plan` transition)
> Authored: 2026-05-25
> Companions: `research-01-audit-log-read-tool.md`, `research-02-missing-exporters.md`, `research-03-pattern-s-backfill.md`, `research-04-revert-extension.md`
> Unblocks: `schedulerconfig` admin UI (paused per `.claude/work/feature-archive/schedulerconfig-paused-2026-05-25T22-44-00Z.json`)

---

## 1. Goal (REVISED v0.3 per CR-B5)

Close every edge-side gap that the schedulerconfig cross-verify (`.claude/work/ai-review-2026-05-25T22-40-58Z.md`) flagged as a blocker, AND fix the 6 pre-existing revert-path bugs the research-phase agents uncovered along the way. After this feature ships:

- Every MD-upload tool in `scheduler-tools.ts` supports the two-step `dry_run` + `expected_confirm_token` flow, AND captures `pre_state_snapshot` server-side on apply (was: 6 of 11)
- Every uploaded surface has a working exporter (was: 9 of 11)
- The orchestrator MCP surface exposes a tool to read `scheduler_admin_audit_log` filtered by surface with per-row revert eligibility (was: zero — only present in `revert_md_upload`'s tool description as a placeholder)
- Every revert path mutates the DB inside a single SECURITY DEFINER plpgsql transaction (per CV2-B2 v0.3 — "all-in-one RPC transaction" choice). No TS-orchestrated multi-step mutations. Race-proof, shop-scoped, staleness-checked, with a real audit-log row written atomically with the mutations.
- Every multi-row UPLOAD apply path also runs inside a transaction RPC (per CV2-I2 v0.3 generalization of CV-I5).
- Claude Desktop's admin chat-instructions explain the two-step flow for legacy uploaders, with a Sentry canary that fires ONLY when the second-step apply call is malformed (not on the documented first-call dry_run).

---

## 2. Locked decisions (per Chris's calls 2026-05-25)

| # | Decision | Source |
|---|---|---|
| L1 | **Path β was chosen for schedulerconfig** — all 8 surfaces. To deliver that safely, this feature first brings every legacy uploader up to V2's safety bar instead of compensating in the UI. | schedulerconfig cross-verify decision |
| L2 | **Bundle all 6 PE-bugs into this feature.** Single migration + single deploy + single PR; splitting just creates ordering risk because deploys are HUMAN GATED anyway. | This feature's bundling Q |
| L3 | **Make reasonable calls on the 6 open questions** and surface them in §3 below for Chris to override before implementing. | This feature's open-Q Q |

---

## 3. Default calls on open questions (override before implementing)

These choices are baked into the plan that follows. DC-1, DC-3, DC-4 were REVISED in v0.2 per cross-verify findings — original v0.1 wording is left in `[strikethrough notes]` for traceability. Also see §3a for the v0.2 cross-verify-driven additions (CV-1 through CV-11).

### DC-1 — Token canonicalization scope (REVISED v0.2 per CV-I6, REFINED v0.3 per CV2-I4)
**v0.1 call:** sort `diff.modified[]` and `diff.deactivated[]` arrays by natural key before computing the token. *[Narrow — only sorted selected arrays.]*
**v0.2 call:** introduce `canonicalizeDiff(diffSummary)` that **recursively sorts ALL arrays + object keys** in the entire diff_summary object. The SAME canonicalized object is used for (a) the JSON returned in the dry_run response, (b) the `diff_summary` written to the audit log, and (c) the input to `sha256Hex` for the token. Apply this to existing V2 uploaders too, not only the legacy backfills. *[SUPERSEDED in v0.3 by CV2-I4 — sorting ordered arrays (questions, options) scrambled user-visible content; v0.3+ sorts ONLY set-typed arrays via explicit allow-list. See §3b CV2-I4 for the active design.]*
**v0.3 call (active):** `canonicalizeDiff` sorts only sets (allow-list: `deactivated_keys`, `added_keys`, `surfaces`) by natural key; preserves order on ordered arrays (`questions[]`, `options[]`). Object keys are always sorted (cheap + universally safe).
**Why revised:** GPT-flagged that v0.1 left a debug-time gap — the returned/audited diff could differ in ordering from the token-input, making "why doesn't my token match" impossible to diagnose. Unifying the canonical form eliminates the asymmetry. v0.3 refinement caught that v0.2 over-corrected by sorting ordered arrays too.
**Source:** research-03 §2 open Q1 + cross-verify GPT I6 + 2nd-round cross-verify CV2-I4.

### DC-2 — `uploadConcernCategoryMd` DEFAULT_OPTIONS in dry_run preview (REVISED v0.2 per CV-I7)
**v0.1 call:** when the diff phase detects a NEW question with no options line in the MD, surface a `validation_warnings` entry. *[Warning-only — diff doesn't reflect defaulted options.]*
**v0.2 call:** the diff phase computes the would-be-defaulted options and includes them in `added[i].options` exactly as apply will persist. The `validation_warnings` entry also fires, but the warning becomes informational ("these N questions had no MD options; defaulted to [yes, no, sometimes]") rather than a semantic-drift indicator. This preserves the confirm_token's "same input → same output" guarantee.
**Why revised:** GPT-flagged that v0.1 left dry_run preview semantically different from apply, breaking confirm_token reproducibility.
**Source:** research-03 §4.2 + §8 open Q2 + cross-verify GPT I7.

### DC-3 — `closed_dates` two-mutation-path collision (REVISED v0.2 per CV-I2)
**v0.1 call:** ship Pattern S; rely on confirm_token re-verify to catch mid-flight `block_appointment_capacity` mutations. *[Token re-verify catches read-time drift, not write-time drift.]*
**v0.2 call:** ALSO wrap the closed_dates apply path (UPSERT + DELETE) in a single `apply_closed_dates_upload` SECURITY DEFINER RPC. The RPC takes the snapshot + diff and applies atomically. Confirm_token re-verify still catches read-time drift; the transactional apply closes the read-to-write window.
**Why revised:** GPT-flagged that confirm_token only verifies state at the apply-time READ, not between that read and the subsequent writes. `closed_dates` is the highest-risk surface because `block_appointment_capacity` is an independent mutation path.
**Source:** research-03 §4.5 open Q3 + cross-verify GPT I2.

### DC-4 — `revertMdUpload` per-table dispatch shape (REVISED v0.2 per CV-B4)
**v0.1 call:** `concern_questions_per_category` covers both the 2-table concern uploader AND the flat `uploadConcernQuestionsMd` uploader since their snapshots are tagged-union-compatible. *[Wrong — snapshot shapes are not compatible.]*
**v0.2 call:** TWO distinct `snapshot_kind`s + TWO distinct handlers:
- `concern_questions_flat` (from `uploadConcernQuestionsMd`): snapshot shape `{ before: Record<"<cat>::<qtext>", row>, added_keys: string[] }`. Handler: `revertConcernQuestionsFlat`.
- `concern_questions_per_category` (from `uploadConcernCategoryMd`): snapshot shape `{ subcategories_before, questions_before, added_subcategory_ids, added_question_ids, category }`. Handler: `revertConcernCategoryUpload`.
**Why revised:** GPT-flagged that the two snapshot shapes are structurally incompatible. Sharing one handler would produce corrupt reverts.
**Source:** research-03 §3 row 1 vs research-04 §2 row 1 + cross-verify GPT B4.

### DC-5 — `_logAudit` consolidation (unchanged)
**Call:** DO consolidate the two near-identical helpers into one shared `logAuditEntry()` in `_shared/scheduler-admin-md.ts`. The new signature REQUIRES `shopId` (not optional) per CV-NTH so the migration's NOT NULL transition can't regress silently. ~30 LOC saved.
**Source:** research-03 §8 open Q5 + cross-verify GPT NTH item.

### DC-6 — Reverting an upload that referenced FK-broken rows (unchanged)
**Call:** REFUSE with explicit error listing the broken refs. Format: `"revert blocked: cannot restore question id=247 because its subcategory_id=99 no longer exists (likely deleted via direct DB or non-tracked tool); manual recovery required."` Do NOT silently `ON CONFLICT DO NOTHING`.
**Source:** research-04 §Open Questions Q5.

---

## 3a. Cross-verify-driven additions (NEW v0.2)

The v0.1 cross-verify (`.claude/work/ai-review-2026-05-25T23-57-10Z.md`) surfaced 5 blockers + 11 importants. The plan revisions integrate them as the CV-* items below. Each is non-negotiable for v0.2.

### CV-B1 — Split migration into A + B (deploy ordering safety)
The v0.1 single-migration approach is unsafe: setting `shop_id NOT NULL` in the SAME migration that runs before the code change writing shop_id will fail any still-deployed `_logAudit` insert.

**Sequence:**
1. **Migration A** (`20260526000000_…_part_a_nullable.sql`): add NULLABLE `shop_id` + CHECK loosen + `successor_revert_id` + `reverts_upload_id` + indexes + unique partial index.
2. **Code deploy**: orchestrator-mcp build that writes `shop_id` on every new audit row + uses the new revert dispatch + writes `snapshot_kind`.
3. **Backfill script**: `scripts/backfill-audit-log-shop-id.ts` derives `shop_id` from each row's relationship to existing per-shop tables; rows where it CAN'T be derived stay NULL.
4. **Manual verification**: `SELECT COUNT(*) FROM scheduler_admin_audit_log WHERE shop_id IS NULL` returns 0 (or Chris explicitly OKs the remaining NULLs as historical-non-revertable rows).
5. **Migration B** (`20260526100000_…_part_b_notnull.sql`): set `shop_id NOT NULL` (gated behind manual verification).

The CHECK loosen + new columns CAN ship in Migration A — they're additive and forward-compatible.

### CV-B2 — Real race-proof claim-revert (not just an index)

**SUPERSEDED by CV2-B2 + CV2-B6 (see §3b) — historical only.** The v0.2 claim-RPC pattern (`revert_md_upload_acquire` + pending-row + commit/fail companion RPCs + `REVERT_IN_PROGRESS` sentinel + parent-pointer-pre-write) was REMOVED in v0.3 per CV2-B2. The v0.3 all-in-one RPC was then RECAST in v0.4 as the outer/inner pair (`revert_md_upload_attempt` outer + `revert_md_upload_apply` inner) per CV2-B6. The active design lives in §3b CV2-B2 + CV2-B6 + §8.1. DO NOT implement the prose below — it describes an architecture that was discarded for the parent-pointer-pre-write failure mode CV2-B2 documents. Kept here for traceability of how the design evolved.

v0.1 proposed a unique partial index on `reverts_upload_id WHERE error_message IS NULL`. That guards the audit-INSERT but fires too late — two concurrent reverts can both pass eligibility, both mutate target tables, and only the second audit row fails.

**Real fix:** the `revert_md_upload_acquire(p_upload_id, p_shop_id)` RPC does (in ONE transaction):
1. `SELECT … FOR UPDATE NOWAIT` on the parent audit row (locks it; second concurrent caller fails fast with `55P03`).
2. Check eligibility (operation, snapshot, table, 30d cutoff, successor_revert_id).
3. **INSERT a "pending" revert audit row** with `error_message='REVERT_IN_PROGRESS'` (excluded from the unique partial index — slot reserved) AND `reverts_upload_id=p_upload_id` (raises unique-index violation if a parallel claim slips through).
4. **UPDATE parent.successor_revert_id = <new pending row id>**.
5. Return `(pending_audit_row_id, snapshot)`.

The TS apply path then runs the table mutations (still inside the lock window if they execute in the same transaction; otherwise the unique index + successor_revert_id guard catches duplicates). On success: UPDATE the pending row's `error_message=NULL` (now visible to the unique index → permanent slot). On failure (partial mutation): leave `error_message` set with the real error (excluded from index → operator review).

The unique partial index from v0.1 stays as the second line of defense.

### CV-B3 — `snapshot_kind` fallback path for existing V2 rows

**TS-side registry-fallback prose SUPERSEDED by CV2-B2 + CV2-B6 (see §3b) — historical only.** v0.2's "fallback in `revertMdUpload`" sat in TypeScript. v0.3 moved all dispatch into plpgsql (CV2-B2); v0.4 split it into the outer/inner pair (CV2-B6). The TS wrapper is now ~50-60 lines (Sentry emit + outcome classification) and has NO dispatch logic — the snapshot_kind fallback now lives inside the inner RPC's CASE expression (see §8.3 `resolve_snapshot_kind` fallback). The E2 backfill script (safety net #1 below) is STILL ACTIVE in v0.4.

Today's V2 catalog snapshots lack `snapshot_kind`. After the new dispatch ships, those existing 30-day-window snapshots would be unrevertable.

**Two safety nets:**
1. **E2 backfill script** runs IMMEDIATELY AFTER Migration A + code deploy — derives `snapshot_kind` from `(table_name, top-level snapshot key heuristic)` and writes it back into the JSONB. Idempotent. [STILL ACTIVE v0.4.]
2. **Registry fallback** in `revertMdUpload`: if `snapshot.snapshot_kind` is missing AND `table_name IN ('testing_services', 'routine_services')` → dispatch to `revertCatalogV2`. For any other table without `snapshot_kind`, return `revert_blocked: snapshot missing snapshot_kind discriminator — pre-migration row not recoverable through new dispatch; manual recovery required.` [SUPERSEDED — fallback moved to plpgsql per §8.3.]

### CV-B5 — Remove hardcoded shop_id=7476 backfill from migration
The v0.1 migration UPDATE `SET shop_id = 7476 WHERE shop_id IS NULL` is a footgun: if this migration ever runs against a different env or replays in a multi-shop world, every historical row falsely attributes to 7476.

**Fix per CV-B1's staged approach:**
- Migration A leaves `shop_id` NULLABLE — no UPDATE in the migration itself.
- Backfill script derives shop_id from each row's snapshot/table data where possible.
- Rows where derivation fails stay NULL; they're flagged non-revertable by the eligibility computation with reason `"shop_id_unknown_pre_migration_backfill"`.
- Migration B's NOT NULL transition runs ONLY after Chris-confirmed verification.

### CV-I1 — Claude Desktop breaking-change strategy (hardened)

**HARD DEPLOY GATE part STILL ACTIVE in v0.4. Canary-condition prose SUPERSEDED by CV2-I3 (see §3b) — historical only for the canary-firing condition.** v0.2's canary said "warn when `dry_run` unset AND `expected_confirm_token` unset" — that fires on every Step 1 happy-path call (Step 1 intentionally omits `dry_run` per §9). v0.3 CV2-I3 narrowed the firing condition to ONLY `dry_run=false AND expected_confirm_token unset` (the actual misuse pattern). The deploy-gate machinery + the `grep` pre-flight check are unchanged.

v0.1 said "update chat-instructions in the same PR." v0.2 makes this a HARD DEPLOY GATE:
- E9 (chat-instructions update) **must merge into the dotfiles repo BEFORE E11 (orchestrator-mcp deploy) is allowed to start.** [STILL ACTIVE v0.4.]
- E11's pre-flight checklist includes: `grep -q "ADMIN MD-UPLOAD TWO-STEP FLOW" docs/chat-instructions/scheduler/...` → fail if missing. [STILL ACTIVE v0.4.]
- Backup safety net: the refactored uploaders log a structured warning to Sentry when called with `dry_run` unset (i.e., relying on the default) AND `expected_confirm_token` unset (i.e., not the second-step apply call). Visible canary if any Claude Desktop session is still on stale instructions post-deploy. [SUPERSEDED — see CV2-I3 in §3b for the corrected `dry_run=false AND expected_confirm_token unset` firing condition.]

### CV-I3 — Revert handlers verify expected post-state before restoring

**SUPERSEDED by CV2-B3 (see §3b) — historical only for the `after_hash`-only design.** v0.2's snapshot stored only an `after_hash` (a sha256 of the canonical post-apply state) — that meant the revert handler could detect drift but could NOT produce a diagnostic diff (only the hashes were stored). v0.3 CV2-B3 promoted the snapshot to carry the FULL `expected_after_state_canonical` string PLUS a derived `after_hash` for the fast-path check. The staleness-detection INTENT below is still active in v0.4; the data-stored-in-snapshot is now the canonical string, not just the hash. See §8.3 "Fast-path `after_hash` check" for the two-stage check (fast hash equality first, then `compute_unified_diff` on mismatch).

v0.1 had no protection against legitimate edits made AFTER the upload but BEFORE the revert. CV-I3 closes this:
- Snapshot now carries `after_hash: string` = sha256 of canonical-serialized "expected post-apply state" (computed at apply time, stored in snapshot). [SUPERSEDED — snapshot now carries `expected_after_state_canonical` (the full canonical content), not just the hash. The `after_hash` is derived from the canonical content and kept as a fast pre-check. Per CV2-B3.]
- Revert handler's apply phase recomputes the current state's canonical-serialized hash; if `current_hash !== snapshot.after_hash` → reject with `"revert_blocked: current rows differ from expected post-upload state — likely modified after upload. Diff: <diff between current and expected>. Manual review required."` [STALENESS-CHECK INTENT STILL ACTIVE — see §8.3 two-stage check + `compute_unified_diff` for the v0.4 implementation that actually produces the inline diff.]
- This is the spec-correct version of DC-3's "confirm_token catches drift" claim, applied to the revert path specifically.

### CV-I5 — Multi-table uploaders wrap apply in transaction

**SUPERSEDED by CV2-I2 (see §3b) — historical only for the narrow scope.** v0.2 added a transaction-wrapping RPC ONLY for `uploadConcernCategoryMd`. v0.3 CV2-I2 GENERALIZED the pattern: every multi-row upload apply path (10 RPCs total — listed in §3b CV2-I2) runs inside an `apply_<table>_upload` SECURITY DEFINER RPC with the FULL CV2-I2 contract (atomic audit row, explicit `p_shop_id`, in-RPC token re-verify under locks, post-write `expected_after_state_canonical` computation). The narrow `apply_concern_category_upload`-only design below is incomplete relative to the v0.3+ pattern. Per-category RPC is STILL ACTIVE in v0.4 but as one of 10 sibling RPCs, NOT as the special case.

`uploadConcernCategoryMd` writes both `concern_subcategories` and `concern_questions` — a mid-apply failure currently leaves rows mutated with no snapshot.

**Fix:** the apply phase for the per-category uploader runs inside a `apply_concern_category_upload` SECURITY DEFINER RPC that does both table writes + audit row INSERT in ONE transaction. On failure, ROLLBACK leaves DB in pre-apply state.

Same pattern applies to any future multi-table uploader. [GENERALIZED to all 10 multi-row paths in CV2-I2; see §3b for the full list.]

### CV-I8 — `closed_dates` `original_today` in shop timezone
Per the codebase's existing `_shared/scheduler-tz.ts` helper. NOT UTC. Near-midnight reverts otherwise freeze the wrong dates.

### CV-I9 — Concern category audit table_name asymmetry
`uploadConcernCategoryMd` audit-logs with `table_name='concern_subcategories'` but mutates BOTH that AND `concern_questions`. List-audit-log filter on `concern_questions` won't show these.

**v0.2 fix:** audit row's `diff_summary` JSONB gets a `surfaces: ["concern_subcategories", "concern_questions"]` array. The `list_scheduler_admin_audit_log` tool's surface_filter resolves to:
```sql
WHERE shop_id = ? AND (
  table_name = '<requested_filter_table>'
  OR diff_summary->'surfaces' ? '<requested_filter_table>'
)
```
No new column needed; lives inside existing JSONB. Forward-compatible.

### CV-I10 — Empty guideline export returns parseable template
Per research-02 §1 of open questions:
```md
# {Title-cased slug} — Diagnostic Guideline

TODO: describe what matters for {slug} concerns. Examples: which sub-categories of {slug} concerns customers report, what facts the advisor needs to capture, how to triage urgency.

---

<!-- exported from concern_category_guidelines (shop_id={shopId}, category={slug}) — no row exists yet; this is a template -->
```
The UI shows this template in the textarea on first export. Roundtrip via the parser works (display_label is title-cased slug; prose body is the TODO text).

### CV-I11 — Failed-revert correctness with the partial unique index

**SUPERSEDED by CV2-B2 + CV2-B6 (see §3b) — historical only.** This item described correctness under v0.2's pending-row model, including the partial-mutation risk. v0.3 CV2-B2's all-in-one RPC eliminated the partial-mutation surface entirely (any failure inside the inner RPC rolls back ALL mutations + the audit row atomically — no partial state survives). v0.4 CV2-B6's outer/inner split preserves that atomic guarantee and additionally records every failed attempt in `scheduler_admin_revert_attempts` for operator visibility (rather than the v0.2 surface of "audit row with non-null error_message"). The partial unique index on `reverts_upload_id WHERE error_message IS NULL` still exists in v0.4 (per §8.8) but its role is narrower: defense-in-depth against duplicate SUCCESSFUL reverts, not pending-row reservation. DO NOT design around the prose below — the pending-row model and the partial-mutation accommodation are both gone.

Per CV-B2's claim-pattern, the "pending" audit row IS the slot reserver. If table mutations partially fail, the operator-facing audit row carries the real error_message AND retains the `reverts_upload_id` pointer (excluded from the unique index → another attempt can succeed). The previously-mutated rows REMAIN mutated (the original mutations weren't rolled back without an RPC transaction). For closed_dates + concern_category this is bounded by CV-I5's RPC; for other tables, the partial mutation surfaces as a Sentry alert + manual recovery.

### CV-NTH — `logAuditEntry` signature requires `shopId`
Not optional. The new helper's signature is `logAuditEntry({ sb, shopId, audit, table_name, operation, ... })`. If a caller forgets `shopId`, TypeScript errors at compile time. Prevents CV-B5 from regressing into a NULL `shop_id` after Migration B.

---

## 3b. v0.3 cross-verify-driven additions (`.claude/work/ai-review-2026-05-26T00-09-58Z.md`)

The v0.2 cross-verify surfaced 5 blockers + 12 importants. Items below close them. Each is non-negotiable for v0.3. Naming: `CV2-*` to distinguish from v0.1's `CV-*`.

### CV2-B1 — Fix `snapshot_kind` internal contradiction (was BOTH-flagged)
v0.2 §5.1 said `uploadConcernQuestionsMd` uses `snapshot_kind='concern_questions_per_category'`, but v0.2 §8.1 + §10 E5d say `'concern_questions_flat'`. Implementing from §5.1 = wrong-handler dispatch = corrupt reverts.

**Fix:** `concern_questions_flat` is the correct value. §5.1 updated in v0.3.

### CV2-B2 — All revert mutations inside ONE SECURITY DEFINER RPC (Chris's call)
v0.2's claim-RPC pattern left a correctness hole: after `revert_md_upload_acquire` set `parent.successor_revert_id = pending_id`, any downstream failure (handler error, unsupported snapshot_kind, TS crash, token mismatch) left the parent permanently pointing at a failed pending row. CV-I11's "another attempt can succeed via partial index" was wrong — the index protects audit-row INSERT, not the parent pointer.

**Fix (Chris's choice from 2-option-question 2026-05-25 — "All-in-one RPC transaction"):**

Every per-table revert handler moves from TypeScript into plpgsql. The TS `revertMdUpload` becomes a thin wrapper that calls ONE RPC, `revert_md_upload(p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id, p_expected_confirm_token, p_force_no_after_hash)`, which does (in one transaction):

1. `SELECT … FOR UPDATE NOWAIT` on the parent audit row (locks it).
2. Validate eligibility (operation, snapshot, 30d cutoff, snapshot_pruned, successor_revert_id, snapshot_kind support — **all before any side-effect** per CV2-I5).
3. Validate `expected_confirm_token` (re-compute over current head + snapshot hash; reject mismatch).
4. Validate `after_hash` staleness (recompute current canonical state hash per CV2-B3; reject mismatch unless `p_force_no_after_hash=true`).
5. Dispatch to per-snapshot_kind plpgsql handler. Handler mutates target tables.
6. INSERT revert audit row with `error_message=NULL`, `reverts_upload_id`, `shop_id`, `diff_summary`.
7. UPDATE parent's `successor_revert_id = <new revert row id>`.
8. Return (audit_log_id, stats).

If ANY step (1-8) raises, the whole transaction rolls back. Parent's `successor_revert_id` stays NULL. No partial mutations. No orphan pending rows. Retry succeeds cleanly.

**No more pending/commit/fail companion RPCs needed.** v0.2's `revert_md_upload_acquire` + `revert_md_upload_commit` + `revert_md_upload_fail` are REMOVED. The `REVERT_IN_PROGRESS` sentinel is REMOVED.

**v0.4 reframing note (X-FIX-AGENT-G).** The v0.3 monolithic `revert_md_upload` RPC was REFRAMED (not replaced) in v0.4 per CV2-B6 — it became the outer/inner pair (`revert_md_upload_attempt` outer + `revert_md_upload_apply` inner). The atomic-guarantee from CV2-B2 SURVIVES: the inner RPC still does dispatch + eligibility + staleness + handler + audit-row INSERT + parent-pointer UPDATE in ONE subtransaction (now hosted inside the outer's `BEGIN…EXCEPTION` block). The 10 plpgsql handlers + plpgsql dispatch survive. What's ADDED is attempt-tracking (the outer RPC ALWAYS writes a `scheduler_admin_revert_attempts` row, capturing success / rejection / crash for operator-visible failure observability). DO NOT implement this as one monolithic RPC — read CV2-B6 for the outer/inner contract before authoring the dispatch migration.

**Trade-off:** rewriting 10 revert handlers in plpgsql (testing_services_v2, routine_services_v2, concern_subcategories_descriptions_v2, concern_subcategories_map_v2, concern_questions_required_facts_v2, concern_questions_flat, concern_questions_per_category, concern_category_guidelines, appointment_default_limits, closed_dates_future). plpgsql adds ~150-300 LOC per handler. Test surface shifts to pgTAP for the SQL paths. Worth it for full transactional guarantee.

**Migration package** now includes the outer + inner dispatch RPCs + 10 handler RPCs + the `lock_targets_for_kind` and `compute_unified_diff` helpers (deployed across the 4 dispatch/handler migrations per §11; all in part-a since they're additive). The CLAIM RPC (`revert_md_upload_acquire`) from v0.2 §4.4 is REMOVED. The outer/inner dispatch pair plus handlers replace it.

### CV2-B3 — Snapshot carries `expected_after_state_canonical`, not just hash
v0.2's `after_hash` was insufficient — the revert error promised "diff between current and expected post-upload state" but only a hash was stored, so no diff could be produced. Also hashing by `table_name` was too coarse for partial surfaces.

**Fix:**
- Snapshot now carries `expected_after_state_canonical: string` (the actual MD-serialized post-apply state, computed by exporter at apply time). NOT just a hash.
- Staleness check is **handler-scoped**: each per-table revert handler computes the current canonical-MD for its specific scope (one category, one guideline row, one closed-date subset, etc.) and string-compares to `expected_after_state_canonical`. Mismatch → reject with the diff inline in the error message.
- `after_hash` is kept as a fast pre-check (avoids re-serializing the full canonical-MD if hash already mismatches).
- Snapshot size grows ~2x but stays well within JSONB practical limits (largest realistic case: ~50KB per snapshot for a per-category concerns upload).

### CV2-B4 — Migration B gate behavior (REVISED v0.3 per A-I1 + A-B12 + A-B13)
v0.2 §10 E11d said "Chris verifies NULL count or accepts the residual" but Migration B's `DO` block RAISEd on any NULL row. v0.3's first cut softened the check to `RAISE NOTICE` AND unconditionally `UPDATE`d NULL→-1 inside the migration — which masked a failed backfill (A-I1).

**Fix (final):** the sentinel-UPDATE moves OUT of Migration B into the backfill script (`scripts/backfill-audit-log-shop-id.ts`), gated behind an explicit Chris-confirmation step. Migration B's safety check goes back to `RAISE EXCEPTION` on any residual NULL row — if anything reaches the migration with NULLs, something went wrong upstream and we want to fail loud. A `CHECK (shop_id > 0 OR shop_id = -1)` constraint (A-B13) also blocks future writes of unexpected negative sentinel values.

**Implication:** after Migration B applies, the table has zero NULL rows. Residual sentinel rows (shop_id=-1) become impossible to revert — `revert_md_upload` rejects negative shop_ids since they never match a real caller's `p_shop_id`. Eligibility computation surfaces them with reason `shop_id_unknown_pre_migration_backfill` (the reason name stays — semantically the operator still can't safely associate the row with a shop). §10 E11d updated to reflect: the backfill script runs the gated sentinel-UPDATE BEFORE Migration B applies.

### CV2-B5 — Goal phrasing fixed (§1 above)
v0.2 said "every upload supports `pre_state_snapshot`" implying client-supplied; v0.3 §1 corrects to "captures `pre_state_snapshot` server-side on apply."

### CV2-I1 — §5.5 stale-text fix
v0.2 §5.5 still said "left for confirm_token re-verify to catch" the closed_dates collision — contradicted DC-3 v0.2's transactional RPC fix. §5.5 rewritten in v0.3 to reference `apply_closed_dates_upload` RPC + transactional safety.

### CV2-I2 — All multi-row apply paths in RPC transactions (REVISED v0.3 per A-B2/A-B7/A-B9/A-B11)
v0.2 added RPCs only for `closed_dates` (CV-I2/DC-3 v0.2) and `concern_category` (CV-I5). Every other multi-row upload path was still TS-orchestrated loops, subject to partial-mutation on mid-loop failure.

**Fix:** every upload's apply phase runs inside an `apply_<table>_upload` SECURITY DEFINER RPC. Per CV-I2 generalization, this covers:
- `apply_testing_services_upload` (was TS loop in `_uploadCatalogV2`)
- `apply_routine_services_upload` (was TS loop in `_uploadCatalogV2`)
- `apply_subcategory_descriptions_upload` (was TS loop)
- `apply_subcategory_service_map_upload` (was TS loop)
- `apply_question_required_facts_upload` (was TS loop)
- `apply_concern_questions_flat_upload` (was TS loop)
- `apply_concern_category_upload` (already in v0.2)
- `apply_concern_category_guideline_upload` (single-row, but wrap for consistency)
- `apply_appointment_default_limits_upload` (7-row UPSERT)
- `apply_closed_dates_upload` (already in v0.2)

5 apply RPCs total — one per legacy uploader (X-FIX-#18 — 2026-05-26 — closes GPT chunk 4 IMPORTANT '"10 apply RPCs" is inconsistent with the listed legacy apply RPCs'; v0.5 conflated the 10 REVERT handler RPCs with apply RPCs. The 5 apply RPCs are `apply_concern_questions_flat_upload`, `apply_concern_category_upload`, `apply_concern_category_guideline_upload`, `apply_appointment_default_limits_upload`, `apply_closed_dates_upload` per §5 + §10 E5; the 2 V2 catalog uploaders — testing + routine services — DO NOT need apply RPCs because they were already Pattern-S compliant before this feature). The TS uploader becomes: parse → validate → fetch current → compute diff + token → dry_run early-return → call `apply_<table>_upload(p_shop_id, p_snapshot, p_diff, p_audit, ...)` RPC (which performs token re-verify + mutations + audit row atomically) → return RPC result. No TS-side audit write after the RPC.

**Apply RPC contract (NON-NEGOTIABLE — applies to all 5 apply RPCs):** (X-FIX-#24 — 2026-05-26 — was "all 10 RPCs" which was internally contradictory with the "5 apply RPCs total" sentence in the prior paragraph; the 5 are the apply-side of the 5 legacy uploaders, NOT the 10 revert handlers)

1. **Atomic audit row.** The RPC ALWAYS writes the `scheduler_admin_audit_log` row (including `pre_state_snapshot`, `diff_summary`, `expected_after_state_canonical`, `after_hash`) INSIDE the same transaction as the target-table mutations. There is NO separate TS-side `logAuditEntry()` call after the RPC returns. A successful mutation that loses its audit row is impossible by construction. The RPC returns the `audit_log_id` for the TS caller's response payload.

2. **Explicit `p_shop_id` parameter — FIRST positional after the snapshot/diff payload.** Every apply RPC takes `p_shop_id INTEGER` (NOT `INTEGER NOT NULL` — PL/pgSQL function parameters do not support `NOT NULL`; the X-FIX-AGENT-A STEP 0a presence-guard pattern is used instead). The RPC enforces `p_shop_id` in every `WHERE`, `INSERT`, `UPSERT`, and `UPDATE` clause against the target table(s). The RPC MUST NOT trust any `shop_id` field that may appear in the snapshot/diff/audit JSON payloads — if such a field is present, the RPC must `RAISE EXCEPTION` if it disagrees with `p_shop_id`. SECURITY DEFINER functions cannot rely on JSON payload contents for tenant identity; the caller's `p_shop_id` (derived server-side from the admin-app's `requireEmployee()` / the OAuth-client's bound shop) is the only authoritative source.

   **Necessary BUT NOT SUFFICIENT.** Per X-FIX-AGENT-B's rewrite of §8.2 Invariant 1: forcing `shop_id = p_shop_id` in UPSERT INSERT-clause alone does NOT prevent cross-shop UPSERT-hijack. Every apply RPC's UPSERTs MUST ALSO scope DO UPDATE with `WHERE target.shop_id = p_shop_id` + row-count detection (Invariant 5), AND validate FK target tenant correctness (Invariant 6) for any FK columns the rows carry. See §8.4 for the 4-layer defense narrative. The §10 E5 cross-reference summarizes this for the apply-RPC author.

3. **Token re-verification happens INSIDE the RPC, under appropriate row locks.** TS does NOT recompute the current-state hash before calling the RPC. Instead, the RPC's FIRST action (after `p_shop_id` validation) is to:
   - Acquire row-level locks on the target table(s) — `SELECT … FOR UPDATE` on every row in `p_snapshot.before`, AND any per-key advisory locks documented per surface (e.g. closed_dates per-date advisory lock — see §5.5).
   - Re-fetch the current state of the same rows.
   - Recompute the canonical current-state hash and compare it to `p_audit.expected_current_hash` (passed as part of `p_audit`).
   - On mismatch: `RAISE EXCEPTION 'current_state_drift: …'` with the diverging row keys. Transaction rolls back; no mutations or audit row applied.

   This closes the TOCTOU window between TS-side reverify and DB mutation — the reverify and the writes are inside the SAME locked transaction.

4. **`expected_after_state_canonical` is computed INSIDE the RPC, AFTER the writes.** TS does NOT pre-compute the canonical after-state. Instead, after the mutations succeed inside the RPC transaction, the RPC re-reads the post-write rows for the affected `(shop_id, …)` scope, calls the canonical-serializer plpgsql helper (`canonical_<table>_state(p_shop_id, …)`) on the actual persisted state, and writes that result into the audit row's `expected_after_state_canonical` field. The `after_hash` is `sha256(expected_after_state_canonical)`, also computed inside the RPC.

   This eliminates the false `current_state_drift` failures on immediate revert that would otherwise arise from DB defaults, triggers, generated IDs, normalization, or SQL-side defaulted options diverging from a TS-pre-computed prediction. The canonical after-state always matches what the DB actually persisted.

5. **`p_audit` payload shape.** The TS caller passes `p_audit JSONB` containing `{operation: 'upload_md', md_hash, diff_summary, confirm_token, expected_current_hash, source, actor_user_id, snapshot_kind, snapshot: <pre_state_snapshot>}`. The RPC writes the audit row using these fields plus the in-RPC-computed `expected_after_state_canonical` and `after_hash`. Apply RPCs NEVER accept TS-pre-computed `expected_after_state_canonical` or `after_hash` fields — those are RPC-internal outputs only.

### CV2-I3 — Sentry canary condition (fix CV-I1)
v0.2 CV-I1 said: warn when `dry_run` is unset and `expected_confirm_token` is unset. But §9 explicitly says "Step 1: call with no `dry_run` because it defaults to true" — meaning the canary fires for every Step 1 happy-path call.

**Fix v0.3:** canary fires ONLY when `dry_run=false` AND `expected_confirm_token` is unset (= someone trying to apply without having done dry_run first). That's the actual misuse — Step 1 with no params is fine.

### CV2-I4 — `canonicalizeDiff` only sorts sets, not ordered data
v0.2 DC-1 said "recursively sorts ALL arrays + object keys." But some arrays are ordered data — question display order, options order, display-order-sensitive diffs. Sorting them = scrambling user-visible content.

**Fix:** `canonicalizeDiff` sorts ONLY arrays that are semantically sets (deactivated_keys, added_keys, surfaces) by their natural key. Ordered arrays (questions[], options[]) preserve order. Object keys ARE always sorted (cheap + universally safe). Implementation: explicit allow-list of "this field is a set" inside the canonicalizer.

### CV2-I5 — Support validation BEFORE claim (now moot — all-in-one RPC)
v0.2 claim-RPC validated table support AFTER claim. Per CV2-B2 v0.3 ("all-in-one"), this is no longer a concern — all validation happens inside the single dispatch RPC before any side-effects.

### CV2-I6 — `RETURNS TABLE` returns array — Supabase JS client invocation note
Doc fix to v0.3 §4.4 sketch (which no longer exists in v0.3 due to CV2-B2). The new `revert_md_upload` RPC returns a single-row composite type, called via `sb.rpc(...).single()` from TS.

### CV2-I7 — List-audit-log eligibility reasons union expanded
v0.2 schema's `revert_eligibility.reasons` union missed `30_day_cutoff`, `shop_id_unknown_pre_migration_backfill`, `current_state_drift`, `revert_in_progress` (the latter REMOVED per CV2-B2 since no more pending rows).

**Fix v0.3:** reasons union becomes `"not_upload_md" | "snapshot_pruned" | "no_snapshot" | "table_not_supported" | "upload_failed" | "successor_revert_exists" | "30_day_cutoff" | "shop_id_unknown_pre_migration_backfill" | "current_state_drift" | "after_hash_check_unavailable"`. 10 values. Update §7 v0.3 schema.

### CV2-I8 — Pre-existing snapshots without `expected_after_state_canonical` require explicit force flag

**Title aligned with CV2-B3 per v0.5 X-FIX-AGENT-G.** The safety-critical missing artifact is now the FULL `expected_after_state_canonical` string (CV2-B3 promoted from hash-only). The parameter name `p_force_no_after_hash` is RETAINED for API-stability reasons (changing it would ripple through the TS wrapper signature, tool registry, and chat-instructions); the semantic is "force-override the missing-canonical-state safety check" regardless of which term the parameter name carries.

v0.2 §8.3 said "fall back to softer warning" — too soft for a tool surface where "warn" is easy to misread.

**Fix v0.3 (terminology aligned v0.5):** the `revert_md_upload_attempt` outer RPC takes a `p_force_no_after_hash BOOLEAN DEFAULT false` parameter (name retained per the API-stability rationale above). If the snapshot lacks `expected_after_state_canonical` AND `p_force_no_after_hash` is not true → reject with `cannot_safely_verify: pre-2026-05-26 snapshot has no expected_after_state_canonical; pass force_no_after_hash=true to override (logged + flagged for review).` Force=true is logged as a Sentry warning + included in audit `diff_summary.forced_no_after_hash_check=true`.

### CV2-I9 — Commit/fail RPCs removed (moot per CV2-B2)
v0.2's `revert_md_upload_commit` + `revert_md_upload_fail` RPCs are REMOVED in v0.3 per CV2-B2. The single all-in-one RPC handles success/failure atomically.

### CV2-I10 — GIN expression index on `diff_summary->'surfaces'`
Add to Migration A:

```sql
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_surfaces_gin_idx
  ON public.scheduler_admin_audit_log
  USING GIN ((diff_summary->'surfaces'));
```

Speeds the list-audit-log filter `WHERE diff_summary->'surfaces' ? <table>` once the audit log grows past ~10k rows.

### CV2-I11 — Monitoring for failed reverts

**SUPERSEDED by CV2-B6 (see below in this same §3b) — historical only.** v0.3's monitoring approach relied on querying for `revert_upload` audit rows with non-null `error_message`. That signal doesn't exist in v0.4 — rejected reverts now roll back ATOMICALLY inside the inner RPC's subtransaction → no audit row is ever written for a failed revert. v0.4 CV2-B6 replaces this surface with `scheduler_admin_revert_attempts` outcome monitoring (the attempt table always carries a row regardless of outer success / inner failure), and the Sentry alert is emitted from the TS wrapper (NOT a DB trigger) when `outcome IN ('rejected','crashed')`. The `'failed'` enum value was removed in v0.4 per X-FIX-AGENT-F. See §3b CV2-B6 bullet 4 for the v0.4 Sentry-emission pattern.

v0.2 had no alerting for stuck `REVERT_IN_PROGRESS` rows. Per CV2-B2 the pending state is GONE (all-in-one transaction has no pending phase), so the original concern is moot.

**v0.3 monitoring:** add a Sentry alert rule for the new `revert_upload` audit rows where `error_message IS NOT NULL` (= revert was attempted but rejected). Per-event alert with `shop_id`, `upload_id`, and `error_message`. Operator can review without polling the audit log. [SUPERSEDED — see CV2-B6 attempt-table outcome monitoring + TS-wrapper Sentry emission.]

### CV2-NTH — Stale text cleanup
v0.2 had stale text in §14 (still said v0.1) + §15 (still had v0.1 DC-3/DC-4 summaries) + file count off ("8" listed 9). All cleaned up in v0.3.

### CV2-B6 — Failed-revert observability via outer/inner two-RPC split (Chris's call 2026-05-26)

3rd-round cross-verify (GPT A-B6) surfaced that the v0.3 single-RPC dispatch leaves no auditable trail for FAILED reverts. If `revert_md_upload` raises inside its transaction, the whole transaction rolls back — including any attempt to record "we tried and it failed." Operators have NO way to know a rejected/crashed revert ever happened (eligibility-failure responses go back to TS, which throws; the audit log only sees successes). The Sentry rule from CV2-I11 (alerts on `revert_upload` audit rows with non-null `error_message`) doesn't help — rejected reverts never reach the audit-row INSERT.

**Fix (Chris's choice from 2026-05-26 — "two-RPC outer/inner split"):**

The v0.3 monolithic `revert_md_upload` RPC splits into an OUTER attempt-logging RPC + an INNER atomic-apply RPC.

1. **New table `scheduler_admin_revert_attempts`** (added to Migration A — coordinated with Agent 3 who owns Migration A SQL; this prose flags the addition, orchestrator merges the SQL post-agent-completion). REWRITTEN v0.4 per X-FIX-AGENT-F to close 4th-round cross-verify findings X5 (token-leak BLOCKER), X15 (orphan-rows BLOCKER), BOTH-flagged `reason` overload, BOTH-flagged `failed` dead state, Gemini-NTH missing `completed_at`, GPT-NTH retention policy, GPT-NTH actor_email naming, GPT-IMPORTANT diff overflow:
   ```sql
   CREATE TABLE public.scheduler_admin_revert_attempts (
     id                              BIGSERIAL PRIMARY KEY,
     attempted_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
     completed_at                    TIMESTAMPTZ NULL,                          -- set on terminal UPDATE
     upload_id                       BIGINT NOT NULL                            -- X15 fix: NOT NULL + FK
                                       REFERENCES public.scheduler_admin_audit_log(id) ON DELETE RESTRICT,
     shop_id                         INTEGER NOT NULL,
     actor_email                     TEXT,                                       -- see COMMENT: actor_label rename deferred
     oauth_client_id                 TEXT,
     dry_run                         BOOLEAN NOT NULL,
     outcome                         TEXT NOT NULL                               -- 'failed' REMOVED (dead state)
                                       CHECK (outcome IN ('pending','dry_run_success','success','rejected','crashed')),
     reason_code                     TEXT NULL,                                  -- short Sentry-safe enum (split from old `reason`)
     error_detail                    TEXT NULL,                                  -- verbose SQLSTATE+SQLERRM+diff (DB-only)
     metadata                        JSONB NULL,                                 -- reserved for future per-handler context
     dry_run_confirm_token_hash      TEXT NULL,                                  -- X5 fix: sha256(token) hex, NOT the token itself
     revert_audit_log_id             BIGINT NULL
                                       REFERENCES public.scheduler_admin_audit_log(id),

     CONSTRAINT scheduler_admin_revert_attempts_token_hash_scope_check
       CHECK ((outcome = 'dry_run_success' AND dry_run_confirm_token_hash IS NOT NULL)
              OR (outcome <> 'dry_run_success' AND dry_run_confirm_token_hash IS NULL)),
     CONSTRAINT scheduler_admin_revert_attempts_completed_at_invariant_check
       CHECK ((outcome = 'pending' AND completed_at IS NULL)
              OR (outcome <> 'pending' AND completed_at IS NOT NULL)),
     CONSTRAINT scheduler_admin_revert_attempts_audit_log_scope_check
       CHECK ((outcome = 'success' AND revert_audit_log_id IS NOT NULL)
              OR (outcome <> 'success' AND revert_audit_log_id IS NULL))
   );
   CREATE INDEX scheduler_admin_revert_attempts_outcome_idx
     ON public.scheduler_admin_revert_attempts (outcome, attempted_at DESC)
     WHERE outcome IN ('rejected','crashed');
   CREATE INDEX scheduler_admin_revert_attempts_shop_idx
     ON public.scheduler_admin_revert_attempts (shop_id, attempted_at DESC);
   CREATE INDEX scheduler_admin_revert_attempts_upload_idx
     ON public.scheduler_admin_revert_attempts (upload_id);
   CREATE INDEX scheduler_admin_revert_attempts_pending_idx
     ON public.scheduler_admin_revert_attempts (attempted_at) WHERE outcome = 'pending';
   ```
   See §4.1 Migration A for the authoritative SQL (column COMMENTs + retention policy COMMENT live there). RLS policies + REVOKE/GRANT landed v0.4 X-FIX-AGENT-B — RESTRICTIVE deny-all policy on the table, REVOKE ALL FROM PUBLIC + anon + authenticated, GRANT SELECT/INSERT/UPDATE TO service_role on the table + USAGE/SELECT on the sequence. Same triple also added to `scheduler_admin_audit_log` (idempotent — closes the gap where that older table had a PERMISSIVE deny_all + no table-level REVOKE). See §4.1 for the SQL; full 4-layer defense rationale in §8.4.

2. **Outer RPC `revert_md_upload_attempt(p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id, p_dry_run, p_expected_confirm_token, p_force_no_after_hash)`** runs in its own transaction:
   - STEP 0a: parameter-presence guard — RAISE if `p_shop_id IS NULL OR <= 0`, RAISE if `p_upload_id IS NULL OR <= 0` (X-FIX-AGENT-A — PL/pgSQL function parameters cannot use `NOT NULL` syntax).
   - STEP 0b: multi-tenant auth assertion (X-FIX-AGENT-B). The load-bearing in-DB auth check is the canonical REVOKE EXECUTE FROM PUBLIC/anon/authenticated + GRANT TO service_role triple — only service_role (used by orchestrator-mcp) can call. An `auth.uid()`-vs-employees.shop_id in-function check is not implementable in this codebase (no `employees` table; no `auth.uid()`-resolvable session). STEP 0b additionally requires `p_actor_email IS NOT NULL` (audit-trail integrity — no anonymous reverts even for service_role direct callers). The 4-layer defense — caller identity at orchestrator-mcp + DB-layer REVOKE/GRANT + STEP 0 presence guards + handler-layer Invariants 5 + 6 — collectively closes the 4th-round GPT BLOCKER X6/X7 + IMPORTANT "Snapshot tampering protection overstated". See §8.4 for the full layer-by-layer narrative.
   - INSERT attempt row with `outcome='pending'`, returning attempt_id (INSERT runs in the outer transaction frame, NOT inside the BEGIN…EXCEPTION subtransaction below).
   - Open a PL/pgSQL `BEGIN … EXCEPTION WHEN OTHERS THEN … END` subtransaction block — the implementation-pattern equivalent of a SAVEPOINT (NOT a literal `SAVEPOINT revert_apply` SQL statement, which would fail to compile in a Postgres function — see "PL/pgSQL transaction-control note" in §4.4).
   - Invoke inner via `SELECT * INTO v_inner FROM revert_md_upload_apply(...)` (function call — NOT a `CALL` procedure invocation).
   - On inner success: the subtransaction exits cleanly (no implicit rollback), inner mutations + audit row INSERT preserved. UPDATE attempt row `outcome` to `success` (apply path) or `dry_run_success` (preview path per CV2-B5-v0.3-AMEND), `completed_at = now()`, and one of: (a) on `success`, `revert_audit_log_id = <inner audit row id>`; (b) on `dry_run_success`, `dry_run_confirm_token_hash = encode(digest(v_inner.confirm_token, 'sha256'), 'hex')` (the token itself is RETURNED to the caller, NEVER stored in plaintext — per X-FIX-AGENT-F X5). The `revert_audit_log_id`/`dry_run_confirm_token_hash` mutual exclusion is enforced by CHECK constraints in §4.1. RETURN result row that always carries `outcome` + `reason_code` (NULL on success) so the TS wrapper can classify uniformly.
   - On inner RAISE: the BEGIN…EXCEPTION subtransaction auto-rolls back inner mutations + audit row INSERT (PL/pgSQL implicit-subtransaction semantics); attempt row INSERT preserved since it was in the outer frame. Capture SQLSTATE + SQLERRM + CONSTRAINT_NAME via `GET STACKED DIAGNOSTICS`, UPDATE attempt row `outcome` to `rejected`/`crashed` (classified per the SQLSTATE + constraint-name + RAISE-prefix table below), `reason_code` (short Sentry-safe enum), `error_detail` (verbose `SQLSTATE:SQLERRM` body — including any inline staleness diff; DB-only, see Sentry payload rules below), and `completed_at = now()`. RETURN structured error result with `outcome` + `reason_code` + `error_message` (do NOT re-RAISE — outer IS the audit boundary).

3. **Inner RPC `revert_md_upload_apply(...)`** is the v0.3 monolithic dispatch+staleness+handler logic from §4.4. Runs INSIDE the outer's transaction, inside the BEGIN…EXCEPTION subtransaction block. Inner contract is RAISE-only (no structured eligibility-failure returns — every failure path RAISEs so the outer's classifier sees one uniform signal). Inner has NO knowledge of the attempt-tracking row.

4. **Sentry alert emission mechanism — TS-wrapper-side, NOT a DB trigger (REVISED v0.4 per X-FIX-AGENT-F redaction; expanded v0.5 X-FIX-AGENT-G to spell out the emission pattern + redaction rationale).** The Sentry alert is NOT emitted by Postgres (databases do not push to Sentry). It is NOT emitted by an unwrapped exception in the TS layer either (the outer RPC swallows all inner exceptions into structured result rows — `try/catch` around `sb.rpc(...)` would never fire for a `'rejected'`/`'crashed'` outcome since the RPC succeeded from the connection's perspective). The ONLY place that sees the outcome in time to emit is the TS wrapper, after it receives the structured RPC result.

   **Canonical emission pattern** (lives in `scheduler-admin-catalog.ts` `revertMdUpload` after the outer RPC returns):

   ```ts
   // After: const { data, error } = await sb.rpc('revert_md_upload_attempt', { ... }).single();
   // (Connection-level errors handled separately; this branch is for RPC success
   //  with a structured failure outcome.)

   const OK_OUTCOMES = new Set(['success', 'dry_run_success']);

   if (data && !OK_OUTCOMES.has(data.outcome)) {
     // Emit Sentry capture for operator visibility.
     // Carries: machine-readable enum + identifiers for DB pivot.
     // EXCLUDES: error_detail (may contain verbose SQLSTATE:CONSTRAINT_NAME:SQLERRM
     //           plus inline staleness-diff content of customer-facing scheduler MD).
     //           Operator pivots to DB via attempt_id to inspect error_detail
     //           in tenant-scoped/service_role-gated surfaces.
     Sentry.captureMessage(`revert_attempt:${data.outcome}`, {
       level: data.outcome === 'crashed' ? 'error' : 'warning',
       tags: {
         shop_id: data.shop_id ?? p_shop_id,
         upload_id: args.upload_id,
         actor_email: args.audit.display_name,
         outcome: data.outcome,
         reason_code: data.reason_code ?? '<none>',
         attempt_id: data.attempt_id,
       },
       extra: {
         dry_run: args.dry_run ?? false,
         // INTENTIONALLY OMITTED: error_detail (carries SQLSTATE:CONSTRAINT_NAME:SQLERRM
         //   + diff content that may include customer-facing scheduler text).
         // Operator queries scheduler_admin_revert_attempts WHERE id = attempt_id
         //   in a service_role-gated surface (admin-app server actions) to inspect
         //   error_detail.
       },
     });
     return { ok: false, outcome: data.outcome, reason_code: data.reason_code,
              error_message: data.error_message, attempt_id: data.attempt_id };
   }
   ```

   The `'failed'` outcome was removed from the enum per X-FIX-AGENT-F — no code path emits it, and the CHECK constraint in §4.1 no longer permits it.

   **Redaction policy (canonical — same rule applies wherever the outcome is surfaced; UPDATED v0.5 X-FIX-#10 2026-05-26 to include `error_message`):**

   | Field | Sentry payload | RPC return row → TS | DB attempt row | Why |
   |---|---|---|---|---|
   | `reason_code` | YES — `tags.reason_code` | YES — `reason_code` column | YES — `reason_code` column | Machine-readable enum (`'current_state_drift'`, `'successor_revert_exists'`, `'confirm_token_mismatch'`, etc.); safe for monitoring + alerting. |
   | `error_message` | NO — intentionally omitted from Sentry `extra` | YES — sanitized templated summary only (X-FIX-#10) | NO — not stored | Templated short-form summary (e.g., "current state drifted since dry-run; re-run dry_run to view the diff (attempt_id 4217)"). Built from `v_sanitized_error_message` in §4.4 outer RPC EXCEPTION block — NEVER contains the raw `v_sqlerrm` body that could carry inline staleness diff text. Safe for TS callers to log / propagate. |
   | `error_detail` | NO — intentionally omitted | NO — not in RETURN shape | YES — `error_detail` column | Verbose `SQLSTATE:CONSTRAINT_NAME:SQLERRM` body + inline staleness-diff content from `compute_unified_diff`. May include customer-facing scheduler MD text. Sentry payloads + RPC return rows should not carry diff text; operators query the DB by `attempt_id` for triage via `scheduler_admin_revert_attempts.error_detail`. |
   | `attempt_id` | YES — `tags.attempt_id` | YES — `attempt_id` column | YES — primary key | Pivot key from Sentry event → RPC caller → DB row. |
   | `shop_id` / `upload_id` / `actor_email` | YES — `tags.*` | YES (subset) | YES — columns | Identity for operator dispatch. |
   | `confirm_token` (dry_run path) | NEVER — token is the authorization secret | YES (success only — fresh token from dry_run_success row) | NEVER — hash stored in `dry_run_confirm_token_hash` only | Per X-FIX-AGENT-F X5. Token is RETURNED to the caller in the RPC RETURN row on dry_run_success only, never persisted in plaintext, never logged. |

   **REPLACES the v0.3 plan's `revert_upload audit row WHERE error_message IS NOT NULL` rule** — that pattern is moot in v0.4 because rejected reverts never produce an audit row (the attempt table replaces that surface).

**Outcome classification by SQLSTATE + CONSTRAINT_NAME / RAISE prefix** (X-FIX-AGENT-A — uniform RAISE-only inner contract per the §4.4 prose; 23505 narrowed per X14; column name `reason_code` matches the schema redesign landed by X-FIX-AGENT-F):
- `55P03` (lock_not_available, from `FOR UPDATE NOWAIT`) → `outcome='rejected'`, `reason_code='another_revert_in_progress'`
- `23505` (unique_violation) AND `CONSTRAINT_NAME = 'scheduler_admin_audit_log_one_successful_revert_idx'` (the ONE partial unique index that protects "exactly one successful revert per upload") → `outcome='rejected'`, `reason_code='successor_revert_exists'`
- `23505` (unique_violation) AND any OTHER constraint name (cross-shop ID collision, corrupted snapshot, unexpected unique constraint, etc.) → `outcome='crashed'`, `reason_code='unique_violation'` — surfaces real data-integrity bugs that the prior over-broad classification was hiding
- App-RAISEd messages with prefix `revert_blocked:` → `outcome='rejected'`, `reason_code` extracted from the canonical enum prefix via the §3b "Canonical reason_code enum" table allow-list (X-FIX-#24 — 2026-05-26 — replaces v0.5+IMPORTANTs's stale "trimmed text after prefix" wording that contradicted the new classifier SQL; closes GPT round-3 chunk 1 BLOCKER + chunk 3 BLOCKER). Verbose detail after the second colon flows to `error_detail` (DB-only). Unknown enums → `unclassified_revert_blocked`. Special-case: `snapshot_kind_unknown` → `outcome='crashed'` (system bug, not user-remediable; see §3b enum table).
- App-RAISEd messages with prefix `confirm_token_mismatch:` → `outcome='rejected'`, `reason_code='confirm_token_mismatch'`
- App-RAISEd messages with prefix `staleness_check_failed:` → `outcome='rejected'`, `reason_code='current_state_drift'`
- Inner contract is RAISE-only: every inner failure path RAISEs, including eligibility failures (operation, snapshot, 30d cutoff, etc.). Inner NEVER returns a structured eligibility-failure row. This simplifies the outer's classifier — one signal path (caught exception) instead of two (caught + structured-no-raise). (X-FIX-AGENT-A — closes Gemini's "mixed error-handling contract" IMPORTANT finding.)
- Any other unexpected exception (FK violation surfaced via handler, NPE-equivalent) → `outcome='crashed'`, `reason_code=NULL`, `error_detail='<SQLSTATE>:<SQLERRM>'`

**Canonical `reason_code` enum (X-FIX-#11 — 2026-05-26 — closes GPT chunk 3 IMPORTANT "reason_code is not actually Sentry-safe" + GPT chunk 2 IMPORTANT "reason_code is populated from free-form exception messages").**

Every `RAISE EXCEPTION 'revert_blocked: ...'` callsite MUST use the format `'revert_blocked: <enum>: <verbose detail>'` where `<enum>` is from the table below. The outer classifier extracts only the enum (regex `revert_blocked:\s+([a-z0-9_]+)`); the verbose detail flows to `error_detail` (DB-only). Unknown enums fall back to `unclassified_revert_blocked` so Sentry alerts still fire but no row-specific data escapes via `reason_code`.

| `reason_code` enum | Outcome | Raised by | When |
|---|---|---|---|
| `not_found` | rejected | Inner RPC step 1 | parent audit row not found (or sentinel `shop_id=-1` row) |
| `not_upload_md` | rejected | Inner RPC step 2 | audit row's `operation <> 'upload_md'` |
| `successor_revert_exists` | rejected | Inner RPC step 2 | already-successful revert recorded |
| `snapshot_pruned` | rejected | Inner RPC step 2 | snapshot was pruned by retention cron |
| `no_snapshot` | rejected | Inner RPC step 2 | `pre_state_snapshot IS NULL` |
| `over_30_day_cutoff` | rejected | Inner RPC step 2 | `occurred_at < now() - 30 days` |
| `table_not_supported` | rejected | Inner RPC step 2 | snapshot_kind couldn't be resolved + table not in legacy fallback |
| `snapshot_kind_unknown` | **crashed** (system bug) | Inner RPC step 9 dispatch ELSE | handler missing for a snapshot_kind that passed step-2 eligibility |
| `dry_run_token_present` | rejected | Inner RPC step 3 | `p_dry_run AND p_expected_confirm_token IS NOT NULL` (caller bug) |
| `cannot_safely_verify` | rejected | Inner RPC step 6 | pre-X-FIX-AGENT-E snapshot has no `after_hash` + no force flag |
| `cross_shop_hijack_attempt` | rejected | Handler Invariant 5 row-count check | snapshot row count > actual writes (cross-shop conflict skipped) |
| `fk_target_tenant_mismatch` | rejected | Handler Invariant 6 FK pre-validation | snapshot FK target in another shop |
| `fk_broken` | rejected | Handler post-mutation FK catch | FK target deleted via direct DB / non-tracked tool |
| `snapshot_invalid` | rejected | Per-handler input validators | missing/empty required snapshot fields (e.g., `v_category` NULL in per-category handler) |
| `unclassified_revert_blocked` | rejected | Classifier fallback | RAISE message didn't match any canonical enum — surfaces unknown rejection paths to operators |
| `another_revert_in_progress` | rejected | Outer classifier — SQLSTATE 55P03 | parallel revert holding the FOR UPDATE NOWAIT lock |
| `unique_violation` | crashed | Outer classifier — SQLSTATE 23505 (any constraint name except the one partial index) | data-integrity bug |
| `confirm_token_mismatch` | rejected | Outer classifier — prefix `confirm_token_mismatch:` | apply called with stale/wrong token |
| `current_state_drift` | rejected | Outer classifier — prefix `staleness_check_failed:` | canonical state changed between dry_run + apply |
| `NULL` | crashed | Outer classifier — generic ELSE | unexpected exception with no recognizable prefix |

Adding a new enum: (1) add the row above, (2) extend the IN(…) allow-list in the outer classifier (§4.4), (3) update every handler RAISE callsite to use the canonical format, (4) update the §7.3 `revert_eligibility.reasons` union if the new enum should surface in list-tool eligibility too.

**Diagnostics extraction.** Outer uses `GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_constraint_name = CONSTRAINT_NAME` to fetch the metadata needed for the classifier. CONSTRAINT_NAME is populated by Postgres on constraint-violation SQLSTATEs (23xxx).

**Storage column name.** The attempt-row storage column is `reason_code` (landed v0.4 X-FIX-AGENT-F schema redesign — split from the old overloaded `reason` per the BOTH-flagged IMPORTANT finding). The RPC's RETURNS TABLE column is also `reason_code`. The TS wrapper carries the same name through to its `{ ok: false }` shape so there is no rename across the contract surface.

**Trade-off:** every revert attempt now writes ≥1 row to the attempt table (plus 1 audit row on success). Worth it for the operator-visible failure trail.

**Retention policy (X-FIX-AGENT-F — closes GPT-NTH "Attempt table intentionally has no retention limit despite actor/error data"):** rows carry `actor_email`, `oauth_client_id`, and `error_detail` (which may include truncated diffs of customer-facing scheduler MD), so retention is a privacy/ops decision, not a "no limit" default. The designed policy is:

- **Online: 90 days from `completed_at`** for terminal rows (success / dry_run_success / rejected / crashed). Pending rows (`completed_at IS NULL`) are NEVER pruned — they are either in-flight or stuck; both deserve human attention before deletion (see the `scheduler_admin_revert_attempts_pending_idx` partial index for stuck-pending alerting).
- **Archive: day 91** copy each terminal row to `scheduler_admin_revert_attempts_archive` (same shape, separate table for tighter access control + cheaper storage), then `DELETE` from the live table.
- **Hard-delete: day 365 from `completed_at`** purge from the archive table.

The schema columns (`completed_at`, partial indexes) are in place from day 1; the **implementation of the retention cron + archive table is DEFERRED** until volume is known after the first 90 days of production traffic (operators rarely revert; tuning a window for unobserved volume is premature). Tracked in `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` OBS-9.

### CV2-B5-v0.3-AMEND — Revert dry-run mode (Chris's call 2026-05-26 — A-B5) — REWRITTEN v0.4 per X-FIX-AGENT-E

3rd-round cross-verify (GPT A-B5) surfaced that the revert path lacked the V2 uploader's two-step `dry_run` + `expected_confirm_token` flow. v0.3 already required `p_expected_confirm_token` on `revert_md_upload`, but no way to OBTAIN that token without first calling the apply path (chicken-and-egg). Operators had no preview of "what would revert do to my current rows" before committing.

4th-round cross-verify (X4 + X13 + X-AMEND-v2 from GPT) surfaced four additional issues with the v0.3 dry_run design — all now closed in v0.4 by X-FIX-AGENT-E and reflected in §4.4 + §8.1 + §8.3:

1. **X4 BLOCKER** — Dry-run could BYPASS the post-upload staleness guard (token returned before staleness check ran).
2. **X13 BLOCKER** — Target-row locks happened AFTER the staleness snapshot, leaving a lost-update window where a concurrent editor could mutate a target row mid-dispatch.
3. **X-AMEND-v2 IMPORTANT** — Dry-run silently ignored a non-NULL `p_expected_confirm_token` (hid caller bugs).
4. **X-AMEND-v2 IMPORTANT** — Confirm-token input `sha256(v_snapshot::text)` was brittle (JSONB::text rendering depends on PG version / formatting).

**Fix (Chris's choice from 2026-05-26 — "dry-run mode on the revert RPC, mirror V2 catalog uploader Pattern S," REFRAMED in v0.4 per X-FIX-AGENT-E):**

The outer RPC `revert_md_upload_attempt` takes `p_dry_run BOOLEAN DEFAULT false`. Behavior:

- **`p_dry_run=true`** (preview mode):
  - Inner `revert_md_upload_apply` runs eligibility checks (operation, snapshot, 30d cutoff, snapshot_pruned, successor_revert_id, snapshot_kind resolution, shop_id match) — step 1-2.
  - **NEW v0.4 (X-FIX-AGENT-E, closes X-AMEND-v2):** Inner RAISEs `revert_blocked: expected_confirm_token must be NULL in dry_run mode (the token is the OUTPUT of dry_run, not its input)` if `p_expected_confirm_token` is non-NULL. v0.3 silently ignored; v0.4 rejects loudly to catch caller bugs where the client accidentally sent apply parameters to preview mode (or reused stale state).
  - **NEW v0.4 (X-FIX-AGENT-E, closes X13):** Inner acquires target-row locks via `lock_targets_for_kind(v_kind, p_shop_id, v_snapshot)` BEFORE computing the current canonical (step 4). v0.3 left lock acquisition inside the handler — that created a TOCTOU window where a concurrent editor could mutate a target row AFTER the staleness snapshot but BEFORE the handler took locks. v0.4's lock-then-compute ordering means current-state computation + staleness check both run under the locks the handler will later mutate under.
  - Inner computes current canonical hash UNDER locks (step 5). Token = `sha256(p_upload_id || '|' || table_name || '|' || current_head_hash || '|' || COALESCE(snapshot.after_hash, '<<no-after-hash>>'))` — **4-explicit-field binding (X-FIX-AGENT-E, closes X-AMEND-v2 "snapshot_hash brittleness"):** every input is either a deliberately-canonicalized hash (current_head_hash, snapshot.after_hash) or a stable scalar (upload_id integer, table_name text). Survives JSONB rendering changes / PG version updates / pg_dump format changes. v0.3's `sha256(v_snapshot::text)` was rejected because JSONB::text rendering depends on PG version + key ordering quirks.
  - **NEW v0.4 (X-FIX-AGENT-E, closes X4):** Inner runs the staleness check (step 6) BEFORE the dry-run early-return. v0.3 ran staleness ONLY on the apply path — that meant dry_run on drifted state happily returned a token, which the operator could then submit on apply, reverting OVER the legitimate post-upload edits. v0.4 runs the same check on BOTH paths. Two-stage check: fast-path is `snapshot.after_hash != current_head_hash` (cheap, 64-char hex equality); slow path is the diagnostic diff via `compute_unified_diff`, generated only on hash mismatch. If the snapshot pre-dates after_hash (pre-CV2-B3), require explicit `force_no_after_hash=true` (logged + flagged).
  - Only AFTER staleness passes: inner returns `(revert_audit_log_id=NULL, confirm_token=<hex>, restored=0, deactivated=0, deleted=0, dry_run=true)`. **NO mutations. NO audit row.**
  - Outer sets attempt row `outcome='dry_run_success'`, `reason_code=NULL`, `completed_at = now()`, and `dry_run_confirm_token_hash = encode(digest(v_inner.confirm_token, 'sha256'), 'hex')` (X-FIX-AGENT-F landed the dedicated column per X5; the token's PRESENCE is traceable via the hash, while the token itself is returned to the caller and NEVER persisted). The CHECK constraint `scheduler_admin_revert_attempts_token_hash_scope_check` enforces that `dry_run_confirm_token_hash` is non-NULL iff `outcome='dry_run_success'`. (Historical note: the original CV2-B5-v0.3-AMEND prose proposed storing the token in `reason` "for traceability" — that was a secret-leak BLOCKER caught by GPT in the 4th-round cross-verify; the v0.4 design replaces it with the hash + RETURN-only token.)

- **`p_dry_run=false`** (apply mode):
  - REQUIRES `p_expected_confirm_token` non-NULL. If NULL → inner RAISEs `confirm_token_mismatch: dry_run=false requires expected_confirm_token (call with dry_run=true first to obtain it)`.
  - Inner runs steps 1-6 (eligibility + lock acquisition + current-state computation + token recomputation + staleness check) IDENTICAL to dry_run path — same locks held, same staleness gate applied, same drift detection. The dry_run-vs-apply split is at step 7 (dry-run returns) vs steps 8-12 (apply continues).
  - Inner string-compares `p_expected_confirm_token` to recomputed (step 8); on mismatch → RAISE `confirm_token_mismatch: head has changed since dry_run (or token was for a different upload); call with dry_run=true again to obtain a fresh token`.
  - Inner runs the full apply (dispatch → handler → audit row INSERT → parent.successor_revert_id UPDATE) — steps 9-12.
  - Inner returns `(revert_audit_log_id=<id>, confirm_token=NULL, restored, deactivated, deleted, dry_run=false)`.

**Mirrors the two-step token workflow from V2 catalog uploaders** — same `dry_run` → `confirm_token` → `apply` shape, same "fresh token required per dry_run" guarantee, same caller experience. The Claude Desktop chat-instructions update from §9 already documents this flow for uploaders; v0.4 extends it to cover `revert_md_upload` too.

**Where the revert flow does NOT exactly mirror Pattern S** (Gemini IMPORTANT from the 4th-round cross-verify):

- **Locus of token computation.** Uploader Pattern S computes the token in TS (per CV2-I2 — TS canonicalizes the diff_summary + emits the sha256). Revert computes the token inside the inner RPC under target-row locks (per X-FIX-AGENT-E — must happen under locks to be staleness-safe). The token semantics are identical (sha256 over a canonical concatenation of operation-defining fields); the LOCUS differs because revert needs the locks first.
- **Persistence + auditing.** Uploader dry_run returns early before calling apply RPC + does NOT write an audit row (per CV2-I2). Revert dry_run ALWAYS writes an attempt row (`outcome='dry_run_success'`) for failed-revert observability (per CV2-B6). The attempt row provides the operator-visible trail; uploader dry_run leaves no trail because there's no analogous failure-trail concern (failed uploads don't have the same multi-tenant scope-of-damage signature).
- These differences are by design + narrow the "mirrors Pattern S exactly" claim to "mirrors the two-step TOKEN workflow exactly — not the persistence / auditing layer."

**TS wrapper signature change:**
```ts
export async function revertMdUpload(sb, shopId, args: {
  upload_id: number;
  audit: AuditContext;
  dry_run?: boolean;
  expected_confirm_token?: string;
  force_no_after_hash?: boolean;
}): Promise<RevertResult>
```

Tool registry block updates the description to call out the two-step flow + extends `inputSchema` with `dry_run` + `expected_confirm_token` (mirrors §5.6 for uploaders).

---

## 4. Migrations (split A + B per CV-B1)

### 4.1 Migration A — additive/forward-compatible

`supabase/migrations/20260526000000_scheduler_admin_audit_log_hardening_part_a.sql`:

```sql
-- Part A: additive schema changes that the new orchestrator-mcp code can
-- write to, but ALSO compatible with the old code (which simply doesn't
-- set the new columns). Once the new code is deployed AND the backfill
-- script has run AND Chris confirms zero NULL shop_id rows, run Part B
-- to set NOT NULL.

BEGIN;

-- X-FIX-1 (2026-05-26 — cross-verify GPT chunk 2 BLOCKER): pgcrypto provides
-- the digest() function the outer+inner RPCs use for confirm-token + canonical
-- hash computation. PostgreSQL has NO built-in sha256(text) function —
-- without pgcrypto installed, every RPC that recomputes a token (every
-- dry-run, every apply, every revert) fails at runtime with
-- "function digest(text, unknown) does not exist". Idempotent: if pgcrypto
-- is already installed in the target DB (Supabase usually has it but not
-- guaranteed), this is a no-op.
-- X-FIX-#23 (2026-05-26) — closes GPT round-3 chunk 2 BLOCKER "pgcrypto may
-- be installed in extensions, but SECURITY DEFINER functions cannot see it".
-- Supabase installs all extensions to the `extensions` schema by default
-- (verified via supabase docs: https://supabase.com/docs/guides/database/extensions).
-- `CREATE EXTENSION IF NOT EXISTS pgcrypto` without an explicit `WITH
-- SCHEMA` clause is a no-op when pgcrypto already exists, regardless of
-- which schema it lives in — so this DDL alone doesn't guarantee `digest(...)`
-- is callable from SECURITY DEFINER functions whose search_path doesn't
-- include the extensions schema. The fix is to add `extensions` to the
-- canonical search_path in every SECURITY DEFINER function (see §4.4 + the
-- canonical security setup block). The combined effect:
--   1. CREATE EXTENSION ensures pgcrypto's functions exist somewhere in the DB
--   2. search_path including `extensions` ensures unqualified `digest(...)`
--      resolves to `extensions.digest(...)`
-- Belt-and-suspenders: if a fresh Supabase project happens to install
-- pgcrypto to `public` (older project template), the search_path still
-- includes `public` so it resolves there. The order in search_path is
-- `pg_catalog, extensions, public` — pg_catalog first (system catalogs +
-- built-ins), extensions next (Supabase convention), public last (so any
-- user-defined function shadowing in `public` overrides last; safe because
-- we don't WANT any function shadowing on these SECURITY DEFINER paths).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PE-1: CHECK loosen so revert_upload audit rows can actually INSERT
ALTER TABLE public.scheduler_admin_audit_log
  DROP CONSTRAINT IF EXISTS scheduler_admin_audit_log_operation_check;

ALTER TABLE public.scheduler_admin_audit_log
  ADD CONSTRAINT scheduler_admin_audit_log_operation_check
    CHECK (operation IN ('upload_md','manual_change','export_md','revert_upload'));

-- PE-2 part 1: shop_id column NULLABLE — the new code writes it; old
-- pre-deploy code simply omits it (NULL is OK). Backfill happens in a
-- separate Deno script (NOT here). Part B will set NOT NULL.
ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS shop_id INTEGER NULL;

-- PE-3: revert linkage columns
ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS successor_revert_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverts_upload_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL;

-- Race-defense partial unique index. Per CV2-B2 v0.3 (all-in-one RPC
-- transaction), there's no more pending/claim phase — successful reverts
-- write `error_message IS NULL` audit rows directly in one transaction.
-- The unique partial index prevents two successful reverts pointing at
-- the same upload_id (defense in depth — the primary line is the
-- `successor_revert_id IS NULL` eligibility check inside `revert_md_upload`).
--
-- X-FIX-#14 (2026-05-26) — index creation on `scheduler_admin_audit_log` is
-- a documented lock-window risk on production-sized audit logs (GPT chunk 2
-- IMPORTANT #40). At Phase 1 ship the table is small enough (~thousands of
-- rows; only admin-tool mutations write here, not customer traffic) that
-- the BEGIN-block index creation is tolerable. If table growth makes the
-- lock window unacceptable in the future, move these 4 audit-log indexes
-- (one_successful_revert / shop_recent / surface_recent / surfaces_gin) out
-- of the BEGIN block and recreate via CREATE INDEX CONCURRENTLY — the same
-- pattern Migration B uses for its renamed indexes (see X-FIX-#14 in §4.3).
-- The `scheduler_admin_revert_attempts` indexes below are unaffected: that
-- table is created here for the first time, so it's empty at index-build
-- time and concurrent isn't necessary.
CREATE UNIQUE INDEX IF NOT EXISTS scheduler_admin_audit_log_one_successful_revert_idx
  ON public.scheduler_admin_audit_log (reverts_upload_id)
  WHERE reverts_upload_id IS NOT NULL AND error_message IS NULL;

-- Indexes for new list_scheduler_admin_audit_log tool's per-surface query.
-- shop_id nullable here means the (shop_id, …) lookup tolerates NULLs as
-- "match no rows" — acceptable since new admin-app calls always pass
-- shop_id and Migration B will require it.
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_shop_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, occurred_at DESC)
  WHERE shop_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, table_name, operation, occurred_at DESC)
  WHERE shop_id IS NOT NULL;

-- CV2-I10: GIN expression index for fast list_scheduler_admin_audit_log
-- filtering by surface_filter when multiple surfaces share a table_name.
-- X-FIX-#14: GIN build cost is the most expensive of the 4 audit-log
-- indexes here. If audit-log size at ship-time triggers a measurable
-- lock-window concern, move ONLY this one out of BEGIN and CREATE INDEX
-- CONCURRENTLY (the other 3 btree indexes are cheap on small tables).
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_surfaces_gin_idx
  ON public.scheduler_admin_audit_log
  USING GIN ((diff_summary->'surfaces'));

-- CV2-B6 v0.3 (REWRITTEN v0.4 per X-FIX-AGENT-F — schema redesign): the
-- scheduler_admin_revert_attempts table is the outer RPC's
-- (revert_md_upload_attempt) failure-trail surface. Outer always inserts an
-- attempt row regardless of outcome, so failed/rejected reverts have an
-- audit trail (the scheduler_admin_audit_log only carries SUCCESSFUL revert
-- rows because the inner RPC's transaction rolls back on failure).
--
-- v0.4 X-FIX-AGENT-F deltas (close 4th-round cross-verify findings):
--   X5  (GPT BLOCKER)  — dry_run confirm_token NEVER stored in plaintext.
--                        Dedicated `dry_run_confirm_token_hash` column
--                        stores sha256(token) hex; token itself returned to
--                        caller, never persisted. Token-hash scope locked
--                        via CHECK constraint (only valid on dry_run_success).
--   X15 (Gemini BLOCKER) — `upload_id` is NOT NULL with FK to
--                        scheduler_admin_audit_log(id) ON DELETE RESTRICT.
--                        Every attempt is against a specific upload; orphan
--                        rows cannot exist.
--   BOTH-IMPORTANT (reason overload) — `reason` column SPLIT into:
--                        `reason_code TEXT NULL`  — short machine-readable
--                                                    enum (Sentry-safe,
--                                                    e.g., 'current_state_drift')
--                        `error_detail TEXT NULL` — verbose
--                                                    SQLSTATE:CONSTRAINT_NAME:SQLERRM
--                                                    + multi-line diff content
--                                                    (DB-only, NOT for Sentry)
--   BOTH-NTH (failed dead state) — `failed` REMOVED from CHECK constraint.
--                        No current code path emits it; reserved name kept
--                        out of the enum to keep state-space minimal.
--   Gemini-NTH (no completion ts) — `completed_at TIMESTAMPTZ NULL` added.
--                        Set by outer on every terminal UPDATE (success,
--                        dry_run_success, rejected, crashed). NULL iff
--                        outcome='pending'. CHECK constraint enforces.
--   GPT-NTH (retention)  — 90-day online → archive table → 365-day hard
--                        delete documented in §3b CV2-B6 trade-off + §8.5.
--                        Implementation deferred per DEFERRED-AUDIT-ITEMS.md
--                        OBS-9.
--   GPT-IMPORTANT (diff overflow) — `error_detail` is TEXT (not VARCHAR),
--                        so 50-line staleness diffs fit. The reason_code
--                        stays short ('current_state_drift'); the diff
--                        body goes into error_detail.
--   GPT-NTH (actor_email vs label) — kept name `actor_email` to keep
--                        Agent A's parameter + Agent D's TS wrapper stable.
--                        Column COMMENT documents that `display_name` is
--                        accepted (today's TS wrapper passes
--                        `args.audit.display_name`). Rename to actor_label
--                        deferred; would force a coordinated parameter
--                        rename across outer + inner + TS wrapper that is
--                        not worth the blast radius today.
--   `metadata JSONB`     — reserved future per-handler context carrier
--                        (currently unused). Avoids needing a schema
--                        migration the next time a handler wants to
--                        surface a per-attempt detail.
--   v0.4 X-FIX-AGENT-B  — adds RLS RESTRICTIVE deny-all policy + table-level
--                        REVOKE ALL FROM PUBLIC/anon/authenticated + GRANT
--                        SELECT/INSERT/UPDATE TO service_role on the table +
--                        USAGE/SELECT on the sequence. Same triple also added
--                        to the existing scheduler_admin_audit_log table
--                        (idempotent; closes the gap where the older table
--                        had a PERMISSIVE deny_all + no table-level REVOKE).
--                        Full 4-layer multi-tenant defense narrative in §8.4.
CREATE TABLE IF NOT EXISTS public.scheduler_admin_revert_attempts (
  id                              BIGSERIAL PRIMARY KEY,
  attempted_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                    TIMESTAMPTZ NULL,
  upload_id                       BIGINT NOT NULL
                                    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE RESTRICT,
  -- X-FIX-#27 (2026-05-26) — closes GPT round-3 chunk 2 IMPORTANT "The
  -- attempts table does not enforce shop_id > 0". The outer RPC's STEP 0a
  -- guard validates positive p_shop_id, but the table itself was permissive.
  -- Direct service_role writes or future code paths could pollute with -1
  -- (audit-log sentinel) / 0 / negative tenant markers. The CHECK forces
  -- valid Tekmetric shop IDs. Audit-log uses (shop_id > 0 OR shop_id = -1)
  -- to permit the historical-backfill sentinel; attempts table is NEW and
  -- has no historical-sentinel use case, so simple positive constraint.
  shop_id                         INTEGER NOT NULL
                                    CHECK (shop_id > 0),
  actor_email                     TEXT,
  oauth_client_id                 TEXT,
  dry_run                         BOOLEAN NOT NULL,
  outcome                         TEXT NOT NULL
                                    CHECK (outcome IN ('pending','dry_run_success','success','rejected','crashed')),
  reason_code                     TEXT NULL,
  error_detail                    TEXT NULL,
  metadata                        JSONB NULL,
  dry_run_confirm_token_hash      TEXT NULL,
  revert_audit_log_id             BIGINT NULL
                                    REFERENCES public.scheduler_admin_audit_log(id),

  -- X5 fix: dry_run_confirm_token_hash is set ONLY on dry_run_success.
  -- Token itself is returned to the caller and never persisted.
  CONSTRAINT scheduler_admin_revert_attempts_token_hash_scope_check
    CHECK (
      (outcome = 'dry_run_success' AND dry_run_confirm_token_hash IS NOT NULL)
      OR (outcome <> 'dry_run_success' AND dry_run_confirm_token_hash IS NULL)
    ),

  -- completed_at is NULL iff outcome='pending' (in-flight); NOT NULL for
  -- every terminal outcome (success/dry_run_success/rejected/crashed).
  CONSTRAINT scheduler_admin_revert_attempts_completed_at_invariant_check
    CHECK (
      (outcome = 'pending' AND completed_at IS NULL)
      OR (outcome <> 'pending' AND completed_at IS NOT NULL)
    ),

  -- revert_audit_log_id is set ONLY on outcome='success'. dry_run_success
  -- intentionally produces no audit row (mutations did not happen).
  CONSTRAINT scheduler_admin_revert_attempts_audit_log_scope_check
    CHECK (
      (outcome = 'success' AND revert_audit_log_id IS NOT NULL)
      OR (outcome <> 'success' AND revert_audit_log_id IS NULL)
    ),

  -- X-FIX-#13 (2026-05-26) — closes GPT chunk 2 IMPORTANT #33 "Attempt-table
  -- constraints do not enforce dry-run/outcome consistency".
  -- Pair outcome ↔ dry_run so no future code path can record nonsensical
  -- combinations like (outcome='success' AND dry_run=true) or
  -- (outcome='dry_run_success' AND dry_run=false).
  CONSTRAINT scheduler_admin_revert_attempts_dry_run_outcome_scope_check
    CHECK (
      (outcome = 'success'         AND dry_run = FALSE) OR
      (outcome = 'dry_run_success' AND dry_run = TRUE)  OR
      outcome IN ('pending', 'rejected', 'crashed')
      -- pending/rejected/crashed are agnostic to dry_run; they can occur in
      -- either mode (dry_run flag tells operators which mode the attempt was).
    ),

  -- X-FIX-#13 (2026-05-26) — closes GPT chunk 2 IMPORTANT #34 "Attempt-table
  -- constraints do not enforce success/error field scope".
  -- Pair outcome ↔ reason_code + error_detail so success paths never carry
  -- failure-side data + rejected paths always have a reason_code.
  CONSTRAINT scheduler_admin_revert_attempts_success_field_scope_check
    CHECK (
      -- success / dry_run_success: no rejection or error data
      (outcome IN ('success', 'dry_run_success')
         AND reason_code IS NULL AND error_detail IS NULL)
      OR
      -- rejected: must carry a reason_code (could be 'unclassified_revert_blocked'
      -- via the §4.4 classifier fallback, but never NULL); error_detail optional
      (outcome = 'rejected' AND reason_code IS NOT NULL)
      OR
      -- crashed: reason_code optional (classifier may emit NULL for unrecognized
      -- exceptions); error_detail SHOULD be non-NULL for operator triage but
      -- not strictly required at the schema level
      outcome = 'crashed'
      OR
      -- pending: in-flight, no failure data yet
      (outcome = 'pending' AND reason_code IS NULL AND error_detail IS NULL)
    )
);

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.actor_email IS
  'Operator label for the attempt. Today populated from the TS wrapper''s '
  '`args.audit.display_name` — column name kept as actor_email for parameter '
  'stability across Agent A''s outer/inner RPC signatures; rename to '
  '`actor_label` was considered + deferred during X-FIX-AGENT-F.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.revert_audit_log_id IS
  'FK to scheduler_admin_audit_log(id). Set ONLY when outcome=success (per '
  'audit_log_scope_check). By construction, the outer RPC sets this to the '
  'audit-log row id the inner RPC just INSERTed for operation=revert_upload '
  'with reverts_upload_id=upload_id + same shop_id + error_message IS NULL. '
  'X-FIX-#13 (2026-05-26): the FK itself enforces row existence; it does NOT '
  'enforce operation/reverts_upload_id/shop_id/error_message semantics — that '
  'protection is tracked as DEFERRED-AUDIT-ITEMS.md SEC-14 (defense-in-depth '
  'trigger against future manual/operator UPDATEs that bypass the outer RPC). '
  'Current correctness comes from the outer RPC being the only writer.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.dry_run_confirm_token_hash IS
  'sha256(confirm_token) hex digest. The token itself is returned to the '
  'caller for the apply step; it is NEVER persisted. Hash here lets '
  'operators trace token PRESENCE without storing the replayable secret. '
  'CHECK constraint scopes this column to outcome=dry_run_success.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.reason_code IS
  'Short machine-readable enum for rejected/crashed outcomes '
  '(e.g., current_state_drift, confirm_token_mismatch, successor_revert_exists, '
  'another_revert_in_progress, unique_violation). Sentry-safe. NULL on success.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.error_detail IS
  'Verbose SQLSTATE:CONSTRAINT_NAME:SQLERRM plus full inline staleness diff '
  'content when relevant. Can be many KB. NOT for Sentry payloads (use '
  'reason_code instead). DB-only operator triage surface.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.metadata IS
  'Reserved JSONB carrier for future per-handler per-attempt context. '
  'Currently unused; keeps schema additions cheap.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.completed_at IS
  'Set on the terminal UPDATE (outcome <> pending). NULL while in-flight. '
  'Pairs with attempted_at for latency analysis. Pending rows older than '
  '5 min are stuck-pending alert candidates (see partial index below).';

COMMENT ON TABLE public.scheduler_admin_revert_attempts IS
  'Per-attempt outer-RPC failure-trail. Retention policy (designed but '
  'implementation deferred per DEFERRED-AUDIT-ITEMS.md OBS-9): 90 days '
  'online (terminal rows), then archived to '
  'scheduler_admin_revert_attempts_archive (TBD), then hard-deleted at day '
  '365. Pending rows (completed_at IS NULL) are NEVER pruned — they are '
  'either in-flight or stuck (alert + human attention).';

-- Operator triage: rejected/crashed in time order.
CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_outcome_idx
  ON public.scheduler_admin_revert_attempts (outcome, attempted_at DESC)
  WHERE outcome IN ('rejected','crashed');

-- Per-shop history.
CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_shop_idx
  ON public.scheduler_admin_revert_attempts (shop_id, attempted_at DESC);

-- Per-upload triage: "what attempts were made against upload X?". The FK
-- already enforces referential integrity; this index speeds the lookup.
CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_upload_idx
  ON public.scheduler_admin_revert_attempts (upload_id);

-- Stuck-pending alerting: pending rows older than N minutes are either
-- stuck (outer crashed mid-inner) or in-flight under heavy contention.
-- Either way they deserve operator attention.
CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_pending_idx
  ON public.scheduler_admin_revert_attempts (attempted_at)
  WHERE outcome = 'pending';

-- RLS: defense-in-depth deny-all (mirrors scheduler_admin_audit_log's
-- existing deny_all pattern from migration 20260513000100). Only
-- service_role accesses this table via the outer RPC. X-FIX-AGENT-B landed
-- the policies + REVOKE/GRANT triple below to close GPT IMPORTANT
-- "Attempt-table missing RLS policies" — the table holds shop_id,
-- actor_email, oauth_client_id, reason_code, error_detail (verbose body
-- which may carry inline staleness-diff content of customer-facing
-- scheduler MD), and dry_run_confirm_token_hash. Without explicit
-- deny-all + table-level REVOKE, a future GRANT to anon/authenticated
-- would silently expose cross-shop operational history.
ALTER TABLE public.scheduler_admin_revert_attempts ENABLE ROW LEVEL SECURITY;

-- RESTRICTIVE default-deny policy. PostgreSQL applies RESTRICTIVE policies
-- as logical-AND with any future PERMISSIVE policies, so even if someone
-- later adds a misconfigured PERMISSIVE policy to anon/authenticated, this
-- one still forces the row test to false. service_role bypasses RLS
-- (Supabase platform behavior), so the outer RPC still functions.
--
-- X-FIX-#27 (2026-05-26) — closes GPT round-3 chunk 2 IMPORTANT "The
-- attempts-table deny policy is also not idempotent despite CREATE TABLE
-- IF NOT EXISTS". CREATE POLICY has no IF NOT EXISTS syntax; wrap in a
-- DO-block that catches duplicate_object (SQLSTATE 42710). Matches the
-- pattern used for ADD CONSTRAINT in Migration B.
DO $$
BEGIN
  CREATE POLICY scheduler_admin_revert_attempts_default_deny
    ON public.scheduler_admin_revert_attempts
    AS RESTRICTIVE
    FOR ALL
    TO PUBLIC, anon, authenticated
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  -- Policy already exists (e.g., from a prior partial-apply); no-op.
  NULL;
END $$;

-- Table-level grants: complement to the RLS policy. RLS denies row
-- visibility; table-level REVOKE denies even the right to issue the
-- statement. Both must agree.
REVOKE ALL ON TABLE public.scheduler_admin_revert_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduler_admin_revert_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduler_admin_revert_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_admin_revert_attempts_id_seq TO service_role;

COMMENT ON POLICY scheduler_admin_revert_attempts_default_deny
  ON public.scheduler_admin_revert_attempts IS
  'Defense-in-depth: this table is reached only via service_role through '
  'public.revert_md_upload_attempt. The RESTRICTIVE deny-all policy + '
  'table-level REVOKE prevent any future GRANT to anon/authenticated '
  'from accidentally exposing operational history (actor_email, '
  'oauth_client_id, error_detail with possibly-sensitive staleness-diff '
  'content, dry_run_confirm_token_hash). Future read-access path for a '
  '"recent revert attempts" admin UI panel is expected to remain '
  'service_role through orchestrator-mcp (same SERVICE_ROLE + '
  'X-Actor-Email contract as audit-log read), so this deny-all stays '
  'permanent.';

-- X-FIX-AGENT-B audit-log table verification. The existing
-- scheduler_admin_audit_log (migration 20260513000100) already has
-- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "deny_all"
-- … FOR ALL TO public USING (false)`. That existing policy is
-- PERMISSIVE-shaped (default for CREATE POLICY without AS RESTRICTIVE)
-- with USING(false) which already denies every row to every role. It
-- pre-dates the table-level REVOKE pattern. X-FIX-AGENT-B adds the
-- complementary table-level REVOKE + GRANT triple HERE (idempotent —
-- safe to re-run; no schema drift) to bring the existing audit-log
-- table to the same hardened posture as the new attempts table.
REVOKE ALL ON TABLE public.scheduler_admin_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduler_admin_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduler_admin_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_admin_audit_log_id_seq TO service_role;

-- X-FIX-#19 (2026-05-26) — closes GPT chunk 2 IMPORTANT "Audit-log RLS is
-- not actually brought to the same hardened posture as attempts". The
-- existing PERMISSIVE deny_all policy already returns false, but
-- PostgreSQL ORs together PERMISSIVE policies — a future migration that
-- adds a permissive allow policy (e.g., `CREATE POLICY "allow_self" ON
-- scheduler_admin_audit_log FOR SELECT TO authenticated USING (true)`)
-- would override the deny. A RESTRICTIVE policy is ANDed with all other
-- policies, so adding a RESTRICTIVE deny-all here prevents that escape
-- hatch. Combined with the table-level REVOKE above, this is the
-- same shape the scheduler_admin_revert_attempts table uses (see §4.1
-- attempts-table RESTRICTIVE deny-all policy).
--
-- X-FIX-#27 (2026-05-26) — defensive ENABLE RLS + idempotent CREATE
-- POLICY. Closes GPT round-3 chunk 2 IMPORTANTs "Migration A does not
-- re-enable RLS on the existing audit-log table" + "The audit-log
-- RESTRICTIVE policy is not idempotent". (a) the defensive ENABLE RLS
-- guards against environmental drift where a manual operator action
-- disabled RLS — without RLS enabled, the RESTRICTIVE policy is inert.
-- (b) the DO-block makes CREATE POLICY idempotent on manual retry. Both
-- additions are no-ops on a fresh deploy.
ALTER TABLE public.scheduler_admin_audit_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "scheduler_admin_audit_log_deny_all_restrictive"
    ON public.scheduler_admin_audit_log
    AS RESTRICTIVE
    FOR ALL
    TO public
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON POLICY "scheduler_admin_audit_log_deny_all_restrictive"
  ON public.scheduler_admin_audit_log IS
  'X-FIX-#19 (2026-05-26): RESTRICTIVE deny-all complements the pre-existing '
  'PERMISSIVE deny_all policy. Only service_role bypasses (per table-level '
  'GRANT). Prevents a future PERMISSIVE allow policy from accidentally '
  'opening this table to authenticated callers via the ORing of permissive '
  'policies. Matches the hardened posture of scheduler_admin_revert_attempts.';

COMMIT;
```

### 4.2 Backfill script — `scripts/backfill-audit-log-shop-id.ts` (Deno) — UPDATED v0.4 per A-I1 / CV2-B4 v0.3

Runs AFTER Migration A + code deploy. Idempotent.

```
PHASE 1 — Derivation (idempotent, no destructive writes):
  For each row WHERE shop_id IS NULL:
    derive shop_id by:
      (a) reading the snapshot's row data and looking up the matching
          per-shop table row (e.g., for a testing_services upload, look at
          snapshot.before's first row's shop_id)
      (b) if (a) yields nothing usable, leave shop_id NULL and log row id
          + table_name + occurred_at for operator review
    UPDATE audit row with derived shop_id (if any)
  End loop.
  PHASE 1 report:
    - N rows updated with derived shop_id
    - M rows left NULL (printed with ids + occurred_at + table_name)

PHASE 2 — Gated sentinel UPDATE (only runs after explicit Chris approval):
  IF M > 0 AND --apply-sentinel-now flag passed AND interactive prompt confirmed:
    UPDATE scheduler_admin_audit_log SET shop_id = -1 WHERE shop_id IS NULL;
    Log: "applied sentinel shop_id=-1 to {M} historical rows per operator
          confirmation. These rows will be non-revertable forever."
  ELSE IF M > 0:
    Log: "{M} NULL rows remain. Migration B will FAIL (RAISE EXCEPTION) until either:
          (1) all NULL rows are backfilled to real shop_ids manually
          (2) operator re-runs this script with --apply-sentinel-now
              (which gated-UPDATEs them to -1 as historical-non-revertable)."
    Exit non-zero.
```

The sentinel UPDATE deliberately lives HERE (in the gated backfill script)
rather than inside Migration B's SQL — per A-I1 (Gemini cross-verify 2026-05-26):
a script-side gated UPDATE fails loud if skipped; a migration-embedded
unconditional UPDATE would silently mask a failed/skipped backfill.

Rows with `shop_id = -1` (sentinel) are flagged non-revertable by the
list-audit-log eligibility computation (reason:
`shop_id_unknown_pre_migration_backfill`). They never match a real caller's
positive `p_shop_id` in `revert_md_upload_attempt`.

### 4.3 Migration B — NOT NULL transition (REVISED v0.4 per CV2-B4 — HARD CHECK; sentinel-UPDATE lives in backfill script)

`supabase/migrations/20260526100000_scheduler_admin_audit_log_hardening_part_b.sql`:

Only run AFTER:
1. Migration A applied
2. New code deployed (writes shop_id on every new row)
3. Backfill scripts run
4. Chris explicitly approves the NULL count (could be 0 or "accept residuals")

```sql
BEGIN;

-- Per CV2-B4 v0.3 + A-I1 amendment: the sentinel-UPDATE of NULL→-1 lives
-- in the backfill script (gated behind Chris's explicit accept-residuals
-- confirmation), NOT in this migration. If any NULL rows reach this
-- migration, something went wrong upstream — fail loud.
--
-- The backfill script (scripts/backfill-audit-log-shop-id.ts) is responsible
-- for: (1) deriving shop_id from snapshot data for every NULL row it can,
-- (2) if residuals remain, prompting Chris for explicit confirmation, and
-- (3) only then issuing `UPDATE ... SET shop_id = -1 WHERE shop_id IS NULL`.
-- By the time this migration runs, zero NULL rows must exist.
DO $$
DECLARE null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count
    FROM public.scheduler_admin_audit_log WHERE shop_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Migration B refusing to apply: % residual NULL shop_id rows remain. The backfill script (scripts/backfill-audit-log-shop-id.ts) must run to completion first — derive what it can, then apply the gated NULL→-1 sentinel UPDATE only with Chris''s explicit confirmation. NEVER let this migration silently coerce NULLs.',
      null_count;
  END IF;
  RAISE NOTICE 'Migration B proceeding with 0 NULL shop_id rows.';
END $$;

ALTER TABLE public.scheduler_admin_audit_log
  ALTER COLUMN shop_id SET NOT NULL;

-- Per A-B13: prevent future writes of unexpected negative sentinel values
-- (-2, -3, etc). Real shop IDs are positive Tekmetric IDs; -1 is the only
-- legal sentinel (set by the backfill script for accepted-residual rows).
-- X-FIX-#14 (2026-05-26): wrap in DO-block to make idempotent on manual
-- retry — closes GPT chunk 2 IMPORTANT #41 "scheduler_admin_audit_log_shop_id_valid_check
-- is not idempotent". The rest of this migration uses IF NOT EXISTS where
-- possible; ADD CONSTRAINT lacks that syntax, so the DO-block is the
-- canonical Postgres pattern.
DO $$
BEGIN
  ALTER TABLE public.scheduler_admin_audit_log
    ADD CONSTRAINT scheduler_admin_audit_log_shop_id_valid_check
      CHECK (shop_id > 0 OR shop_id = -1);
EXCEPTION WHEN duplicate_object THEN
  -- Constraint already exists (e.g., from a prior partial-apply); no-op.
  NULL;
END $$;

COMMIT;

-- X-FIX-#14 (2026-05-26) — Index recreation moved OUTSIDE the migration's
-- BEGIN/COMMIT block + use CREATE INDEX CONCURRENTLY for the audit-log
-- indexes. Closes GPT chunk 2 IMPORTANT #39 "Migration B creates replacement
-- indexes non-concurrently inside a transaction".
--
-- WHY: scheduler_admin_audit_log is the live append-only audit log for every
-- admin mutation. Non-concurrent index recreation inside BEGIN takes an
-- ACCESS EXCLUSIVE lock for the entire DROP+CREATE window, blocking ALL
-- readers/writers (every uploader, exporter, list_audit_log tool call). On
-- a production-sized table this can be measured in minutes.
--
-- Supabase CLI applies each migration in its own transaction, so we
-- COMMIT the schema change above first, then run CONCURRENTLY outside any
-- explicit BEGIN. Postgres only allows CREATE INDEX CONCURRENTLY (and the
-- companion DROP INDEX CONCURRENTLY) at the top level — they cannot run
-- inside an explicit transaction block.

-- Drop the existing partial indexes CONCURRENTLY (waits for in-flight
-- queries to complete before acquiring the SHARE UPDATE EXCLUSIVE lock).
DROP INDEX CONCURRENTLY IF EXISTS public.scheduler_admin_audit_log_shop_recent_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.scheduler_admin_audit_log_surface_recent_idx;

-- Recreate CONCURRENTLY as full indexes (excluding the -1 sentinel
-- shop_id to avoid bloating real-shop queries). The WHERE shop_id > 0
-- predicate is the same as before; the difference vs the v0.5 form is
-- the CONCURRENTLY clause, which lets readers/writers continue during
-- the index build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_shop_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, occurred_at DESC)
  WHERE shop_id > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, table_name, operation, occurred_at DESC)
  WHERE shop_id > 0;
```

The `-1` sentinel shop_id approach means:
- Existing NULL-shop_id rows get `shop_id = -1` (sentinel for "unknown — pre-migration backfill")
- `revert_md_upload` rejects any `p_shop_id < 0` automatically (real shop IDs are positive Tekmetric IDs)
- List-audit-log tool filters rows with `shop_id < 0` automatically (won't surface them in the schedulerconfig UI)
- The unique partial index on `reverts_upload_id` is unaffected (sentinel rows can't be reverted anyway)

### 4.4 RPCs — REWRITTEN v0.4 per CV2-B5-v0.3-AMEND + CV2-B6 (outer/inner two-RPC split)

v0.3's monolithic `revert_md_upload` RPC splits into TWO RPCs per Chris's 2026-05-26 calls:
- **OUTER `revert_md_upload_attempt`** — inserts an attempt row into the new `scheduler_admin_revert_attempts` table (per CV2-B6) IF caller-side preconditions hold (valid params + upload exists in caller's tenant per STEP 0d pre-validation; X-FIX-#12 — 2026-05-26), wraps INNER in a PL/pgSQL `BEGIN … EXCEPTION … END` subtransaction block, captures success / rejection / failure into the attempt row, NEVER re-RAISEs. Calls that fail STEP 0 guards (NULL/invalid params) RAISE per Postgres convention — the contract is that the caller's RPC client surfaces these as call errors, not attempt rows; the contract is "always an attempt row IF the call shape is valid." Nonexistent-upload calls return a clean `{outcome: 'rejected', reason_code: 'not_found', attempt_id: NULL}` without writing an attempt row (no upload to attempt against).
- **INNER `revert_md_upload_apply`** — the dispatch + eligibility + staleness + handler + audit-row-INSERT + parent-pointer-UPDATE logic. RAISEs on any failure. Has dry_run mode (per CV2-B5-v0.3-AMEND) that computes confirm_token + returns without mutating.

Plus 10 per-snapshot_kind plpgsql handler functions + 10 per-table apply RPCs (for uploads per CV2-I2).

**PL/pgSQL transaction-control note (X-FIX-AGENT-A — fixes X1 / CV4-B-SAVEPOINT).** PostgreSQL functions invoked as Supabase RPCs CANNOT issue literal `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` / `RELEASE SAVEPOINT` SQL statements. The equivalent in PL/pgSQL is a nested `BEGIN … EXCEPTION WHEN … END` block, which the runtime automatically wraps in an implicit subtransaction. When this plan uses the word "SAVEPOINT" in revert RPC prose (e.g. "wraps inner in SAVEPOINT"), the implementation is always the `BEGIN … EXCEPTION` block pattern shown in the SQL sketches — never a literal SAVEPOINT statement. Similarly, the inner RPC is a function invoked via `SELECT … FROM revert_md_upload_apply(...)`, NOT a procedure invoked via `CALL`.

**Canonical multi-tenant security setup block (X-FIX-AGENT-B — closes GPT BLOCKER "SECURITY DEFINER + caller-supplied p_shop_id" + GPT IMPORTANT "search_path hardening").** Every SECURITY DEFINER function in this feature — the outer RPC `revert_md_upload_attempt`, all 10 per-snapshot_kind revert handlers, and all 5 per-table apply RPCs (see §10 E5) — uses the IDENTICAL security shell shown below. Subsequent SQL sketches in this section omit the boilerplate and reference this block as "the canonical security setup" to keep the prose readable; implementation SQL MUST include all three pieces verbatim.

**ONE DOCUMENTED EXCEPTION** (X-FIX-#24 — 2026-05-26 — closes GPT round-3 chunk 2 BLOCKER "Canonical security block still says the inner RPC gets GRANT EXECUTE TO service_role"): the **INNER RPC `revert_md_upload_apply`** uses the same shell EXCEPT for the final `GRANT EXECUTE … TO service_role` line — that line is omitted per Fix #19 so service_role callers cannot bypass the outer's attempt-row audit trail by calling inner directly. The outer RPC's SECURITY DEFINER context calls inner as the function owner (postgres role), so the no-grant doesn't break the outer→inner chain. See the inner RPC sketch at the end of §4.4 for the explicit `-- NOTE: NO GRANT to service_role` comment and the future-maintainer warning. The 5 apply RPCs + 10 revert handlers + outer RPC ALL get the standard service_role GRANT (they're entry points or operate inside the outer's transaction).

```sql
CREATE OR REPLACE FUNCTION public.<fn_name>(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
-- GPT IMPORTANT "search_path hardening": pg_catalog FIRST + public second.
-- pg_catalog-first means Postgres resolves built-in functions BEFORE any
-- user-created object in public could shadow them (mitigates the classic
-- shadow-schema attack on SECURITY DEFINER fns). `SET search_path = public`
-- alone leaves the door open for a privilege-escalation chain via a
-- malicious user-defined function in public with the same name as a
-- pg_catalog built-in. Empty-search-path with full qualification (e.g.,
-- `SET search_path = ''`) would also be safe but force every reference to
-- carry a schema prefix throughout the function body — pg_catalog+public
-- is the same hardening with cheaper maintenance.
SET search_path = pg_catalog, extensions, public
AS $$ ... $$;

-- Caller-execution boundary. The RPC is callable ONLY by service_role.
-- Even though it's SECURITY DEFINER (runs as table-owner privileges),
-- without GRANT EXECUTE the caller cannot reach the function in the
-- first place. service_role is the only role that bypasses both
-- statement-level GRANTs and RLS — which is exactly the threat model
-- this function is built for (orchestrator-mcp calls via service_role
-- bearer per orchestrator-mcp/index.ts).
REVOKE EXECUTE ON FUNCTION public.<fn_name>(...) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.<fn_name>(...) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.<fn_name>(...) TO service_role;
```

**Why no `auth.uid()` step inside the RPC.** The 4th-round GPT BLOCKER pointed at the canonical risk: SECURITY DEFINER + caller-supplied `p_shop_id` exposed via PostgREST to `authenticated` lets a caller pass another shop's `p_shop_id`. The mitigation in many codebases is an in-function `auth.uid()` → `employees.shop_id` cross-check.

This codebase does NOT have that layer because it has no `employees` table and no `auth.uid()`-resolvable client path to these RPCs. The auth boundary is structurally different: the orchestrator-mcp edge function (see `supabase/functions/orchestrator-mcp/index.ts`) is the ONLY caller. It authenticates the request via two paths — (a) SERVICE_ROLE bearer + `X-Actor-Email` header for admin-app Server Action calls, (b) OAuth bearer for Claude Desktop — and both resolve a `userLabel` + `shopId` (admin-app side: from `requireEmployee()` in the Next.js layer; OAuth side: from the OAuth client's bound shop). Only after that authentication does the orchestrator-mcp call the SECURITY DEFINER RPCs using the project's `SUPABASE_SERVICE_ROLE_KEY`. There is no PostgREST direct-call path because anon/authenticated do not have EXECUTE on these functions (the REVOKE block above is the load-bearing rule).

For an inside-the-RPC defense-in-depth check to add value here, there would need to be an `auth.uid()`-resolvable session identity AND a DB table mapping that identity to a shop. Neither exists in this codebase as of 2026-05-26. If a future feature adds a per-employee session model with `auth.uid()` available, this section should be revisited to layer a defense-in-depth check that compares `auth.uid() → employees.shop_id` against `p_shop_id` and RAISEs `42501 insufficient_privilege` on mismatch. Until then, the REVOKE/GRANT triple IS the auth boundary, and the 4-layer defense described in §8.4 is what protects against the 4th-round findings without conjuring a check that has no input to consult.

**Migration files** (all in part-a / additive):

- `20260526000100_revert_md_upload_dispatch.sql` — both `revert_md_upload_attempt` (outer) AND `revert_md_upload_apply` (inner) per §8.1 below, PLUS the three helper functions:
  - `lock_targets_for_kind(TEXT, INTEGER, JSONB)` — per-snapshot_kind target-row lock acquisition; called from inner step 4 per X-FIX-AGENT-E (full spec in §8.3)
  - `compute_unified_diff(TEXT, TEXT, INTEGER)` — line-aligned diff generation for staleness rejections; called from inner step 6 slow-path (full spec in §8.3)
  - **`compute_current_canonical_for_kind(TEXT, INTEGER, JSONB)`** — per-snapshot_kind canonical-MD dispatch; called from inner step 5 (per X-FIX-2; full spec in §8.3). Dispatches to 10 per-kind backing functions: `canonical_state_testing_services_v2`, `canonical_state_routine_services_v2`, `canonical_state_subcategory_descriptions_v2`, `canonical_state_subcategory_service_map_v2`, `canonical_state_question_required_facts_v2`, `canonical_state_concern_questions_flat`, `canonical_state_concern_category_upload`, `canonical_state_concern_category_guideline`, `canonical_state_appointment_default_limits`, `canonical_state_closed_dates_future` (~30-80 LOC plpgsql each, ~500 LOC total). These 10 serializers MUST be byte-for-byte identical to their corresponding TS exporters per the parity contract — the apply RPCs in `20260526000500_apply_handlers_uploads.sql` call them too. Without these, every dry-run + apply + revert path fails at runtime.
- `20260526000200_revert_handlers_v2.sql` — `revert_testing_services_v2` + `revert_routine_services_v2`
- `20260526000300_revert_handlers_v2_subcategories.sql` — `revert_subcategory_descriptions_v2` + `revert_subcategory_service_map_v2` + `revert_question_required_facts_v2`
- `20260526000400_revert_handlers_legacy.sql` — `revert_concern_questions_flat` + `revert_concern_category_upload` + `revert_concern_category_guideline` + `revert_appointment_default_limits` + `revert_closed_dates_future`
- `20260526000500_apply_handlers_uploads.sql` — 5 apply RPCs (`apply_concern_questions_flat_upload`, `apply_concern_category_upload`, `apply_concern_category_guideline_upload`, `apply_appointment_default_limits_upload`, `apply_closed_dates_upload`) per CV2-I2 — X-FIX-#18 (2026-05-26) corrected count from "10" which was a v0.5 conflation with revert handlers

Each handler RPC follows the canonical multi-tenant security setup block above — `SECURITY DEFINER`, `SET search_path = pg_catalog, extensions, public` (X-FIX-#23 — 2026-05-26 — `extensions` added so unqualified `digest(...)` calls resolve to `extensions.digest(...)` on Supabase), REVOKE EXECUTE FROM PUBLIC + anon + authenticated, GRANT EXECUTE TO service_role (NOTE: inner RPC `revert_md_upload_apply` is the documented exception per Fix #19 — no service_role GRANT; outer's SECURITY DEFINER context calls inner). The CV2-NTH GPT search_path-hardening note + the X-FIX-AGENT-B REVOKE-from-anon-and-authenticated addition both apply to every handler.

**Sketch of the OUTER RPC `revert_md_upload_attempt`:**

```sql
CREATE OR REPLACE FUNCTION public.revert_md_upload_attempt(
  p_upload_id BIGINT,
  -- X-FIX-AGENT-A (fixes "INTEGER NOT NULL invalid syntax"): PL/pgSQL function
  -- parameters do not support NOT NULL. Caller-required validation is done in
  -- STEP 0a below with an explicit IS NULL / <=0 guard, layered with X-FIX-
  -- AGENT-B's STEP 0b multi-tenant assertion (see §8.4 for the 4-layer
  -- defense narrative).
  p_shop_id INTEGER,
  p_actor_email TEXT,  -- X-FIX-AGENT-F: parameter name kept as p_actor_email
                        -- (matches the column name; see §4.1 column COMMENT). The
                        -- TS wrapper today passes args.audit.display_name into this
                        -- slot — column COMMENT documents that display_name is
                        -- accepted. Rename to p_actor_label was considered + deferred
                        -- (blast-radius outweighed clarity gain).
  p_oauth_client_id TEXT,
  p_dry_run BOOLEAN DEFAULT FALSE,
  p_expected_confirm_token TEXT DEFAULT NULL,
  p_force_no_after_hash BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  revert_audit_log_id BIGINT,
  confirm_token TEXT,
  restored INTEGER,
  deactivated INTEGER,
  deleted INTEGER,
  dry_run BOOLEAN,
  -- X-FIX-AGENT-A (fixes X8 — TS wrapper can't reliably classify success/failure
  -- from error_message alone). Outer always returns these two columns; TS wrapper
  -- keys off `outcome` (success | dry_run_success | rejected | crashed) NOT
  -- `error_message`. `reason_code` is the machine-readable enum on rejections;
  -- NULL on success/dry_run_success. Column name `reason_code` matches the
  -- storage column Agent F will land in the schema redesign.
  outcome TEXT,
  reason_code TEXT,
  error_message TEXT,
  attempt_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_attempt_id BIGINT;
  v_inner RECORD;
  v_sqlstate TEXT;
  v_sqlerrm TEXT;
  v_constraint_name TEXT;
  v_outcome TEXT;
  v_reason TEXT;
  v_sanitized_error_message TEXT;     -- X-FIX-#10 (2026-05-26): redacted public-facing
                                      -- summary returned in the error_message column.
                                      -- Never includes v_sqlerrm body (which can carry
                                      -- inline staleness diff containing customer-facing
                                      -- scheduler MD content). DB-only error_detail
                                      -- carries the full v_sqlerrm for operator triage.
BEGIN
  -- STEP 0a — Parameter-presence guard (X-FIX-AGENT-A, fixes "INTEGER NOT NULL").
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'p_shop_id required and must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_upload_id IS NULL OR p_upload_id <= 0 THEN
    RAISE EXCEPTION 'p_upload_id required and must be positive' USING ERRCODE = '22023';
  END IF;

  -- STEP 0b — Multi-tenant auth assertion (X-FIX-AGENT-B, layered on top of
  -- Agent A's parameter-presence guard). The load-bearing auth check for
  -- this codebase is the REVOKE/GRANT triple in the canonical security
  -- setup block above (§4.4 top) — only service_role can EXECUTE this
  -- function. The orchestrator-mcp edge function authenticates the caller
  -- (SERVICE_ROLE bearer + X-Actor-Email per admin-app path, or OAuth
  -- bearer per Claude Desktop path) BEFORE calling here, and the shop_id
  -- it passes is server-side-derived from that authenticated identity
  -- (see `supabase/functions/orchestrator-mcp/index.ts` BRANCH A +
  -- BRANCH B). There is no `employees` table + no `auth.uid()`-resolvable
  -- identity available inside this RPC, so an in-function
  -- `auth.uid()`-vs-employees.shop_id comparison cannot be implemented
  -- today. If a future feature adds a per-employee session model with
  -- `auth.uid()` available, REPLACE this comment block with the
  -- defense-in-depth check shown in §4.4 top's "Why no `auth.uid()` step"
  -- prose.
  --
  -- Belt-and-suspenders sanity: `actor_email` is required for SERVICE_ROLE
  -- bearer auth (per orchestrator-mcp's BRANCH A — missing actor_email
  -- returns 401 there). We re-assert presence HERE so a direct
  -- service_role caller (e.g., a one-off psql session from an operator
  -- bypassing orchestrator-mcp) still cannot create attempt rows without
  -- an actor identity baked in.
  IF p_actor_email IS NULL OR length(trim(p_actor_email)) = 0 THEN
    RAISE EXCEPTION 'p_actor_email required (caller identity needed for audit trail)'
      USING ERRCODE = '22023';
  END IF;

  -- STEP 0c — Boolean parameter null-guard (X-FIX-3 — 2026-05-26 — fixes
  -- GPT chunk 2 BLOCKER "p_force_no_after_hash = NULL bypasses safety
  -- gate" + GPT chunk 2 IMPORTANT "boolean parameters not null-guarded").
  -- PL/pgSQL function parameters cannot use `NOT NULL`. In SQL three-
  -- valued logic, NULL booleans silently bypass safety predicates:
  --   * The naked form `IF p_dry_run THEN ... END IF` — NULL never enters
  --     the IF body (silently maps to apply-mode behavior); also the
  --     outer's attempt-row INSERT would violate `dry_run NOT NULL` if
  --     propagated. SQL code below uses COALESCE belt-and-suspenders too.
  --   * `IF v_x IS NULL AND NOT p_force_no_after_hash THEN ... END IF` —
  --     `NOT NULL` = NULL, `TRUE AND NULL` = NULL, IF body skipped =
  --     missing-canonical-state safety check silently disabled.
  -- Reject NULL booleans LOUDLY here so caller bugs surface immediately
  -- rather than silently degrading safety/correctness downstream.
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'p_dry_run required (TRUE for preview, FALSE for apply)'
      USING ERRCODE = '22023';
  END IF;
  IF p_force_no_after_hash IS NULL THEN
    RAISE EXCEPTION 'p_force_no_after_hash required (TRUE to override missing-canonical-state safety check, FALSE for normal flow)'
      USING ERRCODE = '22023';
  END IF;

  -- STEP 0d — Upload-existence pre-validation (X-FIX-#12 — 2026-05-26 — closes
  -- GPT chunk 2 IMPORTANT "Nonexistent upload IDs are not classified as
  -- not_found" + GPT chunk 2 IMPORTANT "Outer RPC does not actually always
  -- inserts an attempt row").
  --
  -- The attempt-row INSERT below has `upload_id BIGINT NOT NULL REFERENCES
  -- scheduler_admin_audit_log(id) ON DELETE RESTRICT` per §4.1 schema. Without
  -- this pre-check, a caller passing a nonexistent or wrong-shop p_upload_id
  -- would trigger Postgres FK violation 23503 on the INSERT itself — and
  -- because that error fires OUTSIDE the BEGIN…EXCEPTION subtransaction (the
  -- attempt-row INSERT runs in the OUTER frame, NOT inside the subtransaction
  -- where the inner RPC's `RAISE EXCEPTION 'revert_blocked: not_found'` would
  -- be caught), the caller would get a raw FK error string instead of a clean
  -- `{outcome: 'rejected', reason_code: 'not_found'}` response, and no attempt
  -- row would be recorded for audit.
  --
  -- Cheap upfront SELECT with `WHERE id = p_upload_id AND shop_id = p_shop_id`
  -- (matches the inner RPC's step-1 predicate, including the multi-tenant
  -- scope) converts a missing/wrong-shop upload into the canonical rejection
  -- shape. No attempt row is written for this path because (a) the FK would
  -- fail anyway if we tried, and (b) the call wasn't an "attempt against a
  -- valid upload" — it was a malformed call. The caller still sees the
  -- structured `not_found` rejection.
  --
  -- This narrows the "always inserts an attempt row" claim documented in §3b
  -- CV2-B6 to its honest scope: "always inserts an attempt row IF parameters
  -- are valid AND upload exists in caller's tenant." Operators querying the
  -- attempt table for failure trails will not see a row for nonexistent-upload
  -- calls; that's correct (no upload to attempt against).
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduler_admin_audit_log
      WHERE id = p_upload_id AND shop_id = p_shop_id
  ) THEN
    RETURN QUERY SELECT
      NULL::BIGINT, NULL::TEXT, 0, 0, 0, p_dry_run,
      'rejected'::TEXT,
      'not_found'::TEXT,
      ('audit log row not found for upload_id=' || p_upload_id::TEXT
        || ' in shop_id=' || p_shop_id::TEXT
        || ' — verify the upload_id was correctly retrieved from list_scheduler_admin_audit_log first')::TEXT,
      NULL::BIGINT;  -- attempt_id NULL because no attempt row was written
    RETURN;
  END IF;

  -- A. Pre-insert attempt row with outcome='pending'. This INSERT runs in the
  --    outer function's transaction frame, NOT inside the BEGIN…EXCEPTION
  --    subtransaction below — so it survives inner rollback. X-FIX-AGENT-F
  --    confirmed the INSERT column list — every column written here exists in
  --    the v0.4 redesigned schema; completed_at / revert_audit_log_id /
  --    dry_run_confirm_token_hash / reason_code / error_detail / metadata are
  --    intentionally OMITTED (set by the terminal UPDATE below). The
  --    completed_at-IS-NULL-iff-pending CHECK is satisfied because completed_at
  --    defaults to NULL on INSERT. The audit_log_scope_check and
  --    token_hash_scope_check are satisfied because both columns also default
  --    to NULL and outcome='pending' allows NULLs for both. STEP 0d above
  --    pre-validated that the upload exists in caller's tenant, so the FK
  --    constraint on upload_id won't fire here.
  INSERT INTO public.scheduler_admin_revert_attempts
    (upload_id, shop_id, actor_email, oauth_client_id, dry_run, outcome)
    VALUES (p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id, p_dry_run, 'pending')
    RETURNING id INTO v_attempt_id;

  -- B. Call inner inside a PL/pgSQL BEGIN…EXCEPTION subtransaction block
  --    (the PL/pgSQL equivalent of SAVEPOINT — see "PL/pgSQL transaction-control
  --    note" above). NOT a literal SAVEPOINT statement.
  BEGIN
    -- X-FIX-AGENT-A (fixes "CALL inner …" wrong invocation): inner is a
    -- function, invoked via SELECT … FROM, not a procedure invoked via CALL.
    SELECT * INTO v_inner FROM public.revert_md_upload_apply(
      p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id,
      p_dry_run, p_expected_confirm_token, p_force_no_after_hash
    );

    -- B1. Inner succeeded — classify dry_run vs apply.
    v_outcome := CASE WHEN p_dry_run THEN 'dry_run_success' ELSE 'success' END;
    v_reason := NULL;

    -- X-FIX-AGENT-F (closes X5 + the dry_run_confirm_token_hash CHECK
    -- constraint scope): on dry_run_success, store sha256(token) hex — the
    -- token itself is returned via RETURN QUERY below but NEVER persisted
    -- (replay-secret hazard). On success, set revert_audit_log_id; the
    -- audit-log-scope CHECK constraint enforces that this column is non-NULL
    -- iff outcome='success'. completed_at is set on every terminal UPDATE
    -- (CHECK invariant: completed_at IS NULL iff outcome='pending').
    UPDATE public.scheduler_admin_revert_attempts
      SET outcome = v_outcome,
          reason_code = v_reason,
          completed_at = now(),
          revert_audit_log_id = CASE WHEN p_dry_run THEN NULL ELSE v_inner.revert_audit_log_id END,
          dry_run_confirm_token_hash = CASE
            WHEN p_dry_run THEN encode(digest(v_inner.confirm_token, 'sha256'), 'hex')
            ELSE NULL
          END
      WHERE id = v_attempt_id;

    RETURN QUERY SELECT
      v_inner.revert_audit_log_id, v_inner.confirm_token,
      v_inner.restored, v_inner.deactivated, v_inner.deleted,
      v_inner.dry_run,
      v_outcome,               -- X-FIX-AGENT-A: outcome column populated on success
      NULL::TEXT,              -- reason_code NULL on success / dry_run_success
      NULL::TEXT,              -- error_message NULL on success
      v_attempt_id;
    RETURN;

  EXCEPTION WHEN OTHERS THEN
    -- B2. Inner RAISEd — the BEGIN…EXCEPTION subtransaction auto-rolled back
    --     (PL/pgSQL implicit subtransaction; equivalent to ROLLBACK TO
    --     SAVEPOINT in literal-SQL terms). Now classify the error and update
    --     the attempt row in the OUTER transaction frame.
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_sqlerrm = MESSAGE_TEXT,
      v_constraint_name = CONSTRAINT_NAME;

    -- Classification per CV2-B6 outcome table.
    -- X-FIX-AGENT-A (fixes X14 — 23505 was over-broad): narrow 23505 to the
    -- ONE partial unique index that protects "exactly one successful revert
    -- per upload" (`scheduler_admin_audit_log_one_successful_revert_idx`).
    -- All OTHER 23505s (cross-shop ID collisions, corrupted snapshots,
    -- unexpected unique constraints) classify as `crashed` with
    -- `reason_code='unique_violation'` so real data-integrity bugs surface
    -- instead of being silently labeled as "successor_revert_exists".
    IF v_sqlstate = '55P03' THEN
      v_outcome := 'rejected'; v_reason := 'another_revert_in_progress';
    ELSIF v_sqlstate = '23505' AND v_constraint_name = 'scheduler_admin_audit_log_one_successful_revert_idx' THEN
      v_outcome := 'rejected'; v_reason := 'successor_revert_exists';
    ELSIF v_sqlstate = '23505' THEN
      -- Unexpected unique-violation: surfaces as crashed so operators see it.
      v_outcome := 'crashed';
      v_reason := 'unique_violation';
    ELSIF v_sqlerrm LIKE 'revert_blocked:%' THEN
      v_outcome := 'rejected';
      -- X-FIX-#11 (2026-05-26) — Canonical reason_code enum extraction.
      -- v0.5 used `substring(v_sqlerrm from 17)` which captured the FULL
      -- message body (including row IDs, table names, shop IDs, snapshot-derived
      -- values from messages like `cannot restore concern_questions.id=42 because
      -- subcategory_id=17 ...`). That violated the §3b CV2-B6 promise that
      -- reason_code is Sentry-safe (short, machine-readable, no PII / no
      -- customer-data-derived strings).
      --
      -- New format contract for every `revert_blocked:` RAISE EXCEPTION:
      --   'revert_blocked: <enum_code>: <verbose detail>'
      -- where <enum_code> is from the canonical allow-list below. Verbose text
      -- after the second colon goes to error_detail (full v_sqlerrm body
      -- preserved there). An unrecognized enum_code maps to
      -- 'unclassified_revert_blocked' so Sentry alerts still fire but no PII
      -- escapes the redaction boundary.
      v_reason := substring(v_sqlerrm from 'revert_blocked:\s+([a-z0-9_]+)');
      IF v_reason IS NULL OR v_reason NOT IN (
        -- Eligibility rejections (inner RPC step 1-3):
        'not_found', 'not_upload_md', 'successor_revert_exists',
        'snapshot_pruned', 'no_snapshot', 'over_30_day_cutoff',
        'table_not_supported',
        -- System-bug class — handled below via outcome reclassification:
        'snapshot_kind_unknown',
        -- Dry-run / token rejections (inner RPC step 3/6):
        'dry_run_token_present', 'cannot_safely_verify',
        -- Multi-tenant defense rejections (handler Invariants 5/6 + FK):
        'cross_shop_hijack_attempt', 'fk_target_tenant_mismatch', 'fk_broken',
        -- Snapshot-shape rejections (handler invalid input):
        'snapshot_invalid'
      ) THEN
        v_reason := 'unclassified_revert_blocked';
      END IF;
      -- X-FIX-#11 + Gemini-chunk-2-#23: snapshot_kind_unknown is a SYSTEM BUG
      -- (missing handler for a snapshot_kind that passed step-2 eligibility),
      -- not a user-remediable rejection. Reclassify to crashed so the
      -- engineering on-call sees the alert instead of operators being told to
      -- "try later" for a problem that needs a code deploy.
      IF v_reason = 'snapshot_kind_unknown' THEN
        v_outcome := 'crashed';
      END IF;
    ELSIF v_sqlerrm LIKE 'confirm_token_mismatch:%' THEN
      v_outcome := 'rejected'; v_reason := 'confirm_token_mismatch';
    ELSIF v_sqlerrm LIKE 'staleness_check_failed:%' THEN
      v_outcome := 'rejected'; v_reason := 'current_state_drift';
    ELSE
      v_outcome := 'crashed'; v_reason := NULL;
    END IF;

    -- X-FIX-#10 (2026-05-26) — Sanitize the public-facing error_message.
    -- v_sqlerrm carries the FULL inner-RAISE body, which for `staleness_check_failed`
    -- includes the inline unified-diff text of customer-facing scheduler MD content
    -- (see compute_unified_diff usage in §8.1 / §8.2). The v0.5 plan promised
    -- redaction in two layers (Sentry omits + DB-only error_detail) but the
    -- RETURN-row error_message column was returning v_sqlerrm raw — defeating
    -- the redaction guarantee for any TS caller that logs / propagates
    -- error_message. The sanitized message gives the caller a short
    -- machine-friendly summary; full body is preserved in DB-only error_detail.
    v_sanitized_error_message := CASE v_outcome
      WHEN 'rejected' THEN
        CASE v_reason
          WHEN 'current_state_drift'      THEN 'current state drifted since dry-run; re-run dry_run to view the diff (attempt_id ' || v_attempt_id::TEXT || ')'
          WHEN 'confirm_token_mismatch'   THEN 'confirm_token did not match the latest dry-run for this upload; re-run dry_run for a fresh token (attempt_id ' || v_attempt_id::TEXT || ')'
          WHEN 'successor_revert_exists'  THEN 'upload has already been successfully reverted (attempt_id ' || v_attempt_id::TEXT || ')'
          WHEN 'another_revert_in_progress' THEN 'another revert is in progress for this upload; retry shortly (attempt_id ' || v_attempt_id::TEXT || ')'
          ELSE                                 'revert rejected: ' || COALESCE(v_reason, '<unknown>') || ' (attempt_id ' || v_attempt_id::TEXT || ')'
        END
      WHEN 'crashed' THEN
        'internal error occurred during revert; operators can pivot to attempt_id ' || v_attempt_id::TEXT || ' for the verbose SQLSTATE:SQLERRM body in scheduler_admin_revert_attempts.error_detail'
      ELSE
        'revert failed with unclassified outcome: ' || COALESCE(v_outcome, '<null>') || ' (attempt_id ' || v_attempt_id::TEXT || ')'
    END;

    -- X-FIX-AGENT-F: completed_at set on every terminal UPDATE (CHECK
    -- invariant). error_detail carries the verbose body (SQLSTATE:SQLERRM,
    -- including any inline staleness diff) — DB-only operator triage
    -- surface. reason_code (short Sentry-safe enum) is the only failure
    -- field that goes to Sentry — see §3b CV2-B6 Sentry alert rule for
    -- the redaction policy that closes GPT's diff-leak IMPORTANT finding.
    UPDATE public.scheduler_admin_revert_attempts
      SET outcome = v_outcome,
          reason_code = v_reason,
          -- X-FIX-#16 (2026-05-26) — closes Gemini chunk 2 IMPORTANT
          -- "Critical debug info missing from error_detail": include
          -- v_constraint_name (captured via GET STACKED DIAGNOSTICS above)
          -- so operators can identify WHICH constraint fired on 23xxx
          -- exceptions. v0.5 silently dropped it from error_detail; for
          -- unique-violation triage knowing the constraint name is the
          -- single most important debug fact. Empty/NULL placeholder
          -- keeps the format stable for the non-constraint paths.
          error_detail = v_sqlstate || ':' || COALESCE(v_constraint_name, '<none>') || ':' || v_sqlerrm,
          completed_at = now()
      WHERE id = v_attempt_id;

    RETURN QUERY SELECT
      NULL::BIGINT, NULL::TEXT, 0, 0, 0, p_dry_run,
      v_outcome,         -- X-FIX-AGENT-A: outcome column populated on failure
      v_reason,          -- reason_code (machine-readable enum) on rejection
      v_sanitized_error_message,  -- X-FIX-#10: redacted summary (no inline diff body)
      v_attempt_id;
    RETURN;
  END;
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top — applies to every
-- SECURITY DEFINER function in this feature).
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_attempt(BIGINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_attempt(BIGINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revert_md_upload_attempt(BIGINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role;
```

**Sketch of the INNER RPC `revert_md_upload_apply`** (called only by outer; never directly by TS):

```sql
CREATE OR REPLACE FUNCTION public.revert_md_upload_apply(
  p_upload_id BIGINT,
  -- X-FIX-AGENT-A (fixes "INTEGER NOT NULL invalid syntax"): see outer.
  p_shop_id INTEGER,
  p_actor_email TEXT,  -- X-FIX-AGENT-F: kept as p_actor_email — see outer RPC + §4.1
                        -- column COMMENT for the rename-deferred rationale.
  p_oauth_client_id TEXT,
  p_dry_run BOOLEAN,
  p_expected_confirm_token TEXT,
  p_force_no_after_hash BOOLEAN
)
RETURNS TABLE(
  revert_audit_log_id BIGINT,
  confirm_token TEXT,
  restored INTEGER,
  deactivated INTEGER,
  deleted INTEGER,
  dry_run BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_target RECORD;
  v_snapshot JSONB;
  v_kind TEXT;
  v_now TIMESTAMPTZ := now();
  v_revert_id BIGINT;
  v_stats RECORD;
  v_token_recomputed TEXT;
  v_current_canonical TEXT;
  v_current_head_hash TEXT;
  v_expected_canonical TEXT;
  v_snapshot_after_hash TEXT;
  v_lock_count INTEGER;
BEGIN
  -- STEP 0a — Parameter-presence guard (X-FIX-AGENT-A). Mirrors outer's check
  -- so direct misuse (bypassing outer) still fails fast.
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'p_shop_id required and must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_upload_id IS NULL OR p_upload_id <= 0 THEN
    RAISE EXCEPTION 'p_upload_id required and must be positive' USING ERRCODE = '22023';
  END IF;

  -- STEP 0b — Multi-tenant auth assertion (X-FIX-AGENT-B). Same rationale
  -- as outer STEP 0b: the load-bearing auth check is the canonical
  -- REVOKE/GRANT triple (only service_role can EXECUTE) + the
  -- orchestrator-mcp edge function's pre-RPC authentication. An
  -- in-function `auth.uid()`-vs-employees.shop_id check is not
  -- implementable in this codebase (no employees table + no
  -- auth.uid()-resolvable identity). Defense-in-depth `actor_email`
  -- presence re-asserted here so bypass-outer callers still fail fast.
  IF p_actor_email IS NULL OR length(trim(p_actor_email)) = 0 THEN
    RAISE EXCEPTION 'p_actor_email required (caller identity needed for audit trail)'
      USING ERRCODE = '22023';
  END IF;

  -- STEP 0c — Boolean parameter null-guard (X-FIX-3 — 2026-05-26 — fixes
  -- GPT chunk 2 BLOCKER "p_force_no_after_hash = NULL bypasses safety
  -- gate" + GPT chunk 2 IMPORTANT "boolean parameters not null-guarded").
  -- PL/pgSQL function parameters cannot use `NOT NULL`. In SQL three-
  -- valued logic, `NOT NULL` evaluates to NULL (not TRUE), and
  -- `TRUE AND NULL` is NULL — so an `IF v_x IS NULL AND NOT p_force_*`
  -- predicate silently skips the IF body when the caller passes NULL.
  -- Same risk for the naked form `IF p_dry_run THEN` (NULL never enters
  -- the IF body, which silently maps to apply-mode behavior). Reject NULL
  -- booleans LOUDLY here so caller bugs surface immediately. SQL code
  -- below uses COALESCE belt-and-suspenders too.
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'p_dry_run required (TRUE for preview, FALSE for apply)'
      USING ERRCODE = '22023';
  END IF;
  IF p_force_no_after_hash IS NULL THEN
    RAISE EXCEPTION 'p_force_no_after_hash required (TRUE to override missing-canonical-state safety check, FALSE for normal flow)'
      USING ERRCODE = '22023';
  END IF;

  -- 1. Lock parent audit row (NOWAIT → 55P03 on parallel revert)
  SELECT id, operation, pre_state_snapshot, snapshot_pruned_at,
         successor_revert_id, occurred_at, shop_id, table_name
    INTO v_target
    FROM public.scheduler_admin_audit_log
    WHERE id = p_upload_id AND shop_id = p_shop_id
    FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    -- NOTE: rows with shop_id = -1 (sentinel per CV2-B4) or NULL legacy rows
    -- intentionally return 'not_found' here — they should NEVER reach revert
    -- (real shop IDs are positive; sentinel rows surface as
    -- reason='shop_id_unknown_pre_migration_backfill' in list-audit-log only,
    -- never in revert_md_upload because p_shop_id never matches -1).
    RAISE EXCEPTION 'revert_blocked: not_found';
  END IF;

  -- 2. Eligibility checks (BEFORE any side effect per CV2-I5)
  -- X-FIX-AGENT-A (fixes X2 — every predicate was previously INVERTED, e.g.
  -- "operation = 'upload_md' → RAISE" would have rejected every eligible
  -- upload). Pattern: RAISE on the INVALID condition, not the valid one.
  IF v_target.operation <> 'upload_md' THEN
    -- Not an upload row → cannot revert.
    RAISE EXCEPTION 'revert_blocked: not_upload_md';
  END IF;
  IF v_target.successor_revert_id IS NOT NULL THEN
    -- Successor revert already exists → cannot revert again.
    RAISE EXCEPTION 'revert_blocked: successor_revert_exists';
  END IF;
  IF v_target.snapshot_pruned_at IS NOT NULL THEN
    -- Snapshot was pruned by the 30-day cron → unrevertable.
    RAISE EXCEPTION 'revert_blocked: snapshot_pruned';
  END IF;
  IF v_target.pre_state_snapshot IS NULL THEN
    -- No snapshot captured (pre-Pattern-S row or write-failure) → unrevertable.
    RAISE EXCEPTION 'revert_blocked: no_snapshot';
  END IF;
  IF v_target.occurred_at < v_now - INTERVAL '30 days' THEN
    -- Older than the 30-day cutoff window → unrevertable.
    -- X-FIX-#11 (2026-05-26): enum renamed from `30_day_cutoff` to
    -- `over_30_day_cutoff` — leading-digit enums are awkward for the
    -- substring regex and the §3b canonical enum list uses identifier-style
    -- (leading letter, no leading digit).
    RAISE EXCEPTION 'revert_blocked: over_30_day_cutoff';
  END IF;

  v_snapshot := v_target.pre_state_snapshot;

  -- Resolve snapshot_kind with fallback (CV-B3)
  v_kind := COALESCE(v_snapshot->>'snapshot_kind',
    CASE v_target.table_name
      WHEN 'testing_services' THEN 'testing_services_v2'
      WHEN 'routine_services' THEN 'routine_services_v2'
      ELSE NULL
    END);
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: table_not_supported';
  END IF;

  -- 3. Dry-run / apply two-step parameter-invariant guard (X-FIX-AGENT-E,
  --    fixes X-AMEND "Dry-run silently ignores p_expected_confirm_token").
  --    v0.3 silently ignored a non-NULL expected_confirm_token in dry_run
  --    mode — that could hide caller bugs where the client accidentally sent
  --    apply parameters to preview mode (or reused stale state). v0.4 rejects
  --    loudly so the operator sees the misuse immediately.
  IF p_dry_run AND p_expected_confirm_token IS NOT NULL THEN
    -- X-FIX-#11 (2026-05-26): canonical reason_code format
    -- `revert_blocked: <enum>: <verbose>` — enum is `dry_run_token_present`,
    -- verbose suffix preserved in error_detail. v0.5 used the full sentence as
    -- the enum body which captured verbose explanatory text into reason_code.
    RAISE EXCEPTION 'revert_blocked: dry_run_token_present: expected_confirm_token must be NULL in dry_run mode (the token is the OUTPUT of dry_run, not its input)';
  END IF;

  -- 4. NEW (X-FIX-AGENT-E, closes X13 lost-update window):
  --    Acquire target-row locks BEFORE computing current canonical. In v0.3
  --    the handler acquired its OWN locks (Step 7 below) — that left a TOCTOU
  --    window where a concurrent editor could mutate a target row AFTER the
  --    staleness snapshot was computed but BEFORE the handler took locks.
  --    Pulling lock acquisition up to step 4 means current-state computation
  --    (step 5) + staleness check (step 6) both run under the same locks the
  --    handler will later mutate under. Per-kind predicates live in the
  --    lock_targets_for_kind() helper (see §8.3 spec).
  v_lock_count := public.lock_targets_for_kind(v_kind, p_shop_id, v_snapshot);

  -- 5. Compute current head canonical NOW (under target-row locks per step 4).
  --    v_current_canonical is the live persisted post-apply state of the
  --    surface this snapshot covers. Token binding uses 4 explicit fields
  --    (X-FIX-AGENT-E, fixes X-AMEND "snapshot_hash := sha256(v_snapshot::text)
  --    brittle"): the prior design hashed v_snapshot::text whose rendering
  --    depends on PG version + pg_dump formatting + JSONB key ordering quirks.
  --    The four-field binding is composed of (a) the upload_id scalar, (b) the
  --    table_name scalar, (c) the current_head_hash (deliberately canonicalized
  --    via compute_current_canonical_for_kind), and (d) the snapshot's own
  --    after_hash (also deliberately canonicalized at apply time per §8.3
  --    lifecycle). All four are stable across JSONB rendering changes / PG
  --    version updates / pg_dump format changes.
  v_current_canonical := public.compute_current_canonical_for_kind(v_kind, p_shop_id, v_snapshot);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');
  v_snapshot_after_hash := v_snapshot->>'after_hash';
  v_token_recomputed := encode(digest(
    p_upload_id::text || '|' || v_target.table_name || '|' ||
    v_current_head_hash || '|' || COALESCE(v_snapshot_after_hash, '<<no-after-hash>>'),
    'sha256'), 'hex');

  -- 6. Staleness check (X-FIX-AGENT-E, closes X4 "Revert dry-run can BYPASS
  --    the post-upload staleness guard"). v0.3 ran the staleness check
  --    ONLY on the apply path (after step 8 below) — that meant a dry_run
  --    against drifted state happily returned a confirm token, which the
  --    operator could then submit on apply, reverting OVER the legitimate
  --    post-upload edits. v0.4 runs the same check on BOTH paths BEFORE
  --    the dry-run early-return so the operator never receives a token for
  --    drifted state.
  --
  --    Two-stage check:
  --      (a) Fast path — compare current_head_hash to snapshot.after_hash
  --          (the integrated after_hash fast-path that §8.3 documents).
  --      (b) Slow path — only on hash mismatch, generate the diagnostic
  --          diff for the operator. If the snapshot pre-dates after_hash
  --          (v0.3 or earlier), require explicit force_no_after_hash=true
  --          override (logged + flagged for follow-up review).
  v_expected_canonical := v_snapshot->>'expected_after_state_canonical';
  -- X-FIX-#22 (2026-05-26) — REVISED Fix #16 — closes GPT round-3 chunk 3
  -- BLOCKER + Gemini round-3 chunk 3 BLOCKER (both flagged the same bug):
  -- "force_no_after_hash bypasses verification even when expected_after_state_canonical
  -- exists". Fix #16's logic added the canonical-fallback IF but kept
  -- `NOT COALESCE(p_force_no_after_hash, FALSE)` as a gate, so force=true
  -- still bypassed the canonical check.
  --
  -- Correct intent of p_force_no_after_hash: bypass the "we CAN'T verify"
  -- gate (no hash + no canonical). It should NOT bypass actual verification
  -- when verification IS possible. Three branches, ordered:
  --   1. Hard fail when there is no way to verify (both hash AND canonical
  --      are absent), UNLESS force flag is set.
  --   2. Hash fast-path: if after_hash present, compare to current head hash.
  --   3. Canonical fallback: if after_hash absent but canonical present,
  --      compare canonical-to-canonical. Force flag does NOT bypass this —
  --      its purpose is only branch 1.

  -- Branch 1: hard fail (or accept force) when truly blind
  IF v_snapshot_after_hash IS NULL AND v_expected_canonical IS NULL THEN
    IF NOT COALESCE(p_force_no_after_hash, FALSE) THEN
      RAISE EXCEPTION 'revert_blocked: cannot_safely_verify: pre-2026-05-26 snapshot has no expected_after_state_canonical / after_hash; pass force_no_after_hash=true to override (logged + flagged for review)';
    END IF;
    -- else: force=true accepted; no canonical content to verify against;
    -- proceed (the diff body in audit_log will be informational only).
  END IF;

  -- Branch 2: hash fast-path
  IF v_snapshot_after_hash IS NOT NULL AND v_snapshot_after_hash <> v_current_head_hash THEN
    -- Hash mismatch confirms drift. Produce diff from the canonical content
    -- (if available — pre-CV2-B3 snapshots may carry only the hash without
    -- the canonical content; in that case the diff body is informational).
    RAISE EXCEPTION 'staleness_check_failed: current state differs from expected post-upload state; diff=%',
      public.compute_unified_diff(
        COALESCE(v_expected_canonical, '<<expected_after_state_canonical not stored in this pre-CV2-B3 snapshot>>'),
        v_current_canonical, 50);
  END IF;

  -- Branch 3: canonical fallback — ALWAYS fires when after_hash missing but
  -- canonical present. Force flag does NOT bypass this branch (X-FIX-#22).
  IF v_snapshot_after_hash IS NULL AND v_expected_canonical IS NOT NULL THEN
    IF v_expected_canonical <> v_current_canonical THEN
      RAISE EXCEPTION 'staleness_check_failed: current state differs from expected post-upload state (canonical-fallback, no after_hash on this snapshot); diff=%',
        public.compute_unified_diff(v_expected_canonical, v_current_canonical, 50);
    END IF;
  END IF;

  -- 7. Dry-run early return (X-FIX-AGENT-E, moved DOWN past step 6 — was
  --    step 4 in v0.3; the move is what closes X4). Dry-run returns the
  --    freshly-computed confirm_token ONLY after locks + staleness verify
  --    pass. The operator's apply call must then re-present this token in
  --    step 9 below. NO MUTATIONS. NO AUDIT ROW.
  IF COALESCE(p_dry_run, FALSE) THEN  -- X-FIX-3 COALESCE belt-and-suspenders
    RETURN QUERY SELECT NULL::BIGINT, v_token_recomputed, 0, 0, 0, TRUE;
    RETURN;
  END IF;

  -- 8. Apply mode: validate p_expected_confirm_token (was step 5 in v0.3 —
  --    renumbered after staleness ordering fix).
  IF p_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: dry_run=false requires expected_confirm_token (call with dry_run=true first to obtain it)';
  END IF;
  IF p_expected_confirm_token <> v_token_recomputed THEN
    RAISE EXCEPTION 'confirm_token_mismatch: head has changed since dry_run (or token was for a different upload); call with dry_run=true again to obtain a fresh token';
  END IF;

  -- 9. Dispatch to per-snapshot_kind handler (handler-internal target-row
  --    locking is now DEFENSE-IN-DEPTH — the load-bearing locks live in
  --    step 4 above. Handlers may still acquire FOR UPDATE on their own
  --    target rows as a belt-and-suspenders measure per Invariant 2).
  --
  -- X3 FALSE-POSITIVE NOTE (X-FIX-AGENT-A): the snapshot_kind ↔ handler-name
  -- asymmetry (e.g., 'concern_subcategories_descriptions_v2' →
  -- revert_subcategory_descriptions_v2) is INTENTIONAL and matches §8.2's
  -- table. snapshot_kind labels the data shape; handler name is a descriptive
  -- function identifier. Verified across all 10 entries during 4th-round
  -- cross-verify follow-up. Do NOT "fix" the names to match — they are
  -- correct and consistent.
  --
  -- HANDLER-SIGNATURE ABSORPTION NOTE (X-FIX-AGENT-A + X-FIX-AGENT-C): handlers
  -- are invoked via `SELECT * INTO v_stats FROM <handler>(...)`. The universal
  -- return shape is `TABLE(restored INT, deactivated INT, deleted INT, details JSONB)`
  -- per §8.2 Invariant 7. The `SELECT * INTO v_stats` form absorbs all 4 columns
  -- (the design choice that lets future handlers extend `details` without
  -- per-CASE edits here). The step-10 audit-row INSERT below forwards
  -- `v_stats.details` into `diff_summary` via JSONB concat
  -- (`jsonb_build_object(...) || COALESCE(v_stats.details, '{}'::JSONB)`) so
  -- handler-specific metadata (e.g., closed_dates'
  -- `skipped_past_dates_restore` + `skipped_past_dates_delete` arrays) reaches
  -- the operator-visible audit log.
  CASE v_kind
    WHEN 'testing_services_v2' THEN
      SELECT * INTO v_stats FROM revert_testing_services_v2(p_shop_id, v_snapshot);
    WHEN 'routine_services_v2' THEN
      SELECT * INTO v_stats FROM revert_routine_services_v2(p_shop_id, v_snapshot);
    WHEN 'concern_subcategories_descriptions_v2' THEN
      SELECT * INTO v_stats FROM revert_subcategory_descriptions_v2(p_shop_id, v_snapshot);
    WHEN 'concern_subcategories_map_v2' THEN
      SELECT * INTO v_stats FROM revert_subcategory_service_map_v2(p_shop_id, v_snapshot);
    WHEN 'concern_questions_required_facts_v2' THEN
      SELECT * INTO v_stats FROM revert_question_required_facts_v2(p_shop_id, v_snapshot);
    WHEN 'concern_questions_flat' THEN
      SELECT * INTO v_stats FROM revert_concern_questions_flat(p_shop_id, v_snapshot);
    WHEN 'concern_questions_per_category' THEN
      SELECT * INTO v_stats FROM revert_concern_category_upload(p_shop_id, v_snapshot);
    WHEN 'concern_category_guidelines' THEN
      SELECT * INTO v_stats FROM revert_concern_category_guideline(p_shop_id, v_snapshot);
    WHEN 'appointment_default_limits' THEN
      SELECT * INTO v_stats FROM revert_appointment_default_limits(p_shop_id, v_snapshot);
    WHEN 'closed_dates_future' THEN
      SELECT * INTO v_stats FROM revert_closed_dates_future(p_shop_id, v_snapshot);
    ELSE
      -- X-FIX-#11 (2026-05-26): renamed enum from `unhandled snapshot_kind`
      -- to canonical `snapshot_kind_unknown` per §3b enum allow-list.
      -- Gemini chunk 2 IMPORTANT: this is a SYSTEM BUG (missing handler for a
      -- snapshot_kind that passed earlier validation), not a user-remediable
      -- rejection. The outer classifier (§4.4 EXCEPTION block) special-cases
      -- this enum to map to `outcome='crashed'` so operational alerts fire
      -- and engineering escalates instead of the user being told to "try later".
      RAISE EXCEPTION 'revert_blocked: snapshot_kind_unknown: % is not in the per-kind handler dispatch — this is a system bug, not a user error', v_kind;
  END CASE;

  -- 10. INSERT revert audit row (only on non-dry_run apply success).
  -- X-FIX-AGENT-A (fixes "jsonb_build_object syntax bug"): jsonb_build_object
  -- requires alternating string-literal key + value pairs. The prior sketch
  -- listed bare identifiers (parsed as column refs) — would not compile.
  --
  -- X-FIX-AGENT-C: diff_summary is the STANDARD-KEYS object || the handler's
  -- own per-kind metadata (`v_stats.details`). Per §8.2 Invariant 7, every
  -- handler returns a 4-column shape ending in `details JSONB`. 9 of 10
  -- handlers return `'{}'::JSONB` (concat is a no-op). The closed_dates
  -- handler returns `{skipped_past_dates_restore: [...], skipped_past_dates_delete: [...]}`
  -- so operators see those arrays under audit_log.diff_summary alongside the
  -- standard restored/deactivated/deleted counts. COALESCE guards against a
  -- handler returning NULL details (which would NULL-out the whole diff_summary
  -- under JSONB concat semantics).
  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, shop_id, table_name, operation,
    user_label, oauth_client_id,
    reverts_upload_id, error_message,
    rows_added, rows_modified, rows_deactivated,
    diff_summary
  ) VALUES (
    v_now, p_shop_id, v_target.table_name, 'revert_upload',
    p_actor_email, p_oauth_client_id,
    p_upload_id, NULL,
    0, v_stats.restored, v_stats.deactivated,
    jsonb_build_object(
      'reverted_upload_id', p_upload_id,
      'snapshot_kind', v_kind,
      'restored', v_stats.restored,
      'deactivated', v_stats.deactivated,
      'deleted', v_stats.deleted,
      -- X-FIX-AGENT-E: predicate now keys off v_snapshot_after_hash (the
      -- field actually used by the step-6 staleness check). v0.3 used
      -- v_expected_canonical, but with the after_hash fast-path integrated
      -- in v0.4, the after_hash IS the fast-path signal — the canonical
      -- content may be present for diff diagnostics but is no longer the
      -- gate predicate. Forced=TRUE iff the operator passed force=true AND
      -- the snapshot had no after_hash to verify against.
      'forced_no_after_hash_check', (p_force_no_after_hash AND v_snapshot_after_hash IS NULL)
    ) || COALESCE(v_stats.details, '{}'::JSONB)
  ) RETURNING id INTO v_revert_id;

  -- 11. UPDATE parent.successor_revert_id (atomic with INSERT above)
  UPDATE public.scheduler_admin_audit_log
    SET successor_revert_id = v_revert_id
    WHERE id = p_upload_id;

  -- 12. Return
  RETURN QUERY SELECT v_revert_id, NULL::TEXT,
    v_stats.restored, v_stats.deactivated, v_stats.deleted, FALSE;
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top — applies to every
-- SECURITY DEFINER function in this feature).
-- X-FIX-#19 (2026-05-26) — closes GPT chunk 2 IMPORTANT "Inner RPC is
-- directly executable by service_role, bypassing the attempt audit trail".
-- v0.5 granted EXECUTE to service_role on this inner function — a direct
-- service-role call could perform dry-run/apply WITHOUT creating an
-- attempt row (the audit trail lives in the OUTER function's pre-insert,
-- not the inner). REVOKE service_role EXECUTE here so the only path to
-- inner is via the outer's SECURITY DEFINER context. The outer function
-- runs as the function owner (postgres role by default), so it can call
-- inner without service_role on inner.
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_apply(BIGINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_apply(BIGINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM anon, authenticated;
-- NOTE: NO GRANT to service_role on the INNER function. Only the function
-- owner (postgres) can EXECUTE. The OUTER `revert_md_upload_attempt` is
-- SECURITY DEFINER + runs as owner; it can call inner without any GRANT
-- on inner. Service_role callers MUST go through the outer RPC.
-- This enforces the attempt-row audit trail invariant: every revert
-- attempt has a corresponding `scheduler_admin_revert_attempts` row
-- because the outer's pre-insert is the only entry point.
-- COMMENT for future maintainers: do not add `GRANT EXECUTE TO service_role`
-- on this function without first updating §3b CV2-B6 documentation to
-- describe the audit-bypass surface. See X-FIX-#19 in §16 changelog.
```

**Exception model summary (X-FIX-AGENT-A — fixes C-I3 + X1 + X8 + X14):**
- Inner RAISEs on any failure (eligibility, token mismatch, staleness, handler error, FK violation, malformed snapshot, etc.). Inner NEVER returns structured eligibility-failure rows — every failure path is a RAISE so the outer's classifier sees a uniform signal.
- Outer's `BEGIN…EXCEPTION WHEN OTHERS THEN` block catches the RAISE → the PL/pgSQL implicit subtransaction auto-rolls back inner mutations + audit row INSERT + parent UPDATE (this is the implementation pattern equivalent to a SAVEPOINT rollback; NOT a literal `ROLLBACK TO SAVEPOINT` SQL statement) → outer reads SQLSTATE + SQLERRM + CONSTRAINT_NAME via GET STACKED DIAGNOSTICS → outer classifies into a `(outcome, reason_code)` tuple → outer UPDATEs the attempt row + RETURNs a structured result that always carries `outcome` (does NOT re-RAISE).
- 23505 narrowing (X-FIX-AGENT-A, X14): outer matches `CONSTRAINT_NAME = 'scheduler_admin_audit_log_one_successful_revert_idx'` for `reason_code='successor_revert_exists'`. Every other 23505 (cross-shop ID collision, corrupted snapshot, unexpected unique constraint, etc.) maps to `outcome='crashed'` with `reason_code='unique_violation'` so real data-integrity bugs surface rather than being silently mislabeled.
- TS wrapper classifies on `outcome` (machine-readable enum), NOT on `error_message`. Only `success` and `dry_run_success` count as ok; `rejected` and `crashed` surface as `{ ok: false, outcome, reason_code, error_message, attempt_id }`. PG-level exceptions only surface for outer-internal bugs (broken function signature, REVOKE-introduced 42501, etc.).

If any per-handler raises within inner (e.g., FK violation from a malformed snapshot), the inner's mutations roll back via the BEGIN…EXCEPTION subtransaction — no parent pointer set, no audit row written, no partial mutations. The attempt row INSERT is preserved (it ran in the outer's frame, BEFORE the subtransaction) → operator sees `outcome='crashed'` with `error_detail` carrying the SQLSTATE + message.

### 4.5 GIN expression index per CV2-I10

Added to Migration A (§4.1):

```sql
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_surfaces_gin_idx
  ON public.scheduler_admin_audit_log
  USING GIN ((diff_summary->'surfaces'));
```

### 4.6 Apply order — REVISED v0.3 per CV2-B2 expanded RPC set; X-FIX-#20 (2026-05-26) reverts Fix #14's incorrect reordering

**X-FIX-#20 (2026-05-26)** — REVERTS X-FIX-#14's reordering attempt. Closes GPT chunk 2 BLOCKER round-3 "Migration apply order cannot work with the current filenames" + revealed dependency analysis flaw in Fix #14.

**Why Fix #14 was wrong:** Fix #14 attempted to reorder so handler migrations apply BEFORE the dispatch migration (worried about dispatch referencing handlers that didn't exist yet). But this reordering was both:
1. **Cosmetic-only** — Supabase CLI applies migrations in lexicographic filename order; the §4.6 prose ordering doesn't change what `supabase db push` actually does. The original timestamps (00000 → 00100 → 00200 → 00300 → 00400 → 00500 → 100000) are what runs.
2. **Wrong about dependencies** — PL/pgSQL function bodies defer symbol resolution to **call time**, not **create time** (verified vs PostgreSQL docs: "Because there is no compile-time check that the referenced function exists, the function is found and verified at execution time."). The dispatch RPC can CREATE successfully even though handlers don't exist yet; the handler reference is only checked when the dispatch is actually CALLed. By that time, all migrations have applied. The partial-deploy footgun GPT cited in round 2 is bounded: if migration push stops between E1a and E1f, the dispatch RPC exists but cannot be called successfully — and orchestrator-mcp (E11a) hasn't been deployed yet, so no caller exists.

**Why the original timestamp order is correct (not just safe):**
- `apply_handlers_uploads.sql` at 00500 calls `canonical_state_<kind>` serializers to compute `expected_after_state_canonical` after writes. Those serializers are CREATEd in `revert_md_upload_dispatch.sql` at 00100. Apply RPCs at 00500 MUST be created AFTER the dispatch migration so their serializer references resolve cleanly when they're called.
- Handler migrations (00200/00300/00400) only need to exist before the dispatch RPC is CALLED — they don't depend on dispatch's creation order.
- Migration B (100000) requires backfill to complete first (E11d gate) so it goes last.

| Step | Action | Gate |
|---|---|---|
| E1a | Apply `20260526000000_scheduler_admin_audit_log_hardening_part_a.sql` (additive schema + GIN index per CV2-I10 + `scheduler_admin_revert_attempts` table + canonical security setup) | HUMAN GATE — `supabase db push` |
| E1b | Apply `20260526000100_revert_md_upload_dispatch.sql` (outer/inner RPCs + `lock_targets_for_kind` + `compute_current_canonical_for_kind` + 10 `canonical_state_<kind>` serializers + `compute_unified_diff`). PL/pgSQL defers function-body symbol resolution to call time, so the outer/inner RPCs CREATE successfully even though handlers in E1c-e don't exist yet. | Same migration push |
| E1c | Apply `20260526000200_revert_handlers_v2.sql` (testing/routine revert handlers) | Same migration push |
| E1d | Apply `20260526000300_revert_handlers_v2_subcategories.sql` (subcategory descriptions + map + question_required_facts revert handlers) | Same migration push |
| E1e | Apply `20260526000400_revert_handlers_legacy.sql` (per-category + guideline + appointment_default_limits + closed_dates + concern_questions_flat revert handlers) | Same migration push |
| E1f | Apply `20260526000500_apply_handlers_uploads.sql` (5 apply RPCs for the 5 legacy uploaders; depends on `canonical_state_<kind>` serializers created in E1b). | Same migration push |
| E1g | Verify via `mcp__supabase__list_migrations` + `mcp__supabase__get_advisors` | — |
| ... | E2-E10 code work | (per §10) |
| E11a | `supabase functions deploy orchestrator-mcp` (writes shop_id + uses new dispatch). NOTE: this is where the first ACTUAL CALLs to outer/inner RPCs originate; until this gate, the dispatch RPC's handler references are uncalled and the partial-deploy footgun is dormant. | HUMAN GATE |
| E11b | Run `scripts/backfill-snapshot-kind.ts` against test branch | HUMAN GATE |
| E11c | Run `scripts/backfill-audit-log-shop-id.ts` PHASE 1 (derive-only, no destructive writes) against test branch | HUMAN GATE |
| E11d | Chris reviews PHASE 1 report; if M>0 NULL rows: either backfill manually OR re-run script with `--apply-sentinel-now` to gated-UPDATE NULL→-1 (PHASE 2) | HUMAN GATE |
| E11e | Apply `20260526100000_scheduler_admin_audit_log_hardening_part_b.sql` (Migration B — RAISE EXCEPTION on residual NULL rows per CV2-B4 v0.4 — fails loud if backfill PHASE 2 was skipped; sentinel-UPDATE lives in backfill script, not migration). X-FIX-#17: file name spelled out per Gemini chunk 4 IMPORTANT. | HUMAN GATE |

---

## 5. Server-side refactors (5 legacy uploaders → Pattern S)

Per research-03 §4, each of the 5 legacy uploaders gets refactored to follow the canonical Pattern S anatomy (research-03 §1). The refactor shape per uploader:

```
BEFORE:                                   AFTER:
parse → validate → fetch                  parse → validate → fetch
       → write (immediate apply)                 → compute diff (no write)
       → audit-log                               → compute confirm_token (sort arrays per DC-1)
                                                 → if dry_run: return diff + token (no write)
                                                 → re-verify expected_confirm_token
                                                 → capture pre_state_snapshot (with snapshot_kind)
                                                 → write
                                                 → audit-log with pre_state_snapshot
```

### 5.1 `uploadConcernQuestionsMd` (flat concern_questions; snapshot_kind=`concern_questions_flat` — CORRECTED v0.3 per CV2-B1)
- Snapshot key shape: `"<category>::<question_text>"` (composite; matches existing in-code logic)
- Snapshot row shape: `{kind:"q", id, category, question_text, options, display_order, active}`
- Apply path moves into `apply_concern_questions_flat_upload(p_shop_id, p_snapshot, p_diff, p_audit)` SECURITY DEFINER plpgsql RPC per CV2-I2 v0.3. The RPC runs the per-row INSERT/UPDATE loop (replacing the legacy `scheduler-admin.ts:1003-1056` TS loop), takes row-level locks on every row in `p_snapshot.before`, re-verifies the current-state hash against `p_audit.expected_current_hash`, writes the audit row with `pre_state_snapshot` + `expected_after_state_canonical` (computed AFTER writes by re-reading the post-mutation rows for `p_shop_id` and serializing canonically), and returns `audit_log_id` — all in one transaction.

### 5.2 `uploadConcernCategoryMd` (concern_subcategories + concern_questions; snapshot_kind=`concern_questions_per_category`)
- Significant refactor: today's apply is INTERLEAVED with the diff. Split into a clean diff phase, then apply.
- Apply runs inside `apply_concern_category_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)` SECURITY DEFINER plpgsql RPC per CV2-I2 v0.3 + CV-I5 (X-FIX-#18 — 2026-05-26 — name + contract documented here to match §10 E5e; v0.5 omitted the RPC name + SECURITY DEFINER label from this section). The RPC takes row-level locks on every `(p_shop_id, p_category_slug, id)` row referenced in both `concern_subcategories` AND `concern_questions` slices of the snapshot, re-verifies current-state hash against `p_audit.expected_current_hash`, performs the 2-table apply (UPSERT touched subcategories + UPSERT touched questions + soft-delete omitted-from-MD active rows), writes the audit row with `pre_state_snapshot` + `expected_after_state_canonical` (computed AFTER the writes by re-reading the persisted rows for `(p_shop_id, p_category_slug)`), and returns `audit_log_id` — all in one transaction. `p_shop_id` + `p_category_slug` are explicit params (validated against snapshot.category); RPC `RAISE EXCEPTION`s on mismatch.
- Snapshot scoped to ONE `category_slug`; covers BOTH tables (tagged-union snapshot per research-04 §2 / DC-4)
- DEFAULT_OPTIONS warning surfaced in dry_run report per DC-2

### 5.3 `uploadConcernCategoryGuidelineMd` (single-row composite PK; snapshot_kind=`concern_category_guidelines`)
- Trivial refactor: one fetch, one decide-insert-vs-update, one write — but still wrapped in an apply RPC for atomicity with the audit row (per CV2-I2 v0.3 — "wrap for consistency" applies to single-row too).
- Apply runs inside `apply_concern_category_guideline_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)` SECURITY DEFINER plpgsql RPC. The RPC takes a row-level lock on the existing `(p_shop_id, p_category_slug)` row (if any), re-verifies current-state hash against `p_audit.expected_current_hash`, performs the single INSERT or UPDATE, writes the audit row with `pre_state_snapshot` + `expected_after_state_canonical` (computed AFTER the write by re-reading the persisted row), and returns `audit_log_id` — all in one transaction. `p_shop_id` and `p_category_slug` are explicit params; the snapshot's category field is validated against `p_category_slug` and the RPC `RAISE EXCEPTION`s on mismatch.
- Snapshot: `{before: {<category>: existing|null}, added_keys: existing ? [] : [category]}`
- Revert handles BOTH update-back AND hard-delete (when original was an INSERT)

### 5.4 `uploadAppointmentDefaultLimitsMd` (7-row complete-replace; snapshot_kind=`appointment_default_limits`)
- Easy refactor: function already computes `adds[] + mods[]` before apply
- Keep current semantic: omitting a `day_of_week` from MD = leave the row alone (no soft-delete on omission)
- Apply runs inside `apply_appointment_default_limits_upload(p_shop_id, p_snapshot, p_diff, p_audit)` SECURITY DEFINER plpgsql RPC per CV2-I2 v0.3. The RPC takes row-level locks on every existing `(p_shop_id, day_of_week)` row referenced by the diff, re-verifies current-state hash against `p_audit.expected_current_hash`, performs the 7-row UPSERT (only days present in the MD), writes the audit row with `pre_state_snapshot` + `expected_after_state_canonical` (computed AFTER the writes by re-reading the persisted 7 rows for `p_shop_id`), and returns `audit_log_id` — all in one transaction.
- Snapshot: `{before: {<day_of_week>: row}, added_keys: adds}`

### 5.5 `uploadClosedDatesMd` (future-only add/delete; snapshot_kind=`closed_dates_future`) — REWRITTEN v0.3 per CV2-I1 + A-B2/A-B9/A-B11
- Apply phase runs inside `apply_closed_dates_upload(p_shop_id, p_snapshot, p_diff, p_audit)` SECURITY DEFINER plpgsql RPC per DC-3 v0.2 + CV2-I2 v0.3 (X-FIX-#18 — 2026-05-26 — explicit SECURITY DEFINER + canonical REVOKE/GRANT triple in the RPC migration; matches §4.4 canonical setup). UPSERT future rows + DELETE omitted future rows + write audit row — all in one transaction. Mid-apply failure rolls back atomically.
- **Per-date advisory locks (NOT just `FOR UPDATE`).** The v0.2 wording "the apply RPC's `SELECT … FOR UPDATE` on affected closed_dates rows serializes against concurrent mutations" is INSUFFICIENT — `FOR UPDATE` only locks existing rows, so phantom inserts on a date NOT yet present in `closed_dates` are not blocked. Instead, the RPC takes a per-`(shop_id, closed_date)` transaction-scoped advisory lock — **`PERFORM pg_advisory_xact_lock(p_shop_id::INT, hashtext(closed_date::TEXT))`** — for EVERY date appearing in `p_diff.added`, `p_diff.modified`, AND `p_diff.deactivated`. X-FIX-#24 (2026-05-26): the 2-arg 64-bit-key form is the canonical lock per X-FIX-#16; v0.5's single-arg `hashtext('closed_date:' || …)` form was a 32-bit key vulnerable to cross-pair collision — removed entirely from this bullet (closes Gemini + GPT round-3 chunk 4 BLOCKER "closed_dates apply path advisory lock 1-arg vs 2-arg contradiction"). Locks are acquired in sorted-date order to prevent deadlocks against another `apply_closed_dates_upload` racing on overlapping dates. This serializes the apply against ALL concurrent mutation paths on the same `(shop_id, date)` keys, including phantom inserts.
- **Concurrent-mutation-path inventory (X-FIX-#8 — 2026-05-26).** The v0.5 wording cited `block_appointment_capacity` as the at-risk concurrent path, but inventory verified 2026-05-26 (`Grep INSERT INTO closed_dates|UPDATE closed_dates|DELETE FROM closed_dates|.from("closed_dates")` across `supabase/`) shows `block_appointment_capacity` writes to `appointment_blocks` (NOT `closed_dates`) — that function never touched `closed_dates` and was a v0.5 misidentification. The ACTUAL `closed_dates` mutation paths in the live codebase are: (a) `scheduler-admin.ts:1561` `.upsert(…, { onConflict: 'shop_id,closed_date' })` and `scheduler-admin.ts:1567` `.delete().eq('shop_id', …)` — both inside `uploadClosedDatesMd`, which IS the function being refactored by THIS feature to move both calls inside `apply_closed_dates_upload` (which takes the advisory locks); (b) the revert handler `revert_closed_dates_future` — which calls `lock_targets_for_kind('closed_dates_future', …)` per §8.3 lines 2877-2891 → it takes the SAME per-date advisory locks before mutating. After Phase 1 lands, apply + revert are the ONLY paths and both take the same locks → fully two-sided serialization, no phantom inserts possible from current code.
- **Deferred follow-up:** `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` carries a forward-looking guard: **any FUTURE code path that mutates `closed_dates` (admin tools, cron jobs, edge functions, server actions) MUST adopt the `pg_advisory_xact_lock(shop_id::INT, hashtext(closed_date::TEXT))` (X-FIX-#16 — 2026-05-26 — 2-arg 64-bit-key form replaces v0.5's single-arg `hashtext('closed_date:' || …)` which was a 32-bit key vulnerable to cross-pair collision) pattern before touching a `(shop_id, date)` row**, otherwise the serialization becomes one-sided and phantom inserts re-open the X14 window. The advisory-lock convention is documented as project-canonical for this table.
- **Token re-verify happens INSIDE the RPC, under the held advisory locks.** After locks are acquired, the RPC re-fetches the current `closed_dates` rows for the union of all locked dates within `p_shop_id`, recomputes the canonical current-state hash, and compares it to `p_audit.expected_current_hash`. On mismatch: `RAISE EXCEPTION 'current_state_drift: closed_dates_future'` with the diverging date keys. Transaction rolls back; locks release; no mutations or audit row applied.
- **Audit row + `expected_after_state_canonical` written in the same transaction.** After UPSERT/DELETE succeed, the RPC re-reads the post-mutation `closed_dates` rows for `p_shop_id` where `closed_date >= p_snapshot.original_today`, serializes them via the canonical-serializer plpgsql helper, and writes that exact serialized value into the audit row's `expected_after_state_canonical` field. `after_hash = encode(digest(expected_after_state_canonical, 'sha256'), 'hex')` (per X-FIX-1: `sha256(text)` is NOT a Postgres built-in; pgcrypto's `digest(...)` form is canonical). Both computed inside the RPC after writes — never pre-computed in TS.
- Snapshot: `{snapshot_kind: "closed_dates_future", before: {<closed_date>: row}, added_keys: [<closed_dates>], original_today: 'YYYY-MM-DD'}` per CV2-B3. NOTE: `expected_after_state_canonical` and `after_hash` are NO LONGER part of the snapshot the TS uploader passes — they are RPC-internal outputs written to the audit row directly.
- `original_today` (computed in shop TZ per CV-I8) preserves the "past closures are immutable history" invariant — revert won't resurrect dates that have since drifted into the past.

### 5.6 Tool-registry edits (5 entries in `scheduler-tools.ts`)
Per research-03 §5, each of the 5 tool blocks gets:
- Description rewritten to call out the two-step flow (mirrors V2's wording verbatim)
- `inputSchema` extended with `dry_run: z.boolean().optional().default(true)` + `expected_confirm_token: z.string().optional()`
- `execute` body passes the new fields through

### 5.7 Shared helper: `computeConfirmToken(mdHash, diffSummary)`
Move to `scheduler-admin-md.ts` (DC-1 sort happens inside it). Reuse the existing-but-unused `computeConfirmToken` declaration at `scheduler-admin.ts:69-74`.

### 5.8 Shared helper: `logAuditEntry()` per DC-5
Consolidate the two `_logAudit`/`logAdminAudit` helpers into one in `scheduler-admin-md.ts`. Both call sites (`scheduler-admin.ts:108-151`, `scheduler-admin-catalog.ts:641-684`) become re-exports. Verify the migration's CHECK fix from §4 by running one revert through the consolidated helper post-deploy.

---

## 6. Missing exporters (2 new functions)

Per research-02 §5 + §6, two new exporter functions in `scheduler-admin.ts`:

### 6.1 `exportConcernCategoryGuidelineMd({ category_slug })`
- Reads `concern_category_guidelines` filtered by `(shop_id, category)`
- Emits MD matching `parseConcernCategoryGuidelineMd` round-trip contract
- Returns `{ md_content, row_count }` (row_count = 0 means no row yet — UI seeds new)
- Tool registry: `export_concern_category_guideline_md` in `scheduler-tools.ts`

### 6.2 `exportConcernCategoryMd({ category_slug })`
- Reads BOTH `concern_subcategories` AND `concern_questions` filtered by `(shop_id, category, active=true)`
- Resolves the H1 display label from `concern_category_guidelines` (fall-back: title-cased slug)
- Emits hierarchical MD matching `parseConcernCategoryMd` round-trip contract (`-- {sub} Checklist --` sections + numbered questions + `[multi]` prefix + indented options)
- Per research-02 open Q5, uses index position (NOT DB `display_order`) for question numbering — stable round-trip
- Tool registry: `export_concern_category_md` in `scheduler-tools.ts`

Refactor for testability: extract pure `serializeConcernCategoryMd(subs, questions, label)` + `serializeConcernCategoryGuidelineMd(state, shopId, slug)` helpers so the pure serializer can be unit-tested without a SupabaseClient (research-02 §8).

---

## 7. New MCP tool — `list_scheduler_admin_audit_log`

Per research-01 §3 + §4, one new admin-block tool in `scheduler-tools.ts`:

### 7.1 Input schema
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
  only_revertable: z.boolean().optional(),            // default false
}),
```

### 7.2 Surface → table_name mapping — UPDATED v0.5+IMPORTANTs (X-FIX-#15)

Per research-01 §3, three logical surfaces share `table_name='concern_subcategories'` and two share `table_name='concern_questions'`. v0.2 disambiguates per CV-I9 via the `diff_summary.surfaces[]` JSONB array. X-FIX-#15 (2026-05-26 — closes GPT chunk 4 IMPORTANT "Audit-log surface filter overmatches shared physical tables") narrows the filter from the v0.5 over-broad form:

```sql
-- WRONG (v0.5 — would return unrelated modern rows whose surfaces[] doesn't
--               contain the requested surface):
WHERE table_name = ? OR diff_summary->'surfaces' ? ?
```

to the conditional fallback that only matches `table_name` for LEGACY rows without `surfaces[]` (X-FIX-#26 — 2026-05-26 — closes GPT round-3 chunk 4 IMPORTANTs "Audit-log surface-filter placeholder contract is wrong for legacy fallback" + "Surface-filter fallback likely mishandles diff_summary IS NULL"):

```sql
-- RIGHT (v0.5+IMPORTANTs+round3):
WHERE
  -- Modern rows: prefer surfaces[] when present (post-v0.5 every new
  -- audit row carries surfaces[], so this is the primary path).
  -- COALESCE for NULL diff_summary safety: `? operator on NULL returns
  -- NULL` (SQL three-valued logic), and `NULL AND …` is NULL → false in
  -- WHERE context, so this branch fails-safe for NULL-diff_summary rows.
  (COALESCE(diff_summary ? 'surfaces', FALSE) AND diff_summary->'surfaces' ? ?)
  OR
  -- Legacy fallback: rows without surfaces[] (pre-v0.5) OR with NULL
  -- diff_summary match by table_name only. This branch shrinks over time
  -- as legacy rows age out past the 30-day cutoff.
  (NOT COALESCE(diff_summary ? 'surfaces', FALSE) AND table_name = ?)
```

**Wrapper contract** — the two `?` placeholders take DIFFERENT values:
- First `?` (modern branch): the requested SURFACE value verbatim (e.g., `'question_required_facts'`).
- Second `?` (legacy branch): the MAPPED PHYSICAL TABLE NAME for that surface (e.g., `'concern_questions'`).

The mapping lives in the TS wrapper per research-01 §3:
```ts
const SURFACE_TO_TABLE: Record<SurfaceFilter, string> = {
  routine_services: 'routine_services',
  testing_services: 'testing_services',
  subcategory_descriptions: 'concern_subcategories',
  subcategory_service_map: 'concern_subcategories',
  question_required_facts: 'concern_questions',
  concern_questions: 'concern_questions',
  concern_subcategories: 'concern_subcategories',
  concern_category_guidelines: 'concern_category_guidelines',
  appointment_default_limits: 'appointment_default_limits',
  closed_dates: 'closed_dates',
};
const params = [surfaceFilter, SURFACE_TO_TABLE[surfaceFilter]];
```

Example: `surface_filter='question_required_facts'` — params = `['question_required_facts', 'concern_questions']`. Only matches rows whose `surfaces[]` contains `'question_required_facts'` OR (no `surfaces[]` AND `table_name='concern_questions'`); does NOT match `concern_questions_flat` uploads whose `surfaces[]` is `['concern_questions']` without `question_required_facts`. v0.5+IMPORTANTs documentation said the placeholder takes "the same surface value" which was wrong for the legacy fallback branch.

Documented in the tool's description string + admin UI tooltip.

### 7.3 Output shape — UPDATED v0.5+IMPORTANTs (X-FIX-#15)
```ts
interface AuditLogRow {
  id: number;
  occurred_at: string;        // X-FIX-#15: was `uploaded_at` — DB column is
                              // actually `occurred_at` per the
                              // scheduler_admin_audit_log schema. v0.5
                              // had `uploaded_at` in this output shape
                              // but §7.6 + the eligibility check used
                              // `occurred_at`; closes GPT chunk 4 IMPORTANT
                              // "Cutoff logic uses an undefined/different
                              // timestamp column".
  actor_email: string | null;
  oauth_client_id: string | null;
  surface_table: string;
  operation: "upload_md" | "manual_change" | "export_md" | "revert_upload";
  rows_added: number; rows_modified: number; rows_deactivated: number;
  md_content_hash: string | null;
  error_message: string | null;
  has_snapshot: boolean;
  snapshot_pruned_at: string | null;
  revert_eligibility: {
    eligible: boolean;
    // X-FIX-#26 (2026-05-26) — RELATIONSHIP between this `reasons` union
    // and the §3b "Canonical reason_code enum" table (closes Gemini round-3
    // chunk 1 IMPORTANT + GPT round-3 chunk 1 IMPORTANT "Canonical reason_code
    // table conflicts with the list-audit eligibility reasons union"):
    //
    // The `reasons` union below is a STRICT SUBSET of the §3b canonical
    // reason_code enum. Specifically, it contains ONLY the reasons that:
    //   1. Can be computed CHEAPLY (no per-kind canonical state read), AND
    //   2. Are statically discernible from the audit row's own columns +
    //      one O(1) successor-revert lookup (see §7.4)
    //
    // Reasons from §3b that are NOT in this union:
    //   - `current_state_drift` — requires per-kind canonical compute; only
    //     determinable at revert-attempt time (surfaces via
    //     revert_md_upload_attempt → reason_code='current_state_drift')
    //   - `confirm_token_mismatch` — only meaningful within a dry_run/apply
    //     session, not a property of the audit row
    //   - `cross_shop_hijack_attempt`, `fk_target_tenant_mismatch`,
    //     `fk_broken`, `cannot_safely_verify`, `dry_run_token_present`,
    //     `snapshot_invalid`, `unique_violation`, `another_revert_in_progress`,
    //     `unclassified_revert_blocked` — all attempt-time conditions, not
    //     statically discernible from the audit row
    //
    // ALL values below are spelled identically to their §3b enum counterparts
    // (over_30_day_cutoff, NOT 30_day_cutoff per X-FIX-#11 leading-digit fix).
    // The list-tool's eligibility filter is a HINT for the UI ("looks
    // eligible based on cheap checks"); the authoritative answer comes from
    // calling revert_md_upload_attempt itself (which runs the full attempt
    // path and surfaces the actual rejection reason).
    reasons?: Array<
      // X-FIX-#15 (2026-05-26): list-tool eligibility reasons are a SUBSET of
      // the §3b canonical reason_code enum — only reasons computable from a
      // CHEAP query (no per-kind canonical state read; see §7.4 below) appear
      // here. The reasons that CAN'T be computed cheaply (current_state_drift,
      // confirm_token_mismatch) are NOT in this list; they only surface as
      // revert-attempt outcomes via revert_md_upload_attempt, not as list-tool
      // eligibility. Aligned with §3b canonical enum naming (over_30_day_cutoff,
      // not 30_day_cutoff).
      "not_upload_md"
      | "snapshot_pruned"
      | "no_snapshot"
      | "table_not_supported"
      | "upload_failed"               // upload row's error_message IS NOT NULL
                                      // (the audit log of the original upload
                                      // recorded a partial-write failure) — NOT
                                      // related to the v0.5-removed `'failed'`
                                      // revert-attempt outcome (which was about
                                      // the revert RPC, not the original upload).
                                      // Closes Gemini chunk 4 IMPORTANT
                                      // "Contradiction on upload_failed".
      | "successor_revert_exists"
      | "over_30_day_cutoff"          // X-FIX-#11+#15: was `30_day_cutoff`
      | "shop_id_unknown_pre_migration_backfill"
      | "after_hash_check_unavailable"
    >;
    superseded_by_audit_log_id?: number;
  };
}
interface ListResult {
  ok: true;
  filters: {...request echoed...};
  count: number;
  rows: AuditLogRow[];
  truncated: boolean;
  message: string;
}
```

X-FIX-#15 dropped `"current_state_drift"` from this reasons union. GPT chunk 4 flagged that v0.5's list claimed drift-aware eligibility but §7.4's described query couldn't compute it without per-kind canonical-state reads. Cleaner contract: list-tool reasons cover what's CHEAP to determine; drift is determined only at revert-attempt time (and surfaces as `revert_md_upload_attempt.reason_code='current_state_drift'`, see §3b enum). UI can display a hint like "Eligibility shown is pre-flight; current state may have drifted; dry_run preview will surface drift before apply."

Final reasons union: 9 values (down from 10). §12 testing approach updated to match.

### 7.4 Eligibility computation — UPDATED v0.5+IMPORTANTs (X-FIX-#15)

Per research-01 §4: cheap-rejection checks inline (`operation`, `pre_state_snapshot IS NULL`, `snapshot_pruned_at IS NOT NULL`, `error_message IS NOT NULL` from upload row, `occurred_at < now() - 30 days`, `shop_id <= 0` sentinel/legacy, snapshot_kind resolvability via inline lookup against the 10 known kinds + legacy fallback). For rows that pass cheap checks, ONE follow-up query detects successor-reverts via `WHERE reverts_upload_id IN (...)` (uses the new column from §4 migration). No N+1.

What is INTENTIONALLY NOT computed here:
- **Current-state drift** — would require reading + canonicalizing the target table state per snapshot_kind for every row in the result, which is O(N × per-kind canonical compute). Defer to revert-attempt time (where it's computed once for the one row the operator chose).
- **Confirm-token mismatch** — only meaningful between dry_run + apply within the same operator session; not a property of the audit row itself.

### 7.5 Auth
Inside the existing `if (includeAdminTools && audit)` block at `scheduler-tools.ts:798`. No extra gate — orchestrator-mcp is admin-only at the request boundary.

### 7.6 30-day cutoff
Add a strict cutoff to the eligibility computation: even if `snapshot_pruned_at IS NULL`, treat `occurred_at < now() - interval '30 days'` as eligibility reason `over_30_day_cutoff` (X-FIX-#15: renamed from v0.5's `snapshot_pruned`-as-cutoff conflation; the cutoff is a SEPARATE reason from explicit snapshot pruning so operators can distinguish "snapshot retention cron deleted it" from "cron hasn't run yet but it's been > 30 days"). Closes the cron-not-yet-run window per research-01 §8 Q2.

---

## 8. Revert extension — REWRITTEN v0.4 per CV2-B6 (outer/inner two-RPC split + CV2-B5-v0.3-AMEND dry_run) + v0.5 consolidation pass (X-FIX-AGENT-G — supersession markers, Sentry-emission pattern, redaction policy, lifecycle contract)

v0.2's claim-RPC pattern had a correctness hole (CR-B2 from cross-verify): after acquiring + setting the parent's `successor_revert_id`, any downstream failure permanently consumed revert eligibility. The fix per Chris's call is to make the entire revert atomic — all mutations inside one SECURITY DEFINER plpgsql RPC.

### 8.1 Two RPCs (outer attempt-logging + inner atomic-apply) + 10 per-snapshot_kind handler functions

Per CV2-B5-v0.3-AMEND + CV2-B6 (both Chris's 2026-05-26 calls), the revert pipeline splits into an OUTER RPC `revert_md_upload_attempt` (inserts an attempt row IF caller-side preconditions hold per STEP 0a-0d; captures success/rejection/failure into it; never re-RAISEs — see X-FIX-#12 narrowing) and an INNER RPC `revert_md_upload_apply` (the dispatch + eligibility + staleness + handler + audit-row-INSERT logic; RAISEs on any failure; supports dry_run mode).

The TS `revertMdUpload` calls ONLY the outer RPC:

```ts
// X-FIX-AGENT-A (fixes X8 — wrapper was keying off `error_message` and would
// report `outcome='rejected'` rows as `ok: true` whenever the rejection had no
// error_message text). The contract with the outer RPC is now: outer always
// returns `outcome` (one of success | dry_run_success | rejected | crashed).
// Only `success` and `dry_run_success` count as ok; everything else surfaces
// the structured failure shape (outcome + reason_code + error_message +
// attempt_id) for callers.
const OK_OUTCOMES = new Set(["success", "dry_run_success"]);

type RevertResult =
  | { ok: true; outcome: "success" | "dry_run_success"; attempt_id: number; revert_audit_log_id: number | null; confirm_token: string | null; restored: number; deactivated: number; deleted: number; dry_run: boolean }
  | { ok: false; outcome: "rejected" | "crashed"; reason_code: string | null; error_message: string | null; attempt_id: number };

export async function revertMdUpload(sb, shopId, args: {
  upload_id: number;
  // Audit context — `display_name` is what we pass to `p_actor_email` for now.
  // TBD (Agent F): if the schema column is renamed `actor_label`, the RPC
  // parameter name follows + this wrapper field name updates in lockstep.
  audit: { display_name: string; oauth_client_id: string };
  dry_run?: boolean;
  expected_confirm_token?: string;
  force_no_after_hash?: boolean;
}): Promise<RevertResult> {
  const { data, error } = await sb.rpc("revert_md_upload_attempt", {
    p_upload_id: args.upload_id,
    p_shop_id: shopId,
    p_actor_email: args.audit.display_name,
    p_oauth_client_id: args.audit.oauth_client_id,
    p_dry_run: args.dry_run ?? false,
    p_expected_confirm_token: args.expected_confirm_token ?? null,
    p_force_no_after_hash: args.force_no_after_hash ?? false,
  }).single();

  if (error) {
    // Outer RPC swallows all classified errors into result rows;
    // any error code surfacing HERE is an outer-RPC-internal bug.
    // Specifically:
    // - 55P03 (lock_not_available) is normally caught inside outer's
    //   EXCEPTION block and returned as outcome='rejected', reason_code='another_revert_in_progress'
    // - 23505 (unique_violation on the partial unique index
    //   scheduler_admin_audit_log_one_successful_revert_idx) is caught and
    //   returned as outcome='rejected', reason_code='successor_revert_exists';
    //   any OTHER 23505 is returned as outcome='crashed',
    //   reason_code='unique_violation' (narrowed per X-FIX-AGENT-A so real
    //   data-integrity bugs surface)
    // - Any other code raised at the .rpc boundary = orchestrator-mcp bug
    //   (failure to find the function, broken signature, etc.) — propagate.
    throw error;
  }

  // X-FIX-AGENT-A: classify on `outcome` (machine-readable enum), NOT
  // `error_message` (human-readable text that may be null on rejection).
  if (!OK_OUTCOMES.has(data.outcome)) {
    return {
      ok: false,
      outcome: data.outcome,           // 'rejected' | 'crashed'
      reason_code: data.reason_code,   // machine-readable enum, null on outcome='crashed' without a known cause
      error_message: data.error_message,
      attempt_id: data.attempt_id,
    };
  }
  return { ok: true, ...data };
}
```

**About the `not_found` reason and sentinel-row visibility:**

The inner `revert_md_upload_apply` RPC selects the parent audit row with `WHERE id = p_upload_id AND shop_id = p_shop_id`. Rows with `shop_id = -1` (the CV2-B4 sentinel for "pre-migration backfill, shop unknown") or with legacy NULL shop_id (pre-Migration-A rows that escaped the script) return `not_found` here, NOT `shop_id_unknown_pre_migration_backfill`. This is correct:
- Sentinel/legacy rows are unrevertable by design (the eligibility computation in `list_scheduler_admin_audit_log` surfaces them with `reasons: ['shop_id_unknown_pre_migration_backfill']` — see §7).
- They never reach `revert_md_upload_attempt` because the UI's Revert button is disabled for those rows.
- If a tool consumer bypasses the eligibility filter and calls `revert_md_upload_attempt` directly with such an `upload_id`, the `not_found` response is the right answer: real shop IDs are positive Tekmetric IDs, so `p_shop_id = <real shop>` never matches `shop_id = -1` or NULL.
- The eligibility reason `shop_id_unknown_pre_migration_backfill` is therefore a list-tool-only diagnostic; the revert RPC's `not_found` is structurally equivalent and correct.

`revert_md_upload_attempt(p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id, p_dry_run, p_expected_confirm_token, p_force_no_after_hash)` does (in its own transaction):

```
STEP 0a. Parameter-presence guard (X-FIX-AGENT-A): RAISE on p_shop_id IS NULL OR <= 0;
          RAISE on p_upload_id IS NULL OR <= 0.
STEP 0b. Multi-tenant auth assertion (X-FIX-AGENT-B): RAISE on p_actor_email IS NULL
          OR empty (audit-trail integrity — no anonymous reverts). The load-bearing
          in-DB auth check is the canonical REVOKE/GRANT triple from §4.4 top
          (only service_role can EXECUTE). 4-layer defense narrative in §8.4.
A. INSERT attempt row with outcome='pending'. INSERT runs in the OUTER function's
   transaction frame (NOT inside the BEGIN…EXCEPTION subtransaction), so the row
   survives inner rollback.
B. Open a PL/pgSQL BEGIN…EXCEPTION subtransaction block (the implementation
   pattern equivalent to a SQL-level SAVEPOINT — see "PL/pgSQL transaction-control
   note" at top of §4.4). NOT a literal SAVEPOINT statement.
C. Invoke inner via SELECT … FROM revert_md_upload_apply(...) (function call —
   NOT a CALL procedure invocation).

   C.1 If inner succeeded (returned cleanly):
       - BEGIN…EXCEPTION block commits implicitly on EXIT (no ROLLBACK happened);
         inner mutations + audit row + parent UPDATE preserved.
       - UPDATE attempt row outcome='success' (or 'dry_run_success' per CV2-B5-v0.3-AMEND).
         Note: confirm_token storage on dry_run_success is Agent F's call — likely a
         dedicated dry_run_confirm_token_hash column (NOT overloading reason_code with
         a sensitive token). For now the success-path UPDATE leaves reason_code NULL
         and sets revert_audit_log_id=inner.revert_audit_log_id (NULL when dry_run).
       - RETURN inner's result fields + outcome + reason_code (NULL) + error_message (NULL) + attempt_id.
   C.2 If inner RAISEd:
       - BEGIN…EXCEPTION subtransaction auto-rolls back inner mutations + any
         partial inner writes (PL/pgSQL implicit-subtransaction semantics).
       - GET STACKED DIAGNOSTICS for SQLSTATE + SQLERRM + CONSTRAINT_NAME.
       - Classify per CV2-B6 outcome table (X-FIX-AGENT-A — X14 narrowing applied):
           55P03                                              → outcome='rejected', reason_code='another_revert_in_progress'
           23505 AND CONSTRAINT_NAME =
             'scheduler_admin_audit_log_one_successful_revert_idx'
                                                              → outcome='rejected', reason_code='successor_revert_exists'
           23505 (any other constraint name)                  → outcome='crashed',  reason_code='unique_violation' (surfaces real data-integrity bugs)
           prefix 'revert_blocked:'                           → outcome='rejected', reason_code via §3b "Canonical reason_code enum" allow-list (NOT trimmed text — see X-FIX-#24)
           prefix 'confirm_token_mismatch:'                   → outcome='rejected', reason_code='confirm_token_mismatch'
           prefix 'staleness_check_failed:'                   → outcome='rejected', reason_code='current_state_drift'
           anything else                                      → outcome='crashed',  reason_code=NULL, error_detail=SQLSTATE:SQLERRM
       - UPDATE attempt row outcome + reason_code + error_detail.
       - RETURN structured error result (outcome + reason_code + error_message + attempt_id) — do NOT re-RAISE; outer is the audit boundary.
```

`revert_md_upload_apply(p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id, p_dry_run, p_expected_confirm_token, p_force_no_after_hash)` does (still in outer's transaction, inside the BEGIN…EXCEPTION subtransaction):

```
STEP 0. Parameter-presence guard (X-FIX-AGENT-A): mirrors outer's check so
         direct misuse (bypassing outer) still fails fast. RAISE on p_shop_id
         IS NULL OR <= 0; RAISE on p_upload_id IS NULL OR <= 0.
1. SELECT … FOR UPDATE NOWAIT on parent audit row (NOWAIT → 55P03 on parallel revert)
   - WHERE id = p_upload_id AND shop_id = p_shop_id
   - NOT FOUND → RAISE 'revert_blocked: not_found' (per sentinel-row note above)
2. Validate eligibility — ALL checks BEFORE any side-effect (per CV2-I5).
   X-FIX-AGENT-A (fixes X2): every predicate below is the INVALID condition
   that triggers the rejection. The prior plan had these predicates INVERTED
   (e.g. "operation = 'upload_md' → RAISE" would have rejected every eligible
   upload). The corrected pattern: RAISE on the invalid state.
   - operation <> 'upload_md'           → RAISE 'revert_blocked: not_upload_md'
   - successor_revert_id IS NOT NULL    → RAISE 'revert_blocked: successor_revert_exists'
   - snapshot_pruned_at IS NOT NULL     → RAISE 'revert_blocked: snapshot_pruned'
   - pre_state_snapshot IS NULL         → RAISE 'revert_blocked: no_snapshot'
   - occurred_at < now() - 30d          → RAISE 'revert_blocked: over_30_day_cutoff'
     (X-FIX-#11 — was '30_day_cutoff' which starts with a digit; reason_code regex
     extracts a leading-letter identifier per the canonical enum; renamed for
     parsability + matches §3b enum list)
   - resolve_snapshot_kind returns NULL → RAISE 'revert_blocked: table_not_supported'
3. Dry-run / apply two-step parameter-invariant guard (X-FIX-AGENT-E, fixes
   X-AMEND "Dry-run silently ignores p_expected_confirm_token"):
   - IF p_dry_run AND p_expected_confirm_token IS NOT NULL THEN
       RAISE 'revert_blocked: expected_confirm_token must be NULL in dry_run mode (the token is the OUTPUT of dry_run, not its input)'
   - v0.3 silently ignored a non-NULL token in dry_run mode; v0.4 rejects loudly
     to catch caller bugs that confuse the two-step flow (e.g., re-submitting an
     apply request with stale state to the dry_run preview path).
4. Acquire target-row locks via the per-kind helper (X-FIX-AGENT-E, closes X13
   "Target-row locks happen AFTER staleness snapshot → lost-update window"):
   - v_lock_count := lock_targets_for_kind(v_kind, p_shop_id, v_snapshot)
   - The helper takes a per-kind lock predicate (FOR UPDATE on target rows for
     most handlers; pg_advisory_xact_lock on (shop_id, closed_date) for the
     closed_dates handler — see §8.3 spec). v0.3 left lock acquisition inside
     the handler (step 9 below), which left a TOCTOU window where a concurrent
     editor could mutate a target row AFTER the staleness snapshot but BEFORE
     the handler took locks. v0.4's step-4 ordering means current-state
     computation (step 5) + staleness check (step 6) both run UNDER the same
     locks the handler will later mutate under. Handler-level locks become
     defense-in-depth.
5. Compute current head canonical NOW (under target-row locks per step 4):
   - v_current_canonical := compute_current_canonical_for_kind(v_kind, p_shop_id, v_snapshot)
   - v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex')
   - v_snapshot_after_hash := v_snapshot->>'after_hash'
   - v_token_recomputed := encode(digest(
       p_upload_id || '|' || table_name || '|' ||
       v_current_head_hash || '|' ||
       COALESCE(v_snapshot_after_hash, '<<no-after-hash>>'),
       'sha256'), 'hex')

   X-FIX-1 (2026-05-26 — cross-verify GPT chunk 3 IMPORTANT): the prose previously
   used `sha256(x)` shorthand, but PostgreSQL has NO built-in `sha256(text)`
   function. The canonical form (matching the actual §4.4 SQL block) is
   `encode(digest(x, 'sha256'), 'hex')` provided by pgcrypto (added to
   Migration A as `CREATE EXTENSION IF NOT EXISTS pgcrypto;`). Implementers
   copying the prose verbatim into SQL would have hit
   `function sha256(text) does not exist` at runtime.

   Token-binding stability (X-FIX-AGENT-E, fixes X-AMEND "snapshot_hash :=
   sha256(v_snapshot::text) brittle"): every input is either a deliberately-
   canonicalized hash (current_head_hash, snapshot.after_hash) or a stable
   scalar (upload_id integer, table_name text). Survives JSONB rendering
   changes / PG version updates / pg_dump format changes. The
   '<<no-after-hash>>' literal handles pre-2026 snapshots that lack after_hash.
   v0.3's v_snapshot_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex')
   was rejected: JSONB ::text rendering depends on PG version + key ordering
   quirks, and using that as a token component meant tokens could silently
   invalidate across environments.
6. Staleness check (X-FIX-AGENT-E, closes X4 "Revert dry-run can BYPASS the
   post-upload staleness guard" + integrates §8.3 after_hash fast-path):
   - v_expected_canonical := v_snapshot->>'expected_after_state_canonical'
   - IF v_snapshot_after_hash IS NULL AND NOT COALESCE(p_force_no_after_hash, FALSE) THEN  -- X-FIX-3 COALESCE belt-and-suspenders
       RAISE 'revert_blocked: cannot_safely_verify: pre-2026-05-26 snapshot has no expected_after_state_canonical / after_hash; pass force_no_after_hash=true to override (logged + flagged for review)'
   - IF v_snapshot_after_hash IS NOT NULL AND v_snapshot_after_hash <> v_current_head_hash THEN
       -- Hash mismatch confirms drift. Generate diff for operator.
       RAISE 'staleness_check_failed: current state differs from expected post-upload state; diff=%',
         compute_unified_diff(COALESCE(v_expected_canonical, '<<expected_after_state_canonical not stored in this pre-CV2-B3 snapshot>>'),
                              v_current_canonical, 50)
   v0.3 ran the staleness check ONLY on the apply path (after step 8 in v0.3 —
   AFTER the dry-run return). That meant a dry_run against drifted state happily
   returned a confirm token, which the operator could then submit on apply,
   reverting OVER the legitimate post-upload edits. v0.4 runs the same check on
   BOTH paths BEFORE the dry-run early-return so the operator never receives a
   token for drifted state. Two-stage check: fast-path is the after_hash !=
   current_head_hash comparison (cheap — both are 64-char hex strings); slow
   path is the diagnostic diff, generated only on hash mismatch.
7. Dry-run early return — NOW after locks + staleness verify pass
   (X-FIX-AGENT-E, was step 4 in v0.3):
   - IF COALESCE(p_dry_run, FALSE) THEN  -- X-FIX-3 COALESCE belt-and-suspenders
       RETURN (revert_audit_log_id=NULL, confirm_token=v_token_recomputed,
               restored=0, deactivated=0, deleted=0, dry_run=TRUE);
     (No mutations. No audit row. Outer sets attempt row outcome='dry_run_success'.)
8. Apply branch — validate p_expected_confirm_token (was step 5 in v0.3 —
   renumbered after staleness ordering fix):
   - IF p_expected_confirm_token IS NULL THEN
       RAISE 'confirm_token_mismatch: dry_run=false requires expected_confirm_token (call dry_run=true first)'
   - IF p_expected_confirm_token <> v_token_recomputed THEN
       RAISE 'confirm_token_mismatch: head has changed since dry_run; call dry_run=true again for fresh token'
9. Dispatch via CASE on snapshot_kind to the per-handler plpgsql fn:
   - SELECT * INTO v_stats FROM revert_<kind>(p_shop_id, v_snapshot)
     (X-FIX-AGENT-A: invocation form is `SELECT * INTO v_stats FROM <fn>(...)`,
     which absorbs all 4 columns of the universal handler return shape per
     X-FIX-AGENT-C — `restored INT, deactivated INT, deleted INT, details JSONB`.)
   - Handler returns TABLE(restored INT, deactivated INT, deleted INT, details JSONB) per §8.2
   - Handler may still SELECT … FOR UPDATE its own target rows as defense-in-depth
     (the load-bearing locks live in step 4 above per X-FIX-AGENT-E TOCTOU fix)
   - Handler RAISEs on any internal error → propagates to outer's BEGIN…EXCEPTION catch
10. INSERT revert audit row.
    X-FIX-AGENT-A (fixes "jsonb_build_object syntax bug"): keys must be
    alternating STRING-LITERAL key + value pairs. The prior sketch listed
    bare identifiers that Postgres would parse as column refs.
    X-FIX-AGENT-C: diff_summary is the standard-keys object || `v_stats.details`
    (per §8.2 Invariant 7 + §8.5 details-flow prose). COALESCE guards a NULL
    return from the handler so the whole diff_summary doesn't NULL out.
    - operation='revert_upload', shop_id=p_shop_id, table_name=parent.table_name
    - user_label=p_actor_email, oauth_client_id=p_oauth_client_id
    - reverts_upload_id=p_upload_id, error_message=NULL
    - diff_summary=jsonb_build_object(
        'reverted_upload_id', p_upload_id,
        'snapshot_kind', v_kind,
        'restored', v_stats.restored,
        'deactivated', v_stats.deactivated,
        'deleted', v_stats.deleted,
        'forced_no_after_hash_check', (p_force_no_after_hash AND v_snapshot_after_hash IS NULL)
      ) || COALESCE(v_stats.details, '{}'::JSONB)
    - RETURNING id INTO v_revert_id
11. UPDATE parent SET successor_revert_id = v_revert_id
12. RETURN (revert_audit_log_id=v_revert_id, confirm_token=NULL, restored, deactivated, deleted, dry_run=FALSE)
```

If ANY step (1-12) raises within inner, the BEGIN…EXCEPTION subtransaction in the outer rolls back inner's mutations + audit row INSERT + parent UPDATE (PL/pgSQL implicit-subtransaction semantics). Parent's `successor_revert_id` stays NULL. No partial mutations. Outer's `EXCEPTION WHEN OTHERS THEN` catches, classifies into attempt-row outcome + reason_code, returns clean error result to TS (no re-RAISE).

**Note on the staleness diff format (§8.3 amendment):** the `compute_unified_diff(expected, current, max_lines=50)` helper produces a **line-aligned diff** (NOT a true unified-diff with LCS / myers-style alignment — see §8.3 for the honest framing of what the helper does and does not do). For multi-line / reordered / deleted-block diffs near the top, insertions/deletions cause subsequent lines to mis-align — the helper is best-effort for operator visibility, not a full diff. If true unified-diff output is needed, generate it client-side after revert rejection from the `error_detail` text. The helper truncates at the configured `max_lines` (50 for the inner RPC's RAISE) with a trailing `... (N more lines differ; line-by-line — reordered blocks may overcount)` marker.

### 8.2 The 10 plpgsql handler functions — REWRITTEN v0.4 per C-I2 + C-I5 + C-I6 + A-B3 + A-B10 + per-category-shape + X-FIX-AGENT-C universal-4-column-return

Each handler is `SECURITY DEFINER`, `SET search_path = pg_catalog, extensions, public`, takes `(p_shop_id INTEGER, p_snapshot JSONB)`, and **RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)** per C-I2 + X-FIX-AGENT-C (was v0.3: 3-column return; was v0.2: "returns nothing"). The `details` column carries per-handler metadata; default for 9 of 10 handlers is `'{}'::JSONB` (zero-cost no-op). The closed_dates handler uses it to surface `skipped_past_dates_restore` + `skipped_past_dates_delete` arrays per X9 + X10. On any internal error: RAISE with one of the standardized prefixes (`revert_blocked:` for FK violations and known constraint failures) — outer's exception block catches and classifies.

**Canonical security setup MANDATORY for EVERY handler (X-FIX-4 — 2026-05-26 — fixes GPT chunk 3 BLOCKER "revert_closed_dates_future is SECURITY DEFINER but lacks the REVOKE/GRANT block").** PostgreSQL grants `EXECUTE` on new functions to `PUBLIC` by default. Without an explicit REVOKE-then-GRANT triple, ANY authenticated DB role can call a SECURITY DEFINER handler directly — bypassing the outer/inner revert dispatch + bypassing the attempt-row audit trail + bypassing the multi-tenant auth checks at STEP 0. Every one of the 10 handlers below MUST close its `CREATE OR REPLACE FUNCTION … $$;` block with the canonical triple (matching the per-category and closed_dates_future handlers' SQL sketches in this section):

```sql
REVOKE EXECUTE ON FUNCTION public.<handler_name>(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.<handler_name>(INTEGER, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.<handler_name>(INTEGER, JSONB) TO service_role;
```

This is a deploy-time correctness requirement, not an optional hardening. The §8.2 SQL sketches in this section cover only 2 of the 10 handlers in full (per-category + closed_dates_future) — the other 8 are described by signature + delete-strategy + scope, with the canonical security setup implied by reference to this paragraph. Implementers of the 8 not-yet-sketched handlers MUST emit the triple per the canonical setup block at §4.4 top + Layer 2 of §8.4 four-layer defense.

| Handler fn | snapshot_kind | Tables touched | Delete strategy |
|---|---|---|---|
| `revert_testing_services_v2(p_shop_id, p_snapshot)` | `testing_services_v2` | `testing_services` | soft (active=false) |
| `revert_routine_services_v2(p_shop_id, p_snapshot)` | `routine_services_v2` | `routine_services` | soft (active=false) |
| `revert_subcategory_descriptions_v2(p_shop_id, p_snapshot)` | `concern_subcategories_descriptions_v2` | `concern_subcategories` (description field only) | UPSERT only (no adds) |
| `revert_subcategory_service_map_v2(p_shop_id, p_snapshot)` | `concern_subcategories_map_v2` | `concern_subcategories` (service_map fields) | UPSERT only (no adds) |
| `revert_question_required_facts_v2(p_shop_id, p_snapshot)` | `concern_questions_required_facts_v2` | `concern_questions` (required_facts field) | UPSERT only (no adds) |
| `revert_concern_questions_flat(p_shop_id, p_snapshot)` | `concern_questions_flat` | `concern_questions` | soft (active=false) |
| `revert_concern_category_upload(p_shop_id, p_snapshot)` | `concern_questions_per_category` | `concern_subcategories` + `concern_questions` (per category) | soft (active=false) — both tables |
| `revert_concern_category_guideline(p_shop_id, p_snapshot)` | `concern_category_guidelines` | `concern_category_guidelines` | **hard DELETE** added (no soft-delete column on this table) |
| `revert_appointment_default_limits(p_shop_id, p_snapshot)` | `appointment_default_limits` | `appointment_default_limits` | **hard DELETE** added (per C-I5: no `active` column on this 7-row table; explicitly enumerated here to override the generic rule) |
| `revert_closed_dates_future(p_shop_id, p_snapshot)` | `closed_dates_future` | `closed_dates` | **conditional hard DELETE** per C-I6 (see below) |

**Universal handler invariants** (applied by every handler):

1. **shop_id enforcement is NECESSARY BUT NOT SUFFICIENT (REWRITTEN v0.4 per X-FIX-AGENT-B — closes GPT BLOCKER X7 "ON CONFLICT (id) DO UPDATE SET shop_id = p_shop_id can HIJACK another shop's row" + GPT IMPORTANT "Snapshot tampering protection is overstated").**

   v0.3 framed this invariant as: "force `shop_id = p_shop_id` in UPSERT SET clause → guarantees multi-tenant integrity." That framing was WRONG. A tampered or corrupted snapshot can carry an `id` that belongs to another shop's row. Under the v0.3 pattern, `ON CONFLICT (id) DO UPDATE SET shop_id = p_shop_id` would HIJACK the other shop's row, moving it to the caller's shop — the exact opposite of multi-tenant integrity.

   The v0.4 pattern: forcing `shop_id = p_shop_id` in the INSERT column AND scoping the conflict's DO UPDATE clause with `WHERE target.shop_id = p_shop_id` (so foreign-shop conflict targets are SKIPPED, not hijacked) AND detecting the cross-shop conflict via row-count comparison (the canonical SQL pattern lives in Invariant 5 below). FK target tenant validation handled by Invariant 6.

   **WRONG pattern (do NOT do this — v0.3 sketch):**
   ```sql
   INSERT INTO testing_services (id, shop_id, name, ..., active)
   SELECT (rec->>'id')::UUID, p_shop_id, rec->>'name', ..., (rec->>'active')::BOOLEAN
     FROM jsonb_each(p_snapshot->'before') AS s(key, rec)
   ON CONFLICT (id) DO UPDATE SET
     shop_id = p_shop_id,                  -- ← HIJACKS another shop's row if id collides
     name = EXCLUDED.name, ...,
     active = EXCLUDED.active;
   ```

   **RIGHT pattern (v0.4 — REQUIRED for every handler):**
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

   -- Cross-shop hijack detection (Invariant 5):
   IF v_actual_writes < (SELECT count(*) FROM jsonb_each(p_snapshot->'before')) THEN
     RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: snapshot carries % rows but only % were writable in shop %',
       (SELECT count(*) FROM jsonb_each(p_snapshot->'before')),
       v_actual_writes, p_shop_id
       USING ERRCODE = '42501';
   END IF;
   ```

   The INSERT-clause `shop_id = p_shop_id` ensures NEW rows the snapshot wants to create are created in the caller's tenant. The DO UPDATE WHERE clause ensures EXISTING rows in another tenant are NOT hijacked. The post-write row-count check converts a silently-filtered foreign-shop conflict into a loud `revert_blocked` RAISE. The combined pattern provides true tenant integrity even when the snapshot is corrupted or tampered.

   **Preferred alternative when the target table has a tenant-scoped unique key.** Several scheduler tables already declare composite unique keys that include `shop_id` (verified against existing migrations — `closed_dates(shop_id, closed_date)`, `concern_subcategories(shop_id, category, slug)`, `concern_category_guidelines(shop_id, category)`, etc.). When a tenant-scoped unique key exists, the simplest pattern is to use IT as the conflict target instead of the global `id`:
   ```sql
   ON CONFLICT (shop_id, closed_date) DO UPDATE SET ...    -- ← tenant-scoped conflict target
   ```
   This makes cross-shop hijack STRUCTURALLY IMPOSSIBLE: a snapshot row carrying `(shop=A, date=X)` cannot conflict with an existing `(shop=B, date=X)` row because the conflict target keys include shop_id. The DO UPDATE WHERE filter from Invariant 5 becomes a belt-and-suspenders no-op; the row-count check still surfaces other anomalies (mismatched row counts).

   Per-handler choice:
   - **Tenant-scoped unique key available (preferred):** use it as conflict target. Pattern still applies the Invariant 5 row-count check (for symmetry + future-proofing against schema changes).
   - **Only global `id` PK available:** use `ON CONFLICT (id) DO UPDATE … WHERE target.shop_id = p_shop_id` + row-count check. The WHERE filter does the load-bearing work; the row-count check surfaces the cross-shop conflict.

   The defense layers above the handler are described in §8.4 (4-layer defense narrative). At the handler layer, the four ingredients — INSERT-clause force, DO UPDATE WHERE filter (or tenant-scoped conflict target), row-count detection (Invariant 5), and FK target tenant validation (Invariant 6) — together close the cross-shop attack surface. Removing any one of them re-opens the hijack window.

2. **Target-row locking (REWRITTEN v0.4 per X-FIX-AGENT-B + X-FIX-AGENT-E — closes GPT IMPORTANT X12 "Handler lock predicates do not match conflict targets" + GPT BLOCKER X13 "Target locks happen after the staleness snapshot").**

   The load-bearing target-row locks now live in the inner RPC's step 4 — `lock_targets_for_kind(v_kind, p_shop_id, v_snapshot)` (helper spec in §8.3). The helper acquires `SELECT … FOR UPDATE` on every target row the handler will mutate BEFORE the inner RPC computes the current canonical state (step 5) and runs the staleness check (step 6). This ordering is what closes X13: in v0.3 each handler acquired its own locks AFTER staleness had already been validated against an unlocked snapshot, leaving a TOCTOU window where a concurrent editor could mutate a target row mid-dispatch.

   **Handler-level locks are now DEFENSE-IN-DEPTH, not load-bearing.** Handlers MAY still call `SELECT … FOR UPDATE` on their target rows as belt-and-suspenders (and the example below preserves the pattern for documentation continuity), but the inner RPC's step 4 is the gate that protects against TOCTOU. Removing the handler-level lock does NOT re-open the TOCTOU; the inner RPC's lock acquisition is already holding the rows.

   v0.3 sketch locked by `shop_id + handler-specific key + id`, but UPSERTs conflict on `id` alone (it's the PK). If a row exists under the same `id` but a different shop/category, the SELECT … FOR UPDATE filter did NOT match it → no lock acquired on that row → the eventual `ON CONFLICT (id)` would still race against a concurrent editor of that row in the other shop. That's a TOCTOU window that combines with X7 to make the "lock every target row before mutating" guarantee false.

   **v0.4 rule (applies to BOTH the inner RPC's step-4 helper AND any handler-level defense-in-depth lock):** lock predicate is exactly `shop_id = p_shop_id AND id = ANY(<keys>)`. The Invariant 1 `WHERE target.shop_id = p_shop_id` clause on DO UPDATE ensures the eventual UPSERT only touches rows that the lock pre-acquired. The lock window covers (a) computing current canonical state for staleness verification (inner RPC step 5-6), (b) reading current state for FK validation (Invariant 6), (c) applying mutations.

   Locking only the parent audit row (per §8.1 step 1) does NOT protect the target tables — the inner RPC's step-4 `lock_targets_for_kind` IS the target-table lock acquisition.

   Example for `revert_testing_services_v2`:
   ```sql
   -- Lock every target row in THIS shop before mutating. Combined with
   -- Invariant 1's WHERE clause on DO UPDATE, this lock is now actually
   -- load-bearing for the UPSERT (foreign-shop rows with colliding ids
   -- are skipped at UPSERT time, not silently hijacked).
   PERFORM 1 FROM testing_services
     WHERE shop_id = p_shop_id
       AND id = ANY (
         ARRAY(SELECT (key)::UUID FROM jsonb_object_keys(p_snapshot->'before') AS key)
         || ARRAY(SELECT (key)::UUID FROM jsonb_array_elements_text(p_snapshot->'added_keys') AS key)
       )
     FOR UPDATE;
   -- Now safe to UPSERT + UPDATE active=false; concurrent editors block on these row locks.
   ```
   Each handler's lock scope is narrow (only the rows it's about to mutate, scoped by shop_id + key set) — does NOT lock the whole table.

   **Absent-key TOCTOU analysis (REWRITTEN v0.5+IMPORTANTs+round3 per X-FIX-#25 — 2026-05-26 — closes GPT round-3 chunk 3 BLOCKER + chunk 4 BLOCKER "Absent-key TOCTOU analysis is still incorrect for UPSERT-restore paths" + "Non-`closed_dates` apply RPCs still have absent-key / phantom-write races"). PRIOR analysis (X-FIX-#9) was OVER-OPTIMISTIC and is REPLACED below.**

   `SELECT … FOR UPDATE` locks ROWS, not the KEY NAMESPACE. If a row is ABSENT at lock time, no lock is acquired on that key — a concurrent transaction can INSERT into the gap between the inner RPC's step-4 lock and the handler's UPSERT/DELETE.

   **The race window that X-FIX-#9 missed:** when the ORIGINAL upload DELETED a row, the post-upload canonical state expects that row absent. Dry-run for revert observes absent. Apply step 4 lock acquires nothing. Step 5 canonical compute observes absent (matches expected). Step 6 hash check passes. A concurrent transaction INSERTs a row at that key between step 6 and the handler's UPSERT-restore. The handler's `ON CONFLICT (id) DO UPDATE WHERE shop_id = p_shop_id` silently overwrites the concurrent insert. The canonical-drift check at step 6 cannot catch this because BOTH the dry-run and step-5 observations showed "absent" — the concurrent insert happens AFTER step 5.

   **Per-kind protection status (honest):**

   - **`closed_dates_future`** — explicit per-`(shop_id, closed_date)` advisory locks (`pg_advisory_xact_lock(shop_id::INT, hashtext(date::TEXT))` 2-arg form per X-FIX-#16/#24) at the helper level. Protects the key namespace, not just rows. **Race CLOSED.** ✓
   - **Hard-DELETE handlers on existing-rows AND on added_keys** (CCG + ADL revert-of-UPDATE + revert-of-INSERT) — row exists at lock time AND the table's natural composite unique constraint (`(shop_id, category)` for CCG; `(shop_id, day_of_week)` for ADL) prevents a concurrent INSERT from succeeding while our row holds the slot — Postgres's index lock fires `23505` on the concurrent INSERT → concurrent transaction rolls back. **Race CLOSED by natural constraints.** ✓
   - **UPSERT-from-before handlers where the row was concurrently HARD-DELETED between dry-run and apply** — `SELECT … FOR UPDATE` returns 0 rows; no row lock. BUT the canonical-state hash at step 5 INCLUDES the row's presence/absence; the concurrent DELETE changes the row count → step-6 hash compare DIVERGES from dry-run hash → RAISE `current_state_drift`. **Race CLOSED by canonical drift detection.** ✓
   - **UPSERT-restore-of-originally-DELETED-row** (GPT's counterexample) — original apply DELETED the row; post-upload state expects absent; revert wants to UPSERT-restore it. Dry-run AND step-5 BOTH observe "absent" (matches expected). Step-6 hash passes. Concurrent INSERT between step 6 and handler UPSERT → handler silently overwrites. **Race OPEN — NOT closed by current defenses.** ✗
   - **Apply-RPC INSERT of a NEW key (B10)** — apply RPC locks rows from `p_snapshot.before` (existing rows pre-upload); the NEW-key INSERTs from `p_diff.added` have no pre-existing row to lock. Concurrent INSERT of the same key between apply's hash check and apply's INSERT → ON CONFLICT (id) DO UPDATE silently overwrites. **Race OPEN — NOT closed by current defenses for the 4 non-closed_dates apply RPCs.** ✗

   **The honest gap:** for UPSERT-restore-of-deleted and apply-INSERT-of-new-key cases on the 4 non-closed_dates surfaces (`apply_concern_questions_flat_upload`, `apply_concern_category_upload`, `apply_concern_category_guideline_upload`, `apply_appointment_default_limits_upload`, AND their revert counterparts), the absent-key race is REAL and not closed by canonical drift detection.

   **What this practically means:** silent data corruption is possible if a concurrent same-shop INSERT races with our apply or revert on the SAME natural key. The probability is bounded by:
   - Same-shop concurrent admin uploads of the same surface are operationally rare (single-shop deployment today; admins coordinate sessions)
   - The natural-key conflict-target pattern (Invariant 1's preferred alternative — `ON CONFLICT (shop_id, …)`) shrinks the race for tables where it applies (concern_subcategories, concern_category_guidelines)
   - The cross-shop hijack check (Invariant 5 row-count) catches DELIBERATE tampering, not concurrent legitimate writes

   **DEFERRED-AUDIT-ITEMS.md SEC-15** (NEW 2026-05-26) tracks the proper fix: extend `lock_targets_for_kind` to take advisory key-namespace locks for ALL handler kinds (matching the closed_dates_future pattern). Same surgery for the apply RPCs. Scope: 9 helper branches + 5 apply RPCs gain ~5-10 lines of advisory-lock SQL each. **NOT landed in Phase 1 to keep the BLOCKER fix surface bounded for the first deploy**; tracked for Phase 1.5 follow-up once Phase 1 has live data showing whether the race materializes operationally.

   **Why deferred (not immediately fixed):** the alternative — landing the advisory-lock extension before Phase 1 ships — adds ~50-100 lines of new SQL across 14 sites (9 helper branches + 5 apply RPCs) plus per-kind sorted-key acquisition order to avoid deadlocks plus concurrent-insert race tests for each kind. That's a significant correctness-and-test surface to add to a feature that's already on its 3rd round of cross-verify. The operational risk is low (single-shop, single-admin-at-a-time deployment). Landing the locks as Phase 1.5 after Phase 1 has shipped and burned in is the pragmatic call.

   **Future readers:** if you observe ANY silent same-shop overwrite incident in the audit log after Phase 1 ships, SEC-15 implementation should be expedited — the race materialized. The audit-row content carries enough metadata to detect this post-hoc: an unexpected `revert_audit_log_id` chain or an `expected_after_state_canonical` that doesn't match what you'd expect from the original apply's `expected_after_state_canonical` suggests concurrent overwrite happened.

3. **Reads from p_snapshot.before (Record-shaped, keyed by natural key) + p_snapshot.added_keys (string array).** UPSERTs every `before[*]` row back into target table; deactivates/deletes every `added_keys[*]` row per the per-handler delete strategy table.

4. **FK-broken check (DC-6):** if UPSERT raises FK violation (e.g., a question's `subcategory_id` no longer exists because the subcategory was deleted via direct DB), handler RAISEs (X-FIX-#11 — 2026-05-26 canonical enum format):
   ```
   revert_blocked: fk_broken: cannot restore <table>.id=<id> because <fk_column>=<value> no longer exists (likely deleted via direct DB or non-tracked tool); manual recovery required
   ```
   Enum prefix `fk_broken` is the only piece the classifier extracts into `reason_code`; the verbose tail flows to `error_detail`. v0.5 used the un-prefixed `cannot restore ...` form which would have captured row IDs + table names into `reason_code`, violating the §3b CV2-B6 Sentry-safety contract.
   Outer classifies as `outcome='rejected'`, `reason_code='cannot restore <table>.id=<id> because…'` (X-FIX-AGENT-A — column name `reason_code` matches the contract the schema redesign will land in storage).

5. **Cross-shop UPSERT-hijack prevention (NEW v0.4 per X-FIX-AGENT-B — closes GPT BLOCKER X7).**

   Every UPSERT in every handler MUST detect cross-shop conflict-target attempts via row-count comparison after the write. The canonical pattern:

   ```sql
   WITH attempted AS (
     INSERT INTO <table> (id, shop_id, ...)
     SELECT (key)::<id_type>, p_shop_id, ...
       FROM jsonb_each(p_snapshot->'before') AS s(key, rec)
     ON CONFLICT (id) DO UPDATE SET
       <col1> = EXCLUDED.<col1>, ...
       WHERE <table>.shop_id = p_shop_id        -- ← skips cross-shop targets
     RETURNING 1
   )
   SELECT count(*) INTO v_actual_writes FROM attempted;

   IF v_actual_writes < (SELECT count(*) FROM jsonb_each(p_snapshot->'before')) THEN
     RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt on <table>: snapshot carries % rows but only % were writable in shop %',
       (SELECT count(*) FROM jsonb_each(p_snapshot->'before')),
       v_actual_writes, p_shop_id
       USING ERRCODE = '42501';
   END IF;
   ```

   **Postgres semantics that make this pattern work** (verified against PostgreSQL docs for the INSERT … ON CONFLICT statement):
   - When `ON CONFLICT (id) DO UPDATE SET … WHERE <pred>` fires for a row whose `<pred>` evaluates false, Postgres does NOT execute the UPDATE — the row is skipped entirely.
   - `RETURNING 1` only emits one row per ACTUAL write (INSERT OR successful DO UPDATE). Conflicting rows whose WHERE-filter evaluated false do NOT emit a RETURNING row.
   - Therefore `count(*) FROM attempted` is the count of rows actually written. If it's strictly less than the snapshot's row count, AT LEAST ONE snapshot row was a cross-shop conflict-target that we correctly REFUSED to hijack.

   **What the INSERT-only path looks like.** If the snapshot row's `id` does not exist anywhere in the target table, the INSERT writes a new row with `shop_id = p_shop_id` (always our shop, INSERT clause force from Invariant 1). No conflict; no DO UPDATE; RETURNING emits 1. This is the happy path — a previously-deleted row is being restored to our shop.

   **What the cross-shop hijack attempt looks like.** Snapshot carries `id = X`. Target table has `id = X` in shop B (NOT our shop). ON CONFLICT (id) fires; DO UPDATE WHERE shop_id = p_shop_id evaluates to FALSE (target.shop_id is B, our p_shop_id is A); UPDATE is skipped; RETURNING does NOT emit. Row count comparison shows the miss; we RAISE `cross_shop_hijack_attempt`.

   **What a same-shop UPDATE looks like.** Snapshot carries `id = X`. Target table has `id = X` in our shop. ON CONFLICT (id) fires; WHERE shop_id = p_shop_id evaluates TRUE; UPDATE executes; RETURNING emits 1. Happy path.

6. **FK target tenant validation (NEW v0.4 per X-FIX-AGENT-B — closes GPT IMPORTANT "Snapshot tampering protection is overstated").**

   Postgres FK constraints enforce EXISTENCE of the referenced row but not TENANT-correctness. A tampered snapshot could carry a `subcategory_id` that points at another shop's subcategory; the FK constraint is satisfied (the subcategory exists), but the resulting question row would now reference an out-of-tenant parent — a multi-tenant integrity violation that the per-row FK check misses.

   Every handler that UPSERTs rows carrying FK columns MUST pre-validate that every distinct FK target value in the snapshot resolves IN THE CALLER'S TENANT before the UPSERT runs.

   The canonical pattern (illustrated for the per-category handler's questions → subcategories FK):
   ```sql
   -- Validate FK target tenant correctness BEFORE upserting questions_before.
   -- Count distinct subcategory_id values referenced in the snapshot.
   WITH referenced AS (
     SELECT DISTINCT (rec->>'subcategory_id')::UUID AS sub_id
       FROM jsonb_each(p_snapshot->'questions_before') AS s(key, rec)
      WHERE rec->>'subcategory_id' IS NOT NULL
   ), resolved AS (
     SELECT r.sub_id
       FROM referenced r
       JOIN concern_subcategories cs ON cs.id = r.sub_id
      WHERE cs.shop_id = p_shop_id          -- ← FK target must be in caller's tenant
   )
   SELECT
     (SELECT count(*) FROM referenced),
     (SELECT count(*) FROM resolved)
     INTO v_referenced_count, v_resolved_count;

   IF v_resolved_count < v_referenced_count THEN
     RAISE EXCEPTION 'revert_blocked: fk_target_tenant_mismatch: snapshot references % distinct subcategory_id values but only % resolve in shop % (likely tampered snapshot or stale references); manual recovery required',
       v_referenced_count, v_resolved_count, p_shop_id
       USING ERRCODE = '42501';
   END IF;
   ```

   Apply this pattern BEFORE the UPSERT that references the FK column. If the snapshot has multiple FK columns, validate each.

   **Why not rely on Invariant 5's row-count detection?** Invariant 5 catches `id`-level cross-shop hijack at write time. Invariant 6 catches FK-target-level cross-shop reference BEFORE the write runs at all. They protect against different attack shapes: Invariant 5 prevents the handler from mutating someone else's row; Invariant 6 prevents the handler from writing a NEW row in our shop that incorrectly REFERENCES someone else's parent. Both are necessary; neither replaces the other.

   **Which handlers need Invariant 6.** Any handler whose snapshot rows carry a foreign-key column: the per-category handler (`questions_before.subcategory_id` → `concern_subcategories.id`), the concern_questions_flat handler (if it carries subcategory_id), the closed_dates handler if its rows reference any other table (today: no FKs, so Invariant 6 is a no-op for it). Each handler's owning per-stage agent (Agent D for per-category) implements the pattern; this Invariant DOCUMENTS it.

7. **Universal handler return shape contract (NEW v0.4 per X-FIX-AGENT-C — closes BOTH-flagged BLOCKER X-RETURN-SHAPE "§8.2 declares every handler as RETURNS TABLE(restored INT, deactivated INT, deleted INT) but §8.5 says closed_dates carries skipped_past_dates" + GPT IMPORTANT X-CLOSED-DATES-METADATA "handler-specific metadata needs a typed return contract").**

   Every handler returns `(restored INT, deactivated INT, deleted INT, details JSONB)`. The 4th column is the typed metadata carrier the v0.3 plan was missing — without it, §8.5's `diff_summary.skipped_past_dates` had no path from handler to audit row (the local `v_skipped_past_dates` PL/pgSQL variable inside the v0.3 closed_dates handler was unreachable from the caller).

   **Why a uniform 4-column shape across all 10 handlers** (not a per-kind composite type or a separate normalizer):
   - The §4.4 dispatch CASE block invokes every handler via `SELECT * INTO v_stats FROM <handler>(...)`. A uniform return shape lets that CASE stay symmetric (no per-kind type coercion, no per-kind variable shape). Agent A's X3 absorption note explicitly designed for this.
   - 9 of 10 handlers return `'{}'::JSONB` for `details` — zero-cost no-op. Only `revert_closed_dates_future` populates it today (with `skipped_past_dates_restore` + `skipped_past_dates_delete` per X10).
   - Forward-compatible: future handlers can surface their own metadata (FK-resolution hints, dropped-row notices, partial-completion flags, integrity-warning lists) without a signature change cascade across the dispatch CASE, the inner RPC's audit-row INSERT, and every existing handler.
   - The inner RPC's step-10 audit-row INSERT merges `v_stats.details` into `diff_summary` via JSONB concat: `jsonb_build_object(...) || COALESCE(v_stats.details, '{}'::JSONB)` (see §4.4). Operators querying the audit log see handler-specific metadata under `audit_log.diff_summary.<handler-key>` alongside the standard `restored`/`deactivated`/`deleted` counts.

   **What goes in `details` vs. the attempt-table `metadata` column.** Per X-FIX-AGENT-F, the new `scheduler_admin_revert_attempts` table has its own `metadata JSONB NULL` column for attempt-row-scoped data (e.g., outcome-classification trace, latency breakdowns, retry-counter state). These two surfaces are SEPARATE — do not conflate. Handler `details` flows into the AUDIT-ROW's `diff_summary` (operator-visible record of WHAT the revert did to the data). Attempt-row `metadata` is for outer-RPC observability (operator-visible record of HOW the revert attempt was processed). The inner RPC NEVER writes to the attempt table's `metadata` column directly.

   **No backwards-compatibility concern.** The 3-column shape from v0.3 was never deployed; v0.4 is the first revert-extension release.

**Per-category handler (`revert_concern_category_upload`) — REWRITTEN v0.4 per X-FIX-AGENT-D for X11 (miscount accumulators) + X12 lock-vs-conflict alignment + force-active bug + Invariants 1/5/6 application + FK-broken diagnostic enrichment:**

The per-category snapshot shape per DC-4 v0.2 / §5.2 is:
```json
{
  "snapshot_kind": "concern_questions_per_category",
  "category": "<category_slug>",
  "subcategories_before": { "<subcategory_id>": <row>, ... },
  "questions_before": { "<question_id>": <row>, ... },
  "added_subcategory_ids": [<subcategory_id>, ...],
  "added_question_ids": [<question_id>, ...],
  "expected_after_state_canonical": "...",
  "after_hash": "..."
}
```

This is NOT the generic `before` / `added_keys` shape. The handler explicitly reads these 5 fields.

**Bugs the v0.3 sketch carried (all fixed in the v0.4 SQL below):**

1. **X11 — `v_restored` MISCOUNT (BOTH-flagged BLOCKER).** v0.3 captured `ROW_COUNT` after the subcategory UPSERT into `v_restored` and then never added the questions UPSERT's row count. Returned count was subcategory-only despite the comment claiming "v_restored accumulates both tables."
2. **X11 — `v_deactivated` MISCOUNT (BOTH-flagged BLOCKER).** Symmetric bug: `v_deactivated` captured after the subcategory soft-delete and never added the questions soft-delete count.
3. **Force-active bug (BOTH-flagged BLOCKER).** Both UPSERTs forced `active = TRUE` regardless of the snapshot's stored `active` value. Universal Invariant 1 requires `active = EXCLUDED.active` so rows that were inactive at upload time stay inactive when restored.
4. **X12 — lock predicate vs. conflict-target mismatch (GPT BLOCKER).** v0.3 locked rows by `shop_id + category + id` but the UPSERT conflicted on `id` only (PK), so a same-id row in another shop/category was NOT pre-locked and the eventual `ON CONFLICT` could still race against (or hijack) it. v0.4 narrows the lock predicate to `shop_id + id` per Invariant 2's v0.4 rule (`shop_id = p_shop_id AND id = ANY(<keys>)`) AND adds the cross-shop hijack defense via Invariant 1's RIGHT pattern + Invariant 5's row-count check on each UPSERT.
5. **FK-broken diagnostic too vague (GPT IMPORTANT).** v0.3 RAISEd `revert_blocked: cannot restore concern_category=% — FK violation` without `table.id`, FK column, or missing target value. Invariant 4 + §8.7 promise messages like `cannot restore <table>.id=<id> because <fk_col>=<value> no longer exists`. v0.4 adds Invariant 6's pre-validation pass: BEFORE the questions UPSERT, every distinct `subcategory_id` in `questions_before` is checked to resolve to an in-shop, in-category subcategory (either already present in DB or about to be restored from `subcategories_before` keys). The first failing question is surfaced with the specific id + FK column + missing value.
6. **Column-name drift in v0.3 sketch.** v0.3 referenced `subcategory_name` and other columns that don't exist in the live schema. v0.4 uses the actual columns from the migrations: `concern_subcategories(id, shop_id, category, slug, display_label, display_order, active, description, positive_examples, negative_examples, synonyms, created_at, updated_at, updated_by_oauth_client_id, updated_by_name)` per migrations `20260514100000_scheduler_concern_subcategories_and_keywords.sql` + `20260521120000_scheduler_three_stage_classifier.sql`; `concern_questions(id, shop_id, category, subcategory_id, question_text, options, display_order, active, multi_select, required_facts, created_at, updated_at, updated_by_oauth_client_id, updated_by_name)`. PK type is `BIGSERIAL` (BIGINT) for BOTH tables — NOT `UUID`. Tenant-scoped unique keys: `concern_subcategories(shop_id, category, slug)` and `concern_questions(shop_id, subcategory_id, question_text)`.

**Why use the global `id` (PK) as the conflict target instead of the tenant-scoped unique key.** The snapshot carries the original `id` from upload time. Restoring with the original `id` preserves the FK relationship `concern_questions.subcategory_id → concern_subcategories.id` — questions previously created against subcategory id=42 must be restorable against the same id=42 after revert. Using `(shop_id, category, slug)` as conflict target would force the restored subcategory to take a NEW BIGSERIAL id on INSERT, orphaning every question that referenced the old id. So `(id)` is the load-bearing conflict target; the `WHERE target.shop_id = p_shop_id AND target.category = v_category` DO UPDATE filter + row-count check carry the hijack defense per Invariant 1's RIGHT pattern + Invariant 5.

```sql
CREATE OR REPLACE FUNCTION public.revert_concern_category_upload(
  p_shop_id INTEGER, p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_category               TEXT  := p_snapshot->>'category';
  v_subs_before            JSONB := COALESCE(p_snapshot->'subcategories_before', '{}'::JSONB);
  v_qs_before              JSONB := COALESCE(p_snapshot->'questions_before',     '{}'::JSONB);
  v_added_subs             JSONB := COALESCE(p_snapshot->'added_subcategory_ids', '[]'::JSONB);
  v_added_qs               JSONB := COALESCE(p_snapshot->'added_question_ids',    '[]'::JSONB);
  v_subs_before_count      INT;
  v_qs_before_count        INT;
  v_actual_writes          INT;
  v_restored               INT := 0;
  v_deactivated            INT := 0;
  v_fk_referenced_count    INT;
  v_fk_resolved_count      INT;
  v_first_bad_question_id  BIGINT;
  v_first_bad_subcat_id    BIGINT;
BEGIN
  ----------------------------------------------------------------------
  -- 0a. Snapshot-shape validation (X-FIX-#16 — 2026-05-26 — closes GPT
  --     chunk 3 IMPORTANT "Per-category SQL relies on unvalidated v_category").
  --     v_category is used in INSERTs, UPDATE filters, and FK validation;
  --     a NULL or empty value would surface later as a NOT NULL violation
  --     or a zero-row UPSERT (silently) — neither maps cleanly to a
  --     revert_blocked: enum. Reject loudly here so the outer's classifier
  --     sees the canonical snapshot_invalid reason_code per §3b enum.
  ----------------------------------------------------------------------
  IF v_category IS NULL OR length(trim(v_category)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: per-category handler requires snapshot.category (got NULL or empty); snapshot is corrupted or written by a pre-v0.5 uploader';
  END IF;

  ----------------------------------------------------------------------
  -- 0b. Pre-flight: snapshot row counts (used by Invariant 5 row-count
  --     checks below). Counted upfront so we don't re-walk the JSONB
  --     multiple times.
  ----------------------------------------------------------------------
  SELECT count(*) INTO v_subs_before_count FROM jsonb_object_keys(v_subs_before);
  SELECT count(*) INTO v_qs_before_count   FROM jsonb_object_keys(v_qs_before);

  ----------------------------------------------------------------------
  -- 1. Defense-in-depth row locks (load-bearing lock is the inner
  --    RPC's lock_targets_for_kind helper per §8.2 Invariant 2 v0.4 —
  --    this PERFORM is belt-and-suspenders for handler-isolation
  --    readability + future refactor safety).
  --
  --    X12 fix: lock predicate is `shop_id = p_shop_id AND id = ANY(<keys>)`
  --    per §8.2 Invariant 2 v0.4 ("lock predicate is exactly
  --    shop_id = p_shop_id AND id = ANY(<keys>)"). The category filter is
  --    intentionally OMITTED here: if the snapshot carries an id that
  --    drifted to another category within the same shop (rare but possible
  --    if catalog rebuild migrations have re-assigned category), the lock
  --    still acquires that row and the DO UPDATE WHERE clause's
  --    `category = v_category` filter in steps 2 + 4 still SKIPS it from
  --    UPSERT. Including the category filter in the lock predicate would
  --    leave such a cross-category row unlocked, re-opening the TOCTOU
  --    window that the lock_targets_for_kind helper exists to close.
  ----------------------------------------------------------------------
  PERFORM 1 FROM public.concern_subcategories
    WHERE shop_id = p_shop_id
      AND id = ANY (
        ARRAY(SELECT (key)::BIGINT FROM jsonb_object_keys(v_subs_before) AS key)
        || ARRAY(SELECT (val)::BIGINT FROM jsonb_array_elements_text(v_added_subs) AS val)
      )
    FOR UPDATE;
  PERFORM 1 FROM public.concern_questions
    WHERE shop_id = p_shop_id
      AND id = ANY (
        ARRAY(SELECT (key)::BIGINT FROM jsonb_object_keys(v_qs_before) AS key)
        || ARRAY(SELECT (val)::BIGINT FROM jsonb_array_elements_text(v_added_qs) AS val)
      )
    FOR UPDATE;

  ----------------------------------------------------------------------
  -- 2. UPSERT subcategories_before — Invariant 1 RIGHT pattern + Invariant 5 row-count check.
  --
  --    Force `shop_id = p_shop_id` + `category = v_category` in the
  --    INSERT clause (new rows always land in caller's tenant + caller's
  --    category). Add `WHERE target.shop_id = p_shop_id AND target.category = v_category`
  --    to DO UPDATE so cross-shop OR cross-category conflict targets
  --    are SKIPPED (not hijacked). Detect the skip via row-count
  --    comparison after the write. Use `active = EXCLUDED.active`
  --    (NOT force TRUE — closes the force-active bug).
  ----------------------------------------------------------------------
  WITH attempted AS (
    INSERT INTO public.concern_subcategories (
      id, shop_id, category, slug, display_label, display_order, active,
      description, positive_examples, negative_examples, synonyms,
      created_at, updated_at, updated_by_oauth_client_id, updated_by_name
      -- ... full row column list from the snapshot's row shape; trailing
      -- ... columns omitted for brevity but MUST be enumerated by the
      -- ... builder agent. The snapshot row carries every NOT NULL column.
    )
    SELECT
      (key)::BIGINT,
      p_shop_id,
      v_category,
      rec->>'slug',
      rec->>'display_label',
      (rec->>'display_order')::INTEGER,
      (rec->>'active')::BOOLEAN,
      rec->>'description',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(rec->'positive_examples', '[]'::JSONB))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(rec->'negative_examples', '[]'::JSONB))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(rec->'synonyms',          '[]'::JSONB))),
      (rec->>'created_at')::TIMESTAMPTZ,
      now(),                                  -- updated_at always set to now() on restore
      rec->>'updated_by_oauth_client_id',
      rec->>'updated_by_name'
      FROM jsonb_each(v_subs_before) AS s(key, rec)
    ON CONFLICT (id) DO UPDATE SET
      slug                       = EXCLUDED.slug,
      display_label              = EXCLUDED.display_label,
      display_order              = EXCLUDED.display_order,
      active                     = EXCLUDED.active,
      description                = EXCLUDED.description,
      positive_examples          = EXCLUDED.positive_examples,
      negative_examples          = EXCLUDED.negative_examples,
      synonyms                   = EXCLUDED.synonyms,
      updated_at                 = now(),
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
      WHERE concern_subcategories.shop_id = p_shop_id          -- Invariant 1: skip cross-shop targets
        AND concern_subcategories.category = v_category        -- AND skip cross-category targets
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  -- Invariant 5: cross-shop hijack detection.
  IF v_actual_writes < v_subs_before_count THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt on concern_subcategories: snapshot carries % rows but only % were writable in shop=% category=%',
      v_subs_before_count, v_actual_writes, p_shop_id, v_category
      USING ERRCODE = '42501';
  END IF;

  -- X11 fix: ACCUMULATE (was: overwrite). v_restored sums across both
  -- table UPSERTs so the returned count reflects total rows restored.
  v_restored := v_restored + v_actual_writes;

  ----------------------------------------------------------------------
  -- 3. Invariant 6 — FK target tenant validation BEFORE UPSERTing questions.
  --
  --    Postgres FK enforces EXISTENCE of the referenced row but not
  --    TENANT-correctness. A tampered snapshot could carry a
  --    `subcategory_id` pointing at another shop's subcategory; the FK
  --    constraint would be satisfied but the resulting question would
  --    reference an out-of-tenant parent.
  --
  --    Valid FK targets for the questions UPSERT are subcategories that
  --    EITHER (a) already exist in DB under `(shop_id=p_shop_id,
  --    category=v_category)`, OR (b) are about to be restored by step 2
  --    above (their ids are the keys of v_subs_before).
  --
  --    NOTE: step 2 already ran so set (b)'s rows are in-DB at this
  --    point, but we still UNION the snapshot keys defensively (covers
  --    the rare case where step 2's UPSERT skipped a row due to the
  --    Invariant 5 hijack defense — those would now be missing from DB
  --    AND would be needed as FK targets by step 4; raising on the
  --    missing FK target here surfaces the issue with the specific
  --    question_id pre-write rather than as a generic 23503 mid-write).
  ----------------------------------------------------------------------
  WITH referenced AS (
    SELECT
      (q_key)::BIGINT AS question_id,
      (rec->>'subcategory_id')::BIGINT AS sub_id
      FROM jsonb_each(v_qs_before) AS s(q_key, rec)
     WHERE rec->>'subcategory_id' IS NOT NULL
  ),
  resolved AS (
    SELECT DISTINCT r.sub_id
      FROM referenced r
      JOIN public.concern_subcategories cs
        ON cs.id = r.sub_id
       AND cs.shop_id = p_shop_id
       AND cs.category = v_category
    UNION
    SELECT (key)::BIGINT AS sub_id
      FROM jsonb_object_keys(v_subs_before) AS key
  ),
  bad_questions AS (
    SELECT r.question_id, r.sub_id
      FROM referenced r
      LEFT JOIN resolved x ON x.sub_id = r.sub_id
     WHERE x.sub_id IS NULL
     ORDER BY r.question_id
     LIMIT 1
  )
  SELECT
    (SELECT count(DISTINCT sub_id) FROM referenced),
    (SELECT count(DISTINCT sub_id) FROM (
        SELECT sub_id FROM referenced INTERSECT SELECT sub_id FROM resolved
     ) ok),
    (SELECT question_id FROM bad_questions),
    (SELECT sub_id      FROM bad_questions)
    INTO v_fk_referenced_count, v_fk_resolved_count,
         v_first_bad_question_id, v_first_bad_subcat_id;

  IF v_fk_resolved_count < v_fk_referenced_count THEN
    -- Surfaces the specific failing question_id + the missing subcategory_id
    -- + the tenant scope. Matches Invariant 4 + §8.7 format.
    RAISE EXCEPTION 'revert_blocked: fk_broken: cannot restore concern_questions.id=% because subcategory_id=% not in shop=% category=% (likely tampered snapshot or deleted-via-direct-DB ancestor); manual recovery required',
      v_first_bad_question_id, v_first_bad_subcat_id, p_shop_id, v_category
      USING ERRCODE = '23503';   -- foreign_key_violation, for outer's classifier
  END IF;

  ----------------------------------------------------------------------
  -- 4. UPSERT questions_before — Invariant 1 RIGHT pattern + Invariant 5 row-count check.
  --    Same shape as step 2 but for concern_questions. `active = EXCLUDED.active`.
  ----------------------------------------------------------------------
  WITH attempted AS (
    INSERT INTO public.concern_questions (
      id, shop_id, category, subcategory_id, question_text, options,
      display_order, active, multi_select, required_facts,
      created_at, updated_at, updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      (key)::BIGINT,
      p_shop_id,
      v_category,
      (rec->>'subcategory_id')::BIGINT,
      rec->>'question_text',
      rec->'options',
      (rec->>'display_order')::INTEGER,
      (rec->>'active')::BOOLEAN,
      COALESCE((rec->>'multi_select')::BOOLEAN, FALSE),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(rec->'required_facts', '[]'::JSONB))),
      (rec->>'created_at')::TIMESTAMPTZ,
      now(),
      rec->>'updated_by_oauth_client_id',
      rec->>'updated_by_name'
      FROM jsonb_each(v_qs_before) AS s(key, rec)
    ON CONFLICT (id) DO UPDATE SET
      subcategory_id             = EXCLUDED.subcategory_id,
      question_text              = EXCLUDED.question_text,
      options                    = EXCLUDED.options,
      display_order              = EXCLUDED.display_order,
      active                     = EXCLUDED.active,
      multi_select               = EXCLUDED.multi_select,
      required_facts             = EXCLUDED.required_facts,
      updated_at                 = now(),
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
      WHERE concern_questions.shop_id = p_shop_id          -- Invariant 1: skip cross-shop targets
        AND concern_questions.category = v_category        -- AND skip cross-category targets
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_qs_before_count THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt on concern_questions: snapshot carries % rows but only % were writable in shop=% category=%',
      v_qs_before_count, v_actual_writes, p_shop_id, v_category
      USING ERRCODE = '42501';
  END IF;

  -- X11 fix: ACCUMULATE (was: skip).
  v_restored := v_restored + v_actual_writes;

  ----------------------------------------------------------------------
  -- 5. Soft-delete added subcategories.
  --
  --    WHERE shop_id = p_shop_id AND category = v_category is the
  --    structural cross-shop defense — Postgres cannot match a foreign
  --    tenant's row through this predicate, so no Invariant 5 row-count
  --    check is needed here (the predicate IS the gate). If the snapshot's
  --    added_subcategory_ids carries an id that lives in another shop,
  --    the UPDATE simply matches zero rows for that id — no hijack possible.
  ----------------------------------------------------------------------
  UPDATE public.concern_subcategories
     SET active = FALSE,
         updated_at = now()
   WHERE shop_id = p_shop_id
     AND category = v_category
     AND id = ANY (
       ARRAY(SELECT (val)::BIGINT FROM jsonb_array_elements_text(v_added_subs) AS val)
     );
  GET DIAGNOSTICS v_actual_writes = ROW_COUNT;

  -- X11 fix: ACCUMULATE (was: overwrite).
  v_deactivated := v_deactivated + v_actual_writes;

  ----------------------------------------------------------------------
  -- 6. Soft-delete added questions. Same shape as step 5.
  ----------------------------------------------------------------------
  UPDATE public.concern_questions
     SET active = FALSE,
         updated_at = now()
   WHERE shop_id = p_shop_id
     AND category = v_category
     AND id = ANY (
       ARRAY(SELECT (val)::BIGINT FROM jsonb_array_elements_text(v_added_qs) AS val)
     );
  GET DIAGNOSTICS v_actual_writes = ROW_COUNT;

  -- X11 fix: ACCUMULATE (was: skip).
  v_deactivated := v_deactivated + v_actual_writes;

  ----------------------------------------------------------------------
  -- 7. Return per universal 4-column shape. `details` is empty for this
  --    handler — the Invariant 6 FK-broken case never reaches here
  --    (RAISE in step 3 rolls back the whole inner subtransaction so no
  --    audit row gets written; operator sees the rejection in the
  --    attempt table's reason_code + error_detail per §8.7).
  ----------------------------------------------------------------------
  RETURN QUERY SELECT v_restored, v_deactivated, 0::INT AS deleted, '{}'::JSONB AS details;

  -- Intentional: no `EXCEPTION WHEN foreign_key_violation` catch-all.
  -- Invariant 6's pre-validation in step 3 surfaces the specific failing
  -- (question_id, subcategory_id) pair BEFORE the questions UPSERT runs;
  -- a 23503 escaping step 4 would only happen if a concurrent editor
  -- deleted a subcategory between step 3's validation and step 4's UPSERT
  -- (extremely unlikely under the inner RPC's row locks but theoretically
  -- possible if a future code path bypasses the lock helper). In that
  -- edge case we WANT the raw 23503 to propagate — outer's classifier
  -- maps `foreign_key_violation` outside the `revert_blocked:` prefix
  -- to `outcome='crashed'` so the rare race surfaces as an investigation
  -- signal rather than being silently rewritten to a generic `revert_blocked`
  -- string that loses the original SQLSTATE diagnostic.
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top — applies to every
-- SECURITY DEFINER function in this feature).
REVOKE EXECUTE ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) TO service_role;
```

**closed_dates handler (`revert_closed_dates_future`) — REWRITTEN v0.4 per C-I6 + X9 + X10 + universal-4-column-return:**

The blanket rule "tables without soft-delete: DELETE WHERE PK matches added_keys" is WRONG for closed_dates. Per CV-I8, the snapshot carries `original_today` (computed in shop TZ at apply time). If an added future closure has DRIFTED into the past by revert time, blindly deleting it would violate the "past closures are immutable history" invariant. Per X10 (4th-round BOTH-flagged BLOCKER), the same immutability invariant applies to RESTORES: a `before[*]` row whose key has drifted into the past since the upload must NOT be UPSERTed either — restoring a past closure mutates history just as deleting one does. The v0.4 handler applies the `>= v_current_today` filter to BOTH directions and records the skipped dates in both buckets.

The v0.3 SQL sketch was also BROKEN in three concrete ways (X9 BOTH-flagged BLOCKER, fixed below):
1. `v_deleted` was never populated — the `deletion` CTE used `RETURNING 1` but the main body never read its count, so the handler always reported `deleted=0` even when rows were actually deleted.
2. `SELECT count(*)::INT, ARRAY_AGG(closed_date::TEXT) … INTO v_skipped_past_dates` selected TWO columns into a SINGLE `TEXT[]` variable — Postgres raises a runtime "too many columns" error on every drift-into-past date.
3. The `skipped` CTE was declared but never referenced; a separate `SELECT … FROM (… WHERE (val)::DATE < v_current_today) s` re-implemented the same logic from scratch — drift hazard between the two copies.

v0.4 fixes all three by reading each DELETE / UPSERT CTE's count via a top-level `SELECT count(*)::INT INTO v_deleted FROM deletion_run` (which forces the modifying CTE to execute), splitting the skipped-collection into two single-column SELECTs, COALESCEing `array_agg` so empty inputs return `ARRAY[]::TEXT[]` instead of `NULL`, and dropping the unused `skipped` CTE entirely. The handler also adopts the universal 4-column return shape — `(restored INT, deactivated INT, deleted INT, details JSONB)` — and surfaces both skipped buckets via `details->'skipped_past_dates_restore'` + `details->'skipped_past_dates_delete'`. The inner RPC's step-10 audit-row INSERT merges `v_stats.details` into `diff_summary` via JSONB concat so operators see which dates were skipped in either direction.

```sql
CREATE OR REPLACE FUNCTION public.revert_closed_dates_future(
  p_shop_id INTEGER, p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_before JSONB := p_snapshot->'before';
  v_added JSONB := p_snapshot->'added_keys';
  -- IMPORTANT: current_today computed Postgres-side in the shop's TZ, NOT TS-side, NOT UTC.
  -- TS-side computation would drift across the round-trip; UTC would freeze the wrong dates near midnight.
  v_current_today DATE := (now() AT TIME ZONE public.shop_timezone(p_shop_id))::DATE;
  v_restored INT := 0;
  v_deleted INT := 0;
  v_skipped_restore TEXT[] := ARRAY[]::TEXT[];
  v_skipped_delete  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 1. Lock target rows (defense-in-depth per Invariant 2 — the load-bearing
  --    lock is the inner RPC's step-4 lock_targets_for_kind helper).
  PERFORM 1 FROM closed_dates
    WHERE shop_id = p_shop_id
      AND closed_date = ANY (
        ARRAY(SELECT (key)::DATE FROM jsonb_object_keys(v_before) AS key)
        || ARRAY(SELECT (val)::DATE FROM jsonb_array_elements_text(v_added) AS val)
      )
    FOR UPDATE;

  -- 2. UPSERT closures from `before`, but ONLY for keys that are STILL >= current_today.
  --    X10 (BOTH-flagged BLOCKER): past closures are immutable history; revert may NOT
  --    restore a past date any more than it may delete one. The conflict target is the
  --    tenant-scoped unique key (shop_id, closed_date) so cross-shop hijack is
  --    STRUCTURALLY IMPOSSIBLE (Invariant 1 preferred-alternative pattern).
  -- X-FIX-5 (2026-05-26 — fixes GPT chunk 3 BLOCKER "literal ... placeholders
  -- in handler SQL won't compile"). closed_dates schema per
  -- supabase/migrations/20260510131752_scheduler_phase1_schema.sql:191-200
  -- is a 6-column table: id, shop_id, closed_date, reason, source, created_at.
  -- Restore preserves the snapshot's id (for traceability — closed_dates has
  -- no inbound FKs but other operator tools may reference by id). ON CONFLICT
  -- DO UPDATE SET touches ONLY the mutable cols (reason, source) — never
  -- id/shop_id/closed_date/created_at (those would either be the conflict
  -- target itself, or set-once metadata).
  WITH restore_run AS (
    INSERT INTO closed_dates (id, shop_id, closed_date, reason, source, created_at)
    SELECT
      (rec->>'id')::UUID,
      p_shop_id,
      (key)::DATE,
      rec->>'reason',
      COALESCE(rec->>'source', 'admin'),   -- DEFAULT 'admin' per schema CHECK
      (rec->>'created_at')::TIMESTAMPTZ
      FROM jsonb_each(v_before) AS s(key, rec)
     WHERE (key)::DATE >= v_current_today
    ON CONFLICT (shop_id, closed_date) DO UPDATE SET
      reason = EXCLUDED.reason,
      source = EXCLUDED.source
      WHERE closed_dates.shop_id = p_shop_id           -- Invariant 1 belt-and-suspenders
    RETURNING 1
  )
  SELECT count(*)::INT INTO v_restored FROM restore_run;

  -- X-FIX-#16 (2026-05-26) — Invariant 5 row-count check, scoped to FUTURE-eligible
  -- `before` keys (past dates are intentionally skipped per X10 and counted in
  -- v_skipped_restore below; they're NOT a hijack signal). Closes GPT chunk 3
  -- IMPORTANT "Closed-dates handler omits the Invariant 5 row-count check
  -- promised for tenant-scoped conflict targets". Even though the conflict
  -- target (shop_id, closed_date) makes cross-shop hijack STRUCTURALLY
  -- IMPOSSIBLE per Invariant 1, the row-count comparison surfaces OTHER
  -- anomalies — corrupted snapshot, race conditions, advisory-lock failure —
  -- by failing loud if v_restored < expected_future_count.
  DECLARE
    v_expected_future_count INT;
  BEGIN
    SELECT count(*)::INT INTO v_expected_future_count
      FROM jsonb_each(v_before) AS s(key, rec)
      WHERE (key)::DATE >= v_current_today;
    IF v_restored < v_expected_future_count THEN
      RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: closed_dates snapshot carries % future-eligible rows but only % were writable in shop % (likely advisory-lock collision OR cross-shop conflict-target skip)',
        v_expected_future_count, v_restored, p_shop_id
        USING ERRCODE = '42501';
    END IF;
  END;

  -- 3. Collect skipped restore dates (those that drifted into past since upload).
  --    COALESCE so an empty input returns ARRAY[]::TEXT[] not NULL (X9 fix).
  --    ORDER BY for stable diff_summary output.
  SELECT COALESCE(array_agg((key)::TEXT ORDER BY (key)::DATE), ARRAY[]::TEXT[])
    INTO v_skipped_restore
    FROM jsonb_object_keys(v_before) AS key
   WHERE (key)::DATE < v_current_today;

  -- 4. Hard-DELETE added_keys, but ONLY for dates that are STILL >= current_today.
  --    Drift-into-past dates are skipped + recorded (per X10, restoring the original
  --    closure is also forbidden — see step 2). X9 fix: pull v_deleted from a top-level
  --    SELECT count(*) FROM the modifying CTE so the DELETE actually executes AND we
  --    capture its row count instead of mis-reading from a different CTE.
  WITH delete_run AS (
    DELETE FROM closed_dates
     WHERE shop_id = p_shop_id
       AND closed_date = ANY (
         SELECT (val)::DATE
           FROM jsonb_array_elements_text(v_added) AS val
          WHERE (val)::DATE >= v_current_today
       )
    RETURNING 1
  )
  SELECT count(*)::INT INTO v_deleted FROM delete_run;

  -- 5. Collect skipped delete dates (those that drifted into past since upload).
  SELECT COALESCE(array_agg(val::TEXT ORDER BY val::DATE), ARRAY[]::TEXT[])
    INTO v_skipped_delete
    FROM jsonb_array_elements_text(v_added) AS val
   WHERE val::DATE < v_current_today;

  -- 6. Return with both skipped lists in details JSONB. The inner RPC's step-10
  --    audit-row INSERT merges v_stats.details into diff_summary via JSONB concat,
  --    so operators see skipped_past_dates_restore + skipped_past_dates_delete in
  --    diff_summary. No RAISE — partial-completion is correct semantics here.
  RETURN QUERY SELECT
    v_restored,
    0::INT AS deactivated,        -- closed_dates has no soft-delete column
    v_deleted,
    jsonb_build_object(
      'skipped_past_dates_restore', to_jsonb(v_skipped_restore),
      'skipped_past_dates_delete',  to_jsonb(v_skipped_delete)
    );
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top + §8.4 Layer 2).
-- X-FIX-4 (2026-05-26 — fixes GPT chunk 3 BLOCKER "revert_closed_dates_future
-- is SECURITY DEFINER but lacks the REVOKE/GRANT block"). Without this triple,
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default — a direct
-- RPC caller could invoke this handler outside the protected outer/inner
-- revert path and mutate closed_dates for any p_shop_id.
REVOKE EXECUTE ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) TO service_role;
```

The skipped-past-dates lists propagate into the inner's audit-row `diff_summary` via the universal `details JSONB` return column. See §8.5 for the audit-row INSERT's JSONB-concat semantics.

### 8.3 `resolve_snapshot_kind` fallback (per CV-B3) + `lock_targets_for_kind` helper + `expected_after_state_canonical` lifecycle + staleness diff format (REWRITTEN v0.4 per A-B11 + X-FIX-AGENT-E)

**Snapshot_kind fallback** — the inner apply RPC has a CASE statement on `snapshot_kind`. For pre-2026-05-26 snapshots that don't carry the field, the fallback in plpgsql:

```sql
CASE
  WHEN p_snapshot->>'snapshot_kind' IS NOT NULL
    THEN p_snapshot->>'snapshot_kind'
  WHEN p_table_name = 'testing_services'
    THEN 'testing_services_v2'
  WHEN p_table_name = 'routine_services'
    THEN 'routine_services_v2'
  ELSE NULL   -- → eligibility rejects with table_not_supported
END
```

**`lock_targets_for_kind` helper (X-FIX-AGENT-E, closes X13 lost-update window).**

The inner RPC's step 4 (per §4.4 + §8.1) calls one helper to acquire all target-row locks for the snapshot's `snapshot_kind` BEFORE computing the current-state canonical. This closes the v0.3 TOCTOU where the handler acquired its own locks AFTER staleness had already been validated against an unlocked snapshot. The helper's per-kind lock predicates:

| snapshot_kind | Lock predicate (rows to lock under `shop_id = p_shop_id`) |
|---|---|
| `testing_services_v2` | `SELECT 1 FROM testing_services WHERE shop_id = p_shop_id AND id IN (snapshot.before keys ∪ snapshot.added_keys) FOR UPDATE` |
| `routine_services_v2` | same — `routine_services` |
| `concern_subcategories_descriptions_v2` | `concern_subcategories` rows whose ids appear in `snapshot.before` keys (UPSERT-only — no added_keys) |
| `concern_subcategories_map_v2` | same |
| `concern_questions_required_facts_v2` | `concern_questions` rows whose ids appear in `snapshot.before` keys |
| `concern_questions_flat` | `concern_questions` rows whose ids appear in `snapshot.before` keys ∪ `snapshot.added_keys` |
| `concern_questions_per_category` | BOTH `concern_subcategories` AND `concern_questions` rows (per-category — coordinate with Agent D's per-category handler shape). Locks both subcategory ids + question ids in the snapshot's `subcategories_before` / `added_subcategory_ids` / `questions_before` / `added_question_ids`. |
| `concern_category_guidelines` | `concern_category_guidelines` rows whose `category` ∈ `snapshot.before` keys ∪ `snapshot.added_keys` (table has composite PK `(shop_id, category)` — NO `id` column; this kind is the one exception to id-keyed snapshots because §5.3 shape keys by category slug). v0.5 X-FIX-#6+#7 (2026-05-26) — covers both UPSERT-back-from-`before` rows and hard-DELETE-of-`added_keys` rows. |
| `appointment_default_limits` | `appointment_default_limits` rows whose `id` ∈ `snapshot.before` keys ∪ `snapshot.added_keys` (UUID PK). v0.5 X-FIX-#6 (2026-05-26) — `added_keys` added to lock predicate to close X13 TOCTOU on the hard-DELETE-of-`added_keys` path (this is one of the two hard-DELETE tables alongside concern_category_guidelines). |
| `closed_dates_future` | **`pg_advisory_xact_lock(p_shop_id::INT, hashtext(closed_date::TEXT))` for EVERY date in `snapshot.before` keys ∪ `snapshot.added_keys`** (X-FIX-#24 — 2026-05-26 — 2-arg 64-bit-key canonical form; matches §5.5 advisory-lock pattern). Locks acquired in sorted-date order to avoid deadlocks against another `apply_closed_dates_upload`. |

Helper signature + canonical security setup:

```sql
CREATE OR REPLACE FUNCTION public.lock_targets_for_kind(
  p_kind TEXT,
  p_shop_id INTEGER,
  p_snapshot JSONB
)
RETURNS INTEGER       -- rowcount of acquired locks (for v_stats / debugging)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_lock_count INTEGER := 0;
  v_ids UUID[];               -- for tables with UUID PKs (appointment_default_limits,
                              -- concern_category_guidelines)
  v_int_ids BIGINT[];         -- for tables with integer PKs of any width — INTEGER
                              -- (testing_services / routine_services) and BIGSERIAL
                              -- (concern_subcategories / concern_questions). BIGINT
                              -- widens both losslessly so a single typed array works
                              -- for both cases. v0.5 X-FIX-AGENT-G — was INTEGER[]
                              -- prior, which silently overflowed BIGSERIAL ids past
                              -- 2^31. Branch-level casts are BIGINT for BIGSERIAL
                              -- tables and INTEGER for INTEGER tables.
  v_dates DATE[];
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'p_shop_id required and must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'p_snapshot required' USING ERRCODE = '22023';
  END IF;

  CASE p_kind
    WHEN 'testing_services_v2' THEN
      v_int_ids := ARRAY(
        SELECT (key)::INTEGER FROM jsonb_object_keys(p_snapshot->'before') AS key
        UNION
        SELECT (val)::INTEGER FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS val
      );
      PERFORM 1 FROM public.testing_services
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    WHEN 'routine_services_v2' THEN
      v_int_ids := ARRAY(
        SELECT (key)::INTEGER FROM jsonb_object_keys(p_snapshot->'before') AS key
        UNION
        SELECT (val)::INTEGER FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS val
      );
      PERFORM 1 FROM public.routine_services
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    WHEN 'concern_subcategories_descriptions_v2', 'concern_subcategories_map_v2' THEN
      -- concern_subcategories.id is BIGSERIAL (NOT UUID — corrected v0.5
      -- X-FIX-AGENT-G after Agent D flagged the schema mismatch during
      -- per-category-handler authoring).
      v_int_ids := ARRAY(SELECT (key)::BIGINT FROM jsonb_object_keys(p_snapshot->'before') AS key);
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    WHEN 'concern_questions_required_facts_v2', 'concern_questions_flat' THEN
      -- concern_questions.id is BIGSERIAL (NOT UUID — corrected v0.5
      -- X-FIX-AGENT-G after Agent D flagged the schema mismatch).
      v_int_ids := ARRAY(
        SELECT (key)::BIGINT FROM jsonb_object_keys(p_snapshot->'before') AS key
        UNION
        SELECT (val)::BIGINT FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS val
      );
      PERFORM 1 FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    WHEN 'concern_questions_per_category' THEN
      -- Both subcategories + questions; per-category snapshot keys live under
      -- subcategories_before/added_subcategory_ids + questions_before/added_question_ids.
      -- See Agent D's per-category handler shape. BOTH concern_subcategories
      -- and concern_questions use BIGSERIAL ids (NOT UUID — corrected v0.5
      -- X-FIX-AGENT-G).
      DECLARE
        v_subq_lock_count INT := 0;
        v_qq_lock_count   INT := 0;
        v_fk_lock_count   INT := 0;
      BEGIN
      v_int_ids := ARRAY(
        SELECT (key)::BIGINT FROM jsonb_object_keys(COALESCE(p_snapshot->'subcategories_before', '{}'::JSONB)) AS key
        UNION
        SELECT (val)::BIGINT FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_subcategory_ids', '[]'::JSONB)) AS val
      );
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_subq_lock_count = ROW_COUNT;

      -- X-FIX-#16 (2026-05-26) — closes GPT chunk 3 IMPORTANT "FK race claim
      -- is stronger than the locks actually taken". The per-category handler
      -- pre-validates FK targets (Invariant 6) against concern_subcategories.
      -- v0.5 only locked subcategories appearing in subcategories_before +
      -- added_subcategory_ids — but questions_before row values can reference
      -- subcategory_ids that exist in our shop but aren't in subcategories_before
      -- (e.g., an existing subcategory that the upload didn't touch). Without
      -- locking THOSE FK target subcategories, a concurrent transaction could
      -- delete them between FK pre-validation and our UPSERT, surfacing as a
      -- raw 23503 foreign_key_violation rather than a controlled
      -- fk_target_tenant_mismatch raise.
      v_int_ids := ARRAY(
        SELECT DISTINCT (rec->>'subcategory_id')::BIGINT
          FROM jsonb_each(COALESCE(p_snapshot->'questions_before', '{}'::JSONB)) AS s(key, rec)
          WHERE rec ? 'subcategory_id' AND rec->>'subcategory_id' IS NOT NULL
      );
      IF v_int_ids IS NOT NULL AND array_length(v_int_ids, 1) > 0 THEN
        -- Lock these too. Postgres re-locks idempotently — subcategories
        -- already locked by the first PERFORM above are not double-counted.
        PERFORM 1 FROM public.concern_subcategories
          WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
          FOR UPDATE;
        GET DIAGNOSTICS v_fk_lock_count = ROW_COUNT;
      END IF;

      v_int_ids := ARRAY(
        SELECT (key)::BIGINT FROM jsonb_object_keys(COALESCE(p_snapshot->'questions_before', '{}'::JSONB)) AS key
        UNION
        SELECT (val)::BIGINT FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_question_ids', '[]'::JSONB)) AS val
      );
      PERFORM 1 FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_qq_lock_count = ROW_COUNT;
      -- X-FIX-#16 (Gemini chunk 3 NICE-TO-HAVE): use GET DIAGNOSTICS instead
      -- of redundant SELECT COUNT(*) (v0.5 had an extra COUNT scan).
      v_lock_count := v_subq_lock_count + v_fk_lock_count + v_qq_lock_count;
      END;

    WHEN 'concern_category_guidelines' THEN
      -- concern_category_guidelines has composite PRIMARY KEY (shop_id, category)
      -- — there is NO `id` column on this table (verified migration
      -- 20260514000000_scheduler_concern_category_guidelines.sql; column is
      -- `category` NOT `category_slug`). This table is the ONE exception to the
      -- project's id-as-snapshot-key convention because §5.3 snapshot shape is
      -- keyed by category slug: `{before: {<category>: existing|null},
      -- added_keys: existing ? [] : [category]}`. Lock by (shop_id, category)
      -- — the table's natural composite PK matches the snapshot key surface.
      -- Lock BOTH `before` keys AND `added_keys`:
      --   • `before` keys with non-null value → rows the original apply
      --     UPDATEd; revert UPSERTs them back. SELECT FOR UPDATE locks
      --     existing rows.
      --   • `before` keys with NULL value (subset of added_keys per §5.3) +
      --     `added_keys` → rows the original apply INSERTed; revert
      --     hard-DELETEs (no soft-delete column on this table). SELECT FOR
      --     UPDATE locks them while they currently exist.
      -- Without locking added_keys, the hard-DELETE path has the X13 TOCTOU
      -- window: a concurrent editor could mutate the just-added row between
      -- the inner RPC's staleness check (step 6) and the handler's DELETE.
      -- v0.5 X-FIX-#6+#7 (2026-05-26) — was reading `p_snapshot->'before'->>'id'`
      -- which (a) accessed a non-existent `id` column and (b) misread the
      -- keyed before object as a scalar single row, plus (c) didn't lock
      -- added_keys.
      PERFORM 1 FROM public.concern_category_guidelines
        WHERE shop_id = p_shop_id
          AND category = ANY(
            ARRAY(SELECT key FROM jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS key)
            || ARRAY(SELECT val FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS val)
          )
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    WHEN 'appointment_default_limits' THEN
      -- appointment_default_limits.id IS UUID (gen_random_uuid()).
      -- Lock BOTH `before` row ids (rows the revert will UPSERT back) AND
      -- `added_keys` row ids (rows the original apply INSERTed; revert
      -- hard-DELETEs per §8.2 row — `appointment_default_limits` is one of
      -- the two hard-DELETE tables alongside concern_category_guidelines).
      -- v0.5 X-FIX-#6 (2026-05-26) — added_keys was missing from the lock
      -- predicate, leaving X13 TOCTOU open on the hard-DELETE (revert-of-
      -- INSERT) path: a concurrent editor could mutate a just-added row
      -- between the inner RPC's staleness check (step 6) and the handler's
      -- DELETE.
      v_ids := ARRAY(
        SELECT (key)::UUID FROM jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS key
        UNION
        SELECT (val)::UUID FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS val
      );
      PERFORM 1 FROM public.appointment_default_limits
        WHERE shop_id = p_shop_id AND id = ANY(v_ids)
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    WHEN 'closed_dates_future' THEN
      -- Per-date advisory locks (matches §5.5 pattern coordinated with
      -- block_appointment_capacity). Acquired in sorted-date order to avoid
      -- deadlocks against another apply_closed_dates_upload on overlapping
      -- dates.
      v_dates := ARRAY(
        SELECT (key)::DATE FROM jsonb_object_keys(p_snapshot->'before') AS key
        UNION
        SELECT (val)::DATE FROM jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS val
        ORDER BY 1
      );
      -- X-FIX-#16 (2026-05-26) — closes GPT chunk 3 IMPORTANT
      -- "pg_advisory_xact_lock(hashtext(...)) uses a 32-bit hash key".
      -- The single-arg form widens hashtext's 32-bit output to 64 bits
      -- without gaining entropy; unrelated (shop_id, date) pairs that
      -- happen to hash-collide cause unnecessary blocking. The two-arg
      -- form `pg_advisory_xact_lock(int4, int4)` uses TWO 32-bit ints
      -- (key = (shop_id, hashtext(date))) so collision requires BOTH
      -- shop_id AND date-hash to match — same tenant + same date is the
      -- exact serialization the lock targets. Same key shape is now the
      -- documented convention for any future closed_dates mutator per
      -- DEFERRED-AUDIT-ITEMS.md SEC-12; the §8.3 lock predicate table
      -- + the §5.5 deferred entry should be read in tandem.
      PERFORM pg_advisory_xact_lock(
        p_shop_id::INT,
        hashtext(d::TEXT)
      ) FROM unnest(v_dates) AS d;
      v_lock_count := COALESCE(array_length(v_dates, 1), 0);

    ELSE
      RAISE EXCEPTION 'revert_blocked: unhandled snapshot_kind for lock_targets: %', p_kind;
  END CASE;

  RETURN v_lock_count;
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top).
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) TO service_role;
```

The helper is dispatched from the inner RPC's step 4 (per §4.4) — a single call site, simpler to reason about than scattering the per-kind lock logic across every handler. Handlers may still acquire `FOR UPDATE` on their own target rows as defense-in-depth (per §8.2 Invariant 2), but the load-bearing TOCTOU defense is this helper. This is the migration's place to deploy the helper — it lives in the dispatch migration (`20260526000100_revert_md_upload_dispatch.sql`) alongside the inner RPC that calls it.

**`compute_current_canonical_for_kind` helper + per-kind canonical-serializer functions (X-FIX-2 — 2026-05-26 — fixes GPT chunk 2 BLOCKER "compute_current_canonical_for_kind is referenced but not included in the migration set").**

The inner RPC's step 5 (per §4.4 + §8.1) calls `public.compute_current_canonical_for_kind(v_kind, p_shop_id, v_snapshot)` to produce the current canonical-MD for staleness comparison. This helper plus its 10 per-snapshot_kind backing functions are part of the dispatch migration (`20260526000100_revert_md_upload_dispatch.sql`) — without them every dry-run + apply path fails at runtime with `function public.compute_current_canonical_for_kind(...) does not exist`.

**Dispatch helper signature:**

```sql
CREATE OR REPLACE FUNCTION public.compute_current_canonical_for_kind(
  p_kind TEXT,
  p_shop_id INTEGER,
  p_snapshot JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
BEGIN
  -- Dispatch to the per-snapshot_kind canonical-serializer. The serializer
  -- consumes the snapshot's scope-identifying fields (e.g., category for
  -- per-category, original_today for closed_dates_future, etc.) plus
  -- p_shop_id to read the CURRENT state from the target table(s) and
  -- serialize it to a canonical MD string. Result MUST be byte-for-byte
  -- identical to what the apply RPC's post-mutation serializer produced
  -- (parity contract — see below).
  CASE p_kind
    WHEN 'testing_services_v2' THEN
      RETURN public.canonical_state_testing_services_v2(p_shop_id, p_snapshot);
    WHEN 'routine_services_v2' THEN
      RETURN public.canonical_state_routine_services_v2(p_shop_id, p_snapshot);
    WHEN 'concern_subcategories_descriptions_v2' THEN
      RETURN public.canonical_state_subcategory_descriptions_v2(p_shop_id, p_snapshot);
    WHEN 'concern_subcategories_map_v2' THEN
      RETURN public.canonical_state_subcategory_service_map_v2(p_shop_id, p_snapshot);
    WHEN 'concern_questions_required_facts_v2' THEN
      RETURN public.canonical_state_question_required_facts_v2(p_shop_id, p_snapshot);
    WHEN 'concern_questions_flat' THEN
      RETURN public.canonical_state_concern_questions_flat(p_shop_id, p_snapshot);
    WHEN 'concern_questions_per_category' THEN
      RETURN public.canonical_state_concern_category_upload(p_shop_id, p_snapshot);
    WHEN 'concern_category_guidelines' THEN
      RETURN public.canonical_state_concern_category_guideline(p_shop_id, p_snapshot);
    WHEN 'appointment_default_limits' THEN
      RETURN public.canonical_state_appointment_default_limits(p_shop_id, p_snapshot);
    WHEN 'closed_dates_future' THEN
      RETURN public.canonical_state_closed_dates_future(p_shop_id, p_snapshot);
    ELSE
      RAISE EXCEPTION 'compute_current_canonical_for_kind: unknown snapshot_kind: %', p_kind
        USING ERRCODE = '22023';
  END CASE;
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top).
REVOKE EXECUTE ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) TO service_role;
```

**Per-snapshot_kind canonical-serializer functions (10 total — implementation responsibility for E1).**

Each `canonical_state_<kind>(p_shop_id INTEGER, p_snapshot JSONB) RETURNS TEXT` function reads the CURRENT DB state for its scope (extracted from `p_snapshot`'s scope-identifying fields) and emits the canonical MD form that the corresponding TS exporter produces. The 10 functions:

| Function | Scope it reads | TS exporter it mirrors |
|---|---|---|
| `canonical_state_testing_services_v2` | All `testing_services` for `p_shop_id` | `exportTestingServicesMdV2` |
| `canonical_state_routine_services_v2` | All `routine_services` for `p_shop_id` | `exportRoutineServicesMdV2` |
| `canonical_state_subcategory_descriptions_v2` | `concern_subcategories.description` cols for `p_shop_id` | `exportSubcategoryDescriptionsMdV2` |
| `canonical_state_subcategory_service_map_v2` | `concern_subcategories.service_map_*` cols for `p_shop_id` | `exportSubcategoryServiceMapMdV2` |
| `canonical_state_question_required_facts_v2` | `concern_questions.required_facts` for `p_shop_id` | `exportQuestionRequiredFactsMdV2` |
| `canonical_state_concern_questions_flat` | All `concern_questions` for `p_shop_id` (flat shape) | `exportConcernQuestionsMd` |
| `canonical_state_concern_category_upload` | `concern_subcategories` + `concern_questions` for `(p_shop_id, p_snapshot->>'category')` | `exportConcernCategoryMd({ category_slug })` |
| `canonical_state_concern_category_guideline` | `concern_category_guidelines` for `(p_shop_id, <category>)` where `<category>` is derived from `jsonb_object_keys(p_snapshot->'before')` (single-element since CCG snapshots are scoped to one category per §5.3 shape) UNION `p_snapshot->'added_keys'` (X-FIX-#26 — 2026-05-26 — was `p_snapshot->>'category'` which assumed a top-level `category` field the snapshot doesn't carry per §5.3 keyed-by-category shape; closes GPT round-3 chunk 3 IMPORTANT "concern_category_guidelines snapshot shape is fixed in the lock helper but stale in canonical-state docs") | `exportConcernCategoryGuidelineMd({ category_slug })` |
| `canonical_state_appointment_default_limits` | All `appointment_default_limits` for `p_shop_id` | `exportAppointmentDefaultLimitsMd` |
| `canonical_state_closed_dates_future` | `closed_dates` for `p_shop_id` where `closed_date >= (p_snapshot->>'original_today')::DATE` | `exportClosedDatesMd` filtered |

**Parity contract (LOAD-BEARING).** Each `canonical_state_<kind>` function MUST produce byte-for-byte identical output to the corresponding TS exporter for the same input rows. The apply RPC (per §8.3 lifecycle step 5) calls this SAME function (or a TS-mirror exposed as a SQL function) to produce `expected_after_state_canonical`. If the apply-side and revert-side serializers diverge by a single byte — extra trailing newline, different float precision, different array sort order — every revert will false-positive `staleness_check_failed`.

**Implementation responsibility (E1).** The 10 per-kind canonical-serializer functions are NEW SQL that must be specified + implemented during E1 (Migration deploy). Each is on the order of 30-80 lines of plpgsql. Total ~500 LOC of new canonical-serializer SQL. **This is a substantial part of the E1 implementation work — flagged in §10 E1 build order so it's not surprise scope.** Each function should be paired with a pgTAP test that asserts byte-identity with a known-good fixture; the same fixture also fuels a TS-side parity test that calls the corresponding exporter.

**Why not use the TS exporters directly via http_call?** Considered + rejected: the round-trip latency (orchestrator-mcp → edge fn → Postgres → http_call → edge fn → TS exporter → Postgres) would be slow and add a network failure mode to every revert. plpgsql per-kind serializers keep everything in-database, deterministic, and rollback-safe inside the transaction.

**`expected_after_state_canonical` lifecycle (REWRITTEN v0.4 per X-FIX-AGENT-E + A-B11).**

The canonical post-apply content MUST be produced from PERSISTED post-apply DB rows — inside the apply RPC's transaction, AFTER the writes have succeeded — NOT from TS-side computation done before the write. This is a contract for every `apply_<table>_upload` RPC (deployed in `20260526000500_apply_handlers_uploads.sql` per §10 E1f / E5). It is also a contract for any future apply RPC that produces a snapshot which a later revert will trust.

Mandatory sequence inside each `apply_<table>_upload` RPC (per CV2-I2):

1. Validate inputs (Zod-like checks + parameter presence).
2. Acquire target-row locks (FOR UPDATE on existing rows; advisory locks for closed_dates).
3. Re-verify current-state hash against `p_audit.expected_current_hash` (under locks; this is the apply-side equivalent of revert's staleness check).
4. Apply mutations (UPSERT / INSERT / DELETE).
5. **AFTER mutations land, re-read the freshly-mutated DB state for this surface filtered to `p_shop_id`. Serialize via the SAME canonical-serializer plpgsql helper the revert path uses (or its TS-side mirror exposed as a SQL function).** This is the actual post-apply state, not a guess.
6. Compute `after_hash = encode(digest(expected_after_state_canonical, 'sha256'), 'hex')` from the canonical content from step 5. (X-FIX-1: `sha256(text)` is NOT a built-in PostgreSQL function; pgcrypto's `digest(text, 'sha256')` wrapped in `encode(..., 'hex')` is the canonical form. The descriptive "sha256(x)" shorthand appears elsewhere in PROSE for readability — but every actual SQL block writes the full `encode(digest(...))` form.)
7. INSERT the audit row with `pre_state_snapshot` populated with the snapshot's input fields PLUS the freshly-computed `expected_after_state_canonical` + `after_hash` fields.

Why steps 5-7 MUST happen post-write and post-mutation:

- DB-side triggers can mutate the persisted row (e.g., normalization triggers on TEXT columns, generated columns, default-coercion of NULLs).
- Constraint coercion can change values (e.g., a CHECK normalizes via a CASE-equivalent transform).
- The Postgres timestamp resolution differs from TS Date resolution; comparing TS-computed serialization to DB-stored values can drift.
- Generated IDs (gen_random_uuid()) cannot be predicted TS-side.

The v0.3 design (compute pre-write, TS-side, store in snapshot) produced a guess. A guess that mismatches reality means the very next revert call rejects with `staleness_check_failed` even though nothing was edited post-upload — false positive that wastes operator time and erodes trust. v0.4's contract eliminates the guess: the snapshot's `expected_after_state_canonical` is THE serialized form of the rows that the apply RPC just persisted, captured under the same locks the apply RPC held during mutation.

**Apply-side ↔ revert-side serializer parity.** The serializer the apply RPC uses to produce `expected_after_state_canonical` MUST be the SAME function the revert RPC's `compute_current_canonical_for_kind` uses to produce `v_current_canonical`. Different serializers (or different versions of the same serializer) produce different strings for the same data — the staleness check would false-positive on every revert. Implementation: ship ONE plpgsql canonical-serializer per snapshot_kind, called from BOTH apply and revert paths. Document the parity contract inline at each call site.

**Fast-path `after_hash` check (X-FIX-AGENT-E, integrated into inner RPC step 6).**

The inner RPC's step 6 uses `after_hash` as the FAST-PATH gate (hash comparison is cheap — 64-char hex string equality) and only falls through to producing the diagnostic diff on hash mismatch. The §4.4 step 6 prose + §8.1 step 6 walkthrough now explicitly call out the two-stage check:

1. Compute `current_head_hash` (already done at step 5).
2. Compare `current_head_hash` to `snapshot.after_hash`. If equal: staleness check PASSES — no need to call `compute_unified_diff`.
3. If unequal: drift is confirmed. NOW call `compute_unified_diff(expected_canonical, current_canonical, 50)` to populate the operator-facing error message. The diff body goes into `error_detail`; the short `reason_code='current_state_drift'` goes to Sentry.

This is the integrated form the v0.3 plan documented but didn't actually wire (the v0.3 inner RPC's step 6 was an `IF v_current_canonical <> v_expected_canonical` direct string-compare without the hash fast-path — wasted work in the common happy case). X-FIX-AGENT-E's step-6 rewrite makes the fast-path the load-bearing comparison and the canonical-string comparison only happen on the diagnostic path.

GPT 3rd-round correction note: `after_hash` does NOT save bandwidth on the diagnostic-path case because you still need `v_current_canonical` to produce the diff. It DOES save bandwidth on the common happy case (hash equality = no diff computation, no diff transmission to the caller). The savings shape is "fast-path skip on equality," not "always cheaper."

**Staleness diff format — honest reframing (X-FIX-AGENT-E, fixes X-AMEND "compute_unified_diff is not sound enough for the claim being made").**

The `compute_unified_diff(expected, current, max_lines=50)` helper is a **line-aligned diff** — NOT a true unified-diff with LCS / myers-style alignment, despite the function name. The name is kept for backwards-compat with prior plan revisions; the documentation here is the load-bearing description.

What the helper actually does:

1. Splits both inputs on `E'\n'` via `regexp_split_to_table(text, E'\n') WITH ORDINALITY` to preserve line numbers.
2. FULL OUTER JOINs the two streams on `ordinal` for stable line-number alignment.
3. For each ordinal where the two lines differ (or where one side is NULL — insertion/deletion), emits a `- expected_line` + `+ current_line` pair prefixed with the line number.
4. Counts differing aligned rows; if more than `max_lines` differ, truncates and appends `... (N more lines differ; line-by-line — reordered blocks may overcount)`.

What it does NOT do:

- Reordered-block alignment (LCS). An insertion at line 1 makes every subsequent line "differ" because the line numbers shift. The "N more lines differ" count reflects that mis-alignment, not actual semantic drift.
- Deletion / insertion alignment. The helper treats a deleted block of N lines as N missing-current rows + every subsequent line as drifted (because the alignment offset propagates).
- True `diff -u` semantics. The output looks superficially like unified-diff but is fundamentally a per-line comparison without alignment heuristics.

Why this is acceptable:

- The diff is best-effort for operator visibility. The PRIMARY signal is `reason_code='current_state_drift'` (Sentry-safe enum); the diff body in `error_detail` is for triage when the operator opens the attempt row.
- True LCS alignment is non-trivial in PL/pgSQL and not worth the implementation cost for a feature that fires only on rare staleness rejections.
- If true unified-diff output is needed (e.g., for a future operator UI), generate it client-side after revert rejection — fetch `error_detail` from the attempt table + run TS-side `diff` library on the lines.

PL/pgSQL helper sketch (canonical security setup applies):

```sql
CREATE OR REPLACE FUNCTION public.compute_unified_diff(
  p_expected TEXT,
  p_current TEXT,
  p_max_lines INTEGER DEFAULT 50
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_diff_lines TEXT;
  v_total_diffs INTEGER;
  v_truncation_marker TEXT := '';
BEGIN
  -- NULL inputs → degraded but defined output (the operator sees "no
  -- canonical content available" instead of an exception that crashes the
  -- inner RPC's RAISE statement).
  IF p_expected IS NULL AND p_current IS NULL THEN
    RETURN '<<both expected and current are NULL>>';
  END IF;

  -- Line-aligned diff via FULL OUTER JOIN on ordinal. WITH ORDINALITY
  -- preserves line numbers for stable alignment between the two
  -- independent regexp_split_to_table calls. COALESCE handles NULL
  -- inputs + trailing-empty-line cases (a TEXT ending in \n produces a
  -- trailing empty line in regexp_split_to_table output).
  WITH
  expected_lines AS (
    SELECT line, ord
      FROM regexp_split_to_table(COALESCE(p_expected, ''), E'\n')
        WITH ORDINALITY AS s(line, ord)
  ),
  current_lines AS (
    SELECT line, ord
      FROM regexp_split_to_table(COALESCE(p_current, ''), E'\n')
        WITH ORDINALITY AS s(line, ord)
  ),
  aligned AS (
    SELECT
      COALESCE(e.ord, c.ord) AS ord,
      e.line AS expected_line,
      c.line AS current_line
    FROM expected_lines e
    FULL OUTER JOIN current_lines c ON e.ord = c.ord
    WHERE e.line IS DISTINCT FROM c.line   -- only emit differing rows
  ),
  numbered AS (
    SELECT
      ord,
      expected_line,
      current_line,
      row_number() OVER (ORDER BY ord) AS diff_row
    FROM aligned
  )
  -- X-FIX-#21 (2026-05-26) — REVISED Fix #16 — single CTE statement with
  -- FILTER aggregate. Fix #16 split the aggregation into TWO SELECTs, but
  -- CTEs are scoped to a single statement (PostgreSQL docs: "WITH provides
  -- a way to write auxiliary statements for use in a larger query [singular]")
  -- → the second SELECT `FROM numbered` failed with relation-not-found.
  -- Closes GPT round-3 chunk 3 BLOCKER "compute_unified_diff uses a CTE
  -- outside its statement scope".
  --
  -- Correct pattern: use FILTER aggregate on string_agg so the rendering
  -- only consumes rows where diff_row <= p_max_lines, while COUNT(*) (no
  -- FILTER) sees the unfiltered total. Both aggregates compute in the
  -- same SELECT, against the same CTE, in one statement.
  SELECT
    string_agg(
      format(E'L%s:\n- %s\n+ %s', ord,
             COALESCE(expected_line, '<<absent>>'),
             COALESCE(current_line,  '<<absent>>')),
      E'\n' ORDER BY ord
    ) FILTER (WHERE diff_row <= p_max_lines),
    COUNT(*)
  INTO v_diff_lines, v_total_diffs
  FROM numbered;

  IF v_total_diffs > p_max_lines THEN
    v_truncation_marker := format(
      E'\n... (%s more lines differ; line-by-line — reordered blocks may overcount)',
      v_total_diffs - p_max_lines);
  END IF;

  RETURN COALESCE(v_diff_lines, '<<no differences detected (NULL-vs-NULL or both empty)>>') || v_truncation_marker;
END;
$$;

-- Canonical multi-tenant security setup (see §4.4 top).
REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) TO service_role;
```

The helper lives in the dispatch migration (`20260526000100_revert_md_upload_dispatch.sql`) alongside the inner RPC + `lock_targets_for_kind`. The two-stage check in the inner RPC (fast-path hash equality, slow-path diff generation) means this helper fires only on staleness rejections — operationally a rare event.

NOTE on the prior v0.3 wording: the previous §8.3 text claimed the helper "produces unified-diff style output (similar to `diff -u`)" and "fixes misleading reordered/deleted-block diffs." Both claims overstated what the helper does. X-FIX-AGENT-E corrects the prose to match the implementation: line-aligned with explicit ordinality, no LCS, best-effort for operator visibility. If a future feature needs true unified-diff semantics, the right place to add it is client-side after revert rejection, not in PL/pgSQL.

### 8.4 Multi-tenant scoping (PE-2, refined per CV-B5 + CV-B4 v0.3 + A-B12 amendment + X-FIX-AGENT-B 4-layer defense narrative)

Tenant integrity for revert depends on a 4-layer defense-in-depth chain. NO SINGLE LAYER is sufficient — the security review (4th-round GPT BLOCKERs X6/X7 + GPT IMPORTANT "Snapshot tampering protection overstated") flagged exactly the failure modes of leaning on any one layer alone. All four layers MUST be present.

**Layer 1 — Caller identity at the request boundary (orchestrator-mcp edge function).**

The orchestrator-mcp edge function (`supabase/functions/orchestrator-mcp/index.ts`) is the SOLE caller of `revert_md_upload_attempt`. It authenticates every inbound request via two paths:

- **BRANCH A — SERVICE_ROLE bearer + X-Actor-Email header** (admin-app Server Action path). The request carries `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` plus an `X-Actor-Email` header. The orchestrator timing-safe-compares the bearer to every allowed SERVICE_ROLE / sb_secret_* value, then validates the actor email's domain. Missing or invalid actor email → 401 (request never reaches the RPC). The admin-app Server Action that initiates the call obtains `shopId` from the authenticated employee session via `requireEmployee()`-equivalent server-side resolution (admin-app side; see `admin-app/src/lib/orchestrator/`).
- **BRANCH B — OAuth bearer validation** (Claude Desktop path). The request carries `Authorization: Bearer <oauth_token>`. The orchestrator hashes the token, looks up `oauth_access_tokens`, validates the audience (RFC 8707), and resolves the OAuth client's bound shop_id from the access-token row.

Either path resolves a `(userLabel, shopId)` tuple from authenticated identity BEFORE the RPC is invoked. The orchestrator-mcp passes BOTH into the outer RPC as `p_actor_email` + `p_shop_id`.

**Layer 2 — DB-layer REVOKE EXECUTE + GRANT TO service_role (canonical security setup block, §4.4 top).**

Every SECURITY DEFINER function in this feature has `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`. This means:

- PostgREST direct exposure to `anon` or `authenticated` is BLOCKED at the database. A caller who somehow obtained an authenticated JWT cannot reach `revert_md_upload_attempt` via the standard `/rest/v1/rpc/...` path.
- Only `service_role` — the role embedded in `SUPABASE_SERVICE_ROLE_KEY`, used ONLY by the orchestrator-mcp edge function — can EXECUTE these functions.
- This is the load-bearing auth boundary for this codebase. There is no `employees` table to consult; no `auth.uid()` is resolvable inside the function. The REVOKE/GRANT triple IS the in-DB part of the auth chain.

**Layer 3 — Defense-in-depth presence assertions (STEP 0a + STEP 0b inside outer + inner RPCs).**

Even with Layer 2 closing the standard call paths, a future code change or an operator-side mistake (e.g., a one-off `psql` session opened as `postgres`/`service_role` for debugging) could invoke these RPCs directly. STEP 0a (Agent A's parameter-presence guard) + STEP 0b (Agent B's actor_email-presence assertion + future-employees-table hook) catch the obvious bypasses:

- `p_shop_id IS NULL OR <= 0` → 22023 (caller forgot to pass shop, OR is trying to pass the sentinel `shop_id = -1` for historical-non-revertable rows — both reject).
- `p_upload_id IS NULL OR <= 0` → 22023.
- `p_actor_email IS NULL OR empty` → 22023 (audit trail integrity — no anonymous reverts).

Future hook: when a per-employee session model with `auth.uid()` becomes available, REPLACE the comment block in STEP 0b with `auth.uid()` → `employees.shop_id` resolution + `42501` on mismatch. As of 2026-05-26 that hook is a documented future-revisit, not a no-op replacement (see §4.4 top's "Why no `auth.uid()` step inside the RPC" prose).

**Layer 4 — Handler-level Invariants 5 + 6 (cross-shop UPSERT-hijack prevention + FK target tenant validation).**

Layers 1-3 stop a foreign caller from being authenticated as the wrong shop. They do NOT stop a fully-authenticated caller from triggering a revert on a SNAPSHOT that was itself tampered or corrupted to carry foreign-shop row IDs. The 4th-round GPT BLOCKER X7 + GPT IMPORTANT "Snapshot tampering protection overstated" pointed at exactly this seam: the SECURITY DEFINER function trusts the snapshot's row content because the snapshot lives in `scheduler_admin_audit_log.pre_state_snapshot` (which is itself protected by all prior layers), but Postgres has no built-in check that an `id` in the snapshot belongs to the caller's shop.

The handler-layer defense is two patterns from §8.2:

- **Invariant 5 — Cross-shop UPSERT-hijack prevention.** Every UPSERT uses `ON CONFLICT (id) DO UPDATE … WHERE target.shop_id = p_shop_id` + row-count comparison after the write. A snapshot row whose `id` collides with a foreign-shop row is SKIPPED (not hijacked); the row-count miss surfaces as `revert_blocked: cross_shop_hijack_attempt`. Invariant 1's WRONG-vs-RIGHT example shows the failure mode the prior v0.3 sketch had.
- **Invariant 6 — FK target tenant validation.** Before UPSERTing rows that carry FK columns, the handler joins the distinct FK target values against the parent table filtered to `shop_id = p_shop_id`; if any reference fails to resolve in-tenant, the handler RAISEs `revert_blocked: fk_target_tenant_mismatch`. Catches the attack shape where a tampered snapshot writes a NEW row that incorrectly REFERENCES a foreign-shop parent.

Together, Invariants 5 + 6 provide handler-layer integrity even when the snapshot itself is hostile.

**Why all four layers, not just one.**

| Layer | Stops | Misses |
|---|---|---|
| 1. Caller identity (orchestrator-mcp) | Unauthenticated callers; wrong-domain actors; expired OAuth tokens | A legitimate caller passing a foreign `p_shop_id` (4th-round X6) |
| 2. REVOKE/GRANT (DB) | PostgREST direct invocation by anon/authenticated | service_role callers passing a foreign `p_shop_id` (still X6) |
| 3. STEP 0 presence guards | Direct-DB callers forgetting parameters; missing actor identity | A caller passing valid-but-foreign values that satisfy presence checks |
| 4. Handler Invariants 5 + 6 | Tampered/corrupted snapshots that carry foreign-shop row IDs or FK references | Direct catastrophic DB corruption (e.g., physical row tampering bypassing Postgres entirely — out of scope for this design) |

Removing any one layer re-opens an attack surface the OTHERS cannot catch. The pre-X-FIX-AGENT-B design had Layers 1 + 2 (and only the `shop_id = p_shop_id` "necessary but not sufficient" line, which the v0.4 rewrite of Invariant 1 corrects) — the 4th-round cross-verify caught the gap correctly.

**Pre-existing NULL shop_id rows + historical sentinel handling (carried forward from CV-B1 / CV-B4 / A-B12).**

Per CV-B1's staged approach: until Migration B completes, audit rows can have NULL shop_id (legacy + non-backfillable). Revert eligibility check (`shop_id = p_shop_id`) rejects NULL rows with reason `shop_id_unknown_pre_migration_backfill`. After Migration B's apply: zero NULL rows in the table (the backfill script's gated sentinel-UPDATE handled them); the column is NOT NULL; sentinel rows have `shop_id = -1` (rejected by `revert_md_upload_attempt` since negative shop_ids never match a real caller's `p_shop_id`, AND STEP 0a's `p_shop_id <= 0` guard rejects upfront if a caller somehow passes -1).

### 8.5 Audit log of the revert + attempt-row lifecycle (REWRITTEN v0.4 per CV2-B6 + X-FIX-AGENT-F schema redesign)

The single-row-INSERT-inside-the-dispatch-RPC framing is REPLACED. v0.4 has two surfaces for revert observability:

**A. `scheduler_admin_audit_log` (existing surface).** On a SUCCESSFUL APPLY (not dry_run): the inner `revert_md_upload_apply` RPC INSERTs the `revert_upload` audit row + UPDATEs the parent's `successor_revert_id`, both inside the outer's BEGIN…EXCEPTION subtransaction block (the PL/pgSQL implementation pattern for SAVEPOINT semantics — see §4.4 "PL/pgSQL transaction-control note") and atomic with the handler's table mutations. On any failure (rejection or crash): the subtransaction auto-rolls back → audit row NOT written → parent.successor_revert_id stays NULL. The audit log shows ONLY successful reverts.

**B. `scheduler_admin_revert_attempts` (new surface per CV2-B6, redesigned v0.4 per X-FIX-AGENT-F).** The outer `revert_md_upload_attempt` RPC ALWAYS inserts an attempt row (outcome='pending', `completed_at IS NULL`, `revert_audit_log_id IS NULL`, `dry_run_confirm_token_hash IS NULL`) BEFORE entering the BEGIN…EXCEPTION subtransaction. This INSERT happens in the outer's transaction frame, NOT inside the subtransaction, so it SURVIVES inner rollback. After inner returns or RAISEs, outer UPDATEs the attempt row to a terminal state:

- **`'success'`** — non-dry_run inner returned cleanly. UPDATE sets `outcome='success'`, `reason_code = NULL`, `completed_at = now()`, `revert_audit_log_id = <inner audit row id>`, `dry_run_confirm_token_hash = NULL`. The `audit_log_scope_check` CHECK constraint enforces `revert_audit_log_id IS NOT NULL` on this outcome.
- **`'dry_run_success'`** — dry_run inner returned cleanly. UPDATE sets `outcome='dry_run_success'`, `reason_code = NULL`, `completed_at = now()`, `revert_audit_log_id = NULL` (no mutations, no audit row), `dry_run_confirm_token_hash = encode(digest(v_inner.confirm_token, 'sha256'), 'hex')`. The `token_hash_scope_check` CHECK constraint enforces `dry_run_confirm_token_hash IS NOT NULL` on this outcome and NULL on every other outcome. The token itself is RETURNED to the caller for the apply step but NEVER persisted (X-FIX-AGENT-F closes the X5 token-leak BLOCKER).
- **`'rejected'`** — inner RAISEd with a classified error (eligibility / token / staleness / known constraint matched by the §3b CV2-B6 outcome-classification table). UPDATE sets `outcome='rejected'`, `reason_code` to the machine-readable enum (e.g., `'not_upload_md'`, `'successor_revert_exists'`, `'confirm_token_mismatch'`, `'current_state_drift'`), `error_detail = '<SQLSTATE>:<SQLERRM>'` (the verbose body — for staleness rejections this includes the full inline diff from `compute_unified_diff`), `completed_at = now()`. No audit row in `scheduler_admin_audit_log`.
- **`'crashed'`** — inner RAISEd with an unexpected exception (including unexpected `23505` from a constraint OTHER than `scheduler_admin_audit_log_one_successful_revert_idx` — these surface as `reason_code='unique_violation'` per the X14 narrowing, so real data-integrity bugs are visible instead of being silently mislabeled). UPDATE sets `outcome='crashed'`, `reason_code` per the classifier (or NULL for fully-unexpected exceptions), `error_detail = '<SQLSTATE>:<SQLERRM>'`, `completed_at = now()`. No audit row.

(The `'failed'` outcome was REMOVED from the enum in v0.4 per X-FIX-AGENT-F — no code path emits it; reserved future use was BOTH-flagged as a dead state. The CHECK constraint `outcome IN ('pending','dry_run_success','success','rejected','crashed')` no longer includes it.)

**Column lifecycle invariants** (CHECK-enforced in §4.1):
- `completed_at IS NULL` iff `outcome='pending'`. Every terminal outcome sets `completed_at`. Pairs with `attempted_at` for latency analysis; pending rows older than ~5 min are stuck-pending candidates (the `scheduler_admin_revert_attempts_pending_idx` partial index makes that query cheap).
- `dry_run_confirm_token_hash IS NOT NULL` iff `outcome='dry_run_success'`. Replay-secret hazard avoided.
- `revert_audit_log_id IS NOT NULL` iff `outcome='success'`. Dry-run paths never produce an audit row.
- `reason_code` is the Sentry-safe field; `error_detail` is the DB-only verbose body. The TS wrapper's Sentry emission carries `reason_code` + `attempt_id` only — operators query the attempt table by `attempt_id` to see `error_detail` (closes GPT's "diff/error_detail may leak to Sentry" IMPORTANT finding).

**Canonical `reason_code` + `error_detail` lifecycle contract (v0.5 X-FIX-AGENT-G — consolidated from scattered prior-round prose).** Earlier rounds left this inconsistent across §8.1 / §8.5 / §8.7. The single canonical contract:

| outcome | reason_code | error_detail | revert_audit_log_id | dry_run_confirm_token_hash | Sentry emit? |
|---|---|---|---|---|---|
| `pending` | NULL | NULL | NULL | NULL | No (transient — outer hasn't classified yet) |
| `success` | NULL | NULL | NOT NULL (inner audit row id) | NULL | No (happy path) |
| `dry_run_success` | NULL | NULL | NULL | NOT NULL (sha256(confirm_token) hex) | No (preview path) |
| `rejected` | NOT NULL — canonical enum from §3b "Canonical reason_code enum" table (X-FIX-#26 — 2026-05-26): `'confirm_token_mismatch'`, `'current_state_drift'`, `'successor_revert_exists'`, `'not_upload_md'`, `'snapshot_pruned'`, `'over_30_day_cutoff'` (NOT `30_day_cutoff` — renamed per X-FIX-#11 leading-digit fix), `'another_revert_in_progress'`, `'fk_broken'` (canonical for ALL FK-related rejections — replaces `'fk_target_tenant_mismatch'` per X-FIX-#26 dedup; the per-category handler's Invariant 6 raises `revert_blocked: fk_broken: cannot restore ...` and the post-mutation FK catch in §8.7 also uses `fk_broken` — single enum per Sentry-safety contract). | NOT NULL — `SQLSTATE:CONSTRAINT_NAME:SQLERRM` body. For staleness rejections this INCLUDES the inline diff body from `compute_unified_diff`. DB-only; not for Sentry. | NULL | NULL | Yes — `level: 'warning'` |
| `crashed` | NULL (fully-unexpected) OR machine-readable enum (`'unique_violation'` for unexpected 23505 per X14 narrowing) | NOT NULL — `SQLSTATE:CONSTRAINT_NAME:SQLERRM` body. DB-only; not for Sentry. | NULL | NULL | Yes — `level: 'error'` |

`error_detail` is populated for ALL non-success outcomes (rejected AND crashed) — this resolves the v0.4 inconsistency where some prose said "only crashed carries error_detail" and other prose said "rejected FK failures also set error_detail." The canonical answer is: `error_detail` carries the SQLSTATE+CONSTRAINT_NAME+SQLERRM body whenever the inner RAISEd (regardless of whether the outer classified the outcome as `'rejected'` or `'crashed'`). `reason_code` is the parallel short enum — Sentry-safe — that the outer derived from the classifier table. The CHECK constraints in §4.1 do NOT bind `error_detail` to an outcome (any non-success may carry it, and dry-run success rows never do because no inner exception fired).

Operators see the full revert lifecycle in the attempt table (every attempt regardless of outcome) + the audit log (only successes). Sentry alert (per §3b CV2-B6) on `outcome IN ('rejected','crashed')` rows surfaces the failure trail with redacted payload (per the redaction policy table in §3b CV2-B6 bullet 4).

**Retention.** Designed policy: 90 days online from `completed_at` (terminal rows; pending rows never pruned), then archive to `scheduler_admin_revert_attempts_archive`, then hard-delete at day 365. Implementation is DEFERRED pending observed production volume — see `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` OBS-9. Day-1 schema (completed_at column + partial pending index) is sufficient for stuck-pending alerting and latency analysis without the cron in place.

**Handler return shape carries per-kind metadata via `details JSONB`** (universal 4-column return contract per §8.2 Invariant 7, landed v0.4 per X-FIX-AGENT-C). Every handler's 4th return column is a JSONB blob the inner RPC merges into the audit-row `diff_summary` via JSONB concat: `jsonb_build_object('reverted_upload_id', ..., 'restored', ..., ...) || COALESCE(v_stats.details, '{}'::JSONB)`. The concat is right-biased — handler keys override standard keys on collision, but the standard key set (`reverted_upload_id`, `snapshot_kind`, `restored`, `deactivated`, `deleted`, `forced_no_after_hash_check`) is namespaced separately from per-kind keys so collisions don't happen in practice.

For `revert_closed_dates_future` specifically: `details = {'skipped_past_dates_restore': ['YYYY-MM-DD', ...], 'skipped_past_dates_delete': ['YYYY-MM-DD', ...]}` per X10. The audit row's resulting `diff_summary` carries those two arrays so operators see (a) which dates in `before` were NOT restored because they drifted into the past since upload, and (b) which dates in `added_keys` were NOT deleted for the same reason. Both directions of the "past closures are immutable history" invariant surface to operators — the dates the revert ran on the future side AND the dates the revert refused to touch on the past side. 9 of the 10 handlers return `'{}'::JSONB` (the JSONB concat is a no-op for those — `diff_summary` carries only the standard keys); future handlers added later may surface their own metadata via this contract without dispatch-CASE or audit-INSERT signature changes.

The attempt-table column `scheduler_admin_revert_attempts.metadata JSONB NULL` (per §4.1 + X-FIX-AGENT-F schema) is a DIFFERENT surface — it carries outer-RPC observability (outcome-classification trace, latency breakdowns, future retry-counter state) and is written by the OUTER RPC, never by handlers. Do not conflate handler `details` (audit-row scope) with attempt-row `metadata` (attempt-row scope).

### 8.6 30-day strict cutoff (in the dispatch RPC)
Inside `revert_md_upload_apply`: `IF v_target.occurred_at < v_now - INTERVAL '30 days' THEN RAISE 'revert_blocked: over_30_day_cutoff'` (X-FIX-#26 — 2026-05-26 — renamed from `30_day_cutoff` per X-FIX-#11 leading-digit fix; matches §3b canonical enum). Independent of `snapshot_pruned_at` cron timing.

### 8.7 FK-broken revert refusal (DC-6, REWRITTEN v0.4 for outer/inner exception model + X-FIX-AGENT-D enriched diagnostic format)

Per §8.2 above, every handler that UPSERTs rows carrying FK columns runs Invariant 6's FK-target tenant-validation pass BEFORE the mutating UPSERT and RAISEs a structured `revert_blocked:` message that names the specific failing row + FK column + missing value. The error then propagates up through the outer/inner two-RPC exception model:

1. Handler RAISEs one of:
   - **Per-category handler (canonical example):** `revert_blocked: fk_broken: cannot restore concern_questions.id=<question_id> because subcategory_id=<value> not in shop=<shop_id> category=<category> (likely tampered snapshot or deleted-via-direct-DB ancestor); manual recovery required`. RAISE USING ERRCODE = '23503' so outer's classifier sees the standard `foreign_key_violation` SQLSTATE alongside the structured message. X-FIX-#11 (2026-05-26): the `fk_broken:` enum prefix is what the §4.4 classifier extracts; everything after the second colon is verbose detail flowing to `error_detail`.
   - **Generic format for other handlers** (when the handler's snapshot rows reference an FK that needs tenant validation): `revert_blocked: fk_broken: cannot restore <table>.id=<id> because <fk_col>=<value> no longer exists; manual recovery required` (or `...not in shop=<shop_id>` when tenant scope matters more than existence). The handler chooses the more specific phrasing — "no longer exists" when the FK target was hard-deleted, "not in shop=<shop_id>" when it's a cross-tenant reference. The `fk_broken:` enum prefix is REQUIRED for all such RAISEs.
2. Inner's CASE dispatch block does not catch (no `EXCEPTION` block in the CASE itself — the RAISE propagates straight up).
3. Outer's `BEGIN…EXCEPTION WHEN OTHERS THEN` block catches (the PL/pgSQL implementation pattern equivalent to a SAVEPOINT catch — see §4.4 "PL/pgSQL transaction-control note"). The implicit subtransaction auto-rolls back inner mutations + the audit row INSERT + the parent UPDATE atomically (no partial restore).
4. Outer classifies SQLERRM via the `'revert_blocked:%'` prefix match → `outcome='rejected'`, `reason_code=<text after prefix>` (the full structured message, including the table.id + FK column + value + scope), `error_detail=<SQLSTATE>:<SQLERRM>`. Per X-FIX-AGENT-A's X14 narrowing, the `'revert_blocked:'` prefix is the load-bearing classification signal — SQLSTATE is recorded in `error_detail` for triage but does NOT drive the outcome enum.
5. UPDATE attempt row; RETURN structured error result to TS — outcome + reason_code + error_message + attempt_id (TS wrapper keys off `outcome`, not `error_message`).

**Why the structured format is load-bearing.** The operator's first signal is `reason_code` in the attempt table. A vague `cannot restore concern_category=brakes — FK violation` (v0.3 wording) gives the operator no actionable starting point — they'd have to query both tables, diff against the snapshot, and walk every FK manually to find the broken reference. The v0.4 format (`cannot restore concern_questions.id=42 because subcategory_id=17 not in shop=7476 category=brakes`) names the exact row to fix + the exact missing parent + the tenant scope to query in — operator can resolve in one query.

**What if the FK breaks AFTER pre-validation (rare race).** Invariant 6's pre-validation runs under the inner RPC's pre-handler target-row locks (per §8.3's `lock_targets_for_kind` helper). A concurrent editor cannot delete a locked parent row mid-transaction. The handler therefore does NOT need a catch-all `EXCEPTION WHEN foreign_key_violation` clause (per the per-category handler's step-7 comment) — the only path a raw 23503 could escape is a future code-path that bypasses the lock helper, in which case the raw SQLSTATE propagating to outer's `crashed` classifier is the RIGHT signal (an unexpected race surfaces as an investigation signal, not as a silent `revert_blocked` string that loses the original SQLSTATE diagnostic).

The whole inner transaction rolls back via the BEGIN…EXCEPTION subtransaction — no partial mutations. Operator sees the rejection in the attempt table + Sentry alert + can manually recover the broken FK before retrying.

### 8.8 v0.2 claim RPCs are GONE; v0.3 monolith is REFRAMED as outer/inner per CV2-B6

v0.2's three-step claim pattern (`acquire` + `commit` + `fail`) — REMOVED in v0.3. v0.3's single all-in-one RPC `revert_md_upload` — RECAST in v0.4 as the outer/inner two-RPC split per CV2-B6:

- **The atomic guarantee is preserved.** The inner `revert_md_upload_apply` is still "all-in-one" — single subtransaction (via outer's PL/pgSQL `BEGIN…EXCEPTION` block — the implementation-pattern equivalent of a SAVEPOINT; NOT a literal SAVEPOINT SQL statement, per the §4.4 transaction-control note), single dispatch+staleness+handler+audit pipeline, all rolls back together on any failure.
- **What's added is attempt-tracking.** Outer wraps inner to log every attempt (success / rejection / crash) for operator-visible failure observability. This was the gap CV2-B6 closed.

The `REVERT_IN_PROGRESS` sentinel from v0.2 is still REMOVED (never came back). CV-I11's stuck-pending monitoring is still moot (no pending audit-row state exists; pending lives on the attempt table for the duration of inner — typically milliseconds for the common path, but can extend to seconds under lock contention or large handler workloads).

The unique partial index on `reverts_upload_id WHERE error_message IS NULL` (`scheduler_admin_audit_log_one_successful_revert_idx`) from §4.1 is STILL VALUABLE — guards against duplicate successful reverts (defense-in-depth) since `successor_revert_id IS NULL` check in §8.1 step 2 is the primary line. When two parallel reverts somehow both pass eligibility (extremely unlikely given the `FOR UPDATE NOWAIT` on parent), the second's audit row INSERT raises `23505 unique_violation` with `CONSTRAINT_NAME = 'scheduler_admin_audit_log_one_successful_revert_idx'` — outer catches → `outcome='rejected'`, `reason_code='successor_revert_exists'`. Any OTHER 23505 (different constraint) classifies as `outcome='crashed'`, `reason_code='unique_violation'` per the X14 narrowing.

---

## 9. Chat-instructions system prompt update (Claude Desktop)

Per research-03 §7: making `dry_run` default to `true` is a breaking change. Without updating Claude Desktop's admin prompt, every legacy upload becomes a silent no-op.

Update `docs/chat-instructions/scheduler/` (TBD path — locate during implement phase) to add:

```
ADMIN MD-UPLOAD TWO-STEP FLOW (ALL upload_*_md TOOLS — both V2 and legacy)
- Step 1: Call upload tool with no dry_run (defaults to true). The tool
  parses, validates, and computes a diff WITHOUT writing.
- Step 2: Present the dry_run report (diff_summary, validation_errors,
  validation_warnings) to the advisor. Ask for explicit approval.
- Step 3: On approval, call again with { dry_run: false,
  expected_confirm_token: <token from step 1> } to apply. On token
  mismatch the tool rejects — re-run step 1.
```

Verify: smoke test via Claude Desktop after deploy — upload a no-op MD and assert it shows the dry_run preview before applying.

---

## 10. Build order (REVISED v0.2 per CV-B1 staged-migration + CV-I1 hard-gate)

**E1. Migration A + 5 RPC migrations** (apply via `supabase db push` HUMAN GATE) — REVISED v0.3 per CV2-B2:
- `20260526000000_scheduler_admin_audit_log_hardening_part_a.sql` (§4.1)
- `20260526000100_revert_md_upload_dispatch.sql` (§4.4 dispatch RPC)
- `20260526000200_revert_handlers_v2.sql` (V2 catalog handlers)
- `20260526000300_revert_handlers_v2_subcategories.sql` (V2 sub-surface handlers)
- `20260526000400_revert_handlers_legacy.sql` (5 legacy handlers per CV2-B2)
- `20260526000500_apply_handlers_uploads.sql` (5 apply RPCs per CV2-I2 — X-FIX-#24 sweep: was "10" in v0.5+IMPORTANTs which conflated with revert handlers)
- Apply to test branch only
- Verify via `mcp__supabase__list_migrations` + `mcp__supabase__get_advisors`

**E2. Shared helpers** (code-only, no DB):
- E2a: `logAuditEntry()` consolidation in `scheduler-admin-md.ts` per DC-5 — REQUIRES shopId (CV-NTH)
- E2b: `canonicalizeDiff(diffSummary)` per DC-1 v0.2 + CV2-I4 v0.3 amendment + X-FIX-#18 (2026-05-26): sorts ONLY set-typed arrays. The full canonical set-typed allow-list is `{deactivated_keys, added_keys, added_subcategory_ids, added_question_ids, surfaces}` and any same-shape `added_*`/`*_keys`/`surfaces`-suffix names introduced by future handlers — the underscore-pluralized "this is a key set, not ordered data" suffix convention. The v0.5 allow-list cited only `{deactivated_keys, added_keys, surfaces}` which missed the per-category handler's `added_subcategory_ids` + `added_question_ids`. Preserves order on ordered arrays (`questions[]`, `options[]`). Object keys are always sorted (cheap + universally safe). The implementation extends the allow-list as `string.endsWith('_keys') || string.endsWith('_ids') || string === 'surfaces'` — captures all current naming + accommodates future handlers without per-name edits.
- E2c: `computeConfirmToken(mdHash, canonicalDiff)` in `scheduler-admin-md.ts` (replaces inline sha256 in `_uploadCatalogV2` + all 5 new legacy paths)
- E2d: `computeCanonicalAfterState(snapshot)` helper — REWRITTEN v0.5+IMPORTANTs X-FIX-#18 (2026-05-26) to align with the DB-authoritative apply design.
  - v0.5 incorrectly stated this helper is "reused at apply time to populate `expected_after_state_canonical` in the snapshot." That contradicted §5.1/§5.3/§5.4/§5.5, which explicitly say apply RPCs compute `expected_after_state_canonical` INSIDE Postgres after writes by re-reading persisted rows. The DB-authoritative design is the active one — the TS helper does NOT predict after-state.
  - Active design: `computeCanonicalAfterState` is a **revert-side-only** helper that produces canonical-MD from a JSONB snapshot — used by the revert path to compare expected canonical state to current canonical state for diff diagnostics on staleness rejection (per CV2-B3 v0.3). It is NOT called by apply RPCs.
  - The apply RPC's `expected_after_state_canonical` is computed Postgres-side via the per-snapshot_kind canonical-serializer functions (`canonical_state_<kind>` per §8.3 dispatch + X-FIX-2) — after the writes succeed, re-reading the persisted rows is the source of truth, not a TS prediction.
  - Closes GPT chunk 4 IMPORTANT "computeCanonicalAfterState(snapshot) contradicts the DB-authoritative apply design".

**E3. Backfill scripts** (Deno one-shots, before legacy refactors land):
- E3a: `scripts/backfill-snapshot-kind.ts` — writes `snapshot_kind` into existing V2 audit-row snapshots
- E3b: `scripts/backfill-audit-log-shop-id.ts` per §4.2

**E4. Update existing V2 uploaders to canonicalize diff + emit `expected_after_state_canonical`** (per CV-I6 + CV-I3 + CV2-B3 v0.3 + X-FIX-#18 — 2026-05-26 — closes GPT chunk 4 IMPORTANT "Existing V2 uploaders are updated to after_hash but not clearly to expected_after_state_canonical"):
- `_uploadCatalogV2` (testing + routine) writes `snapshot.snapshot_kind` + `snapshot.expected_after_state_canonical` (the full canonical-MD post-apply state — read from the persisted rows after the apply, NOT predicted in TS) + `snapshot.after_hash` (derived from `expected_after_state_canonical` as `encode(digest(expected_after_state_canonical, 'sha256'), 'hex')` per X-FIX-1 pgcrypto form), uses `canonicalizeDiff` for token + return + audit
- 3 V2 sub-surface uploaders (`uploadSubcategoryDescriptionsMdV2`, `uploadSubcategoryServiceMapMdV2`, `uploadQuestionRequiredFactsMdV2`) get the same treatment + their snapshots gain distinct `snapshot_kind` values + write both `expected_after_state_canonical` and `after_hash`
- v0.5 wording said "emit after_hash" — that was incomplete because the post-CV2-B3 revert contract requires `expected_after_state_canonical` (full content, for diff diagnostics on staleness rejection); `after_hash` alone gives a yes/no drift signal but no diff. X-FIX-#18 makes the active contract explicit so V2 uploader rewrites carry both fields per the revert system's expectation.

**E5. Refactor 5 legacy uploaders → Pattern S** — one PR per uploader:

**Cross-reference for E5's 5 `apply_<table>_upload` RPCs (X-FIX-AGENT-B note; X-FIX-#24 — 2026-05-26 — corrected from "10" which conflated apply RPCs with revert handlers; the 5 are E5a-e below).** Each apply RPC is a SECURITY DEFINER function authored during implementation of this feature (NOT dynamically generated). Every apply RPC MUST follow the canonical multi-tenant security setup block (see §4.4 top) — `SECURITY DEFINER`, `SET search_path = pg_catalog, extensions, public`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`. Every apply RPC MUST implement STEP 0a + STEP 0b parameter-presence + actor-identity guards (same pattern as the revert RPCs in §4.4). Every apply RPC's UPSERT path MUST apply Invariant 1's RIGHT pattern + Invariant 5 (cross-shop UPSERT-hijack prevention via `WHERE target.shop_id = p_shop_id` + row-count check), AND Invariant 6 (FK target tenant validation) for any FK columns the rows carry. These are the SAME guarantees the revert RPCs provide; they apply at apply time too because the snapshot reverts later trust is generated by these RPCs. If an apply RPC silently mis-writes a foreign-shop row, the eventual revert will rest on a snapshot that already encodes the bad state. The integrity layer must be load-bearing on BOTH writes (apply) and reads-of-prior-writes (revert).

- E5a: `uploadConcernCategoryGuidelineMd` (simplest)
  - Apply path moves into `apply_concern_category_guideline_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)` RPC per CV2-I2 v0.3; audit row + `expected_after_state_canonical` written inside the same transaction.
- E5b: `uploadAppointmentDefaultLimitsMd`
  - Apply path moves into `apply_appointment_default_limits_upload(p_shop_id, p_snapshot, p_diff, p_audit)` RPC per CV2-I2 v0.3; audit row + `expected_after_state_canonical` written inside the same transaction.
- E5c: `uploadClosedDatesMd` — uses `apply_closed_dates_upload(p_shop_id, p_snapshot, p_diff, p_audit)` RPC for transactional apply (DC-3 v0.2 + CV2-I2 v0.3); shop-TZ-aware `original_today` (CV-I8)
  - Apply path moves into `apply_closed_dates_upload(p_shop_id, p_snapshot, p_diff, p_audit)` RPC per CV2-I2 v0.3 with per-`(shop_id, date)` advisory locks (see §5.5); audit row + `expected_after_state_canonical` written inside the same transaction.
- E5d: `uploadConcernQuestionsMd` (snapshot_kind=`concern_questions_flat`, DC-4 v0.2)
  - Apply path moves into `apply_concern_questions_flat_upload(p_shop_id, p_snapshot, p_diff, p_audit)` RPC per CV2-I2 v0.3 (replacing the legacy `scheduler-admin.ts:1003-1056` TS loop); audit row + `expected_after_state_canonical` written inside the same transaction.
- E5e: `uploadConcernCategoryMd` (snapshot_kind=`concern_questions_per_category`, biggest; uses `apply_concern_category_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)` RPC for transactional 2-table apply per CV-I5; DEFAULT_OPTIONS surfaced in diff per DC-2 v0.2; audit `diff_summary.surfaces=["concern_subcategories","concern_questions"]` per CV-I9)
  - Apply path moves into `apply_concern_category_upload(p_shop_id, p_snapshot, p_diff, p_audit, p_category_slug)` RPC per CV2-I2 v0.3; audit row + `expected_after_state_canonical` written inside the same transaction.
- Each: refactor impl + update tool registry block + add pure-fn diff helper + tests

**E6. Add 2 new exporters**:
- `exportConcernCategoryMd` + `exportConcernCategoryGuidelineMd`
- Empty-state returns parseable template per CV-I10
- New tool registry blocks
- Round-trip tests against the matching parsers

**E7. Add `list_scheduler_admin_audit_log` tool**:
- Inside admin-block of `scheduler-tools.ts`
- Per-row eligibility helper (pure function — unit testable)
- Surface filter resolves via the X-FIX-#15 conditional-fallback form per §7.2 (modern surfaces[] OR legacy table_name; X-FIX-#26 — 2026-05-26 — was the old over-broad `(table_name = ? OR diff_summary->'surfaces' ? ?)` which caused false-positive matches on shared physical tables): see §7.2 final filter SQL
- Eligibility for legacy NULL-shop_id rows = `shop_id_unknown_pre_migration_backfill` per CV-B5

**E8. Replace `revertMdUpload` with thin RPC wrapper** — REWRITTEN v0.4 per CV2-B2 + CV2-B6 + CV2-B5-v0.3-AMEND:
- TS `revertMdUpload` becomes ~50-60-line wrapper that calls the OUTER `revert_md_upload_attempt` RPC via `sb.rpc(...).single()` per CV2-I6 + CV2-B6
- All dispatch + eligibility + staleness check + multi-tenant scoping + handler invocation + audit-row INSERT + parent pointer update + attempt-row lifecycle happens INSIDE the plpgsql RPCs (per §8.1 outer/inner walkthrough)
- Per-table revert handlers are the 10 plpgsql functions deployed in E1c-e (NOT TS code)
- Wrapper passes through `dry_run` + `expected_confirm_token` parameters per CV2-B5-v0.3-AMEND (revert two-step flow)
- Wrapper emits Sentry event when outer's `outcome IN ('rejected','crashed')` per CV2-B6 (TS-wrapper-side emission, NOT a DB trigger; carries machine-readable `reason_code` per §3b CV2-B6 redaction policy — `error_detail` stays DB-only). The `failed` outcome was REMOVED from the CHECK constraint in v0.4 since no code path assigned it.
- p_force_no_after_hash escape hatch per CV2-I8 (logged + flagged when used; param name retained, feature semantically gates on missing `expected_after_state_canonical`)

**E9. Update chat-instructions system prompt** (Claude Desktop two-step flow) — **HARD DEPLOY GATE per CV-I1**:
- Update `docs/chat-instructions/scheduler/` admin prompt
- Add structured Sentry warning on uploader call when `dry_run=false` AND `expected_confirm_token` unset (CV2-I3 v0.3 fix — narrower than CV-I1 v0.2's "either unset"; only fires on actual misuse)
- **E11a-e below cannot start until this PR merges in dotfiles**

**E10. Cross-verify via `/feature-cross-verify`** on the whole feature:
- `node scripts/ai-review.mjs --what "scheduler-edge-parity v0.5 implementation" <key files>` (full canonical invocation in §14)
- Address findings before deploy

**E11. Deploy** — each step HUMAN GATED per `.claude/rules/deployment.md`:
- **E11-pre**: verify chat-instructions PR is merged (CV-I1 hard gate)
- E11a: `supabase functions deploy orchestrator-mcp` — verify via curl test
- E11b: Run `scripts/backfill-snapshot-kind.ts` against test branch
- E11c: Run `scripts/backfill-audit-log-shop-id.ts` PHASE 1 (derive-only) against test branch
- E11d: Chris reviews PHASE 1 report; if any NULL rows remain, either backfill manually OR re-run script with `--apply-sentinel-now` to gated-UPDATE NULL→-1 (PHASE 2). Migration B will RAISE EXCEPTION if any NULLs remain.
- E11e: Apply Migration B (NOT NULL transition — fails loud if PHASE 2 wasn't run when needed)
- E11f: Live smoke battery:
  - Call each refactored uploader with valid `md_content` (+ `category_slug` where required) and `dry_run` OMITTED (defaults to true per E5/E5.6) → assert response has `dry_run: true` + `confirm_token` populated. Uploaders never accept "no args" — `md_content` is always required; the test exercises the default-true behavior of the new optional `dry_run` field.
  - Call new audit-log tool → assert per-row eligibility populated
  - Call new exporters → assert round-trip to uploader is no-op
  - Revert dry_run + apply two-step happy path (per CV2-B5-v0.3-AMEND / X4): call `revert_md_upload` with `dry_run: true` (no `expected_confirm_token`) → assert `outcome='dry_run_success'`, `dry_run: true`, `confirm_token` populated, no audit row written, no parent `successor_revert_id` set, attempt-row `outcome='dry_run_success'` with `reason_code=NULL` (token traceability via Agent F's pending `dry_run_confirm_token_hash` column rather than overloading `reason_code` with a sensitive token). Then call again with `dry_run: false` + that same `expected_confirm_token` → assert apply succeeds, `outcome='success'`, parent's `successor_revert_id` set, revert audit row written with `error_message=NULL`, attempt-row `outcome='success'`.
  - Revert dry_run staleness rejection (X4): apply an upload, then directly mutate a target row (simulate post-upload editor activity), then call `revert_md_upload` with `dry_run: true` → assert `outcome='rejected'`, `reason_code='current_state_drift'`, `error_message` includes the unified-diff content from `compute_unified_diff` AND no confirm_token is returned AND attempt-row `outcome='rejected'`. The drift must be rejected at dry_run; the operator should NOT receive a token that they could then apply over the post-upload edits. (TS wrapper classifies on `outcome` — NOT on `error_message` — so this test asserts the wrapper returns `{ ok: false, outcome: 'rejected', reason_code: 'current_state_drift', error_message, attempt_id }`.)
  - Revert dry_run with `expected_confirm_token` passed → rejected loud (X-AMEND-v2): call `revert_md_upload` with `dry_run: true` AND a non-null `expected_confirm_token` → assert `outcome='rejected', reason_code='dry_run_token_present'` (X-FIX-#26 — 2026-05-26 — canonical enum per §3b; the RAISE prefix is `revert_blocked: dry_run_token_present: <verbose>` per Fix #11; classifier extracts just the enum). NOTE per Fix #12: dry-run with a passed token IS a malformed-parameters case, so per STEP 0d pre-validation the attempt row IS still created (parameters are syntactically valid; the rejection comes from the inner RPC's step 3 dry-run/apply parameter-invariant guard, not from a STEP 0 guard). v0.3's behavior was to silently ignore the token; v0.4 rejects to catch caller bugs that confuse the two-step flow.
  - Revert apply concurrent-edit race rejection (X13): in a controlled test, (a) start a long-running transaction that does `BEGIN; UPDATE testing_services SET name='X' WHERE shop_id = ? AND id = ?; -- do not commit yet`; (b) from a separate session call `revert_md_upload` `dry_run: true` against an upload that targets that row; (c) the dry_run should BLOCK on the inner RPC's `lock_targets_for_kind` step (per §4.4 step 4), NOT race past it; (d) commit the first transaction; (e) the dry_run unblocks and either succeeds (if the edit happened to match the snapshot's expected-after-state) or rejects with `outcome='rejected', reason_code='current_state_drift'` (the common case; X-FIX-#26 — 2026-05-26 — was `staleness_check_failed` which is the inner-RPC RAISE prefix, NOT the canonical reason_code; outer's classifier maps `staleness_check_failed:` prefix → `current_state_drift` per §3b CV2-B6 enum). The smoke test asserts the dry_run does NOT silently revert over the concurrent edit — the lock-then-snapshot ordering protects against the v0.3 TOCTOU.
  - Revert step-ordering audit (X-FIX-AGENT-E, X4): instrument the inner RPC with a temporary `RAISE NOTICE` on each step's entry (steps 1-12); call `revert_md_upload` `dry_run: true` against a normally-non-drifted upload; assert the NOTICE order is 0a-0b-1-2-3-4-5-6-7 (no 8-12). Then call apply on the same upload with the returned token; assert the NOTICE order is 0a-0b-1-2-3-4-5-6-8-9-10-11-12 (no 7). This verifies step 4 (locks) precedes step 5 (canonical compute) precedes step 6 (staleness) precedes step 7 (dry-run return) — closes X4 + X13. Strip the NOTICEs after the test passes.
  - Confirm-token stability across JSONB rendering simulation (X-FIX-AGENT-E, X-AMEND-v2): manually mutate a test snapshot's JSONB key ordering (e.g., reverse the object key order without changing any value) via `pg_dump | sed | pg_restore` on a test branch; call `revert_md_upload` `dry_run: true` and capture the returned token; call again with the original key order; assert BOTH tokens are IDENTICAL. With v0.3's `sha256(v_snapshot::text)` this test would FAIL (jsonb::text rendering changes); with v0.4's 4-explicit-field binding it MUST PASS — the token components are deliberately-canonicalized hashes + stable scalars, not raw JSONB text.
  - Concurrent revert test: spawn two `revert_md_upload` apply calls on same upload_id → one succeeds, one fails with `55P03` (lock_not_available) OR `successor_revert_exists` (the second call after the first commits)
  - Smoke check Sentry for the CV2-I3 canary — should be ZERO `dry_run=false + no expected_confirm_token` events from Claude Desktop after the chat-instructions land
  - Cross-shop isolation test (per PE-2 / CV-B1): call revert_md_upload from one shop's actor on an audit row from a different shop → assert `not_found` (NOT cross-shop pollution)
  - `lock_targets_for_kind` per-kind sanity (X-FIX-AGENT-E): for EACH of the 10 snapshot_kinds, set up a test upload + revert against a non-existent snapshot key (e.g., snapshot.before contains an id that doesn't exist in the target table) → assert the helper returns `v_lock_count = 0` (lock predicate matched zero rows; this is acceptable — the staleness check at step 6 will catch the divergence via the after_hash mismatch). Then set up a valid snapshot → assert `v_lock_count > 0` for kinds with non-empty before (matches expected row count) and `v_lock_count = N` for closed_dates_future where N = number of dates in before ∪ added_keys.

**E12. Resume schedulerconfig feature**:
- Re-`/feature-start schedulerconfig` (restore from `feature-archive/`)
- Re-cross-verify the schedulerconfig plan as v0.4 — confirm B1, B2, B3, B4 + I3, I4 are all closed by edge-parity ship
- Continue implementing per the (revised) schedulerconfig plan

---

## 11. File inventory

### New files (12) — REVISED v0.4 per CV2-B6 (outer/inner two-RPC split adds the `scheduler_admin_revert_attempts` CREATE TABLE inside Migration A — no new file) + CV2-I2 (apply RPCs); v0.5 prose-only refresh per X-FIX-AGENT-G

**Migrations (7):**
- `supabase/migrations/20260526000000_scheduler_admin_audit_log_hardening_part_a.sql` — additive schema (nullable shop_id + CHECK loosen + revert linkage + B-tree + GIN indexes per CV2-I10)
- `supabase/migrations/20260526000100_revert_md_upload_dispatch.sql` — outer + inner dispatch RPCs (`revert_md_upload_attempt` outer per CV2-B6 + `revert_md_upload_apply` inner per CV2-B2 + CV2-B5-v0.3-AMEND dry_run mode + X-FIX-AGENT-E reordered steps) PLUS THREE helper functions: `lock_targets_for_kind` (X-FIX-AGENT-E closes X13 TOCTOU), `compute_unified_diff` (line-aligned diff for staleness rejection diagnostics), and **`compute_current_canonical_for_kind` + 10 per-kind `canonical_state_<kind>` backing functions** (X-FIX-2 closes "compute_current_canonical_for_kind referenced but not defined" — full specs in §8.3; ~500 LOC of plpgsql for the 10 serializers; MUST be byte-identical to TS exporters per parity contract)
- `supabase/migrations/20260526000200_revert_handlers_v2.sql` — `revert_testing_services_v2` + `revert_routine_services_v2`
- `supabase/migrations/20260526000300_revert_handlers_v2_subcategories.sql` — 3 V2 sub-surface handlers
- `supabase/migrations/20260526000400_revert_handlers_legacy.sql` — 5 legacy handlers
- `supabase/migrations/20260526000500_apply_handlers_uploads.sql` — 5 apply RPCs per CV2-I2 (X-FIX-#24 sweep: was "10")
- `supabase/migrations/20260526100000_scheduler_admin_audit_log_hardening_part_b.sql` — NOT NULL transition (RAISE EXCEPTION on residual NULL rows per CV2-B4 — fails loud if backfill PHASE 2 was skipped) (HUMAN GATED — only after E11d verification)

**Scripts (2):**
- `scripts/backfill-snapshot-kind.ts` — one-shot Deno (E3a)
- `scripts/backfill-audit-log-shop-id.ts` — one-shot Deno (E3b) per CV-B5

**Tests (3):**
- `supabase/functions/_shared/tools/scheduler-admin-legacy.test.ts` — pure-fn tests for the 5 refactored legacy uploaders + canonicalizeDiff (per-set-only sort per CV2-I4)
- `supabase/functions/_shared/tools/scheduler-admin-revert-extension.test.ts` — pure-fn tests for TS-side revert wrapper + pgTAP tests for the 10 plpgsql handlers + concurrent-revert (NOWAIT) + after_hash staleness (with `expected_after_state_canonical` per CV2-B3) + v0.4 X-AMEND tests: dry_run staleness rejection (X4 — dry_run never returns token over drifted state), dry_run + expected_confirm_token loud rejection (X-AMEND-v2 — caller-confusion guard), inner-RPC TOCTOU lock ordering (X13 — `lock_targets_for_kind` acquires before canonical compute), confirm_token stability across simulated JSONB rendering changes (X-AMEND-v2 token-binding stability)
- `supabase/functions/_shared/tools/scheduler-admin-audit-log-list.test.ts` — pure-fn tests for list tool's eligibility computation including the new 10-reason union (per CV2-I7)

### Modified files (5)
- `supabase/functions/_shared/scheduler-admin-md.ts` — add `computeConfirmToken` + `logAuditEntry()` consolidated helper
- `supabase/functions/_shared/tools/scheduler-admin.ts` — refactor 5 uploaders + add 2 exporters; ~+500 / -300 lines net
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` — REWRITTEN v0.4 per CV2-B2 v0.3 + CV2-B6 + CV2-B5-v0.3-AMEND + X-FIX-AGENT-F; emission pattern locked v0.5 per X-FIX-AGENT-G. The `revertMdUpload` function becomes a ~50-60-line thin TS wrapper that calls the OUTER plpgsql RPC `revert_md_upload_attempt` via `sb.rpc(...).single()`. All dispatch + eligibility + staleness check + handler invocation + audit-row INSERT + parent-pointer update + attempt-row lifecycle now live in plpgsql (outer + inner RPCs + 10 revert handler RPCs + 5 apply RPCs deployed across §4.6 steps **E1a-f** — X-FIX-#17 (2026-05-26): was "E1b-f" in v0.5 which omitted E1a (the part-a additive-schema migration) and over-counted apply RPCs as 10 — actual count is 5 legacy uploaders + 5 apply RPCs, NOT 10; see §11 Migrations list for the canonical file inventory). The wrapper's responsibilities are EXACTLY four: (a) pass through `dry_run` and `expected_confirm_token` parameters per CV2-B5-v0.3-AMEND, (b) call `sb.rpc('revert_md_upload_attempt', {...}).single()` and unwrap the result, (c) inspect the outer RPC's `outcome` field and emit a Sentry event (per the canonical pattern in §3b CV2-B6 bullet 4) when outcome is `rejected`/`crashed` — payload carries `tags.shop_id`/`upload_id`/`actor_email`/`outcome`/`reason_code`/`attempt_id` only; verbose `error_detail` is INTENTIONALLY EXCLUDED per the redaction policy. The `'failed'` outcome was removed from the enum per X-FIX-AGENT-F — no code path emits it. (d) Return the structured `{ ok, ...data }` result classified on `data.outcome` (NOT `data.error_message`). Per-table revert handlers and all dispatch / eligibility / staleness logic are NO LONGER in this TS file. Also consolidate the local `_logAudit` call to the new shared helper.
- `supabase/functions/_shared/scheduler-tools.ts` — update 5 legacy tool blocks for Pattern S; add 2 exporter blocks; add 1 new list-audit-log block; ~+150 / -50 lines net
- `docs/chat-instructions/scheduler/` (path TBD) — add two-step flow doc per §9

### Updated docs (3)
- `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` — add `closed_dates two-mutation-path tightening` follow-up per DC-3
- `docs/scheduler/future-release-notes.md` — note the orchestrator-side breaking change (dry_run default change)
- `.claude/memory/scheduler_system_architecture.md` — update Pattern S inventory + revert dispatch shape per the rule in MEMORY.md

---

## 12. Testing approach

Mirrors the existing test patterns in `tools/scheduler-admin-catalog.test.ts` (pure helpers, Deno-native, JSR `@std/assert`).

### Per-uploader (E5a-e)
18 test cases per uploader from research-03 §8 — focus on diff + token determinism, dry_run never writes, token mismatch path, FK-broken handling. Extract `computeXyzDiff(currentRows, parsedRows)` as a pure helper to enable testing without a SupabaseClient.

### Per-exporter (E6)
Round-trip: `parseFn(serializeFn(state)) === state`. One test per exporter (research-02 §8). DB-backed smoke test: `upload(export(current)) === no-op` (relies on SHA-256 duplicate-upload fast-path).

### Audit-log read tool (E7) — UPDATED v0.5+IMPORTANTs (X-FIX-#15)

Pure-fn eligibility computation: feed synthetic audit rows, assert correct `reasons[]` for each rejection cause (research-01 §7). **9 rejection causes × 2 (eligible/ineligible boundary) = 18 cases minimum** — was "6 × 2 = 12" in v0.5 which became stale after the §7.3 reasons union grew from 6 → 10 → 9 values across cross-verify rounds. X-FIX-#15 (2026-05-26) syncs the test count to the final reasons union: `not_upload_md`, `snapshot_pruned`, `no_snapshot`, `table_not_supported`, `upload_failed`, `successor_revert_exists`, `over_30_day_cutoff`, `shop_id_unknown_pre_migration_backfill`, `after_hash_check_unavailable`. Closes GPT chunk 4 IMPORTANT "Audit-log tests still say 6 rejection causes despite the 10-reason union" (which was already itself stale relative to the 9-reason post-#15 union).

Additional surface filter tests (X-FIX-#15): explicit cases that verify the conditional fallback narrows correctly — `question_required_facts` filter on a `concern_questions_flat` upload's audit row (must NOT return because `surfaces[]=['concern_questions']` without `question_required_facts`), vs the same filter on a row that DOES carry `surfaces[]` containing `question_required_facts` (must return). Plus a legacy-row test: an audit row missing `surfaces[]` keyed by `table_name='concern_questions'` matches the legacy fallback branch.

### Revert extension (E8) — UPDATED v0.5+IMPORTANTs (X-FIX-#15+#17)

Per research-04 §8: ~7 cases per new handler + 7 shared-invariant cases. Most important: race test (parallel reverts of same `upload_id` — one fails fast with SQLSTATE `55P03` `another_revert_in_progress` per outer's NOWAIT lock, OR with `successor_revert_exists` per the partial unique index — both correct outcomes per the X-FIX-AGENT-A 23505 narrowing in §3b CV2-B6); staleness test (drift catalog head between dry-run + apply → outer returns `outcome='rejected', reason_code='current_state_drift'` per §3b enum — was `staleness_check_failed` in v0.5, X-FIX-#11 aligned to the canonical enum); shop-scoping test (audit row's `shop_id` ≠ caller's → `not_found` reason_code per X-FIX-#12 STEP 0d pre-validation, NOT a raw FK violation).

### Live smoke (E11)
- curl each refactored uploader with `dry_run` omitted → assert response has `dry_run: true, confirm_token: <hex>`
- curl with `dry_run: false, expected_confirm_token: <wrong>` → assert mismatch error
- curl with correct token → assert apply succeeds AND `audit_log_id` is returned
- curl the new audit-log tool → assert each returned row has populated `revert_eligibility`
- curl `revert_md_upload` for one of the new tables → assert apply succeeds AND the parent audit row has `successor_revert_id` set

---

## 13. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Migration fails to apply OR the gated backfill script (`scripts/backfill-audit-log-shop-id.ts` PHASE 1/PHASE 2) fails to converge before Migration B's loud NULL check | Apply Migration A to test branch FIRST; run backfill script PHASE 1 to surface residual NULL count; if M>0, gate on PHASE 2 sentinel-UPDATE OR manual backfill before Migration B; Migration B's `DO $$ ... RAISE EXCEPTION 'NULL rows remain' ... $$;` block fails loud if PHASE 2 was skipped; verify via `mcp__supabase__get_advisors`; staged commit so rollback is just `git revert` + `supabase db reset`. X-FIX-#17 (2026-05-26): the v0.5 wording "backfill UPDATE hits a constraint we don't expect" was stale — backfill is a Deno script (not a migration UPDATE) per CV3-A-I1 v0.4. |
| Snapshot-kind backfill heuristic mis-classifies an existing V2 row | Deno script logs every classification decision; manual spot-check; idempotent so re-run is safe |
| Refactoring `uploadConcernCategoryMd` (most complex) introduces a regression in the per-category upload path | Pure-fn diff helper makes the diff phase unit-testable; live smoke against test Supabase before deploy; revert-from-snapshot is the safety net if a bad upload lands |
| Claude Desktop chat-instructions update misses the deploy window → every admin upload silently no-ops for hours | Bundle the prompt update in the same PR as the edge fn changes; smoke test via Claude Desktop immediately post-deploy |
| `revertMdUpload`'s outer/inner RPC pair (`revert_md_upload_attempt` + `revert_md_upload_apply` per CV2-B6 v0.4) returns `55P03` (lock_not_available) under unrelated long-running queries holding the parent audit row | Outer's classifier maps `55P03` → `outcome='rejected'`, `reason_code='another_revert_in_progress'` per §3b CV2-B6; TS wrapper surfaces a clean "another revert is in progress" error to the caller; client retries OK |
| Tests rely on chainable Supabase mock that doesn't exist yet | Keep diff-computation pure; defer apply-path tests to curl smoke; if a mock is needed later, mirror `_shared/test-helpers.ts:createMockSupabaseClient()` |
| `scheduler-tools.ts` grows past readable size after adding 1 tool + extending 5 + adding 2 exporters | Acceptable for this feature; flag for a future refactor that splits per-domain (admin vs customer-facing) |

---

## 14. Cross-verify checklist (run after E10 implementation complete) — REVISED v0.5

```bash
node scripts/ai-review.mjs \
  --max-tokens-per-file 100000 \
  --what "scheduler-edge-parity v0.5+IMPORTANTs+round3 implementation — outer/inner two-RPC revert dispatch (CV2-B6) + 5 legacy uploaders refactored to Pattern S + 5 apply RPCs + 10 revert plpgsql handlers + scheduler_admin_revert_attempts table + audit-log read tool + 2 new exporters + Migration A/B split + chat-instructions update + TS-wrapper-side Sentry emission with redaction policy" \
  supabase/migrations/20260526000000_scheduler_admin_audit_log_hardening_part_a.sql \
  supabase/migrations/20260526000100_revert_md_upload_dispatch.sql \
  supabase/migrations/20260526000200_revert_handlers_v2.sql \
  supabase/migrations/20260526000300_revert_handlers_v2_subcategories.sql \
  supabase/migrations/20260526000400_revert_handlers_legacy.sql \
  supabase/migrations/20260526000500_apply_handlers_uploads.sql \
  supabase/migrations/20260526100000_scheduler_admin_audit_log_hardening_part_b.sql \
  supabase/functions/_shared/tools/scheduler-admin.ts \
  supabase/functions/_shared/tools/scheduler-admin-catalog.ts \
  supabase/functions/_shared/scheduler-tools.ts \
  supabase/functions/_shared/scheduler-admin-md.ts \
  scripts/backfill-snapshot-kind.ts \
  scripts/backfill-audit-log-shop-id.ts \
  docs/chat-instructions/scheduler/...two-step-flow.md
```

Note: `--max-tokens-per-file 100000` is REQUIRED — the default 8000 silently truncates large files (bug tracked separately in spawned task).

If Gemini or GPT flags new blockers, address before deploy. If verdict APPROVED, proceed to E11.

---

## 15. Remaining open questions (for Chris before implementing) — REVISED v0.5

None blocking — DC-1 through DC-6 (with v0.2 revisions to DC-1/3/4) and CV-* + CV2-* additions are the calls. Summary:

- **DC-1 v0.2:** `canonicalizeDiff` over the ENTIRE diff_summary, with the v0.3 amendment per CV2-I4: only SORT sets (deactivated_keys/added_keys/surfaces), preserve order on ordered arrays (questions/options).
- **DC-2 v0.2:** Defaulted options included in diff itself, not just warnings.
- **DC-3 v0.2:** `closed_dates` apply uses `apply_closed_dates_upload` SECURITY DEFINER RPC for transactional safety (matches v0.3 generalization in CV2-I2).
- **DC-4 v0.2:** Per-table dispatch via `snapshot_kind` registry. v0.3 superseded by CV2-B2 (monolithic `revert_md_upload` RPC); v0.4 RECAST as outer/inner two-RPC pair `revert_md_upload_attempt` + `revert_md_upload_apply` per CV2-B6 (dispatch + handlers SURVIVE inside the inner RPC). v0.5+IMPORTANTs X-FIX-#17 (2026-05-26): name clarified here so future implementers don't grep for the obsolete monolithic name.
- **DC-5:** `logAuditEntry` consolidation with required `shopId`.
- **DC-6:** Refuse FK-broken revert with explicit error.

Plus operational Qs for after deploy:

- **Q-OPS-1:** do we want the snapshot-kind backfill script (E2/E11b) to dry-run-and-log first, or apply straight away? Recommend: dry-run first against test branch to see the classification distribution, then apply.
- **Q-OPS-2 (NEW v0.3, REVISED per A-B12 amendment):** after Migration B applies, all rows have either a positive shop_id (real) or `-1` (sentinel from explicitly-accepted backfill residual). The sentinel approach is permanent — do not periodically re-derive. Sentinel rows surface in list-audit-log with `revert_eligibility.reason='shop_id_unknown_pre_migration_backfill'` for transparency.

---

## 16. Versioning

- v0.1 (2026-05-25) — initial synthesis. Bundles all 6 PE-bugs + 4 new features. Build order E1-E12; deploy gates per `.claude/rules/deployment.md`.
- v0.2 (2026-05-25) — **revised post-cross-verify** (`.claude/work/ai-review-2026-05-25T23-57-10Z.md`). Addresses 5 blockers + 11 importants:
  - **CV-B1**: Split migration into A (additive/nullable) + B (NOT NULL transition). Backfill in separate Deno script, not inside migration.
  - **CV-B2**: Replaced "race-proof partial unique index" with real claim-RPC pattern (`revert_md_upload_acquire` does `FOR UPDATE NOWAIT` + INSERT-pending-row + UPDATE-parent-pointer atomically). Index becomes second line of defense.
  - **CV-B3**: Added `snapshot_kind` fallback for pre-migration V2 rows (fallback to `revertCatalogV2` when `snapshot_kind` missing AND table_name in known V2 catalogs).
  - **CV-B4**: Split DC-4 into two distinct handlers — `concern_questions_flat` vs `concern_questions_per_category` (snapshot shapes are incompatible).
  - **CV-B5**: Removed hardcoded `shop_id=7476` UPDATE from migration; deferred to derived backfill script; eligibility surfaces `shop_id_unknown_pre_migration_backfill` reason for NULL rows.
  - **CV-I1**: Chat-instructions update becomes HARD DEPLOY GATE (E11-pre check). Added structured Sentry canary on uploader calls with both `dry_run` and `expected_confirm_token` unset.
  - **CV-I2 + DC-3 v0.2**: closed_dates apply wrapped in `apply_closed_dates_upload` SECURITY DEFINER RPC for transactional safety beyond confirm_token re-verify.
  - **CV-I3**: Added `after_hash` to every NEW snapshot. Revert handler verifies current state hash matches `snapshot.after_hash` before restoring; refuses with diff on drift.
  - **CV-I5**: `apply_concern_category_upload` RPC wraps the 2-table apply for `uploadConcernCategoryMd` per CV-I5.
  - **CV-I6 + DC-1 v0.2**: `canonicalizeDiff(diffSummary)` recursively sorts ALL arrays + object keys. Same canonical form used for return + audit + token. Applied to existing V2 uploaders too.
  - **CV-I7 + DC-2 v0.2**: Defaulted options included in diff itself, not just warnings — preserves token reproducibility.
  - **CV-I8**: `closed_dates` `original_today` computed in shop TZ via `scheduler-tz.ts`.
  - **CV-I9**: `diff_summary.surfaces[]` array for multi-table operations. List-audit-log filter resolves via `WHERE table_name = ? OR diff_summary->'surfaces' ? ?`.
  - **CV-I10**: Empty guideline export returns parseable template with TODO body.
  - **CV-I11**: Failed-revert correctness clarified — pending row stays excluded from unique index; CV-I5 RPCs bound partial mutation risk.
  - **CV-NTH**: `logAuditEntry` signature requires `shopId` (not optional). Build-time guard against CV-B5 regression.

  File-count went 5 → 8 new (added 2 RPC migrations + 1 backfill script). Build order added E2c-d helpers + E4 V2-uploader update for canonicalize+after_hash. Tests gained concurrent-revert + after_hash + NULL-shop_id reason cases. Pending Chris approval before `/feature-implement` transition.
- v0.3 (2026-05-26) — **revised post-2nd-cross-verify** (`.claude/work/ai-review-2026-05-26T00-09-58Z.md`). Addresses 5 blockers + 12 importants from v0.2 cross-verify.

  > **Note on v0.3 → v0.4 evolution:** several items below were FURTHER SUPERSEDED in v0.4 — see the v0.4 changelog and §3b CV2-B6 / CV2-B5-v0.3-AMEND for the active design. Most notable changes: CV2-B2's monolithic `revert_md_upload` became the outer/inner pair (`revert_md_upload_attempt` + `revert_md_upload_apply`); CV2-B4's "NOTICE softening" was reverted to RAISE EXCEPTION in v0.4 (sentinel-UPDATE moved into backfill script); CV2-I11's `revert_upload audit row` alert was replaced by the `scheduler_admin_revert_attempts` outcome alert. v0.3 items not marked here are STILL ACTIVE in v0.4.

  - **CV2-B1:** Fixed internal `snapshot_kind` contradiction in §5.1 (was `concern_questions_per_category`, now `concern_questions_flat` per §8.1 + §10 E5d agreement).
  - **CV2-B2 (Chris's call):** ALL revert mutations now inside ONE SECURITY DEFINER RPC. Replaces v0.2's 3-RPC claim pattern. 10 plpgsql handler functions (per snapshot_kind) deployed in 4 new migration files. TS `revertMdUpload` is ~50-60 lines (X-FIX-#17 2026-05-26 — v0.3 cited "~30 lines" which became stale after the v0.4 outer/inner split added classifier-aware return-shape mapping + Sentry emission; §11 file inventory is the canonical line count source). No more pending/commit/fail dance. No more `REVERT_IN_PROGRESS` sentinel. **[v0.4: REFRAMED via CV2-B6 outer/inner split — the atomic guarantee + 10 handlers + no-pending design SURVIVE.]**
  - **CV2-B3:** Snapshot carries `expected_after_state_canonical` (the actual content), not just `after_hash`. Per-handler-scoped staleness check, not table-wide. Diff is surfaced on staleness rejection.
  - **CV2-B4:** Migration B's NULL-row check becomes a NOTICE (not EXCEPTION). Residual NULL rows get `shop_id=-1` sentinel before NOT NULL transition. Sentinel rows are non-revertable forever. **[v0.4: SUPERSEDED by CV3-A-I1 — Migration B now RAISE EXCEPTIONs on NULLs; sentinel-UPDATE moved into the gated backfill PHASE 2.]**
  - **CV2-B5:** Goal phrasing fixed (§1) — "captures pre_state_snapshot server-side on apply" (not "supports" — pre_state_snapshot is output, not input).
  - **CV2-I1:** §5.5 stale text rewritten to reference transactional `apply_closed_dates_upload` RPC (was: "left for confirm_token re-verify to catch" — directly contradicted DC-3 v0.2).
  - **CV2-I2:** EVERY multi-row upload apply path moved to transactional SECURITY DEFINER RPCs (5 apply RPCs total — the 5 legacy uploaders; X-FIX-#18 correction from v0.5's stale "10 apply RPCs", listed in §11). No more TS-orchestrated loops with partial-mutation risk.
  - **CV2-I3:** Canary condition narrowed — fires only on `dry_run=false + expected_confirm_token unset` (= actual misuse), NOT on Step 1 happy path.
  - **CV2-I4:** `canonicalizeDiff` sorts only sets (allow-list-based), preserves ordered arrays.
  - **CV2-I5:** Moot per CV2-B2 (all validation now inside one RPC before any side effect).
  - **CV2-I6:** `sb.rpc(...).single()` call shape documented.
  - **CV2-I7:** List-audit-log `revert_eligibility.reasons` union expanded to 10 values.
  - **CV2-I8:** `p_force_no_after_hash` escape hatch on `revert_md_upload` RPC (default false; logged when used). **[v0.4: terminology aligned — feature is about missing `expected_after_state_canonical` per CV2-B3; parameter name retained.]**
  - **CV2-I9:** Commit/fail RPCs REMOVED per CV2-B2.
  - **CV2-I10:** GIN expression index on `diff_summary->'surfaces'` added to Migration A.
  - **CV2-I11:** Sentry alert rule on `revert_upload` audit rows with non-null `error_message` (replaces stuck-pending monitoring — no pending rows exist in v0.3). **[v0.4: SUPERSEDED by CV2-B6 — rejected reverts now roll back entirely (no audit row); the new alert surface is `scheduler_admin_revert_attempts` outcome IN ('rejected','failed','crashed') via TS-wrapper emission.]**
  - **CV2-NTH:** Stale text cleaned in §14 (now references v0.3 + all 6 migrations + chat-instructions); §15 open Qs aligned with v0.3 decisions; file count reconciled (now 13).

  File-count went 8 → 13 new (added 4 more RPC migrations for the handler functions + 1 apply-RPCs migration). Build order's E1 expanded from 2 migrations to 6. §8 entirely rewritten (was claim-RPC pattern; now all-in-one RPC with 10 handlers). §11 + §14 + §15 + §16 cleaned of stale v0.1/v0.2 text. Pending Chris approval + 3rd cross-verify before `/feature-implement` transition.

  **Also bundled with v0.3 (separate concern but same session):** updated `scripts/ai-review.mjs` SYSTEM_INSTRUCTION to emphasize "full audit, list everything" instead of "highest-signal findings only" per Chris's instruction 2026-05-25. Plus raised Gemini's `maxOutputTokens` from 8192 to 16384.

- v0.4 (2026-05-26) — **revised post-3rd-cross-verify** (`.claude/work/ai-review-2026-05-26T00-26-44Z.md`). The 3rd cross-verify (with the new "full audit, list everything" prompt) surfaced 5 blockers + 22 importants — significantly more than prior rounds because the prompt change worked. Chris dispatched 4 specialized agents in parallel to address them, plus the orchestrator integrated 3 cross-agent coordination items. Key v0.4 deltas:
  - **CV3-B5 (Chris's A-B5 call):** Add `p_dry_run=true` mode to revert. Inner RPC computes + returns `confirm_token` over `(upload_id, table_name, current_head_canonical_hash, snapshot_hash)` without applying. Mirrors V2 catalog uploader two-step.
  - **CV3-B6 (Chris's A-B6 call):** Two-RPC split for failed-revert observability. NEW outer `revert_md_upload_attempt` always INSERTs an attempt row in NEW `scheduler_admin_revert_attempts` table (added to Migration A SQL). Outer wraps inner in a SAVEPOINT-equivalent `BEGIN…EXCEPTION` PL/pgSQL subtransaction (per X-FIX-AGENT-A — literal SAVEPOINT SQL doesn't compile in Postgres functions), captures outcome (`pending` → `success`/`dry_run_success`/`rejected`/`crashed`), never re-RAISEs. Inner does atomic apply (unchanged guarantee). Sentry alert rule on outcome IN (`rejected`,`crashed`). **[v0.5 amend: the `'failed'` outcome and its CHECK-constraint allow-list entry were REMOVED per v0.5 X-FIX-AGENT-F — BOTH-flagged as a dead state, no code path emits it. The original v0.4 design's 6-outcome enum is now a 5-outcome enum.]**
  - **CV3-B2/B7/B8/B9/B10/B11 (Apply RPC atomicity):** Every apply path now uses SECURITY DEFINER RPC with explicit `p_shop_id INTEGER NOT NULL` first param. Audit row written INSIDE the same transaction. Token re-verify + `expected_after_state_canonical` computation moved INSIDE the RPC (after writes succeed). closed_dates apply uses per-(shop_id, closed_date) advisory locks for true serialization against `block_appointment_capacity` (flag added for that tool to adopt same lock — DEFERRED-AUDIT-ITEMS).
  - **CV3-B3 + CV3-I3 + C-I5 + C-I6 + X9 + X10 (Revert handler contract):** Handler signatures now `RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)` — uniform 4-column shape with `details` as the per-handler metadata carrier (X9-X10 v0.4 fix; 9 handlers return `'{}'::JSONB`, `revert_closed_dates_future` populates `skipped_past_dates_restore` + `skipped_past_dates_delete`; inner RPC merges `v_stats.details` into audit row's `diff_summary` via JSONB concat). Each handler does `SELECT … FOR UPDATE` on target rows BEFORE mutating (closes TOCTOU). Each handler forces `shop_id = p_shop_id` literal (NEVER trusts snapshot row data). Per-category handler reads `subcategories_before`/`questions_before`/`added_subcategory_ids`/`added_question_ids` — NOT generic `before`/`added_keys`. appointment_default_limits handler hard-DELETEs added keys. closed_dates handler computes `current_today := (now() AT TIME ZONE shop_timezone(p_shop_id))::DATE` Postgres-side; conditional-DELETEs only `>= current_today` AND conditional-UPSERTs `before[*]` only `>= current_today` (X10 — past-date immutability applies to restores too); records `skipped_past_dates_restore` + `skipped_past_dates_delete` via `details`. v0.4 broken-sketch bugs (X9: `v_deleted` never populated; INTO-too-many-columns runtime error; unused `skipped` CTE; `array_agg` NULL-on-empty) all fixed in §8.2 handler rewrite.
  - **CV3-B1 (GIN index in SQL):** Added the GIN expression index to Migration A's actual SQL block (was previously only in §4.5 prose + §11 file inventory).
  - **CV3-A-I1 + CV3-B12/B13 (Migration B safety):** Removed unconditional UPDATE NULL→-1 from Migration B SQL. Migration B now RAISE EXCEPTIONs if any NULL rows remain. The NULL→-1 coercion lives in `scripts/backfill-audit-log-shop-id.ts` PHASE 2 (gated behind `--apply-sentinel-now` flag + interactive prompt). Added CHECK constraint `(shop_id > 0 OR shop_id = -1)` preventing future negative-sentinel drift.
  - **CV3-NTH (stale text):** §7.3 reasons union expanded 6→10. §7.2 surface filter description updated to reflect CV-I9 surfaces[] disambiguation. §10 E2b/E2d/E11f wording corrected. §11 file count corrected 13→12. §13 risks table RPC name updated.

  **Sub-agent execution:** 4 general-purpose agents dispatched in parallel on 2026-05-26 with strict non-overlapping section scopes; 29 total edits applied. Three retries on parallel-collision (Agent 2 and Agent 4 each hit a transient "file modified" error on a shared neighbor section, succeeded after the other agent finished). Total wall-clock: ~14 minutes. Post-merge orchestrator integration added the `scheduler_admin_revert_attempts` CREATE TABLE + RLS to Migration A SQL (Agent 4 had it only in §3b prose), rewrote §4.2 backfill script doc to spell out PHASE 1 (derive) + PHASE 2 (gated sentinel) explicitly, and updated §10 E11d to match.

  File-count stays at 12 new (the `scheduler_admin_revert_attempts` table + outer attempt RPC were added INSIDE existing Migration A SQL + the existing dispatch migration — no new file added; the 6 plpgsql handler migrations from v0.3 unchanged). Build order unchanged at E1-E12. Pending Chris approval + 4th cross-verify before `/feature-implement` transition.

- v0.5 (2026-05-26 — sequential 7-agent fix round) — addresses 5 BLOCKERS + 22 IMPORTANTS from the 4th-round chunked cross-verify (`.claude/work/ai-review-2026-05-26T01-04-47Z.md` CV-additions chunk + `T01-05-35Z.md` Migrations chunk + `T01-05-37Z.md` Revert chunk). The prior parallel 7-agent dispatch (2026-05-26) was rolled back due to file-edit collisions + Python-helper-bypass risk; the snapshot at `.claude/work/snapshots/v0.5-pre-rollback-2026-05-26.md` preserves the parallel attempt's good architectural decisions for traceability. v0.5 re-did the work SEQUENTIALLY with each agent seeing the prior agent's landed changes — zero Edit collisions across all 7 agents. Summary by agent:
  - **Agent A (RPC SQL correctness — X-FIX-AGENT-A):** X1 SAVEPOINT → BEGIN/EXCEPTION (literal SAVEPOINT SQL doesn't compile in Postgres functions); X2 inverted eligibility checks; X8 outcome-keyed TS wrapper (classifier reads `data.outcome`, NOT `data.error_message`); X14 23505 narrowing via CONSTRAINT_NAME (only `scheduler_admin_audit_log_one_successful_revert_idx` classifies as `successor_revert_exists`; all OTHER 23505 surfaces as `outcome='crashed'`, `reason_code='unique_violation'` — surfaces real data-integrity bugs); jsonb_build_object syntax fix; STEP 0a parameter-presence guard (PL/pgSQL params don't support `NOT NULL`); X3 confirmed false positive; `reason_code` as canonical column name; inner contract is RAISE-only (closes Gemini's "mixed error-handling contract" IMPORTANT).
  - **Agent F (attempt-table schema — X-FIX-AGENT-F):** X5 `dry_run_confirm_token_hash` column (sha256 of token, NOT plaintext); X15 `upload_id NOT NULL` + FK to `scheduler_admin_audit_log(id) ON DELETE RESTRICT`; `reason` → `reason_code`/`error_detail`/`metadata` split (closes BOTH-flagged overload IMPORTANT); `'failed'` enum value REMOVED from CHECK (BOTH-flagged dead state); `completed_at` invariant (NULL iff pending); 3 new CHECK constraints (`token_hash_scope_check`, `completed_at_invariant_check`, `audit_log_scope_check`); retention policy 90-day online → archive at 91 → hard-delete at 365 documented (implementation DEFERRED per OBS-9); 20 X-FIX-AGENT-F markers planted across §3b + §4.1 + §8.5.
  - **Agent B (multi-tenant safety — X-FIX-AGENT-B):** discovered NO `employees` table or `auth.uid()` usage in this codebase (audit-driven finding — original cross-verify assumed standard Supabase auth setup); adapted STEP 0b to actor_email presence guard (audit-trail integrity — no anonymous reverts); 4-layer defense narrative in §8.4 (caller identity at orchestrator-mcp + DB REVOKE/GRANT + STEP 0 presence guards + handler Invariants 5+6); §8.2 Invariant 1 rewritten as WRONG-vs-RIGHT side-by-side (WHERE on DO UPDATE, NOT just INSERT-clause `shop_id = p_shop_id`); NEW Invariant 5 (UPSERT-hijack prevention via row-count check); NEW Invariant 6 (FK target tenant validation); RLS RESTRICTIVE policy on `scheduler_admin_revert_attempts` + canonical REVOKE ALL / GRANT TO service_role; canonical security setup block at §4.4 top.
  - **Agent E (race + dry-run staleness — X-FIX-AGENT-E):** X13 inner RPC reordered to 12 steps with `lock_targets_for_kind` BEFORE canonical compute (closes TOCTOU — locks-then-snapshot ordering prevents the lost-update window); X4 staleness check runs in BOTH dry-run AND apply (v0.3 ran it only on apply, letting dry_run hand out tokens over drifted state); X-AMEND-v2 dry_run + non-NULL `expected_confirm_token` loudly rejects (was silently ignored — hid caller bugs); X-AMEND-v2 4-explicit-field token binding `sha256(upload_id|table_name|current_head_hash|snapshot.after_hash)` (replaced brittle `sha256(v_snapshot::text)` whose output depends on PG version JSONB rendering); `lock_targets_for_kind` helper specced for all 10 snapshot_kinds; `compute_unified_diff` honestly framed as line-aligned (not LCS) for operator visibility; §8.2 Invariant 2 reframed (handler-internal locks now defense-in-depth, helper is load-bearing TOCTOU defense).
  - **Agent C (universal handler shape — X-FIX-AGENT-C):** Invariant 7 added (handler return contract); universal `details JSONB` 4th column for all 10 handlers (9 return `'{}'::JSONB`; `revert_closed_dates_future` populates `skipped_past_dates_restore` + `skipped_past_dates_delete`); closed_dates fully rewritten (X9 + X10 fixes — past-date immutability applies to RESTORES too, not just deletes); per-category signature stub updated to the universal shape; §8.5 prose for `details` JSONB-concat flow; **wired the audit-row INSERT's JSONB concat that A's TODO had flagged but not implemented**.
  - **Agent D (per-category handler — X-FIX-AGENT-D):** per-category handler body fully rewritten (X11 accumulator pattern not overwrite; force-active via EXCLUDED.active = TRUE; X12 lock-vs-conflict aligned via target-row locks BEFORE UPSERT; FK-broken diagnostic enriched to `cannot restore concern_questions.id=<id> because subcategory_id=<value> not in shop=<shop> category=<category> (likely tampered snapshot or deleted-via-direct-DB ancestor); manual recovery required` — names exact row + missing parent + tenant scope); applied B's Invariants 1+5+6; **discovered + fixed column-name + type-cast bugs** (`display_label` not `subcategory_name`; `BIGSERIAL` not UUID for concern tables); §8.7 rewritten (no post-hoc EXCEPTION catch — Invariant 6 pre-validation is the contract).
  - **Agent G (cleanup + observability — X-FIX-AGENT-G):** (a) Sentry emission pattern (TS-wrapper-side `Sentry.captureMessage` with canonical pseudocode in §3b CV2-B6 bullet 4 — closes GPT's "Sentry row UPDATE alert has no emission mechanism" IMPORTANT); (b) redaction policy table (reason_code yes-Sentry, error_detail DB-only — closes GPT's "Failure details + diffs may leak sensitive data to Sentry" IMPORTANT); (c) `reason_code` + `error_detail` lifecycle contract table in §8.5 (closes GPT's "error_detail lifecycle inconsistency" IMPORTANT — both rejected and crashed carry error_detail; CHECK constraints don't bind error_detail to specific outcomes); (d) supersession markers on 7 §3a + §3b items (CV-B2, CV-B3, CV-I1, CV-I3, CV-I5, CV-I11, CV2-I11 — closes 6 Gemini IMPORTANT "stale text" findings + 2 GPT IMPORTANT supersession callouts); (e) CV2-I8 title aligned with `expected_after_state_canonical` terminology (parameter name retained for API stability); (f) lock_targets_for_kind type-cast fix (BIGINT not UUID for `concern_subcategories` + `concern_questions` BIGSERIAL ids — surfaced by Agent D's audit; `v_int_ids` widened from INTEGER[] to BIGINT[] so a single typed array handles both INTEGER tables and BIGSERIAL tables losslessly); (g) §8 + §4.3 + §11 + §10 E11e + §16 v0.4 prose version updates (heading versions consistent with active design; soft-check → HARD CHECK; `rewriting 8 handlers` → `rewriting 10`; v0.4 CV3-B6 bullet annotated with `'failed'` enum removal); (h) §3b CV2-B2 v0.4 reframing note added (warns implementers the v0.3 monolithic RPC is the outer/inner pair now — prevents accidental single-RPC build).

  Sequential execution: 7 agents, ~80 minutes total wall-clock, zero Edit collisions. File grew from 1827 lines (v0.4) → ~3500 lines (v0.5) net of the consolidation pass. Pending Chris approval + 5th cross-verify before `/feature-implement` transition.

- v0.5+10fixes (2026-05-26 — focused-fix round, sequential one-at-a-time) — addresses 10 BLOCKERS / IMPORTANTS surfaced by the chunked v0.5 re-cross-verify (`.claude/work/ai-review-2026-05-26T03-47-13Z.md` + `T03-47-17Z.md` + `T03-47-51Z.md`). Process directive from Chris 2026-05-26: "make focused fixes. Start one at a time. Remember research plan, implement, verify." Each fix went through research → plan → implement → peripheral-audit cycles; no parallel agent dispatches on the same file (the prior parallel attempts caused 30+ Edit collisions); zero retry collisions in this round.
  - **Fix #1 — pgcrypto + `digest()` form:** `sha256(text)` is not a Postgres built-in; rewrote all hash callsites to `encode(digest(<text>, 'sha256'), 'hex')` + added `CREATE EXTENSION IF NOT EXISTS pgcrypto;` to Migration A. Closes GPT chunk 2 BLOCKER.
  - **Fix #2 — `compute_current_canonical_for_kind` helper:** added the dispatch helper + 10 per-snapshot_kind canonical-serializer functions (`canonical_state_<kind>`) referenced by §4.4 inner-RPC step 5; without them every dry-run + apply path would fail at runtime with "function does not exist". Closes GPT chunk 2 BLOCKER.
  - **Fix #3 — boolean three-valued logic bypass:** STEP 0c added explicit NULL guards on `p_dry_run` + `p_force_no_after_hash` (PL/pgSQL params don't reject NULL); + COALESCE belt-and-suspenders on the downstream IF-tests (`COALESCE(p_dry_run, FALSE)` etc.) so NULL can't slip past via SQL three-valued logic. Closes GPT chunk 1 BLOCKER.
  - **Fix #4 — `revert_closed_dates_future` missing REVOKE/GRANT triple:** added the canonical multi-tenant security setup (REVOKE FROM PUBLIC + anon + authenticated, GRANT TO service_role) that was missing on this one handler — closes the only-PUBLIC-grant gap that all other handlers already plugged in v0.5. Documented the mandatory paragraph in §8.2 covering all 10 handlers. Closes Gemini IMPORTANT.
  - **Fix #5 — closed_dates handler SQL placeholders:** filled the `\`...\`` placeholders in the handler body with real column references (`id, shop_id, closed_date, reason, source, created_at`) verified against migration `20260510131752_scheduler_phase1_schema.sql`. Closes Gemini IMPORTANT.
  - **Fix #6 — `lock_targets_for_kind` `added_keys` lock gap:** `appointment_default_limits` branch was missing `added_keys` from the lock predicate, leaving X13 TOCTOU open on the hard-DELETE-of-`added_keys` path. Rewrote to UNION `before` keys ∪ `added_keys` (matching the canonical pattern used by every other branch except CCG). Closes GPT chunk 3 BLOCKER.
  - **Fix #7 — CCG branch snapshot-shape misread (BUNDLED with #6):** `concern_category_guidelines` branch was reading `p_snapshot->'before'->>'id'` as if `before` were a scalar single row, AND was referencing an `id` column that doesn't exist on this table (composite PK is `(shop_id, category)`). Rewrote to lock by `(shop_id, category)` from `jsonb_object_keys(before)` ∪ `added_keys` (which are category slugs, not ids — this is the one snapshot_kind that keys by natural composite key, not by id). Closes GPT chunk 3 BLOCKER + matches verified schema in migration `20260514000000_scheduler_concern_category_guidelines.sql`.
  - **Fix #8 — closed_dates one-sided advisory lock misidentified:** v0.5 §5.5 cited `block_appointment_capacity` as the at-risk concurrent path needing the same advisory lock. Codebase audit verified `block_appointment_capacity` writes to `appointment_blocks` (NOT `closed_dates`) — it never touched `closed_dates` and the cross-verify finding was a misidentification of the function's surface. Rewrote §5.5 to: (a) document the actual closed_dates mutation paths (currently only `uploadClosedDatesMd` being refactored INTO `apply_closed_dates_upload` + the revert handler — both take advisory locks), (b) move the forward-looking guard to `DEFERRED-AUDIT-ITEMS.md` SEC-12 (any FUTURE code path that mutates `closed_dates` must adopt the same advisory-lock pattern). Closes GPT chunk 1 BLOCKER.
  - **Fix #9 — Absent-key TOCTOU race documented + layered defense explained:** GPT chunks 1 + 2 flagged that `SELECT … FOR UPDATE` doesn't lock the key namespace; absent-key inserts could theoretically race between staleness check and UPSERT/DELETE. Analysis (added to §8.2 Invariant 2) shows the race is closed for ALL in-scope snapshot_kinds by the layered defense (per-row FOR UPDATE + canonical drift detection + natural composite unique constraints). closed_dates_future has explicit advisory locks; hard-DELETE handlers operate on existing rows that ARE locked; UPSERT-from-absent paths are caught by canonical hash divergence. The ONLY residual is adversarial DELETE-INSERT-with-byte-identical-replacement, which is operationally implausible. `DEFERRED-AUDIT-ITEMS.md` SEC-13 tracks the schema-stability guard: any future migration that DROPs a tenant-scoped unique constraint must simultaneously extend `lock_targets_for_kind` with advisory locks for the affected kind. Closes GPT chunks 1+2 BLOCKER as documentation; no SQL change needed.
  - **Fix #10 — `error_message` carried inline staleness diff (broke redaction promise):** v0.5 promised two-layer redaction (Sentry omits + DB-only `error_detail`), but the outer RPC's RETURN row was setting `error_message := v_sqlerrm` raw — and `v_sqlerrm` for `staleness_check_failed` includes the inline unified-diff text from `compute_unified_diff` (which can carry customer-facing scheduler MD content). Sanitized the public-facing `error_message` via new `v_sanitized_error_message` (CASE on `v_outcome` × `v_reason` → templated short summaries that include only `attempt_id` for operator pivot, no diff body). Updated §3b CV2-B6 redaction policy table from 2-column (Sentry / DB) to 3-column (Sentry / RPC return → TS / DB) so the contract surface is complete. Closes GPT chunk 1 IMPORTANT "Failure details + diffs may leak sensitive data via error_message".

  Sequential execution: 10 fixes, ~3 hours wall-clock, zero Edit collisions. Plan grew from ~3500 lines (v0.5) → ~3700 lines (v0.5+10fixes) — net +200 lines despite the documentation-heavy fixes #8/#9 (~80 lines for §5.5 rewrite + Invariant 2 absent-key analysis). Pending Chris approval + final 6th-round cross-verify before `/feature-implement` E1 (Migration A).

- v0.5+IMPORTANTs (2026-05-26 — focused-fix round 2, sequential one-at-a-time) — addresses the IMPORTANT findings from the chunked v0.5 re-cross-verify that fell out of scope for the v0.5+10fixes BLOCKER pass. 9 fixes (#11-#19), each focused on a single theme + executed without spawning agents. Same process directive as v0.5+10fixes: "make focused fixes. Start one at a time. Remember research plan, implement, verify." Net additions ~250 lines.
  - **Fix #11 — Reason code Sentry-safety (canonical enum):** Defined the canonical `reason_code` enum table in §3b (15+ values: `not_found`, `cross_shop_hijack_attempt`, `fk_target_tenant_mismatch`, `dry_run_token_present`, `snapshot_kind_unknown`, etc.). Rewrote the outer-RPC classifier to extract enum prefix via `substring(v_sqlerrm from 'revert_blocked:\s+([a-z0-9_]+)')` + IN(…) allow-list — unknown values map to `unclassified_revert_blocked` (Sentry-safe fallback that surfaces but doesn't leak). Reformatted RAISE callsites that were the worst offenders: `expected_confirm_token must be NULL...` → `dry_run_token_present:`, `unhandled snapshot_kind` → `snapshot_kind_unknown:`, FK-broken → `fk_broken:`, `30_day_cutoff` → `over_30_day_cutoff` (leading-digit was awkward for the regex). Special-cased `snapshot_kind_unknown` to map to `outcome='crashed'` (Gemini chunk 2 IMPORTANT — system bug, not user-remediable rejection). Closes GPT chunk 3 IMPORTANT "reason_code is not actually Sentry-safe" + Gemini IMPORTANT "Unhandled snapshot kinds misclassified as rejected".
  - **Fix #12 — Outer RPC pre-insert safety + not_found classification:** Added STEP 0d upload-existence pre-check between STEP 0c and the attempt-row INSERT. v0.5 attempted-row INSERT had `upload_id NOT NULL REFERENCES scheduler_admin_audit_log(id)`, so a nonexistent or wrong-shop `p_upload_id` triggered a raw FK 23503 OUTSIDE the BEGIN…EXCEPTION subtransaction — caller got a raw FK error + no attempt row was recorded. STEP 0d does `SELECT 1 FROM scheduler_admin_audit_log WHERE id = p_upload_id AND shop_id = p_shop_id` (matches inner's step-1 predicate including multi-tenant scope); if NOT FOUND, returns clean `{outcome:'rejected', reason_code:'not_found', attempt_id:NULL}`. Narrowed the §3b CV2-B6 "always inserts an attempt row" claim to "always inserts an attempt row IF parameters valid AND upload exists in caller's tenant". Closes GPT chunk 2 IMPORTANTs #27+#28.
  - **Fix #13 — Attempt-table CHECK gaps:** Added 2 new CHECK constraints to `scheduler_admin_revert_attempts`. `dry_run_outcome_scope_check`: `outcome='success' AND dry_run=FALSE` OR `outcome='dry_run_success' AND dry_run=TRUE` OR pending/rejected/crashed (mode-agnostic). `success_field_scope_check`: success/dry_run_success → `reason_code IS NULL AND error_detail IS NULL`; rejected → `reason_code IS NOT NULL`; crashed → optional; pending → both NULL. Added a column comment on `revert_audit_log_id` noting the operation/upload/shop/error semantics are not schema-enforced + tracked DEFERRED-AUDIT-ITEMS.md SEC-14 for the future trigger when admin-app adds operator-facing UPDATE surfaces. Closes GPT chunk 2 IMPORTANTs #33+#34+#35.
  - **Fix #14 — Migration ordering + idempotency + concurrent indexes:** Reordered §4.6 apply order so handler migrations + `apply_handlers_uploads.sql` apply BEFORE the dispatch migration (E1f) — closes GPT chunk 2 IMPORTANT #36 partial-deploy footgun. Wrapped Migration B's `ADD CONSTRAINT scheduler_admin_audit_log_shop_id_valid_check` in a `DO $$ ... EXCEPTION WHEN duplicate_object ... $$` block (IF NOT EXISTS for ADD CONSTRAINT doesn't exist; this is the canonical pattern). Migration B's index recreation now uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS` outside any explicit BEGIN block — lock-window-safe for production-sized `scheduler_admin_audit_log`. Migration A's GIN index documented as the most expensive of the 4 audit-log indexes; flagged for future move-to-concurrent if table-size triggers visible lock-window concern. Closes GPT chunk 2 IMPORTANTs #36+#39+#40+#41.
  - **Fix #15 — Audit-log read tool drift:** Rewrote §7.2 surface filter from over-broad `WHERE table_name = ? OR diff_summary->'surfaces' ? ?` to conditional fallback `WHERE (diff_summary ? 'surfaces' AND diff_summary->'surfaces' ? ?) OR (NOT (diff_summary ? 'surfaces') AND table_name = ?)` — modern rows use surfaces[] only; legacy rows fall back to table_name. Renamed §7.3 `uploaded_at` → `occurred_at` to match actual DB column + §7.6 cutoff predicate. Reduced reasons union from 10 → 9 (dropped `current_state_drift` — list query can't compute it; only revert-attempt time produces this value). Renamed `30_day_cutoff` → `over_30_day_cutoff` aligning to §3b canonical enum. Updated §12 test count from "6 rejection causes × 2 = 12 cases" to "9 × 2 = 18 cases". Closes GPT chunk 4 IMPORTANTs + Gemini chunk 4 IMPORTANT "upload_failed vs 'failed' clarification".
  - **Fix #16 — Handler correctness batch:** Multiple SQL-correctness fixes: (a) outer EXCEPTION block now includes `v_constraint_name` in `error_detail` body (Gemini chunk 2 IMPORTANT — was silently dropped); (b) `compute_unified_diff` truncation count split into separate unfiltered + filtered SELECTs so the marker actually fires (GPT chunk 3 IMPORTANT); (c) per-category lock helper extended to also lock distinct `subcategory_id` values referenced in `questions_before` row values (GPT chunk 3 IMPORTANT — FK target subcategories that aren't in `subcategories_before` were unlocked → FK race window); (d) closed_dates Invariant 5 row-count check added (GPT chunk 3 IMPORTANT — closes 23505 surfacing as crashed instead of structured rejection); (e) `pg_advisory_xact_lock(hashtext(…))` upgraded to 2-arg `pg_advisory_xact_lock(shop_id::INT, hashtext(date::TEXT))` for 64-bit key space (GPT chunk 3 IMPORTANT — 32-bit collision); (f) `force_no_after_hash` now falls back to `expected_after_state_canonical`-vs-current canonical compare when after_hash is missing but canonical content is present (GPT chunk 3 IMPORTANT); (g) per-category handler STEP 0a snapshot-shape validation rejects NULL/empty `v_category` with canonical `snapshot_invalid` reason_code (GPT chunk 3 IMPORTANT). Plus Gemini NICE-TO-HAVE fix to use `GET DIAGNOSTICS ROW_COUNT` consistently in per-category lock helper (replaces redundant `SELECT COUNT(*)` scan).
  - **Fix #17 — Stale text cleanup:** §15 DC-4 summary updated to reference outer/inner pair (was monolithic). §16 v0.3 CV2-B2 TS wrapper line count updated from `~30 lines` → `~50-60 lines` (current §11 inventory is canonical). §11 `scheduler-admin-catalog.ts` bullet's E1b-f label corrected to E1a-f (E1a is the additive-schema migration; v0.5 omitted it). §13 backfill-UPDATE risk wording rewritten — backfill is a Deno script (CV3-A-I1 v0.4), Migration B fails loud on residual NULLs; v0.5 wording predated that split. Closes GPT chunk 4 IMPORTANTs.
  - **Fix #18 — §5/§10 contract clarifications:** §5.2 gained SECURITY DEFINER label + apply RPC name + contract detail (parity with §5.1/§5.3/§5.4/§5.5). §5.5 SECURITY DEFINER label explicit. §10 E2d rewritten — `computeCanonicalAfterState` is REVERT-side-only helper for diff diagnostics; the apply RPC's `expected_after_state_canonical` is computed Postgres-side via `canonical_state_<kind>` functions after writes succeed (DB-authoritative design per §5.x). §10 E2b allow-list extended via `endsWith('_keys') || endsWith('_ids') || === 'surfaces'` suffix convention (covers per-category's `added_subcategory_ids` + `added_question_ids`). §10 E4 V2 uploaders now write BOTH `expected_after_state_canonical` AND `after_hash` (was just `after_hash` per v0.5 — but post-CV2-B3 revert contract needs the canonical content for diff diagnostics). "10 apply RPCs" claim corrected to "5 apply RPCs" (v0.5 conflated with 10 revert handlers). Closes Gemini + GPT chunk 4 IMPORTANTs.
  - **Fix #19 — Inner RPC service_role bypass + audit-log RLS RESTRICTIVE:** Removed the inner RPC's `GRANT EXECUTE … TO service_role` — only the function owner (postgres) can EXECUTE inner directly; outer's SECURITY DEFINER context calls inner without a service_role grant. Enforces the attempt-row audit trail invariant: every revert attempt has a `scheduler_admin_revert_attempts` row because the outer's pre-insert is the only entry point. Added a future-maintainer comment warning against re-adding the GRANT. Added a RESTRICTIVE deny-all RLS policy to `scheduler_admin_audit_log` complementing the existing PERMISSIVE deny_all — prevents a future PERMISSIVE allow policy from accidentally opening the table via OR semantics. Matches the hardened posture of `scheduler_admin_revert_attempts`. Closes GPT chunk 2 IMPORTANTs #30+#31.

  Sequential execution: 9 fixes, ~2 hours wall-clock, zero Edit collisions. Plan grew from ~3700 lines (v0.5+10fixes) → ~3950 lines (v0.5+IMPORTANTs). Pending Chris approval + final cross-verify before `/feature-implement` E1 (Migration A). Remaining v0.5 cross-verify IMPORTANTs not closed in this round: GPT chunk 2 #37 (backfill script pseudocode-only — defer to implementation phase E11c), #38 (backfill derivation may not cover non-upload audit rows — operator decision, documented as known gap with `shop_id=-1` sentinel as the fallback), #48 (Invariant 3 "natural key" wording — minor doc inconsistency, very low impact). NICE-TO-HAVE findings (token-hash CHECK regex, metadata jsonb_typeof constraint, actor_email naming, etc.) deferred.

- v0.5+IMPORTANTs+round3 (2026-05-26 — focused-fix round 3, sequential one-at-a-time) — addresses the BLOCKERs + critical IMPORTANTs from the round-2 chunked cross-verify (4 artifacts at `T11-55-39Z` / `T11-56-10Z` / `T11-56-13Z` / `T11-56-22Z`). Round-2 surfaced 8 real BLOCKERs (4 genuine new bugs introduced or never noticed; 4 propagation gaps from prior fixes) plus ~30 IMPORTANTs. Same process directive: "make focused fixes. Start one at a time. Remember research plan, implement, verify."
  - **Fix #20 — REVERT Fix #14's reordering of migration apply order:** Fix #14's prose reordering was both (a) cosmetic — Supabase CLI applies migrations lexicographically; the §4.6 prose doesn't change what `supabase db push` runs; and (b) wrong about dependencies — PL/pgSQL defers function-body symbol resolution to call time, so dispatch RPC CREATEs cleanly even when handlers don't exist yet. Original timestamp order (00000 → 00100 dispatch → 00200/300/400 handlers → 00500 apply RPCs) IS correct because apply RPCs depend on canonical_state_<kind> serializers from dispatch. Restored timestamp-aligned ordering with full dependency rationale documented in §4.6. Closes GPT round-3 chunk 2 + chunk 4 BLOCKERs.
  - **Fix #21 — compute_unified_diff CTE scope:** Fix #16 split the CTE-using statement into 2 SELECTs, but PostgreSQL CTEs are scoped to a SINGLE statement; the second SELECT referenced a `numbered` relation that no longer existed → runtime "relation does not exist" on every staleness rejection. Redesigned to use FILTER aggregate on string_agg + COUNT(*) in ONE statement. Both aggregates compute against the same CTE in one statement; truncation marker correctly fires. Closes GPT round-3 chunk 3 BLOCKER.
  - **Fix #22 — force_no_after_hash logic:** Fix #16 added canonical-fallback IF but kept the force flag as a gate, so force=true still bypassed canonical check. Redesigned into 3 branches: (1) hard fail / accept force when truly blind, (2) hash fast-path when hash present, (3) canonical fallback ALWAYS fires when canonical present (force does NOT bypass). Closes Gemini + GPT round-3 chunk 3 BLOCKERs.
  - **Fix #23 — pgcrypto schema visibility:** On Supabase, pgcrypto lives in `extensions` schema; SECURITY DEFINER funcs with `search_path = pg_catalog, public` couldn't resolve `digest(...)` → runtime error. Updated canonical search_path to `pg_catalog, extensions, public` across all SECURITY DEFINER declarations (8+ sites via replace_all). Added long explanatory comment in §4.1 near `CREATE EXTENSION pgcrypto`. Closes GPT round-3 chunk 2 BLOCKER.
  - **Fix #24 — Propagation sweep:** (B1) Stale "10 apply RPCs" text in §3b CV2-I2 header, §10 E1, §11, §14, §10 E5 — all updated to "5 apply RPCs". (B2) §3b CV2-B6 classifier prose + §8.1 step-9 pseudocode rewrote `trimmed text after prefix` to reference §3b canonical-enum allow-list. (B3) §5.5 single-arg advisory lock form removed; bullet shows ONLY 2-arg canonical form; §8.3 lock predicate table updated. (B7) §4.4 canonical security setup adds explicit exception note for inner-RPC's no-grant per Fix #19. Closes GPT round-3 chunk 1+2+4 BLOCKERs.
  - **Fix #25 — Absent-key TOCTOU rewritten honestly:** Fix #9's analysis was over-optimistic. GPT round-3 demonstrated a real race for UPSERT-restore-of-originally-DELETED rows + apply-INSERT-of-new-key cases on 4 non-closed_dates surfaces (canonical drift check can't catch when both readings show "absent"). Rewrote §8.2 Invariant 2 absent-key analysis to honestly classify per-kind race-protection status. Deferred proper fix (extend lock_targets_for_kind with advisory key-namespace locks for ALL kinds + same for apply RPCs) to Phase 1.5 via DEFERRED-AUDIT-ITEMS.md SEC-15. Rationale: ~50-100 lines of new SQL across 14 sites; operational risk bounded by single-shop/single-admin deployment. Closes GPT round-3 chunks 3+4 BLOCKERs (honestly framed instead of dismissed).
  - **Fix #26 — Top IMPORTANTs batch:** (I1) §7.3 reasons union has explicit "STRICT SUBSET" comment to §3b canonical enum. (I5) §8.6 30_day_cutoff → over_30_day_cutoff. (I7) §8.3 canonical serializer CCG entry rewritten — was reading nonexistent `p_snapshot->>'category'` scalar. (I8) §10 E7 surface filter description references §7.2 conditional-fallback form. (I9) §10 E11f X13 test asserts canonical `current_state_drift` (not inner-RPC prefix `staleness_check_failed`). (I25) §8.5 lifecycle table deduped fk_target_tenant_mismatch + fk_broken → single canonical `fk_broken`. (I38+I39) §7.2 surface filter wrapper contract — placeholders take DIFFERENT values (modern = surface verbatim; legacy = mapped table_name); added TS SURFACE_TO_TABLE mapping spec + COALESCE-NULL safety. Closes Gemini + GPT round-3 chunks 1+3+4 IMPORTANTs.
  - **Fix #27 — RLS idempotency + schema guards:** (I10+I11) Both CREATE POLICY calls wrapped in DO-blocks catching duplicate_object. (I12) Added defensive `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for scheduler_admin_audit_log before RESTRICTIVE policy. (I18) Added `CHECK (shop_id > 0)` to scheduler_admin_revert_attempts.shop_id. (I19) Added DEFERRED-AUDIT-ITEMS.md SEC-16 for attempts.shop_id ↔ upload.shop_id trigger (deferred same as SEC-14 — outer RPC is only writer under current design). Closes GPT round-3 chunk 2 IMPORTANTs.

  Sequential execution: 8 fixes, ~2 hours wall-clock, zero Edit collisions. Plan grew from ~3950 lines (v0.5+IMPORTANTs) → ~4350 lines. Pending Chris approval + final round-3 cross-verify before `/feature-implement` E1 (Migration A). New deferred items: **SEC-15** (Phase 1.5 — advisory key-namespace locks for all kinds, after Phase 1 burns in), **SEC-16** (attempts.shop_id ↔ upload.shop_id trigger when admin-app adds operator UPDATE surfaces). Phase 1's open race surface fully documented; operators can monitor audit-log for race-incident forensics until SEC-15 lands.
