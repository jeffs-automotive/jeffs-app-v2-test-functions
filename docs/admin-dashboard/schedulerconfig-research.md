# schedulerconfig — research artifact

> Feature: `schedulerconfig` (admin-app)
> Phase: research (consumed by plan v0.5)
> Authored: 2026-05-25 · v0.1
> Revised: 2026-05-26 · v0.2 (post `scheduler-edge-parity` ship)
> Companion: `docs/admin-dashboard/schedulerconfig-plan.md`
>
> Purpose: enumerate every orchestrator MCP tool the admin-app's
> `/schedulerconfig` page needs to call, classify their confirmation
> shape (Pattern S two-step dry-run vs legacy one-shot), and capture
> the existing keytag UI patterns to mirror.
>
> **v0.2 update:** the legacy/V2 split below was canonical at the time
> of v0.1. The `scheduler-edge-parity` feature (commit `4443d77`
> jeffs-app-v2-test-functions + `74a0487` dotfiles-v2-test-data, both
> shipped 2026-05-26) added full Pattern S (dry_run +
> `expected_confirm_token` + `pre_state_snapshot` + revert via
> `revertMdUpload`) to ALL 5 previously-legacy uploaders + added 2 new
> exporters that close the prior "no exporter" / "ambiguous exporter"
> gaps. The §1B + §2 sections below have been rewritten to reflect
> post-ship reality; the v0.1 wording is preserved as a footnote at
> the bottom of each affected section.

---

## 1. Orchestrator tool inventory (post edge-parity ship)

Source: `supabase/functions/_shared/scheduler-tools.ts` lines 798–1614,
all tools registered behind the `admin === true` block. Each tool is
backed by an implementation in `_shared/tools/scheduler-admin.ts` or
`_shared/tools/scheduler-admin-catalog.ts`. The full canonical 10-kind
mapping (kind ↔ table ↔ handler ↔ canonical-state ↔ exporter ↔
`surface_filter` enum ↔ delete strategy) lives in
`docs/scheduler/edge-parity/PLAN.md` §7.

### 1A. Catalog uploaders with Pattern S — all 10 surfaces (post edge-parity)

All MD upload tools now share the same Pattern S shape: `dry_run +
expected_confirm_token + pre_state_snapshot + audit_log_id` on the
edge side; revert via the universal `revert_md_upload` tool that
covers all 10 surfaces per the `revertMdUpload` wrapper.

**V2 catalog uploaders (5 — were Pattern S in v0.1 already):**

| Tool name | Impl | snapshot.before key shape (per PLAN.md §7) |
|---|---|---|
| `upload_routine_services_md` | `uploadRoutineServicesMdV2` (catalog.ts:349) | `service_key` TEXT |
| `upload_testing_services_md` | `uploadTestingServicesMdV2` (catalog.ts:217) | `service_key` TEXT |
| `upload_subcategory_service_map_md` | `uploadSubcategoryServiceMapMdV2` (catalog.ts:1046) | composite TEXT `"<cat>::<slug>"` w/ id in value |
| `upload_subcategory_descriptions_md` | `uploadSubcategoryDescriptionsMdV2` (catalog.ts:1726) | composite TEXT `"<cat>/<slug>"` w/ id in value |
| `upload_question_required_facts_md` | `uploadQuestionRequiredFactsMdV2` (catalog.ts:2234) | composite TEXT `"qid_<id>"` w/ id in value |

**Ex-legacy uploaders, now Pattern S (5 — refactored by edge-parity E5):**

| Tool name | Impl | snapshot.before key shape (per PLAN.md §7) |
|---|---|---|
| `upload_concern_questions_md` | `uploadConcernQuestionsMd` (scheduler-admin.ts:796) | `String(id)` |
| `upload_concern_category_md` | `uploadConcernCategoryMd` (scheduler-admin.ts:1792) | nested `subcategories_before` + `questions_before` keyed by `String(id)` |
| `upload_concern_category_guideline_md` | `uploadConcernCategoryGuidelineMd` (scheduler-admin.ts:2210) | category slug TEXT (composite PK `(shop_id, category)`) |
| `upload_appointment_default_limits_md` | `uploadAppointmentDefaultLimitsMd` (scheduler-admin.ts:1132) | `String(day_of_week)` (composite PK `(shop_id, day_of_week)`) |
| `upload_closed_dates_md` | `uploadClosedDatesMd` (scheduler-admin.ts:1393) | DATE string |

**Universal revert tool (1):**

| Tool name | Impl | Notes |
|---|---|---|
| `revert_md_upload` | `revertMdUpload` (catalog.ts:826) — TS wrapper around `revert_md_upload_attempt` plpgsql outer RPC | Covers all 10 surfaces; 30d retention; rejects too-old / revert-of-revert / already-reverted / current-state-drift per ADR-014; returns canonical reason_code enum per ADR-007 |

