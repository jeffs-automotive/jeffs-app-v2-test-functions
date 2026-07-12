
> **SUPERSEDED (noted 2026-07-12).** This plan describes the orchestrator-mediated / Claude-Desktop-era model. Claude Desktop was retired 2026-07-02 and /schedulerconfig is now direct webforms — see docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md. Kept as a dated planning record.

# schedulerconfig — admin UI plan

> Feature: `schedulerconfig` (admin-app)
> Phase: plan (resumed after `scheduler-edge-parity` ship)
> Authored: 2026-05-25 · v0.1
> Revised: 2026-05-26 · v0.5 (post edge-parity ship + round-1 cross-verify fixes)
> Companion: `docs/admin-dashboard/schedulerconfig-research.md`
> Edge-parity feature artifacts: `docs/scheduler/edge-parity/PLAN.md` +
> `docs/scheduler/edge-parity/decisions/` + `SMOKE-EVIDENCE.md`
>
> Replaces the stub at `admin-app/app/schedulerconfig/page.tsx` with a
> tabbed editor surface for the scheduler's predefined-data catalog
> (testing services, routine services, concerns, etc.).

---

## 1. Goal

Give a service advisor a web UI to do everything Chris currently does
in Claude Desktop for the scheduler MD uploaders — without leaving
admin.jeffsautomotive.com — with the same safety properties:

- **two-step apply** for every multi-row mutation (preview diff → apply)
- **revert** within 30 days of any catalog upload
- **export current state** as MD for offline editing
- **audit trail** visible per surface
- **never blocks pending operations** (every modal pending-state guarded)

The page never goes around the orchestrator-mcp tool surface — same
SERVICE_ROLE + X-Actor-Email auth path the Keytags page uses today.

---

## 2. Scope — 10 MD-upload surfaces on Pattern S; 1 per-day surface + Operations on soft-confirm (post edge-parity)

The `scheduler-edge-parity` feature (committed 2026-05-26 as
`4443d77` in jeffs-app-v2-test-functions; companion `74a0487` in
dotfiles-v2-test-data) added Pattern S (dry_run + `expected_confirm_token`
+ `pre_state_snapshot` + revert) to the 5 previously-legacy uploaders.
Net effect for this plan: **the legacy/V2 split no longer exists for MD uploaders.**
All 10 MD-upload surfaces share the same two-step Pattern S shape.

> **Confirmation-shape map (closes R-IMP-1):** Pattern S is the
> shape used by every MD-upload tool (rows 1–9a in the table below).
> Row 9b (per-day inline block/unblock — co-located on the closed-dates
> tab) and the Operations tab (run_appointments_sync + find_orphan_customers)
> use one-shot soft-confirm modals with **no revert** — the inverse
> action is the recovery path. The phrase "all 10 surfaces, all Pattern S"
> from earlier drafts referred to the 10 MD-upload surfaces specifically;
> per-row and operations tools are intentionally NOT Pattern S because
> they're single-row mutations or idempotent on the edge.

### Build-first tab (Chris's call 2026-05-25, still valid)

**Subcategory descriptions** is built end-to-end FIRST. Validates the
shared `<CatalogEditorTab>` shape on a real Pattern S surface before
replicating across the other 9 catalog tabs. This was the original
pilot; the edge-parity ship doesn't change that call.

### Surfaces in scope (Phase D)

| # | Surface | Edge tool | Confirmation shape | Revert |
|---|---|---|---|---|
| 1 | **Subcategory descriptions** (FIRST) | `upload_subcategory_descriptions_md` | Pattern S | `revert_md_upload` |
| 2 | Routine services | `upload_routine_services_md` | Pattern S | `revert_md_upload` |
| 3 | Testing services | `upload_testing_services_md` | Pattern S | `revert_md_upload` |
| 4 | Subcategory service map | `upload_subcategory_service_map_md` | Pattern S | `revert_md_upload` |
| 5 | Question required facts | `upload_question_required_facts_md` | Pattern S | `revert_md_upload` |
| 6 | Concern questions (flat) | `upload_concern_questions_md` | Pattern S | `revert_md_upload` |
| 7 | Concerns per-category (14 cats × 2 sub-surfaces — questions + guidelines) | `upload_concern_category_md` + `upload_concern_category_guideline_md` | Pattern S | `revert_md_upload` |
| 8 | Appointment default limits | `upload_appointment_default_limits_md` | Pattern S | `revert_md_upload` |
| 9a | Closed dates — MD path | `upload_closed_dates_md` | Pattern S | `revert_md_upload` |
| 9b | Closed dates — inline per-day editor (cohabitating Closed-dates tab with 9a) | `block_appointment_capacity` + `unblock_appointment_capacity` | One-shot soft-confirm modal | **No** — inverse action (manual unblock/block) is the recovery; documented in tab UX |
| — | Operations | `run_appointments_sync` + `find_orphan_customers` | One-shot soft confirm | n/a |

### Surface count summary (closes v0.4 cross-verify drift)

- **10 MD upload surfaces** (rows 1–9a, plus 9a = 9 + the 7th row being
  one "Concerns per-category" tab that itself binds to 2 upload tools
  parametrized by category_slug + sub-surface picker; counted as 1
  tab surface, 2 upload tools)
- **2 per-row mutation tools** (block / unblock — co-located on row 9b)
- **2 operations tools** (run_appointments_sync + find_orphan_customers)
- **1 universal revert tool** (revert_md_upload, covers all 10 MD
  surfaces; does NOT cover row 9b per-row mutations)
- **1 universal audit-log read tool** (list_scheduler_admin_audit_log)
- **10 top-level tabs** visible in §3 (9 catalog + 1 Operations)

### Concerns surfaces — flat vs per-category data-shape distinction

**Row 6 (Concerns flat)** and **row 7 (Concerns per-category)** look
similar but operate on different data shapes:

- **Flat (`upload_concern_questions_md`)** — uploads the entire
  `concern_questions` table as one MD blob. ONE tab; one upload form;
  one set of recent uploads. Shape mirrors the testing/routine catalog
  uploaders. Useful when reorganizing questions across categories.
- **Per-category (`upload_concern_category_md` +
  `upload_concern_category_guideline_md`)** — uploads ONE category's
  subcategories OR ONE category's guidelines at a time, scoped by
  `category_slug` arg. The TWO upload tools are mutually exclusive
  per-call (different data shapes; different tables). ONE tab with
  category picker + sub-surface picker (per §6). Useful when iterating
  on a single category's content without disturbing others.

Both surfaces produce distinct audit-log rows (separate `surface_filter`
enum values), so each is **independently addressable by revert** — clicking
Revert on one row never wipes the other surface's audit-log row. But the
flat path and the per-category subs path BOTH mutate `concern_questions`,
so revert of one may **fail with `current_state_drift`** if the other
surface has touched overlapping `concern_questions` rows between the
target upload and the revert attempt. The `<RevertConfirmDialog>`
lost-update warning banner (§4) surfaces this case before the user
clicks Apply, listing every newer upload (regardless of which surface)
that will be undone (closes R-IMP-3 — earlier "independently revertable"
phrasing was an overclaim).

Concrete invariants:
- **Per-category guidelines path** mutates ONLY `concern_category_guidelines`
  — no overlap with flat path; revert is fully independent.
