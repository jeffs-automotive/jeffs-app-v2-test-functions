# Research 03 — Pattern S backfill for the 5 legacy uploaders

**Feature:** `scheduler-edge-parity`
**Scope:** Refactor 5 legacy uploaders (`uploadConcernQuestionsMd`, `uploadConcernCategoryMd`, `uploadConcernCategoryGuidelineMd`, `uploadAppointmentDefaultLimitsMd`, `uploadClosedDatesMd`) to support `dry_run` + `expected_confirm_token` + `pre_state_snapshot` — matching the V2 catalog uploaders' Pattern S shape. Closes Important finding I3 from `.claude/work/ai-review-2026-05-25T22-40-58Z.md`.
**Authored:** 2026-05-25 via Explore sub-agent (Opus). Content returned inline + transcribed verbatim.

## 1. Pattern S anatomy

Canonical implementation: `_uploadCatalogV2` at `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:361-619`, with `uploadTestingServicesMdV2` (`:217-223`) and `uploadRoutineServicesMdV2` (`:349-355`) as thin wrappers passing a `CatalogConfig` object.

Steps, in order, with file:line refs in `scheduler-admin-catalog.ts`:

| # | Step | Lines | Reusable across all 5? |
|---|------|-------|------------------------|
| 1 | Destructure args `{md_content, audit, dry_run=true, expected_confirm_token}`; compute `md_content_hash = sha256Hex(md_content)` | 371-372 | Yes — verbatim |
| 2 | Parse MD (try/catch; on failure, audit-log only if `!dry_run`, return fail-result) | 374-384 | Yes — but parser swap per uploader (see §4) |
| 3 | Validate per-section (push findings into shared `findings: ValidationFinding[]`; collect `validRows`) | 386-419 | Per-uploader — validation rules differ |
| 4 | Fetch current state from `sb.from(tableName).select(selectColumns).eq("shop_id", shopId)` | 421-440 | Yes — `selectColumns` lives in `CatalogConfig` |
| 5 | Compute diff `{added, modified, deactivated, unchanged}` keyed by natural key (`service_key` for V2) | 442-462 | Per-uploader natural key — see §3 |
| 6 | Smell-test warnings (price moves >50%, deactivations, soft-deletes by omission) | 464-505 | Optional, per-uploader |
| 7 | Build `diff_summary: Record<string, unknown>` | 507-517 | Yes — shape varies but pattern identical |
| 8 | Compute `confirm_token = sha256Hex(JSON.stringify({md: hash, diff: diffSummary}))` | 519 | Yes — verbatim |
| 9 | **Dry-run path** — return `{ok:true, dry_run:true, confirm_token, diff_summary, ...}`, NO DB write | 521-536 | Yes — verbatim shape |
| 10 | **Token re-verify** — `if (expected_confirm_token !== confirm_token) return mismatch-error` | 538-556 | Yes — verbatim |
| 11 | **Capture pre_state_snapshot** BEFORE writes — `{before: {[key]: row}, added_keys: [...]}` | 558-565 | Per-uploader — key + row shape varies |
| 12 | Apply UPSERT for added+modified, UPDATE active=false for deactivated | 567-588 | Per-uploader apply path |
| 13 | Audit-log via `_logAudit(...)` with `pre_state_snapshot: applyError ? null : snapshot` | 590-602 | Yes — `_logAudit` (`:641-684`) is verbatim reusable |
| 14 | Return final result with `audit_log_id` | 604-618 | Yes |

**Reusable building blocks** (move/promote to module scope to share):

- `sha256Hex` — already shared (`scheduler-admin-md.ts`)
- `_logAudit` (`scheduler-admin-catalog.ts:641-684`) — already supports `pre_state_snapshot` insert. Either export it OR mirror it into `scheduler-admin.ts` (already exists there at `:108-151` with identical shape — the duplication is intentional today).
- `_failResult` (`:621-639`) — small helper, can be duplicated trivially.
- The token computation `sha256Hex(JSON.stringify({md, diff}))` should become a tiny named helper in `scheduler-admin-md.ts` (e.g. `computeConfirmToken(mdHash, diffSummary)`). Note: `scheduler-admin.ts:69-74` already declares `computeConfirmToken` — currently UNUSED. Re-use it.

**Per-uploader custom logic:**