**Pattern S confirmed shape** (universal across all 10 surfaces):

```
input: { md_content: string, dry_run?: boolean = true, expected_confirm_token?: string }
output (dry_run=true): { ok, dry_run: true, diff_summary, confirm_token, dry_run_result, ... }
output (dry_run=false): { ok, dry_run: false, applied: true, audit_log_id, rows_added, rows_modified, rows_deactivated, ... }
```

Mismatch on `expected_confirm_token` → tool rejects + advisor must
re-run dry_run.

> **v0.1 footnote:** v0.1 of this doc classified the 5
> ex-legacy uploaders in §1B "WITHOUT Pattern S (legacy one-shot)"
> and recommended an app-level pre-apply gate per `Path β`. That
> recommendation is OBSOLETE — the edge-parity ship eliminated the
> legacy/V2 split. Plan v0.4+ uses a single Pattern S UX (the
> universal `<CatalogEditorTab>`) for all 10 surfaces.

### 1B. (Removed — was "legacy one-shot" section)

This section in v0.1 described 5 uploaders lacking Pattern S. The
`scheduler-edge-parity` feature (E5: legacy refactor + E1c-f: handler
+ apply RPC migrations) brought all 5 up to full Pattern S parity.
They are listed in §1A above alongside the original 5 V2 uploaders.

### 1C. Per-row write tools (no MD upload, direct mutations)

Unchanged from v0.1.

| Tool name | Surface | Impl |
|---|---|---|
| `upsert_testing_service` | testing-services | `scheduler-admin.ts` (older row-level) |
| `deactivate_testing_service` | testing-services | scheduler-admin.ts |
| `patch_testing_service_fields` | testing-services | scheduler-tools.ts:1329 |
| `upsert_routine_service` | routine-services | scheduler-admin.ts |
| `deactivate_routine_service` | routine-services | scheduler-admin.ts |
| `patch_routine_service_fields` | routine-services | scheduler-tools.ts:1380 |
| `block_appointment_capacity` | closed-dates/blocks | scheduler-tools.ts:798 |
| `unblock_appointment_capacity` | closed-dates/blocks | scheduler-tools.ts:820 |

These mutate one row at a time — useful for "small tweak" workflows
(advisor flips a `starting_price_cents` from $89 → $99 without
re-uploading the entire MD). Plan v0.4 §10 Q1 defers per-row UI
exposure to Phase E. The `block/unblock_appointment_capacity` pair is
the exception — these are surfaced directly in the closed-dates tab
calendar strip per plan v0.4 §7.

### 1D. Read-side / export tools — complete inventory (post edge-parity)

Edge-parity E6 added 2 new exporters that close the v0.1 "no
exporter" / "ambiguous exporter" gaps. Full inventory (10 exporters,
one per surface):

| Tool name | Surface | Notes |
|---|---|---|
| `export_routine_services_md` | routine_services | v0.1 |
| `export_testing_services_md` | testing_services | v0.1 |
| `export_subcategory_service_map_md` | subcategory_service_map | v0.1 |
| `export_subcategory_descriptions_md` | subcategory_descriptions | v0.1 |
| `export_question_required_facts_md` | question_required_facts | v0.1 |
| `export_concern_questions_md` | concern_questions (flat) | v0.1 — for the flat surface, NOT per-category |
| `export_concern_category_md` | concern_subcategories (per-category) | **NEW (E6)** — closes v0.1 "?" ambiguity |
| `export_concern_category_guideline_md` | concern_category_guidelines (per-category) | **NEW (E6)** — closes v0.1 "no exporter found" gap |
| `export_appointment_default_limits_md` | appointment_default_limits | v0.1 |
| `export_closed_dates_md` | closed_dates (future only) | v0.1 |

Output shape (uniform across all 10): `{ ok: true, md_content: string,
exported_at: ISO, row_count: number }`.

### 1E. Audit-log read tool (NEW — edge-parity E7)

| Tool name | Use case |
|---|---|
| `list_scheduler_admin_audit_log` | Read recent audit-log entries with server-computed revert eligibility per row. Filters: `surface` (canonical enum per PLAN.md §6), `limit`, `before_id`, `category_slug` (for concerns-per-category surfaces). Returns `can_revert` boolean + `revert_reason_if_not` canonical enum value (`too_old`, `revert_of_revert`, `already_reverted`, `current_state_drift_unknowable`, etc.). |

This tool **did not exist** at v0.1 — its absence was a BLOCKER in
the prior cross-verify. Built per ADR-021.

