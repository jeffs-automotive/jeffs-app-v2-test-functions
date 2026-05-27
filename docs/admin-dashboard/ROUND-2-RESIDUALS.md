# schedulerconfig — Round-2 cross-verify residuals

> Companion to `schedulerconfig-plan.md` v0.5 + `schedulerconfig-research.md` v0.2.
> Round-2 cross-verify artifact: `.claude/work/ai-review-2026-05-27T00-48-29Z.md`
> Round-1 cross-verify artifact: `.claude/work/ai-review-2026-05-27T00-38-03Z.md`
> Authored: 2026-05-26 · v1 (ship-to-implement decision)

## Trend

| Metric | Round 1 (v0.4) | Round 2 (v0.5) |
|---|---|---|
| Gemini BLOCKERs | 2 | 1 |
| GPT BLOCKERs | 4 | **0** |
| Combined IMPORTANTs | 20 | ~15 |
| Combined NICE-TO-HAVEs | 3 | 5 |

Round 2 closed substantial ground. The remaining 1 BL + ~5 real IMP
are all docs-level (sharpen wording / add explicit invariants) — no
design changes. Same ship-to-implement decision Chris made for
edge-parity Round 6: docs hygiene is faster to close during build
than via more cross-verify rounds.

## Real residual — closed inline during D.2-D.7

### R-BL-1 (Gemini) — verify shop_id scoping for per-row tools

**Finding.** Plan §2 "Out of scope" asserts that every uploader +
revert + exporter tool enforces `shop_id` at the edge via
`requireAdmin()` → session shop_id. The cross-verify points out that
this is asserted but not verified for the older single-row mutation
tools (`upsert_testing_service`, `deactivate_testing_service`,
`patch_*`, `block_appointment_capacity`,
`unblock_appointment_capacity`) whose implementation is separate
from the newer V2 catalog uploaders.

**Disposition.** The per-row UI is deferred to Phase E per §10 Q1.
The 2 in-scope per-row tools for Phase D (block / unblock) need
explicit `shop_id`-scoping verification before D.6 lands.

**Close during D.6:** when `block-appointment-capacity.ts` Server
Action is implemented, verify by reading
`supabase/functions/_shared/scheduler-tools.ts:798-820` that:
1. The Edge tool accepts NO `shop_id` arg (or rejects client-set
   ones)
2. The handler derives `shop_id` from `requireAdmin()` session ONLY
3. Add a Vitest test asserting that a request attempting to set
   `shop_id` via form field gets that field stripped

If any of those fail, file as a pre-D.6 fix; otherwise document the
verification in a code comment + add the assertion to the §12
testing list.

### R-IMP-1 (GPT) — sharpen "all 10 surfaces Pattern S" wording

**Finding.** §2 heading says "all 10 surfaces, all Pattern S" but
the same table includes row 9b (block/unblock, soft-confirm) and
Operations (soft-confirm). The wording is misleading.

**Disposition.** Reword §2 heading + opening paragraph during D.1 to:
"All 10 MD-upload surfaces use Pattern S. Row 9b (per-day inline
edits) and Operations use one-shot soft-confirm with no revert."

Trivial doc fix; lands when D.1 starts (~30 LOC).

### R-IMP-2 (GPT) — per-category scope clearing on switch

**Finding.** `<ConcernsPerCategoryTab>` switches between (category ×
sub-surface) tuples. When the user switches category or sub-surface,
the stale `previewedMd` state + dry-run `confirm_token` + recent-uploads
filter + export cache from the prior tuple must be cleared. Plan §6
implies this but doesn't spell it out.

**Disposition.** Close during D.5 (Concerns-per-category tab build).
Component contract:

```tsx
// ConcernsPerCategoryTab.tsx
useEffect(() => {
  // On (category, subSurface) change, reset all per-tuple state
  setPreviewedMd(null);
  setConfirmToken(null);
  setLastExport(null);
  // RecentUploadsList is re-rendered with new filter args so it
  // refetches automatically
}, [category, subSurface]);
```

Add a Vitest test in D.5 asserting state reset on switch.

### R-IMP-3 (GPT) — "independently revertable" overclaim for concerns

**Finding.** §2 Concerns paragraph says flat + per-category are
"independently revertable" but then correctly notes both can
overlap on `concern_questions` rows. Independent revertability is
overclaimed.

**Disposition.** Reword during D.5: "Each surface is independently
addressable by revert (separate audit-log rows; separate `surface_filter`
enum values), but revert of one may fail with `current_state_drift`
if the other surface has touched overlapping `concern_questions` rows
in the interim. The `<RevertConfirmDialog>` lost-update warning
banner already covers this case (§4)."