- **Per-category subs path** mutates `concern_subcategories` (no overlap)
  + `concern_questions` (possible overlap with flat path).
- **Flat path** mutates ONLY `concern_questions` (possible overlap with
  per-category subs path).

### Out of scope (forever or for a separate build)

- Editing audit log entries (read-only by design)
- Multi-shop config (single-shop product). **`shop_id` scoping is
  NOT out of scope** — every uploader + revert + exporter tool
  enforces `shop_id` at the edge via `requireAdmin()` → session
  shop_id, even though only one shop exists today. Single-shop product
  ≠ no tenant isolation; the edge surfaces are tenant-aware so that
  future multi-shop migration is a feature flip, not a schema rewrite.
- Per-row mutation UI for `upsert_*` / `patch_*` / `deactivate_*` —
  **deferred to Phase E per §10 Q1** (see Open questions); the
  small-tweak workflow has lower priority than parity with the MD
  upload pattern Chris uses today

---

## 3. UI shape — top-level

`/schedulerconfig` becomes a Tabs surface mirroring the `/keytags`
layout. All 10 surface tabs visible at the top level (no nested
"legacy" group — they're all Pattern S now):

```
┌───────────────────────────────────────────────────────────────────┐
│  Scheduler config                                       [user▾]   │
│  Edit predefined-data catalog. Two-step apply. Revert within 30d. │
├───────────────────────────────────────────────────────────────────┤
│  [ Sub-desc ] [ Routine ] [ Testing ] [ Sub-map ] [ Req-facts ]   │
│  [ Concerns-flat ] [ Concerns-per-cat ] [ Appt-limits ]           │
│  [ Closed-dates ] [ Operations ]                                  │
├───────────────────────────────────────────────────────────────────┤
│  <active tab body>                                                │
└───────────────────────────────────────────────────────────────────┘
```

Tab routing is client-side (`<Tabs value>` keyed by URL `?tab=`).
Default = `?tab=sub-desc` (the pilot tab).

---

## 4. Per-tab UI shape (Phase D — 9 catalog tabs share the SAME shape)

Each catalog tab is a single component instance of a new shared
component `<CatalogEditorTab>`. Concerns-per-category is a
special-case that wraps `<CatalogEditorTab>` inside a category picker
(see §6).

```
┌──────────────────────────────────────────────────────────────────┐
│  Routine services                                                │
│  Two-step: paste/upload → preview diff → confirm apply.          │
├──────────────────────────────────────────────────────────────────┤
│  ┌─ Current state ─────────────────────────────┐                 │
│  │  N services (M active, K deactivated)       │                 │
│  │  [ Export current as .md ]                  │                 │
│  └─────────────────────────────────────────────┘                 │
│                                                                  │
│  ┌─ Upload new MD ─────────────────────────────┐                 │
│  │  [ Paste MD ] tab    [ Upload .md ] tab     │                 │
│  │  ┌─────────────────────────────────────┐    │                 │
│  │  │ <textarea | <file input>            │    │                 │
│  │  └─────────────────────────────────────┘    │                 │
│  │  [ Preview diff (dry-run) ]                 │                 │
│  └─────────────────────────────────────────────┘                 │
│                                                                  │
│  ┌─ Recent uploads (last 10) ──────────────────┐                 │
│  │  May 24 22:00  chris@..  +3 mod 2 deact 0   │                 │
│  │                          [ Revert ▾ ]       │                 │
│  │  May 21 14:12  chris@..  +0 mod 11 deact 0  │                 │
│  └─────────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────┘

(diff-preview modal pops on [Preview diff] click)
(confirm modal pops on [Apply] inside diff modal)
```

### Two-step modal flow (Pattern S)

1. User clicks **Preview diff** → form action dispatches with
   `dry_run: true`.
2. Server Action returns `{ kind: "needs_confirmation", confirmation:
   { confirm_token, diff_summary, dry_run_result } }` per the
   adapter contract in §5.
3. UI opens a **`<DiffPreviewDialog>`** showing:
   - Pretty diff (rows_added / rows_modified / rows_deactivated)
   - Per-row breakdown (collapsed by default, expand on click)
   - Warnings (e.g., >50% price moves; deactivations)
   - **`Apply changes`** button (variant=primary) + **`Cancel`** button
4. **The textarea + Paste/Upload tabs are LOCKED while the preview
   dialog is open.** `<CatalogEditorTab>` holds a `previewedMd: string |
   null` state. When non-null, the underlying form inputs are
   `readOnly` + visually dimmed; the only paths forward are Apply
   (dispatch with `previewedMd` + `expected_confirm_token`) or Cancel
   (clear `previewedMd`, re-enable inputs). This guarantees the Apply
   step sends EXACTLY the MD that was previewed — if the user wants to
   tweak something, they must Cancel + re-preview. Closes GPT v0.4
   IMPORTANT "Plan says 'same form action' but does not call out
   preserving the exact MD payload."
5. On Apply: dispatch the SAME form action with `previewedMd` (NOT
   any newer textarea value) + `dry_run: false` +
   `expected_confirm_token: <token from step 2>`. `useEffect` toasts
   success and closes the dialog.
6. **Post-apply refresh contract:** on `state.kind === "success"`,
   the Server Action returns successfully + Next.js `revalidatePath`
   invalidates the current-state summary + the recent-uploads list +
   any cached export payload for the current surface. The
   `<CatalogEditorTab>` triggers a `router.refresh()` and the UI
   shows the fresh row counts + the newly-landed audit-log row
   without a hard reload. (Closes GPT v0.4 IMPORTANT "Plan does not
   specify refresh/invalidation after apply or revert".)

Tied to existing primitives:

- Dialog: `admin-app/src/components/ui/dialog.tsx` (already exists)
- Button: `admin-app/src/components/ui/button.tsx` (`loading` + `loadingText` props already added during loading-spinners feature)
- Dialog close guard while pending: copy from
  `admin-app/src/components/keytag/ConfirmationDialog.tsx:72-75`
- Toast: existing `sonner` setup

### Revert flow

`<RecentUploadsList>` shows the last 10 audit-log entries for the
current surface, sourced from the new
`list_scheduler_admin_audit_log` orchestrator tool (E7 of edge-parity,
per ADR-021). Each row has a **Revert** button.

The tool returns server-computed eligibility per row — see §5 for the
adapter contract. The UI disables the button when the tool reports
`can_revert: false` (with the reason: stale, already-reverted, revert
of revert, hash-mismatch, etc.).

Click → opens **`<RevertConfirmDialog>`** mirroring the Pattern S
two-step (dry_run via `revert_md_upload` with `dry_run: true` →
preview the revert plan → apply with `expected_confirm_token`).

The edge-side `revert_md_upload_attempt` inner RPC enforces all
eligibility conditions server-side (E1b + ADR-014); UI-side disabling
is a UX layer, not a security boundary.

### Revert lost-update warning (closes GPT v0.4 BL1 + Gemini IMP)

**The revert path is destructive: reverting an old upload can wipe
subsequent legitimate uploads' changes.** Concretely: if Upload A
lands at T1, Upload B lands at T2 (modifying rows that A also
touched), and an admin reverts A at T3, the revert restores A's
`pre_state_snapshot` — which means B's changes vanish along with A's.

Edge-side defense (already in place per ADR-014):

- The inner RPC `revert_md_upload_attempt` computes the current
  canonical state at STEP 5 + compares to the target audit row's
  `expected_after_state_canonical` at STEP 6. If state has drifted
  (B's upload landed after A), the revert is rejected with
  `reason_code: current_state_drift` and the diff is surfaced.
- This catches the obvious case: B's upload changed rows A wrote, so
  reverting A would un-do B's work. The advisor sees the drift diff
  and decides.
- **What edge canNOT catch:** if B's upload touched DIFFERENT rows
  than A (and A's row-set is still in the state A left it), the
  `current_state_drift` check is "no drift" relative to A's specific
  rows — but reverting A still operates on the full pre-A snapshot,
  potentially missing B's contributions to the same surface.

UI-side defense (this plan):

`<RevertConfirmDialog>` always shows, at the top of the dialog:

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠ Revert may wipe newer changes                                 │
│  This will restore the catalog state as of <audit row timestamp>.│
│  Any uploads to this surface AFTER that time will be undone.     │
│  Newer uploads on this surface (last 30d):                       │
│    May 25 09:12  jane@..  +0 mod 4 deact 0  (will be undone)    │
│    May 26 14:33  chris@.. +2 mod 0 deact 1  (will be undone)    │
│  Proceed only if you intend to undo those changes too.           │
└──────────────────────────────────────────────────────────────────┘
```

The "newer uploads" list comes from the same `list_scheduler_admin_audit_log`
call (filtered to `surface = <current>` and `occurred_at > <target audit row
occurred_at>`). If the list is empty (target is the most-recent upload),
the warning collapses to a single line: "This will restore the catalog
state as of <timestamp>. No newer uploads to this surface."

If the dry-run rejects with `current_state_drift`, the dialog shows
the full diff in its body and disables Apply until the user
re-previews. (Same banner pattern as the closed-dates two-path
conflict per §7.)

### Per-surface audit-log filter keys

`<RecentUploadsList>` calls `list_scheduler_admin_audit_log` with
`surface = <canonical enum value>` (filter values per the
canonical `surface_filter` enum defined in `docs/scheduler/edge-parity/PLAN.md` §6):

| Tab | `surface` filter value | Extra args |
|---|---|---|
| Subcategory descriptions | `subcategory_descriptions` | — |
| Routine services | `routine_services` | — |
| Testing services | `testing_services` | — |
| Subcategory service map | `subcategory_service_map` | — |
| Question required facts | `question_required_facts` | — |
| Concerns (flat) | `concern_questions` | — |
| Concerns per-category — Questions | `concern_subcategories` | `category_slug` |
| Concerns per-category — Guidelines | `concern_category_guidelines` | `category_slug` |
| Appointment default limits | `appointment_default_limits` | — |
| Closed dates (MD path 9a) | `closed_dates` | — |
| Closed dates (per-day 9b) | (NOT shown in `<RecentUploadsList>` — no audit row written by `block/unblock_appointment_capacity`; see §7) | — |
| Operations | (NOT a catalog surface; no recent-uploads list) | — |

For concerns-per-category, the extra `category_slug` arg constrains
the filter to one category at a time (so `brakes` doesn't bleed into
`steering`'s recent-uploads list). The audit-log row records the
`category_slug` in its `metadata` JSONB column.

---

## 5. Server Action shape + adapter contract

The orchestrator-mcp tools return:

```
upload (dry_run=true):  { ok, dry_run: true, diff_summary, confirm_token, dry_run_result, ... }
upload (dry_run=false): { ok, dry_run: false, applied: true, audit_log_id, rows_added, rows_modified, rows_deactivated, ... }
revert (dry_run=true):  { ok, outcome: "dry_run_success", confirm_token, ... }
revert (dry_run=false): { ok, outcome: "applied", audit_log_id, restored, deactivated, deleted, ... }
list_audit_log:         { ok, rows: [{ audit_log_id, surface, occurred_at, user_label, rows_added, rows_modified, rows_deactivated, can_revert, revert_reason_if_not, ... }] }
```

Each Server Action **wraps** this into a React-state-ergonomic
discriminated union:

```ts
"use server";

export type CatalogUploadState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string; field?: string }
  | { kind: "needs_confirmation";
      args: { md_content: string };
      confirmation: { confirm_token: string; diff_summary: DiffSummary; dry_run_result: DryRunResult } }
  | { kind: "success";
      data: { audit_log_id: number; rows_added: number; rows_modified: number; rows_deactivated: number } }
  | { kind: "tool_error"; data: { message: string; reason_code?: string } }
  | { kind: "transport_error"; message: string };

export async function uploadXxxAction(
  _prev: CatalogUploadState,
  fd: FormData,
): Promise<CatalogUploadState> {
  // 1. parse + zod-validate fd (md_content, dry_run, expected_confirm_token)
  // 2. const session = await requireAdmin();  // actor_email comes from HERE, never from fd
  // 3. dispatch via orchestrator client with X-Actor-Email: session.email
  // 4. branch on tool response shape → map to state shape above
}
```

**Adapter responsibilities:**
- Convert `{ ok: false, ... }` tool responses to `{ kind: "tool_error" }`
- Convert `{ ok: true, dry_run: true }` to `{ kind: "needs_confirmation" }`
- Convert `{ ok: true, dry_run: false, applied: true }` to `{ kind: "success" }`
- Convert network errors to `{ kind: "transport_error" }`
- For revert: `outcome` (canonical enum per ADR-007) maps to `kind` —
  `dry_run_success` → `needs_confirmation`, `applied` → `success`,
  `rejected` / `crashed` → `tool_error` (with `reason_code` from the
  canonical enum so UI can render specific recovery copy per row in
  the chat-instructions table per `docs/chat-instructions/scheduler/revert-upload.md`).

**Auth boundary (closes I5 from prior cross-verify):**
- SERVICE_ROLE key lives in server-side env only; admin-app's orchestrator
  client lives in `src/lib/orchestrator/` (server-only by file location —
  no `'use client'` directive anywhere in that subtree).
- `actor_email` is derived from `requireAdmin()` session, **never** from
  a form field or client-provided header. If a request arrives with a
  client-set `X-Actor-Email`, the Server Action strips it and substitutes
  the session value.
- Admin authorization is enforced by `requireAdmin()` from
  `@/lib/auth`; possession of `X-Actor-Email` is informational
  (audit-log labeling) not authorizational.

**Idempotency contract (closes GPT v0.4 IMP "duplicate-submit / idempotency"):**

Server Actions are safe to retry without producing duplicate
mutations:

- **Apply path** (`dry_run: false` with `expected_confirm_token`):
  the edge-side uploader computes `md_content_hash` (sha256). If a
  prior audit-log row exists for the same `(shop_id, table_name,
  md_content_hash)` triple within a short window, the apply path
  takes the duplicate-upload fast path and returns the original
  `audit_log_id` + `duplicate_upload: true` without re-writing rows.
  This makes double-click / network retry / browser-back-then-resubmit
  safe.
- **Revert path** (`dry_run: false` on `revert_md_upload`): the inner
  RPC `revert_md_upload_attempt` records every attempt in the
  `scheduler_admin_revert_attempts` table per ADR-002. A second
  attempt with the same `(upload_id, shop_id, expected_confirm_token)`
  AFTER a successful first attempt is rejected with
  `reason_code: already_reverted` (the target audit row now has a
  `successor_revert_id` set).
- **Dry-run paths** are always safe to retry — they perform no row
  mutations on the catalog tables. Each dry-run does write one
  attempt row (for the revert path) or no rows (for the upload path
  — the uploader recomputes the diff each time without touching
  state); cost is bounded.

UI does NOT need its own idempotency token. The pending-state guards
in §11 row 7 (disabled button + dialog close-guard) prevent
double-submit at the UX layer; the edge contracts above prevent
duplicate mutations even if the UX layer fails to.

**Refresh / invalidation contract (recap from §4):**

Every successful apply or revert Server Action ends with:

1. `revalidatePath('/schedulerconfig')` to invalidate any cached
   Server-Component-fetched data for the surface
2. Returns `{ kind: "success", ... }` to the client
3. Client effects (in `<CatalogEditorTab>` + `<RecentUploadsList>`)
   key on `state.timestamp` and trigger `router.refresh()` to fetch
   the new current-state summary + the new audit-log row

The export payload cache (per surface, fetched lazily on first
"Export current as .md" click) is also invalidated on apply/revert
success — the next Export click refetches.

---

## 6. Concerns-per-category tab (the complex one)

The Concerns tab handles BOTH `upload_concern_category_md` (questions
per category) AND `upload_concern_category_guideline_md` (guidelines
per category) for each of 14 concern subcategories:

```
noise · vibration · pulling · smell · smoke · leak · warning_light ·
performance · electrical · hvac · brakes · steering · tires · other
```

(Source: `_shared/tools/scheduler-admin.ts` CONCERN_CATEGORY_SLUGS)

### UI shape

```
┌──────────────────────────────────────────────────────────────────┐
│  Concerns — per category                                         │
├──────────────────────────────────────────────────────────────────┤
│  Category: [ brakes ▼ ]   Sub-surface: ( Questions | Guidelines )│
│                                                                  │
│  ┌─ <CatalogEditorTab> instance ────────────────────────────┐    │
│  │  Current state, Upload new MD, Recent uploads            │    │
│  │  (same shape as any other catalog tab — bound to         │    │
│  │  upload_concern_category_md or _guideline_md based on    │    │
│  │  the sub-surface picker)                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

`<ConcernsPerCategoryTab>` is the container that:
1. Renders a category picker (`<Select>` with 14 options)
2. Renders a sub-surface picker (`<RadioGroup>` Questions | Guidelines)
3. Renders ONE `<CatalogEditorTab>` instance bound to the selected
   tool + scope (`category_slug` arg threaded into the upload action)

URL state: `?tab=concerns-per-cat&category=brakes&sub=questions`.

---

## 7. Closed-dates extras — inline block/unblock

The closed-dates tab additionally exposes `block_appointment_capacity`
+ `unblock_appointment_capacity` as per-day actions in a
calendar-strip view (next 90 days). These mutate one row at a time —
no diff preview needed:

```
┌──────────────────────────────────────────────────────────────────┐
│  Per-day capacity blocks (next 90 days)                          │
│  May 26  ───────  available                                      │
│  May 27  ███████  BLOCKED — "Memorial day"  [ Unblock ]          │
│  May 28  ───────  available                  [ Block… ]          │
│  ...                                                             │
└──────────────────────────────────────────────────────────────────┘
```

`block_appointment_capacity` takes `{ date, reason }`. Single-row
mutation — soft-confirm modal (`<BlockDayDialog>`) with date + reason
inputs.

### Two-path precedence (closes I7 from prior cross-verify)

The closed-dates tab has TWO mutation paths that can conflict:

- **MD upload path** (`upload_closed_dates_md`) — bulk-replaces table state
- **Per-day path** (`block_appointment_capacity` / `unblock_…`) —
  mutates one row at a time

Precedence rules:

1. **Edge-side defense (already in place per ADR-013):** both paths
   share a 2-arg advisory lock keyed on `(shop_id, closed_dates_future)`,
   so concurrent execution is serialized. The MD upload's inner-RPC
   STEP 6 staleness check will detect drift from the captured
   `pre_state_snapshot` if a per-day mutation lands between
   dry-run and apply, and reject with `current_state_drift`.

2. **App-side UX (this plan):**
   - When `<CatalogEditorTab>` (for closed dates) has a Pattern S diff
     modal open AND the calendar strip fires a block/unblock, the
     calendar strip's success refreshes the strip but does NOT
     auto-close the open diff modal. The diff modal's Apply click
     will hit `current_state_drift` from the edge; the modal handles
     that error by showing a "Current state changed — please
     re-preview" banner and disabling Apply until the user clicks
     Preview again.
   - When the calendar strip has a `<BlockDayDialog>` open AND an MD
     upload Apply lands, the calendar strip auto-refreshes the strip
     data; the open `<BlockDayDialog>` is unaffected (single-row
     mutation against fresh state). The user sees a brief toast
     "Calendar refreshed — recent MD upload landed" so they're not
     surprised when a row they see changes.

### Invalidation contract (closes R-IMP-4)

Both the MD path and the per-day path share state — every UI piece on
the closed-dates tab must observe mutations from either path. The
contract:

- **MD path apply/revert success** → action calls
  `revalidatePath("/schedulerconfig")` server-side. The page-level RSC
  re-fetches both the audit-log list AND the 90-day capacity calendar
  load in its `Promise.all` block. `<CapacityCalendarStrip>` re-renders
  with fresh closed-dates + appointment_blocks data.
- **Per-day path (`block_appointment_capacity` /
  `unblock_appointment_capacity`) success** → action also calls
  `revalidatePath("/schedulerconfig")`. The page-level RSC re-fetches
  the same `Promise.all` block, which:
  1. Refreshes `<CapacityCalendarStrip>` (immediate; user sees the day
     flip status).
  2. Invalidates any cached "current state summary" or export-cache
     state in the closed-dates `<CatalogEditorTab>` instance. Because
     the `<CatalogEditorTab>` doesn't persist `previewedMd` /
     `confirm_token` server-side, in-memory state for an open Pattern S
     modal is unaffected — but the next Preview click will hit fresh
     `pre_state_snapshot` data, so any subsequent Apply will reflect
     reality.
- **No client-side `router.refresh()` is needed** beyond what
  `revalidatePath` already triggers via Next.js — the RSC's revalidation
  signals propagate to the active route automatically.

---

## 7.5 Operations tab UI (closes Gemini v0.4 NICE-TO-HAVE + GPT IMP)

The Operations tab is structurally different from the 9 catalog tabs
— it does NOT use `<CatalogEditorTab>` (no MD upload, no diff
preview, no revert, no recent-uploads list). It's two independent
"action card" surfaces:

```
┌──────────────────────────────────────────────────────────────────┐
│  Operations                                                      │
├──────────────────────────────────────────────────────────────────┤
│  ┌─ Appointments sync ─────────────────────────┐                 │
│  │  Manually trigger the appointments-sync     │                 │
│  │  edge function (normally cron-driven).      │                 │
│  │  Last run: May 25 21:00 — 12 synced         │                 │
│  │  [ Run sync now ]                           │                 │
│  └─────────────────────────────────────────────┘                 │
│                                                                  │
│  ┌─ Orphan customers ──────────────────────────┐                 │
│  │  Customers in our cache that Tekmetric      │                 │
│  │  deleted. Recommend periodic review.        │                 │
│  │  [ Find orphans ]                           │                 │
│  │  <results table with id + name + last-seen> │                 │
│  └─────────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────┘
```

### `<RunSyncCard>` shape

- One-shot soft-confirm action backed by `run_appointments_sync` tool
- No Pattern S (the underlying edge function is idempotent at the per-run
  level — see "Idempotency + concurrency contract" below)
- Loading spinner during pending state (pattern: `keytag/ReconcileTab.tsx`)
- Toast on success with row counts (e.g., "12 appointments synced")
- Toast on error with the structured tool error message
- "Last run" timestamp shown in the success card body. Phase D source:
  the user's OWN last successful invocation in this session (from
  `useActionState` timestamp). Global "last run from any session" is
  NOT surfaced in Phase D — it would require an additional read tool
  + table query; deferred to Phase E if Chris asks.

### Idempotency + concurrency contract (closes R-IMP-5)

`run_appointments_sync` is the wrapper over the `appointments-sync` edge
function (cron-driven every 5 min in normal operation). Contract:

- **Per-invocation idempotency:** the edge function writes via
  `appointments.upsert` keyed on `(shop_id, tekmetric_id)`, so
  re-invoking with the same input window is safe. No duplicate-row
  risk.
- **Concurrent runs from the same shop:** the edge function does NOT
  hold a distributed lock. Two concurrent runs CAN happen if (a) the
  cron fires while a manual run is in flight, OR (b) two admins click
  Run sync now simultaneously. Both will complete; the second one's
  upsert writes are no-ops for any rows the first already touched, and
  fresh inserts for any rows that landed between the two reads. Net
  effect: no corruption, no duplicate rows, but the second run's
  "synced N rows" count may double-count the first run's work.
- **`<RunSyncCard>` UX during in-flight:** the button shows
  `loading={isPending}` + `loadingText="Syncing…"` (per
  `OperationsTab.tsx`); the button is disabled while the user's OWN
  request is in flight, preventing same-tab double-click. **Cross-tab /
  cross-admin concurrent runs are NOT prevented in the UI** — they're
  safe per the contract above but produce mildly confusing counts.
  Operator runbook: if you double-clicked or someone else ran sync
  near-simultaneously, the counts shown are a superset; trust the
  database, not the toast.
- **No retry on transport error:** the user sees a transport_error
  toast and is expected to retry manually. We do NOT auto-retry because
  the edge function's per-run cost (Tekmetric API calls) is non-trivial.

### `<FindOrphansCard>` shape

- Read-only action backed by `find_orphan_customers` tool
- `[ Find orphans ]` button → spinner → results table renders below
- Results table columns: `customer_id`, `name`, `last_seen_at`, `tekmetric_id`
- Empty state ("No orphans found — your cache is clean!")
- Refresh button at table top to re-run the query

### Action shape (NOT the catalog `CatalogUploadState` shape)

Operations actions use a simpler discriminated union since they have
no two-step / dry-run / token flow:

```ts
"use server";

export type OperationsActionState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | { kind: "success"; data: unknown }   // shape depends on the tool
  | { kind: "tool_error"; data: { message: string } }
  | { kind: "transport_error"; message: string };
```

The `<OperationsTab>` component does NOT share plumbing with
`<CatalogEditorTab>` — keeping the two type systems separate prevents
accidental "treat Operations like a catalog editor" bugs (closes GPT
v0.4 IMP "shared tab plumbing or action adapters may accidentally treat
Operations like a catalog editor").

The top-level `<SchedulerConfigTabs>` router does treat all 10 tab
keys as equivalent for URL state + tab-switch UX, but routes the
selected tab's body to either `<CatalogEditorTab>`,
`<ConcernsPerCategoryTab>`, or `<OperationsTab>` based on a small
per-tab config registry in `SchedulerConfigTabs.tsx`.

---

## 8. New files

### admin-app/src/actions/scheduler/ (Server Actions)

**Catalog uploaders (Pattern S — all 10 catalogs + revert + audit-list):**
```
upload-routine-services.ts
upload-testing-services.ts
upload-subcategory-service-map.ts
upload-subcategory-descriptions.ts
upload-question-required-facts.ts
upload-concern-questions.ts
upload-concern-category.ts                (per-category, takes category_slug)
upload-concern-category-guideline.ts      (per-category, takes category_slug)
upload-appointment-default-limits.ts
upload-closed-dates.ts
revert-md-upload.ts                       (handles dry_run + confirm)
list-recent-uploads.ts                    (wraps list_scheduler_admin_audit_log; surface filter)
```
Total: 12 files.

**Exporters (all 10 surfaces):**
```
export-routine-services.ts
export-testing-services.ts
export-subcategory-service-map.ts
export-subcategory-descriptions.ts
export-question-required-facts.ts
export-concern-questions.ts
export-concern-category.ts                (per-category subcats)
export-concern-category-guideline.ts      (per-category guidelines)
export-appointment-default-limits.ts
export-closed-dates.ts
```
Total: 10 files. All exporters now exist edge-side (the 2 new ones
from E6 of edge-parity close the prior B1 + B3 cross-verify findings).

**Per-row mutations (3 files):**
```
block-appointment-capacity.ts
unblock-appointment-capacity.ts
patch-service-fields.ts                   (covers testing + routine via toolName arg, optional / deferred per §10 Q1)
```

**Operations (2 files — `list-recent-uploads` already above):**
```
run-appointments-sync.ts
find-orphan-customers.ts
```

### admin-app/src/components/scheduler/ (UI — new dir, ~11 files)

```
SchedulerConfigTabs.tsx                   (top-level Tabs router with ?tab= URL sync)
CatalogEditorTab.tsx                      (UNIVERSAL shape for all 9 catalog tabs)
DiffPreviewDialog.tsx                     (Pattern S two-step modal)
RevertConfirmDialog.tsx                   (Pattern S two-step revert modal)
RecentUploadsList.tsx                     (per-surface audit-log table, sources list_scheduler_admin_audit_log)
ConcernsPerCategoryTab.tsx                (category picker + sub-surface picker + <CatalogEditorTab>)
CapacityCalendarStrip.tsx                 (90-day strip with per-day block/unblock)
BlockDayDialog.tsx                        (soft-confirm modal for block_appointment_capacity)
OperationsTab.tsx
RunSyncCard.tsx                           (one-shot run_appointments_sync)
FindOrphansCard.tsx                       (read-only orphan-customers table)
```
Total: 11 files. The legacy-only components from v0.3 (a separate
`<LegacyEditorTab>` + a separate no-undo `<LegacyApplyDialog>`) are
NOT in the file list — the legacy/V2 distinction is dissolved by the
edge-parity ship.

### admin-app/src/lib/scheduler/ (helpers — 2 files)

```
types.ts                                  (UploadResult + DryRunResult + AuditLogRow + RevertOutcome types — mirrored from edge fn + ADR-007 canonical enum)
md-file-utils.ts                          (download .md, parse uploaded .md File, validate size + MIME per §11)
```

### Updated files (4)

```
admin-app/app/schedulerconfig/page.tsx    (replace stub with <SchedulerConfigTabs>)
admin-app/src/lib/orchestrator/types.ts   (add the scheduler-tool response types if not already there)
docs/admin-dashboard/PLAN.md              (mark Phase D complete after ship)
docs/scheduler/DEFERRED-AUDIT-ITEMS.md    (record per-row UI deferral per §10 Q1 if Chris confirms Phase E)
```

---

## 9. Build order (Phase D)

**D.1** — `src/lib/scheduler/types.ts` + `md-file-utils.ts` + `src/lib/orchestrator/types.ts` additions.

**D.2** — **Subcategory descriptions END-TO-END as the pilot** (Chris's call):
- `actions/scheduler/upload-subcategory-descriptions.ts` (Pattern S)
- `actions/scheduler/export-subcategory-descriptions.ts`
- `actions/scheduler/list-recent-uploads.ts` (filtered by `surface = "subcategory_descriptions"`)
- `actions/scheduler/revert-md-upload.ts` (Pattern S — universal, covers all 10 surfaces per `revertMdUpload` wrapper in scheduler-admin-catalog.ts)
- `components/scheduler/CatalogEditorTab.tsx` (generic — drives any surface)
- `components/scheduler/DiffPreviewDialog.tsx`
- `components/scheduler/RevertConfirmDialog.tsx`
- `components/scheduler/RecentUploadsList.tsx`
- Wire into `<SchedulerConfigTabs>` (one tab visible: Subcategory descriptions)
- Replace stub `app/schedulerconfig/page.tsx`
- typecheck + live smoke test against test Supabase
- **Stop and verify with Chris** before replicating

**D.3** — Replicate the catalog pattern to the other 4 V2 catalog tabs:
- routine services, testing services, sub-map, req-facts
- Each becomes one extra `<CatalogEditorTab tool="..." />` instantiation + 2 Server Actions (upload + export)
- typecheck

**D.4** — Add the 3 ex-legacy-now-Pattern-S catalog tabs:
- concern_questions_flat, appointment_default_limits, closed_dates (MD path only — calendar strip is D.6)
- Same `<CatalogEditorTab>` instantiation pattern as D.3
- typecheck

**D.5** — Concerns-per-category tab:
- `actions/scheduler/upload-concern-category.ts`
- `actions/scheduler/upload-concern-category-guideline.ts`
- `actions/scheduler/export-concern-category.ts`
- `actions/scheduler/export-concern-category-guideline.ts`
- `components/scheduler/ConcernsPerCategoryTab.tsx` (category picker → sub-surface picker → `<CatalogEditorTab>`)

**D.6** — Closed-dates inline block/unblock (additive to D.4's MD path):
- `actions/scheduler/block-appointment-capacity.ts`
- `actions/scheduler/unblock-appointment-capacity.ts`
- `components/scheduler/CapacityCalendarStrip.tsx`
- `components/scheduler/BlockDayDialog.tsx`
- Wire below the closed-dates `<CatalogEditorTab>` per §7 precedence rules

**D.7** — Operations tab:
- `actions/scheduler/run-appointments-sync.ts`
- `actions/scheduler/find-orphan-customers.ts`
- `components/scheduler/OperationsTab.tsx` + `RunSyncCard` + `FindOrphansCard`

**D.8** — Cross-verify via `/feature-cross-verify` (Gemini + GPT).

**D.9** — Live smoke test against the test Supabase project (must NOT touch prod). Manual walkthrough of every tab.

---

## 10. Open questions for Chris (BEFORE implementing)

1. **(NEW) Per-row mutation tools UI surfacing.** The edge already
   exposes `upsert_testing_service`, `patch_testing_service_fields`,
   `deactivate_testing_service`, equivalents for routine, and
   `block/unblock_appointment_capacity` (the latter already in scope
   per §7). The MD upload pattern is full parity with Claude Desktop
   today, but for small tweaks (flip one price, deactivate one
   service) an MD round-trip is heavy. **Question:** ship per-row
   inline editors in Phase D, defer to Phase E, or never (MD-only
   workflow is good enough)?  **Default if no answer:** defer to
   Phase E and record in `DEFERRED-AUDIT-ITEMS.md`.
2. **Recent-uploads cutoff** — last 10 or last 30 per surface in
   `<RecentUploadsList>`? Anything older → "View full history" link
   to a full audit-log table page (future)?
3. **MD file upload UX** — paste-textarea sufficient, or do you want
   a real file picker that reads the .md from your downloads?
4. **`run_appointments_sync` cadence** — is the manual button purely
   for emergencies, or do you want to run it on-demand during normal
   workflow? Affects whether we cache the "last run" result.

---

## 11. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Mis-parsing a confirm_token (orchestrator schema drift) | `src/lib/orchestrator/types.ts` is the single mapping point; integration smoke test catches drift early; types mirror ADR-007 canonical enum verbatim |
| Dialog accidentally closes mid-apply | Copy the `keytag/ConfirmationDialog.tsx:72-75` close-guard pattern verbatim |
| Diff preview hides a destructive change (>50% rows deactivated) | Show explicit "DEACTIVATIONS" callout + require a 2nd checkbox before enabling Apply, only when ≥10 rows or ≥50% would be deactivated |
| Revert clobbers an in-flight upload | Edge-side `revert_md_upload_attempt` STEP 6 staleness check + `successor_revert_id` guard reject this case; UI surfaces the canonical reason_code |
| Touching prod by accident | admin-app's Supabase URL/keys come from env per project — admin-app is bound to `jeffs-app-v2-test-functions-admin-app` Vercel project (NOT prod `jeffs-app-v2`). Verified before build. |
| **(NEW) Admin XSS via uploaded MD content** (closes I8) | All MD rendering uses React default text-escaping (the JSX `{text}` form). NEVER use React's raw-HTML inject prop (the prop name starts with "dangerously" and ends with "InnerHTML" — do not pass it). The diff renderer treats MD as plain text — no markdown→HTML transformation. Validated by Phase D.8 cross-verify with explicit XSS regression test in §12. |
| **(NEW) Upload size / encoding abuse** (closes I9) | `md-file-utils.ts` enforces: ≤2 MB file size; UTF-8 encoding required (rejects BOM + invalid bytes); `.md` extension OR `text/markdown` MIME advisory; empty file rejected with explicit "empty file" error; diff display truncates at 500 changed rows with "X more rows hidden" affordance |
| **(NEW) Pending-state guards beyond dialog** (covers NICE-TO-HAVE N5) | While a mutation Server Action is pending: dialog close-guard (already covered), tab switch disabled (`<Tabs disabled={pending}>`), navigation `beforeunload` guard, double-click on Apply prevented via `disabled={pending}` |
| **(NEW) Closed-dates two-path conflict** (closes I7) | See §7 precedence section — edge advisory lock + STEP 6 staleness check are the safety; UI surfaces drift gracefully |

---

## 12. Testing approach (expanded — closes I10)

### Per-action unit tests (Vitest)

Dispatch unit tests with mocked orchestrator client (no real network). Verify per action:

- `dry_run=true` returns `{ kind: "needs_confirmation" }` with non-empty `confirm_token`
- `dry_run=false` + mismatched token returns `{ kind: "tool_error" }` (reason_code = `confirm_token_mismatch`)
- `dry_run=false` + correct token returns `{ kind: "success" }` with row counts
- `dry_run=false` without token at all returns `{ kind: "validation_error" }` (caught by zod)
- `tool_error` responses (e.g., `current_state_drift`) bubble through the canonical enum
- `transport_error` (network down, 503, etc.) returns `{ kind: "transport_error" }`

### Per-action revert-specific tests

- Revert blocked when target audit row is older than 30 days (`reason_code: too_old`)
- Revert blocked when target audit row IS a revert (`reason_code: revert_of_revert`)
- Revert blocked when target audit row already has a successor revert (`reason_code: already_reverted`)
- Revert blocked when current state drifted between dry-run and apply (`reason_code: current_state_drift`)
- Revert succeeds when token matches + state unchanged + within 30d

### Per-component tests (React Testing Library)

- `<CatalogEditorTab>` renders current state, dispatches preview-diff on click, opens `<DiffPreviewDialog>` on `needs_confirmation`
- `<DiffPreviewDialog>` shows row counts, expands per-row breakdown on click, disables Apply while pending
- `<RecentUploadsList>` renders rows from `list_scheduler_admin_audit_log` response, disables Revert button when `can_revert: false`
- `<RevertConfirmDialog>` survives a `current_state_drift` rejection without losing user-entered context
- `<ConcernsPerCategoryTab>` propagates `category_slug` correctly into upload actions
- `<CapacityCalendarStrip>` refreshes after `<BlockDayDialog>` success without closing it

### Per-Server-Action auth tests

- Server Action with no admin session returns 401-equivalent
- `X-Actor-Email` header sent by client is ignored — actor_email derived from session only
- Service role key never appears in client bundle (build-time check via `next build` output scan)

### Per-page integration tests (Playwright)

- Tab switch persists `?tab=` in URL + browser-back restores prior tab
- Tab switch disabled while a mutation is pending (matches §11 row 7)
- Each tab loads its current state on mount without errors
- Each tab's Preview-diff → modal → Apply round-trip works against test Supabase
- Revert button on a recent upload opens the revert modal, dry-run preview shows the inverse diff, apply succeeds, the now-reverted row shows `Reverted by audit_log_id #N` in `<RecentUploadsList>`

### Live smoke tests (against test Supabase `itzdasxobllfiuolmbxu`)

- Upload a no-op MD (re-export of current state) and verify duplicate-upload fast-path returns the no-op shape
- Each surface: full upload → preview → apply → revert round-trip
- Concerns-per-category: category switch + sub-surface switch preserves correct tool binding
- Closed-dates: open MD upload modal, fire inline block from calendar, hit Apply on modal → expect `current_state_drift` graceful banner

### XSS regression test (closes I8)

- Upload an MD whose row text contains the literal characters `<` + `script` + `>` + `alert(1)` + `<` + `/script` + `>` → verify diff modal renders those literal characters as visible text (no script execution; React's default `{text}` escaping handles this without any extra sanitizer)

---

## 13. Cross-verify checklist (run after Phase D code lands)

- `node scripts/ai-review.mjs --what "schedulerconfig phase D" admin-app/app/schedulerconfig/page.tsx admin-app/src/components/scheduler/*.tsx admin-app/src/actions/scheduler/*.ts`
- typecheck the admin-app
- next build the admin-app (verify SERVICE_ROLE key not in client bundle — search build output for the env var name)
- live smoke test against test Supabase

---

## 14. Versioning

- v0.1 (2026-05-25) — initial plan. Recommends Path α + Phase D top-3 first.
- v0.2 (2026-05-25) — **revised per Chris's call:** Path β (all 8 surfaces this build) + **subcategory descriptions** built first end-to-end as the pilot. Added §6 legacy-surface UX (side-by-side diff + double-checkbox no-undo confirmation), expanded §7 new-files list to 21 actions + 14 components, restructured §8 build order into D.1–D.9.
- v0.3 (2026-05-25) — **PAUSED, pivoting to backend parity first.** Cross-verify (Gemini + GPT — `.claude/work/ai-review-2026-05-25T22-40-58Z.md`) returned 4 blockers and 9 importants. Chris's call: pause this feature, build a separate `scheduler-edge-parity` feature first to fix the edge-side gaps. Then resume schedulerconfig with all 8 surfaces at full safety parity. **Blocker dependencies (must be resolved before resuming):**
  - **B1:** `concern_category_guidelines` has no exporter — breaks the "recover via re-upload of prior export" claim for guideline writes
  - **B2:** `concern_subcategories` exporter is ambiguous (`export_concern_questions_md (?)`) — needs disambiguation or dedicated exporter
  - **B3:** no orchestrator MCP tool exists to read `scheduler_admin_audit_log` — `<RecentUploadsList>` + revert eligibility cannot be built without it
  - **Parity (deferred from §6):** add `dry_run` + `expected_confirm_token` to the 5 legacy uploaders (concerns × 2, default-limits, closed-dates), persist `pre_state_snapshot`, extend `revertMdUpload` to cover them. Eliminates the "no undo" surfaces entirely.
  - **B4:** tab/surface count internal inconsistency — reconcile when resuming
  - **I4-I8:** server-side revert eligibility, auth boundary tightening (actor email from session, not client), tool response shape adapter, closed-dates path conflict precedence, admin XSS guard, upload size/MIME limits, test list expansion
  When `scheduler-edge-parity` ships, re-cross-verify this plan against the new edge-side surface and write a v0.4 reflecting the corrections.
- **v0.4 (2026-05-26) — RESUMED post-`scheduler-edge-parity` ship** (commit `4443d77` jeffs-app-v2-test-functions + `74a0487` dotfiles). Mapping of prior cross-verify findings to current state:
  - **B1 (no `concern_category_guidelines` exporter)** → **CLOSED**: E6 added `export_concern_category_guideline_md`
  - **B2 (no audit-log read tool)** → **CLOSED**: E7 + ADR-021 added `list_scheduler_admin_audit_log_filtered` RPC + MCP tool with server-computed revert-eligibility per row
  - **B3 (Concerns exporters incomplete)** → **CLOSED**: E6 added both `export_concern_category_md` (subcats) + `…_guideline_md` (guidelines)
  - **B4 (tab/surface count drift)** → **CLOSED** by this rewrite: §2 table lists all 10 surfaces explicitly; §3 top-level tabs mock includes all of them; §8 build order maps every surface to a D.x step
  - **I1 (per-row mutation tools ignored)** → **DEFERRED** as §10 Q1 explicit question; default to Phase E per `DEFERRED-AUDIT-ITEMS.md` unless Chris says otherwise
  - **I2 (no-undo legacy surfaces understated)** → **CLOSED**: E5 + E8 — all 10 surfaces now have full Pattern S + revert via the universal `revertMdUpload` wrapper. The "legacy" classification is dissolved; the entire v0.3 §6 legacy-surface UX section is GONE
  - **I3 (legacy app-side confirm not real diff)** → **CLOSED**: same as I2 — all surfaces have real edge-side dry_run with byte-exact canonical state per ADR-025
  - **I4 (server-side revert eligibility)** → **CLOSED**: E1b inner RPC `revert_md_upload_attempt` enforces all 4 conditions (`too_old`, `revert_of_revert`, `already_reverted`, `current_state_drift`) at apply time per ADR-014; UI-side disabling is a UX layer not a security boundary
  - **I5 (auth boundary actor_email from session)** → **CLOSED**: §5 makes this explicit — `requireAdmin()` derives actor_email server-side; client-provided `X-Actor-Email` headers are stripped
  - **I6 (action result shape adapter)** → **CLOSED**: §5 added with full adapter contract (tool shape → React discriminated union)
  - **I7 (closed-dates two-path conflict)** → **CLOSED**: §7 added with explicit precedence rules (edge advisory lock per ADR-013 + UI graceful drift surfacing)
  - **I8 (admin XSS guard)** → **CLOSED**: §11 risk row + §12 explicit regression test
  - **I9 (upload size/MIME/UTF-8 limits)** → **CLOSED**: §11 risk row with explicit limits + `md-file-utils.ts` enforces
  - **I10 (test list expansion)** → **CLOSED**: §12 rewritten with per-action + per-component + per-Server-Action auth + per-page integration + live smoke + XSS regression
  - NICE-TO-HAVE items: N1 closed (E6); N2 resolved (§6 ConcernsPerCategoryTab design); N3 partially addressed (§8 file list naming convention enforces consistency, full registry deferred); N4 partially addressed (every Server Action goes through `wrapAdminAction` Sentry helper per Phase C); N5 closed (§11 row 7)
  Net effect: 13 of 13 cross-verify findings addressed. Plan is ready for re-cross-verify as v0.4 + transition to implement.
- **v0.5 (2026-05-26) — round-1 cross-verify of v0.4 surfaced 6 BLOCKERs + 20 IMPORTANTs** (artifact: `.claude/work/ai-review-2026-05-27T00-38-03Z.md`). The findings broke into three groups:

  **(A) Stale research doc** caused Gemini's 2 BLOCKERs + ~5 IMPORTANTs from both models. The companion `schedulerconfig-research.md` still had the v0.1 "legacy uploaders" classification + missing-exporter claims. **Fix:** updated research doc to v0.2 reflecting post-edge-parity reality. Closes Gemini BL1 (concern_category_guidelines no exporter — added in E6), Gemini BL2 (concern_subcategories ambiguous exporter — added in E6), GPT BL4 (research describes 5 as legacy — updated §1A to list all 10 as Pattern S), and most of the "stale doc" IMPORTANTs.

  **(B) Real safety / UX gaps in the plan.** Closed in v0.5 by these additions:
  - **GPT BL1 / Gemini IMP — Revert wipes newer uploads:** §4 "Revert lost-update warning" section added. `<RevertConfirmDialog>` shows a banner listing newer uploads to the same surface that will also be undone. Edge `current_state_drift` catches the obvious case (same rows); the UI warning catches the subtle case (different rows on the same surface).
  - **GPT IMP — MD textarea freeze during preview→apply:** §4 step 4 added explicit "textarea LOCKED while preview dialog is open" rule. `<CatalogEditorTab>` holds `previewedMd` state; Apply dispatches `previewedMd` (not any newer textarea content). Cancel re-enables inputs.
  - **GPT IMP — Server-side idempotency contract:** §5 new "Idempotency contract" subsection. Upload apply fast-paths on `md_content_hash`; revert apply rejects duplicate `(upload_id, expected_confirm_token)` via `successor_revert_id`; dry-run paths are write-light or write-bounded.
  - **GPT IMP — Refresh/invalidation after apply:** §4 step 6 + §5 "Refresh/invalidation contract" subsection. Every successful apply/revert triggers `revalidatePath('/schedulerconfig')` + client `router.refresh()` to invalidate current-state + recent-uploads + export-payload cache.
  - **GPT IMP — Audit-log filter keys per surface:** §4 new "Per-surface audit-log filter keys" table mapping each tab to its `surface_filter` enum value + extra args (`category_slug` for concerns-per-category).
  - **Gemini NICE / GPT IMP — Operations tab UI undefined:** new §7.5 "Operations tab UI" section. `<RunSyncCard>` + `<FindOrphansCard>` use a separate `OperationsActionState` type system; deliberately NOT routed through `<CatalogEditorTab>` plumbing to prevent "treat Operations like a catalog editor" bugs.
  - **GPT IMP — Closed-dates row split (MD vs per-day):** §2 surfaces table split into row 9a (MD path, Pattern S, revertable) and row 9b (per-day, soft-confirm, NOT revertable). §4 audit-log filter table excludes row 9b explicitly. Closes ambiguity around what `<RecentUploadsList>` shows for the closed-dates tab.
  - **Gemini IMP / GPT IMP — Concerns #6 vs #7 disambiguation:** §2 new "Concerns surfaces — flat vs per-category data-shape distinction" paragraph. Spells out: flat = `concern_questions` whole table; per-category = `concern_subcategories` OR `concern_category_guidelines` scoped by `category_slug`. Different tables, different scoping, different audit-log rows, independently revertable.
  - **GPT IMP — Single-shop ≠ no shop_id scoping:** §2 "Out of scope" reworded to clarify: multi-shop config is out, but `shop_id` enforcement at the edge stays on (single-shop product ≠ no tenant isolation).
  - **Gemini IMP — No revert for per-day capacity:** §2 row 9b explicitly documents that block/unblock has no `revert_md_upload` coverage; recovery is the inverse action (manual unblock/block).

  **(C) False alarms** — fully addressed in the existing v0.4 plan but the cross-verify only saw a truncated excerpt (37706 bytes of plan + 12503 bytes of research = ~50KB of input; the cross-verify summary noted "truncated"):
  - **GPT BL3 — Actor identity server-derivation:** ALREADY in §5 "Auth boundary" subsection ("`actor_email` is derived from `requireAdmin()` session, never from a form field or client-provided header. If a request arrives with a client-set `X-Actor-Email`, the Server Action strips it"). The cross-verify saw only earlier parts of §5.
  - **GPT BL2 — Dry-run stale apply / lost update:** edge-side enforcement is documented in `docs/scheduler/edge-parity/decisions/ADR-014-force-no-after-hash-three-branch-logic.md` + ADR-012 (lock-targets-before-staleness ordering); plan §4 explicitly says "edge-side `revert_md_upload_attempt` STEP 6 staleness check + `successor_revert_id` guard reject this case". The plan does NOT duplicate the ADR contents (right call per the ADR-restructure pattern); cross-verify didn't have ADR access.
  - **Gemini IMP — Audit trail for per-day capacity is missing:** the `block/unblock_appointment_capacity` tools DO write to `scheduler_audit_log` (general scheduler audit) but NOT to `scheduler_admin_audit_log` (which is MD-upload-specific). v0.5 §4 audit-log filter table makes this explicit + §7 documents the recovery path. Cross-verify wasn't aware of the dual audit-log architecture.

  Net effect for v0.5: 9 of 9 real findings closed (group B); group A killed by research doc update; group C clarified in §14. Ready for re-cross-verify as v0.5.