### 1F. Cross-cutting ops

| Tool name | Use case |
|---|---|
| `find_orphan_customers` | List locally-cached customers Tekmetric has deleted (cleanup workflow) |
| `run_appointments_sync` | On-demand kick of the appointments-sync edge function |

---

## 2. DB tables touched (corrected — post edge-parity)

Confirmed via the implementation files + edge-parity PLAN.md §7:

| Table | Owner uploader | Per-row tool | Exporter |
|---|---|---|---|
| `testing_services` | upload_testing_services_md (Pattern S) | upsert/deactivate/patch | export_testing_services_md |
| `routine_services` | upload_routine_services_md (Pattern S) | upsert/deactivate/patch | export_routine_services_md |
| `concern_questions` | upload_concern_questions_md (Pattern S, post E5) | — | export_concern_questions_md |
| `concern_subcategories` | upload_concern_category_md (Pattern S, post E5) | — | **export_concern_category_md (NEW E6)** |
| `concern_category_guidelines` | upload_concern_category_guideline_md (Pattern S, post E5) | — | **export_concern_category_guideline_md (NEW E6)** |
| `subcategory_service_map` | upload_subcategory_service_map_md (Pattern S) | — | export_subcategory_service_map_md |
| `subcategory_descriptions` | upload_subcategory_descriptions_md (Pattern S) | — | export_subcategory_descriptions_md |
| `question_required_facts` | upload_question_required_facts_md (Pattern S) | — | export_question_required_facts_md |
| `appointment_default_limits` | upload_appointment_default_limits_md (Pattern S, post E5) | — | export_appointment_default_limits_md |
| `closed_dates` | upload_closed_dates_md (Pattern S, post E5) | block/unblock | export_closed_dates_md (future only) |
| `scheduler_admin_audit_log` | (written-to by every uploader) | (read via list_scheduler_admin_audit_log, NEW E7) | (no MD format) |
| `scheduler_admin_revert_attempts` | (written-to by revert_md_upload_attempt) | (read via list_scheduler_admin_audit_log join) | (no MD format) |

> **v0.1 footnote on table-exporter mapping:** v0.1 marked
> `concern_subcategories` exporter as `export_concern_questions_md (?)`
> and `concern_category_guidelines` exporter as missing. Both gaps are
> closed by E6 (new dedicated exporters). The `(?)` ambiguity reflected
> a real architectural concern at the time — `export_concern_questions_md`
> serves the flat concern-questions surface, NOT per-category — and the
> 2 new E6 exporters disambiguate the per-category data shapes
> explicitly.

---

## 3. The 14 concern subcategories (canonical list)

Unchanged from v0.1.

Source: `_shared/tools/scheduler-admin.ts:1751` (CONCERN_CATEGORY_SLUGS Set)

```
noise · vibration · pulling · smell · smoke · leak · warning_light ·
performance · electrical · hvac · brakes · steering · tires · other
```

Plan v0.4 §6 specifies the UI shape:
`<ConcernsPerCategoryTab>` = category picker (14 options) +
sub-surface picker (Questions | Guidelines) + one `<CatalogEditorTab>`
instance bound to the selected (category_slug, sub_surface) tuple.

---

## 4. Existing keytag UI patterns to mirror

Unchanged from v0.1.

The `/keytags` page in admin-app already implements the
admin-dashboard chrome + Pattern A two-step UUID confirmation flow.
Scheduler-config should reuse the same primitives + idioms.

### Files to reuse / extend

- `admin-app/src/components/shell/AppShell.tsx` — page chrome
- `admin-app/src/components/ui/tabs.tsx` — top-level tab nav
- `admin-app/src/components/ui/dialog.tsx` — modal primitive
- `admin-app/src/components/ui/button.tsx` — has `loading` + `loadingText` props (built during loading-spinners feature)
- `admin-app/src/components/keytag/ConfirmationDialog.tsx` — Pattern A confirmation reference. **Extendable to Pattern S** (just rename `confirmation_token` → `confirm_token`; add an explicit diff-preview surface)
- `admin-app/src/lib/orchestrator/*` (existing client) — JSON-RPC dispatch helper to orchestrator-mcp
- `admin-app/src/components/ui/sonner.tsx` — toast surface

### Idioms to match (from `MarkKeytagPostedForm.tsx` + `ReconcileTab.tsx`)

- `useActionState(action, initial)` + `startTransition(() => dispatch(fd))` on programmatic re-dispatch
- `useEffect` on `state.kind` to drive toast + dialog close
- `!isPending && state.kind === "success"` gate on success-card UI
- Dialog close guarded while pending (`handleOpenChange(next: boolean) { if (isPending && !next) return; ... }`)
- All terminal kinds (`success | tool_error | transport_error | validation_error`) close the dialog
- Loader2 from `lucide-react` with `motion-safe:animate-spin`, `aria-busy`, `role="status"`, `aria-live="polite"` inside the dialog body during pending