- Parser choice (`parseMdTable` vs `parseConcernCategoryMd` vs `parseConcernCategoryGuidelineMd`)
- Validation rules (CHECK constraints, length bounds, enum sets)
- Natural key (`(category, question_text)`, `day_of_week`, `closed_date`, `(category, subcategory_slug, question_text)`, `(shop_id, category)`)
- Apply method (`upsert` vs per-row `insert`/`update`/`delete`)

## 2. confirm_token determinism

`scheduler-admin-catalog.ts:519`:

```ts
const confirm_token = await sha256Hex(JSON.stringify({ md: hash, diff: diffSummary }));
```

`hash` is `sha256Hex(md_content)`. `diffSummary` is the exact structured-diff object returned to the caller, e.g.:

```ts
{ added: [...prettyRows], modified: [{service_key, changed_fields, pretty}], deactivated: [...keys], unchanged_count }
```

**Determinism guarantees:** both inputs are deterministic ONLY if (a) `JSON.stringify` field order is stable and (b) the diff arrays are in a stable order. Today the V2 implementation builds `diff.added` / `diff.modified` / `diff.deactivated` by iterating `validRows` in MD order (stable) and `currentByKey` Map iteration order (insertion order = fetch row order = NOT GUARANTEED stable). **Open question for Chris:** is this an acceptable latent risk? In practice the row order from Postgres without an `ORDER BY` is stable enough, but a backfill could change it. **Recommendation:** for new uploaders, sort the deactivated/modified diff arrays by their natural key before stringifying. Cheap insurance.

The same `(md_content, current DB state)` pair must therefore produce the same token across dry_run and apply calls. Token mismatch on apply means EITHER the MD changed (re-paste typo) OR the DB changed (concurrent admin write). Either case demands a re-preview. This is exactly what the I3 finding wants the legacy uploaders to give us.

## 3. pre_state_snapshot shape

V2 catalog uploader (`scheduler-admin-catalog.ts:558-565`):

```ts
const snapshotBefore: Record<string, TRow> = {};
for (const mod of diff.modified)    snapshotBefore[mod.before.service_key] = mod.before;
for (const row of diff.deactivated) snapshotBefore[row.service_key] = row;
const snapshot = {
  before: snapshotBefore,             // { [service_key]: { ...full row pre-write } }
  added_keys: diff.added.map(r => r.service_key),   // names of rows the upload INSERTED
};
```

Revert (`:826-961`) UPSERTs every `snapshot.before[*]` back, then sets `active=false` on every `snapshot.added_keys[*]`. UPSERT-restorable.

**Proposed shapes for the 5 backfill tables** — designed for the same revert mechanic (UPSERT before + deactivate added):

| Table | Natural key (snapshot map key) | `before[key]` row shape | `added_keys` | Notes |
|-------|-------------------------------|-------------------------|--------------|-------|
| `concern_questions` (flat-table; `uploadConcernQuestionsMd`) | `"<category>::<question_text>"` (the existing in-code composite key) | `{id, category, question_text, options, display_order, active}` | array of composite keys | The PK is auto `id` but the natural key is composite. Snapshot must carry `id` so revert can target the right row by ID rather than by composite UPSERT (which needs a unique index that does not exist today — see legacy comment at `scheduler-admin.ts:1004-1008`). |
| `concern_subcategories` (`uploadConcernCategoryMd`, per-category) | `"sub:<slug>"` for subcategories + `"q:<subcategory_id>::<question_text>"` for child questions | Tagged-union: `{kind:"sub", id, slug, display_label, display_order, active}` or `{kind:"q", id, subcategory_id, question_text, options, multi_select, display_order, active}` | both subcategory and question composite keys added | Single snapshot covers BOTH tables (`concern_subcategories` + `concern_questions`) since the uploader writes both. Scope: only rows where `category=<this category_slug>`. |
| `concern_category_guidelines` (`uploadConcernCategoryGuidelineMd`) | `"<category>"` (single row per category) | `{shop_id, category, display_label, guideline_prose}` OR `null` (if no prior row — insert case) | `[category]` if it was an insert | One-row-per-category — simplest snapshot. Revert is either re-UPSERT the prior prose or DELETE if it was inserted. |
| `appointment_default_limits` (`uploadAppointmentDefaultLimitsMd`) | `day_of_week` (0..6, integer-as-string key) | `{day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes}` | array of day_of_week (uncommon — usually 7 rows already exist) | Bounded to 7 rows max — snapshot will fit in a tiny JSONB. |
| `closed_dates` (`uploadClosedDatesMd`) | `closed_date` (YYYY-MM-DD) | `{closed_date, reason}` | array of closed_dates | **Flag (open question):** today the legacy uploader DELETEs future closed_dates dropped from the MD (`:1565-1572`). Revert needs to re-INSERT them. The snapshot+revert mechanic supports this if we capture deleted rows in `snapshot.before`. |