Trivial doc fix; lands when D.5 starts.

### R-IMP-4 (GPT) — closed-dates MD vs inline mutual invalidation contract

**Finding.** §7 covers the precedence rule for concurrent MD-modal +
inline block/unblock execution (advisory lock + drift detection) but
doesn't explicitly state the UI invalidation contract: when the MD
path applies/reverts, the calendar strip must refresh; when the
inline path mutates, the current-state preview + export cache must
invalidate.

**Disposition.** Add to §7 during D.6 build:

> **Invalidation contract:**
> - On `<CatalogEditorTab>` MD path apply/revert success → refresh
>   `<CapacityCalendarStrip>` data
> - On `<BlockDayDialog>` per-day mutation success → invalidate
>   `<CatalogEditorTab>` current-state summary + export cache
> - Both refresh paths go through Next.js `revalidatePath('/schedulerconfig')`
>   which the `<SchedulerConfigTabs>` root will observe and trigger
>   `router.refresh()`

### R-IMP-5 (GPT) — Operations contract: idempotency + concurrent runs

**Finding.** §7.5 covers `<RunSyncCard>` UI but doesn't document
`run_appointments_sync` contract — is it idempotent? What happens on
concurrent invocations? Where does the "last run" come from?

**Disposition.** Close during D.7 build. Verify against
`supabase/functions/appointments-sync/index.ts` (or equivalent edge
fn) that:
1. The tool is idempotent at the per-run level (re-running while
   one is in flight either queues OR returns the in-flight job_id)
2. Result is persisted to a table queryable for "last run" timestamp
   + row counts
3. Concurrent runs from the same shop_id are either serialized or
   coalesced; document which.

Add findings to §7.5 + add Vitest tests for the `<RunSyncCard>`
concurrent-run UX (e.g., button shows "In progress…" if a prior run
is in flight).

## Truncation false alarms — already addressed in v0.5

Both models flagged these as gaps; all are present in v0.5 but the
cross-verify input was truncated (57782-byte plan; both Gemini and
GPT noted "truncated" on their input). Listed here so builders don't
chase them:

| Finding | Where it's already addressed |
|---|---|
| Lost-update recovery UX | §4 "Revert lost-update warning" subsection (the banner showing newer uploads that will be undone) |
| Missing audit trail for block/unblock | §4 "Per-surface audit-log filter keys" table — row 9b explicitly excluded; recovery is the inverse action documented in §7 row 9b |
| Operations user feedback | §7.5 `<RunSyncCard>` + `<FindOrphansCard>` UI shapes |
| SERVICE_ROLE / X-Actor-Email boundary | §5 "Auth boundary" subsection |
| Idempotency contract not in research doc Pattern S shape | §5 "Idempotency contract" subsection (the research doc's Pattern S shape is the on-the-wire input shape; the v0.5 idempotency contract layers on top via edge-side `md_content_hash` fast-path + `successor_revert_id` guard) |
| Audit-log filter for parameterized surfaces | §4 "Per-surface audit-log filter keys" table has `category_slug` column |
| Dry-run output `audit_log_id` inconsistency | Audit-log row is written ONLY on apply success (dry-run does NOT write to `scheduler_admin_audit_log`); §5 adapter contract preserves this contract; research §1A Pattern S shape is correct |
| Drift recovery path documentation | §4 step 6 + §4 lost-update banner cover both the apply-time drift case AND the revert-time drift case |

## Deferred (per existing §10 questions — not blocking D.2-D.7)

- **§10 Q1 — Per-row mutation tools UI** — defer to Phase E unless
  Chris reverses. R-BL-1's verification work is bounded to D.6 (block
  / unblock only); the broader `upsert_*` / `patch_*` / `deactivate_*`
  UI is Phase E.
- **§10 Q2 — Recent-uploads cutoff (10 vs 30)** — small UX choice;
  default to 10 unless Chris specifies.
- **§10 Q3 — MD file upload UX** — paste-textarea is default; file
  picker is additive if Chris wants it.
- **§10 Q4 — run_appointments_sync cadence** — frames whether to
  cache "last run". Close during D.7.

## Cross-verify history archive

After D.7 lands + the feature ships, archive these artifacts to
`.claude/work/archive/schedulerconfig/cross-verify-history/`:
- ai-review-2026-05-25T22-40-58Z.md (v0.3 paused-state cross-verify)
- ai-review-2026-05-27T00-38-03Z.md (round-1 v0.4 cross-verify)
- ai-review-2026-05-27T00-48-29Z.md (round-2 v0.5 cross-verify)

Same archive pattern as edge-parity.