### Server Action shape (from `mark-keytag-posted.ts` etc.)

```ts
"use server";
export type FooState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | { kind: "needs_confirmation"; args: {...}; confirmation: { token_id, scope_summary, expires_at } }
  | { kind: "success"; data: {...} }
  | { kind: "tool_error"; data: { message: string } }
  | { kind: "transport_error"; message: string };

export async function fooAction(_prev: FooState, fd: FormData): Promise<FooState> {
  // 1. parse + zod-validate fd
  // 2. requireAdmin() (from @/lib/auth)
  // 3. dispatch via orchestrator client (SERVICE_ROLE + X-Actor-Email)
  // 4. branch on response shape
}
```

For Pattern S the `needs_confirmation` branch carries `confirm_token`
(string) + a diff summary instead of `token_id` + `scope_summary` (the
keytag Pattern A token + scope shape). Full adapter contract lives in
plan v0.4 §5.

---

## 5. Existing admin-app starting point

Unchanged from v0.1.

`admin-app/app/schedulerconfig/page.tsx` is currently a polished stub
(Construction icon, "Coming in Phases D–F" card). All page chrome
(`AppShell` + `PageHeader` + `requireAdmin()` auth gate) is already
wired. Only the page body needs to be replaced.

No `admin-app/src/components/scheduler*/` directory exists yet; this
build creates one from scratch following the `keytag/` shape.

No `admin-app/src/actions/scheduler/` directory exists yet; this
build creates one to mirror `admin-app/src/actions/keytag/`.

---

## 6. (Removed — was "Path α vs Path β decision")

This section in v0.1 weighed two paths: defer the 5 legacy surfaces
to a future phase (Path α) vs ship all 8 surfaces with app-level
pre-apply gates (Path β). The `scheduler-edge-parity` feature
eliminated the legacy/V2 split entirely — there is no longer a Path
α/β choice. Plan v0.4 ships all 10 surfaces with edge-side Pattern S
(no app-level pre-apply gates needed).

---

## 7. Sources cited

- `supabase/functions/_shared/scheduler-tools.ts` — orchestrator tool registry (lines 176–1614)
- `supabase/functions/_shared/tools/scheduler-admin.ts` — uploader implementations (797–2580) post E5 Pattern S refactor
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` — V2 + universal revertMdUpload + per-tool exporters
- `supabase/functions/_shared/scheduler-admin-md.ts` — shared parse/serialize helpers + E2 byte-parity canonical helpers (computeConfirmToken + computeCanonicalAfterState + canonicalizeDiff + logAuditEntry)
- `supabase/functions/_shared/scheduler-field-validators.ts` — `CONCERN_CATEGORY_SLUGS` Set form (line 21)
- `admin-app/src/components/keytag/ConfirmationDialog.tsx` — Pattern A reference UI
- `admin-app/src/components/keytag/MarkKeytagPostedForm.tsx` — Pattern A form reference
- `admin-app/src/components/keytag/ReconcileTab.tsx` — soft-confirm modal reference (no-token shape)
- `admin-app/app/schedulerconfig/page.tsx` — current stub
- **`docs/scheduler/edge-parity/PLAN.md`** — canonical 10-kind ↔ table ↔ handler ↔ canonical-state ↔ exporter ↔ surface_filter mapping (§7) + Pattern S flow architecture
- **`docs/scheduler/edge-parity/decisions/`** — 25 ADRs covering Pattern S design (outer-inner RPC split per ADR-001; canonical reason-code enum per ADR-007; force_no_after_hash three-branch logic per ADR-014; audit-log read tool per ADR-021; canonical-state pipe-delimited format per ADR-025; etc.)
- **`docs/scheduler/edge-parity/SMOKE-EVIDENCE.md`** — end-to-end smoke evidence for both V2 (TEXT service_key) + legacy (BIGINT/String(id)) dispatch paths on real test-DB data

---

## 8. Versioning

- v0.1 (2026-05-25) — initial inventory. Classified 5 uploaders as legacy one-shot. Recommended Path α.
- v0.2 (2026-05-26) — post-edge-parity rewrite. Reclassified all 10 uploaders as Pattern S. Added 2 new exporters (E6) to §1D + §2 table. Added §1E audit-log read tool (E7). Removed §1B "legacy" section (collapsed into §1A). Removed §6 Path α/β decision (resolved). Added cross-references to `docs/scheduler/edge-parity/` artifacts.