**General notes:**
- The audit log's `pre_state_snapshot JSONB` column (`20260519140000_scheduler_md_edit_v2_schema.sql:30-32`) is already in place. No DDL widening needed.
- 30-day retention prune cron is already running (`20260522190500_fix_snapshot_prune_cron.sql`) and will prune these new snapshots equally — no change needed.

## 4. Per-uploader refactor plan

For every one of the 5 — the new input shape is:

```ts
{
  md_content: string;
  audit: AdminAudit;
  dry_run?: boolean;             // default TRUE (matches V2)
  expected_confirm_token?: string;
  // optional category_slug for the two concern-category tools
}
```

Reuse `_logAudit` from `scheduler-admin-catalog.ts` (export it) OR keep using `logAdminAudit` from `scheduler-admin.ts` (which already accepts `pre_state_snapshot` — see `:108-151`). The local one already works — no movement needed unless we want one canonical helper.

### 4.1 `uploadConcernQuestionsMd` (`scheduler-admin.ts:796-1092`)

- **Input change:** add `dry_run`, `expected_confirm_token` (table: `concern_questions`, flat MD table).
- **Refactor:** the function ALREADY computes `adds[]`, `mods[]`, `deactivates[]` (lines 979-1000) BEFORE writing. Insert (a) `confirm_token` computation between diff and apply, (b) `dry_run` early return, (c) token re-verify, (d) snapshot capture before apply.
- **Snapshot construction (insert before the apply block at `:1002`):**
  ```ts
  const snapshotBefore: Record<string, ConcernQuestionRow> = {};
  for (const k of mods)        snapshotBefore[k] = currentByKey.get(k)!;
  for (const k of deactivates) snapshotBefore[k] = currentByKey.get(k)!;
  const snapshot = { before: snapshotBefore, added_keys: adds };
  ```
- **Pattern S blocks reused unchanged:** sha256Hex, dry_run early-return shape, token re-verify, `_logAudit` with `pre_state_snapshot`. The duplicate-upload short-circuit (`checkDuplicate`, `:160-176`) at the top of the function should stay — it short-circuits faster than the full dry_run; but it must short-circuit on `dry_run=true` too (no DB write either way, so it's safe).
- **Adapted:** the existing per-row `INSERT`/`UPDATE` loop (`:1003-1056`) needs no change — it already uses row `id` for updates/deactivates.
- **`revertMdUpload` change:** today (`scheduler-admin-catalog.ts:875-882`) it hard-rejects anything that isn't `testing_services` or `routine_services`. Extend the allow-list per refactor. Restoring by `id` is more reliable than by composite-key UPSERT.

### 4.2 `uploadConcernCategoryMd` (`scheduler-admin.ts:1792-2190`, takes `category_slug`)

- **Input change:** add `dry_run`, `expected_confirm_token`. Keep `category_slug`.
- **Refactor — significant**: this is the most complex of the 5. The function today INTERLEAVES fetch/diff/apply across two tables (`concern_subcategories` + `concern_questions`) and writes inline as it iterates (no clear "diff complete, now apply" boundary). To make it Pattern S, the apply must be separated into a clean phase AFTER the diff is built.
- **Plan:**
  1. Phase 1 (now exists): parse MD → fetch current `concern_subcategories` + `concern_questions` for `(shop_id, category=category_slug)`.
  2. **Insert new phase:** build a diff object describing all sub-category and question adds/mods/deactivates WITHOUT writing. Compute confirm_token.
  3. Dry-run early return.
  4. Token re-verify.
  5. **Capture combined snapshot** (tagged-union shape per §3) covering subcategory rows by id + question rows by id.
  6. Apply: replay the existing write path in `scheduler-admin.ts:1942-2149`.
  7. Audit-log with `pre_state_snapshot=snapshot`.
- **Per-category snapshot scope:** yes — the snapshot must be scoped to ONE category (matches the existing scope of the uploader). Revert restores only rows where the `category` column equals the original `category_slug` in `audit_log.diff_summary.category_slug`.
- **Open question for Chris:** today on every parse the uploader writes "default options" (DEFAULT_OPTIONS at `:1935-1939`) for new questions — that's a side-effect of the apply phase, not the diff. We'll need to compute the would-be-inserted options DURING the diff phase so the diff_summary is accurate.

### 4.3 `uploadConcernCategoryGuidelineMd` (`scheduler-admin.ts:2210-2408`, takes `category_slug`)

- **Input change:** add `dry_run`, `expected_confirm_token`.
- **Refactor — trivial.** One-row-per-category. The function already does fetch (`:2275`) → decide insert vs update (`:2306,2340`) → write. Add a diff object `{action: "inserted"|"updated"|"no-op", before: existingRow|null, after: parsedRow}`, compute token, dry-run early-return, re-verify, snapshot, apply.
- **Snapshot shape:** `{before: {<category>: existing|null}, added_keys: existing ? [] : [category]}`.
- **Note:** today there's NO exporter for this table (cross-verify GPT blocker). Out of scope for THIS pass, but Pattern S only works end-to-end if the admin can re-export current state to edit. Flag separately as `concerngl-exporter-add` follow-up (covered by research-02).

### 4.4 `uploadAppointmentDefaultLimitsMd` (`scheduler-admin.ts:1132-1360`)

- **Input change:** add `dry_run`, `expected_confirm_token`.
- **Refactor — straightforward.** The function ALREADY computes `adds[]`, `mods[]` before the apply phase (`:1299-1314`) and uses one UPSERT (`:1325-1328`). Insert Pattern S between diff and apply. Add a `deactivates[]` calc — though semantically, omitting a `day_of_week` from the MD is unusual; current legacy behavior is to LEAVE THE ROW ALONE (it's a 7-row table). **Keep that behavior** — no soft-delete on omission. Snapshot only the modified rows.
- **Snapshot shape:** `{before: {<day_of_week>: row}, added_keys: adds}`.

### 4.5 `uploadClosedDatesMd` (`scheduler-admin.ts:1393-1605`)

- **Input change:** add `dry_run`, `expected_confirm_token`.
- **Refactor with caveat.** The function already computes `adds[]`, `mods[]`, `deactivates[]` (`:1539-1554`). Apply uses `upsert` (`:1560-1563`) AND a `delete` (`:1567-1572`) for omitted future dates.
- **Pattern S fit — partial:** the snapshot mechanic works fine. Revert needs to be able to RE-INSERT deleted future dates (snapshot carries the `reason`) AND DELETE rows that were inserted. Note this differs from V2 which only `active=false`s deletions.
- **OPEN QUESTION / FLAG FOR DISCUSSION:** the cross-verify report (`.claude/work/ai-review-2026-05-25T22-40-58Z.md:69-70`) explicitly flags `closed_dates` as having two mutation paths (`upload_closed_dates_md` vs per-day `block_appointment_capacity`/`unblock_appointment_capacity`). Pattern S only locks the MD-upload path. A `block_appointment_capacity` call between dry_run and apply will invalidate the snapshot's relevance for those days, but the confirm_token re-verification WILL catch it (because the fetched current-state will differ → diff differs → token differs → reject). Good news, but the dry_run's diff_summary will be slightly stale by the time the apply runs — UI must re-display the apply-time diff.
- **Sub-question:** is snapshotting the whole future closed_dates table overkill? **No** — it's bounded to future dates only (`gte("closed_date", today)`), and there are realistically 5-50 such rows per shop. JSONB will fit comfortably under any reasonable size limit.

## 5. scheduler-tools.ts registry changes

Representative example: `upload_concern_questions_md` at `supabase/functions/_shared/scheduler-tools.ts:1194-1205`.

**Before** (current — `:1194-1205`):

```ts
upload_concern_questions_md: tool({
  description:
    "LEGACY — flat-table format. For the sub-category-aware flow " +
    "(Phase 9b+), prefer upload_concern_category_md. This tool still " +
    "requires inline md_content (no repo-fetch default — legacy path).",
  inputSchema: z.object({
    md_content: z.string().min(1),
  }),
  execute: recorded(recorder, "upload_concern_questions_md", (input) =>
    uploadConcernQuestionsMd(sb, shopId, { md_content: input.md_content, audit }),
  ),
}),
```

**After:**

```ts
upload_concern_questions_md: tool({
  description:
    "Bulk-update concern_questions (flat table). TWO-STEP FLOW: " +
    "(1) Call with dry_run=true (DEFAULT) to get diff + confirm_token. " +
    "(2) On approval, call with dry_run=false AND expected_confirm_token=<token>. " +
    "Token mismatch → DB or MD changed since dry_run; re-preview required. " +
    "pre_state_snapshot captured on apply for revert_md_upload.",
  inputSchema: z.object({
    md_content: z.string().min(1),
    dry_run: z.boolean().optional().default(true),
    expected_confirm_token: z.string().optional(),
  }),
  execute: recorded(recorder, "upload_concern_questions_md", (input) =>
    uploadConcernQuestionsMd(sb, shopId, {
      md_content: input.md_content,
      audit,
      dry_run: input.dry_run,
      expected_confirm_token: input.expected_confirm_token,
    }),
  ),
}),
```

**Lines that change:** description (`:1195-1198` → new copy), `inputSchema` (`:1199-1201` adds `dry_run` + `expected_confirm_token`), `execute` body (`:1202-1204` passes new fields). Same pattern for the other 4 tool blocks at `scheduler-tools.ts:1207-1327` (the two concern-category tools) and `:1449-1508` (limits + closed_dates).

Identical edits apply to: `upload_concern_category_md` (`:1207-1265`), `upload_concern_category_guideline_md` (`:1267-1327`), `upload_appointment_default_limits_md` (`:1449-1481`), `upload_closed_dates_md` (`:1483-1508`).

## 6. Migration needs

`pre_state_snapshot` ALREADY exists on `scheduler_admin_audit_log` (`20260519140000_scheduler_md_edit_v2_schema.sql:30-32`, added with `snapshot_pruned_at` and the prune cron). Re-confirmed: `git log` of migrations shows V2 was deployed.

**However — two real problems found while researching:**

### 6.1 BUG: `operation` CHECK constraint is missing `revert_upload`

`supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:140`:

```sql
operation TEXT NOT NULL CHECK (operation IN ('upload_md','manual_change','export_md')),
```

But `scheduler-admin-catalog.ts:937` inserts `operation: "revert_upload"` via `_logAudit`. The insert in `_logAudit` (`:656-672`) silently logs a warning if it fails (`:673-682`); the `revertMdUpload` function (`:934-948`) currently has no way to detect that its revert was NOT audit-logged because of CHECK failure. This is a pre-existing latent bug unrelated to the backfill. **Recommend a migration drops + re-adds the constraint to include `revert_upload`.**

### 6.2 No new column needed — but a migration IS recommended

**Proposed migration** (`20260526000000_scheduler_audit_log_revert_operation.sql`):

```sql
-- Allow operation='revert_upload' on scheduler_admin_audit_log.
-- Existing CHECK at 20260513000100_scheduler_phase1_new_tables.sql:140
-- omits revert_upload — this causes silent audit-log INSERT failures from
-- revertMdUpload (catch in _logAudit warns and returns null; revert path
-- proceeds as if logged).
--
-- Also adds an index on table_name + operation for the schedulerconfig
-- admin UI's "Recent uploads per surface" list (UI requirement per the
-- cross-verify blocker at ai-review-2026-05-25T22-40-58Z.md GPT blocker 1).

BEGIN;

ALTER TABLE public.scheduler_admin_audit_log
  DROP CONSTRAINT IF EXISTS scheduler_admin_audit_log_operation_check;

ALTER TABLE public.scheduler_admin_audit_log
  ADD CONSTRAINT scheduler_admin_audit_log_operation_check
    CHECK (operation IN ('upload_md','manual_change','export_md','revert_upload'));

-- Speed up the admin UI "uploads-by-surface" recent-list query.
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (table_name, operation, occurred_at DESC);

COMMIT;
```

**Recommend NOT adding** `parent_run_id` for chained reverts yet. Today's V2 hard-rejects revert-of-revert at `scheduler-admin-catalog.ts:843-849`. Keep that simple invariant — revert-of-revert can be reconsidered if requested.

(Note: research-04 proposes additional schema changes — `shop_id`, `successor_revert_id`, `reverts_upload_id`, unique partial index — that should be bundled into the SAME migration during the synthesis plan.)

## 7. Backward compatibility

Today the 5 legacy tools have inputs of shape `{md_content[, category_slug]}` and ALWAYS apply. Old Claude Desktop call (no `dry_run`, no `expected_confirm_token`):

```
upload_concern_questions_md({ md_content: "..." })
```

After the refactor with `dry_run` defaulting to `true`:
- The same call **becomes a dry-run**. No DB write. Returns a `diff_summary` + `confirm_token` and `dry_run: true`.
- The orchestrator (Claude Desktop with the chat-instructions system prompt) MUST learn the new two-step pattern, otherwise EVERY admin upload after this refactor silently no-ops.

**This is a breaking change in semantics, not in shape.** Old shape still parses fine because the new fields are optional.

**Orchestrator-side prompt update required:**

The chat-instructions admin prompt (under `docs/chat-instructions/scheduler/` — pathing visible at `scheduler-tools.ts:951`) MUST be updated to say: "after calling any `upload_*_md` tool with no `dry_run` flag, review the returned `diff_summary` and `confirm_token` with the advisor; only call again with `dry_run: false, expected_confirm_token: <token>` after explicit approval." This is the EXACT pattern already documented for the V2 catalog uploaders in their tool descriptions (`scheduler-tools.ts:912-921` for `upload_routine_services_md`).

**Recommended copy** for the orchestrator system prompt diff:

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

**Acceptable?** Yes — explicitly desirable per the I3 finding. Document the breaking change in `docs/scheduler/future-release-notes.md` and in the deploy commit body. Add an integration smoke test that calls each upload tool with no args and asserts `dry_run === true` in the response.

## 8. Test surface

Mirror the existing test file shape (`scheduler-admin-catalog.test.ts:1-162`) — Deno-native, tests pure helpers only; end-to-end uploader behavior is smoke-tested via curl post-deploy. For Pattern S backfill, the most valuable unit tests target the diff-and-token logic, which can be made pure (extract from `uploadXyzMd` into a `computeXyzDiff(currentRows, parsedRows)` helper that returns `{added, modified, deactivated, snapshot, confirmToken, diffSummary}`).

Per-uploader test list (add to `scheduler-admin-catalog.test.ts` or split into `scheduler-admin-legacy.test.ts`):

For EACH of the 5 refactored uploaders:

1. `parse + diff: identical MD vs DB → adds=mods=deactivates=0, diff_summary unchanged_count=N`
2. `parse + diff: one new row in MD → adds=[<key>], snapshot.added_keys=[<key>], snapshot.before={}`
3. `parse + diff: modified row → mods=[<key>], snapshot.before[<key>]={<full prior row>}`
4. `parse + diff: row missing from MD → deactivates=[<key>], snapshot.before[<key>]={<full prior row>}`
5. `confirm_token determinism: same (md, current) → same token across two calls`
6. `confirm_token sensitivity: different md_content → different token`
7. `confirm_token sensitivity: same md, different current DB → different token`

Plus uploader-specific:

8. `uploadConcernQuestionsMd: invalid category in MD row → validation_errors includes that row_index, validRows excludes it`
9. `uploadConcernCategoryMd: category_slug not in 14-enum → returns ok:false, never reaches parser`
10. `uploadConcernCategoryMd: snapshot covers both subcategories and questions for the given category_slug only` (other categories untouched)
11. `uploadConcernCategoryGuidelineMd: insert case has snapshot.before[<category>]=null, snapshot.added_keys=[<category>]`
12. `uploadAppointmentDefaultLimitsMd: omitting a day_of_week from MD does NOT add it to deactivates` (keep current "leave alone" semantics)
13. `uploadClosedDatesMd: past closed_date in MD is ignored / rejected appropriately` (current behavior is to fetch only `gte today` — confirm that's preserved)
14. `uploadClosedDatesMd: deactivates target only future dates; past closed_dates never appear in any diff arm`

Plus shared:

15. `dry_run=true never calls .insert(), .update(), or .delete() on the target table` — verify via Supabase client mock counter
16. `dry_run=false with no expected_confirm_token → ok:false, error_message mentions "missing expected_confirm_token"`
17. `dry_run=false with wrong expected_confirm_token → ok:false, error_message mentions "confirm_token mismatch"`
18. `dry_run=false with matching token → writes happen; audit_log row exists with pre_state_snapshot != null`

The Supabase client mock used in the V2 tests doesn't exist yet (current tests only exercise parsers). Either (a) add a thin in-memory `SupabaseClient` mock now, or (b) keep the diff-computation pure and test it directly; defer apply-path tests to a curl smoke test. **Recommendation:** (b) for speed, with one apply-path test per uploader via a real Supabase test instance if CI has one wired up.

---

## Open questions for Chris

1. **`confirm_token` determinism vs row ordering.** Today `diff.deactivated` and `diff.modified` arrays preserve `currentByKey: Map` insertion order (= Postgres scan order without `ORDER BY`). Backfill: sort by natural key before stringifying, or trust pg row order? Cheap to sort.
2. **`uploadConcernCategoryMd` DEFAULT_OPTIONS side-effect.** Today the diff phase doesn't know about default options injected on insert. Should the dry_run preview show "this NEW question will get options = [yes/no/sometimes]" as a clarification line? Probably yes — surface it in `validation_warnings`.
3. **`uploadClosedDatesMd` two-mutation-path conflict.** Per the cross-verify GPT important finding, `block_appointment_capacity` mutates `closed_dates` too (?). Verify: does it? If yes, dry_run output may go stale between preview and apply. The confirm_token re-verify catches it but UX is degraded. Worth a follow-up.
4. **`revertMdUpload` allow-list.** Today it's hard-coded to two tables (`scheduler-admin-catalog.ts:875-882`). Refactor: extend to all 5 backfilled tables, or keep a per-table reverter pattern? Recommend the same shared mechanic; per-table only if a uniform UPSERT can't restore (current closed_dates DELETE is the only edge case). (Note: research-04 expands on this with `snapshot_kind` discriminator.)
5. **`_logAudit` consolidation.** Today there are TWO near-identical helpers: `scheduler-admin.ts:108-151` and `scheduler-admin-catalog.ts:641-684`. They differ only in the warning message key. Either consolidate to one in `_shared/scheduler-admin-md.ts` or accept the duplication. Marginal cleanup.
6. **Latent bug discovered: `operation='revert_upload'` is rejected by the CHECK constraint.** `scheduler-admin-catalog.ts:937` writes it; the CHECK at `20260513000100_scheduler_phase1_new_tables.sql:140` doesn't allow it; `_logAudit` only warns on failure. Means every revert today produces a silent unaudited revert. Independent of this backfill — but worth filing as a P1 fix in the same migration as §6.2 above.

## Relevant file paths

- `.claude/work/ai-review-2026-05-25T22-40-58Z.md` (cross-verify report; finding I3)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` (canonical Pattern S; `_uploadCatalogV2` at 361-619, `_logAudit` at 641-684, `revertMdUpload` at 826-961)
- `supabase/functions/_shared/tools/scheduler-admin.ts` (5 legacy uploaders + `logAdminAudit` helper at 108-151)
- `supabase/functions/_shared/scheduler-tools.ts` (tool registry: V2 at 905-1192, legacy at 1194-1327, 1449-1508)
- `supabase/functions/_shared/scheduler-admin-md.ts` (parsers + `sha256Hex`; `parseConcernCategoryGuidelineMd` at 449, `parseConcernCategoryMd` at 506)
- `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql` (audit log table, CHECK constraint at line 140, concern_questions at 64-, appointment_default_limits at 108-)
- `supabase/migrations/20260519140000_scheduler_md_edit_v2_schema.sql` (`pre_state_snapshot` + `snapshot_pruned_at` columns; prune cron)
- `supabase/migrations/20260522190500_fix_snapshot_prune_cron.sql` (`run_admin_snapshot_prune()` named fn)
- `supabase/migrations/20260514000000_scheduler_concern_category_guidelines.sql` (concern_category_guidelines DDL)
- `supabase/migrations/20260514100000_scheduler_concern_subcategories_and_keywords.sql` (concern_subcategories + subcategory_id FK on concern_questions)
- `supabase/migrations/20260510131752_scheduler_phase1_schema.sql` (closed_dates DDL at 191-200)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` (test pattern to mirror)
