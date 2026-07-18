# Back-office module — implementation plan

Feature: `back-office` (first cross-app module). Phase: plan. Research: [RESEARCH-2026-07-17.md](./RESEARCH-2026-07-17.md).

---

## Why

The office manager tracks vendor-invoice and repair-order problems in three Notion databases, with make.com
fetching QuickBooks data. The workflow is: office manager (OM) logs an issue → service advisor (SA) fixes it
→ OM verifies → the line disappears. We're replacing Notion/make.com with a real, first-class cross-app
module so the data, status, and alerts live in our own system and both roles work in their own app.

- **OM / owner / back office** work in **qteklink-app**.
- **Service advisors** (GM, SM, Asst Managers) work in **admin-app**.
- The one real cross-app seam is the **shared Supabase database** (no shared code package exists; each app
  gets its own thin DAL/actions/UI over shared tables + RPCs — the repo idiom).

## Locked decisions (Chris, 2026-07-17)

1. **Build the whole module in one pass** (ship together, not incrementally). Internal build order still
   backend → functional UI → design polish.
2. **Reopened-ROs auto-detected**, reusing qteklink's existing Tekmetric unpost/date-move/amount-delta
   detection. Status must encode the **change type**: `unposted` / `reposted (date changed)` /
   `reposted (total changed)` / `date & total changed`.
3. **SA queue visible to all admin-app users** (no new RBAC in admin-app).
4. **Parts-invoice image pulled from QuickBooks** (Attachable API), not a Supabase Storage upload.
5. **RO# comes from a "customer line" on the QBO bill/expense** (a `Line[]` referencing the customer), not a
   custom field. Jeff's is on **Essentials**.
6. **Bills AND expenses**: the invoice number may be a QBO `Bill` OR a `Purchase` (Expense/Check/CC). The
   fetch queries **both** entities and disambiguates.
7. Stale = **48h** since last activity → surfaced in a **daily digest** with a stale section (keytag-report
   style), sent daily until resolved.
8. **Reopened-RO detection = 30-min cron** (not instant — keeps it off the live webhook path). (Chris 2026-07-17.)
9. **Verify = close for every kind** (no separate "reviewed, no issue" state). (Chris.)
10. **Fresh start** — no automated Notion backfill; Chris backfills the open rows manually. (Chris.)
11. **Status label wording** = the design-spec vocabulary (Open / With Advisor / Awaiting Verify / Verified),
    not the Notion terms. (Chris.)
12. **Open-RO auto-close automation (Chris, explicit):** for `open_ro` rows, the system watches that RO#
    and, when the RO **closes** (Tekmetric posted / A/R), automatically flips the row's state to "RO closed"
    and **emails the office manager to verify the entries**. "As much automated as possible." Handled by the
    same detection cron.

> **This whole plan is PHASE 1.** Chris: more automation comes in **phase 2**, discussed after phase 1 ships.

## Non-goals (v1)

- No new RBAC in admin-app. No Supabase Realtime (freshness = existing `router.refresh()` polling idiom).
- No Notion write-back / migration of the 1,776 historical Notion rows (fresh start; can backfill later).
- The QBO CloudEvents webhook migration is **separate** (task chip already filed; due Jul 31).

---

## Architecture

### One table, `kind`-discriminated (not four tables)

A single `back_office_issues` table with a `kind` discriminator + typed common columns + `context` JSONB for
kind-specific data. Rationale: all four Notion tables share the resolution status machine, the BO/SA notes,
RO#, and the verify flow; a unified table gives **one** status machine, **one** RPC set, **one** audit log,
and **one** digest/dashboard query instead of 4×. This matches the repo's `qteklink_review_items` idiom
(typed status + `detail`/`resolution` JSONB) and the keytag manual-review `context` JSONB idiom.

### Status machine (shared by all kinds)

```
open ──Send to SA──▶ sent_to_sa ──SA submits fix──▶ awaiting_verify ──Verify──▶ verified
 │                        ▲                              │
 └────────Verify──────────┴───────Add note & resend─────┘   (Verify allowed from any active state)
```

- Items stay on the OM's table through `open`, `sent_to_sa`, `awaiting_verify`; leave on `verified`.
- `open → verified` directly is allowed (e.g. a reopened RO the OM reviews and finds fine — no SA needed).
- Every transition writes an audit row and fires an email (except a direct create).
- **Stale** = `now() - last_activity_at > 48h` AND status ≠ verified — a derived flag, surfaced by the daily
  digest, not a stored status.

Transitions follow the repo idiom: **SECURITY DEFINER RPCs with a guarded `UPDATE ... WHERE status = '<from>'`**
(optimistic from-state guard), tables service-role-SELECT-only with writes REVOKEd even from service_role.

---

## Database (new migrations under `supabase/migrations/`)

### `back_office_issues`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK `gen_random_uuid()` | |
| `shop_id` | INTEGER NOT NULL | Tekmetric shop id (qteklink convention; Jeff's = 7476) |
| `realm_id` | TEXT NULL | QBO realm for invoice/expense kinds; FK-consistent with `qbo_connections` |
| `kind` | TEXT NOT NULL CHECK IN (`invoice_issue`,`open_ro`,`reopened_ro`,`misc`) | |
| `status` | TEXT NOT NULL DEFAULT `open` CHECK IN (`open`,`sent_to_sa`,`awaiting_verify`,`verified`) | |
| `source` | TEXT NOT NULL CHECK IN (`manual`,`qbo_fetch`,`tekmetric_detection`) | |
| `title` | TEXT NULL | misc kind |
| `ro_number` | TEXT NULL | all kinds (misc optional) |
| `tekmetric_ro_id` | BIGINT NULL | reopened/open-ro kinds — join to `qteklink_events` |
| `vendor_name` | TEXT NULL | invoice kinds |
| `bill_no` | TEXT NULL | invoice kinds — the QBO `DocNumber` |
| `bill_date` | DATE NULL | invoice kinds — QBO `TxnDate` |
| `total_cents` | BIGINT NULL | amount (BIGINT cents per convention) |
| `qbo_txn_type` | TEXT NULL CHECK IN (`Bill`,`Purchase`) | which QBO entity (bills AND expenses) |
| `qbo_txn_id` | TEXT NULL | QBO entity Id — attachment fetch + deep link |
| `bo_notes` | TEXT NULL | office-manager issue description |
| `sa_notes` | TEXT NULL | service-advisor fix description |
| `context` | JSONB NOT NULL DEFAULT `'{}'` | kind-specific (below) |
| `created_by` | TEXT NULL | actor email/label (null when auto-detected) |
| `sent_to_sa_at` / `sa_submitted_at` / `verified_at` | TIMESTAMPTZ NULL | |
| `verified_by` | TEXT NULL | |
| `last_activity_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | drives stale |
| `created_at` / `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

`context` shapes:
- `reopened_ro`: **SUPERSEDED 2026-07-18** by the net-saga model — see `docs/back-office/reopened-ro-history-plan.md` §4. The
  live shape is now `{ change_type (date_changed|total_changed|date_and_total_changed only), saga_started_at, reopened_by,
  baseline_posted_date, baseline_total_cents, final_posted_date, final_total_cents, final_at, history[] }`. (Original 2026-07-17
  shape, now retired: `{ change_type ∈ {unposted, reposted, date_changed, total_changed, date_and_total_changed}, original_posted_date,
  new_posted_date, original_total_cents, new_total_cents, unposted_by, unposted_at }`.)
- `open_ro`: `{ ro_status, ro_closed_at }` (from Tekmetric status).
- `invoice_issue`: `{ attachment: { qbo_attachable_id, file_name, temp_download_uri?, fetched_at } | null }`.

**Indexes:** reopened dedup — **SUPERSEDED 2026-07-18**: the per-unpost-cycle index
`(shop_id, tekmetric_ro_id, (context->>'unposted_at')) WHERE kind='reopened_ro'` was replaced by the one-active-issue-per-RO
index `back_office_issues_reopened_active (shop_id, tekmetric_ro_id) WHERE kind='reopened_ro' AND status <> 'verified'`
(migration `20260718170000`). Also: active-issue index `(shop_id, kind, status) WHERE status <> 'verified'`; stale scan
`(shop_id, last_activity_at) WHERE status <> 'verified'`.

### `back_office_issue_events` (audit — keytag_audit_log style)
`id BIGSERIAL PK`, `issue_id UUID NOT NULL REFERENCES back_office_issues(id)`, `occurred_at`, `action TEXT
CHECK IN (created, detected, ro_closed, sent_to_sa, resent_to_sa, sa_submitted, verified, note_added)`, `prior_status`,
`new_status`, `actor TEXT`, `actor_app TEXT CHECK IN (qteklink, admin, system)`, `note TEXT`,
`email_sent_at TIMESTAMPTZ`, `email_error TEXT`.

### Settings — extend `qteklink_settings`
Add a `back_office JSONB` column (payroll-blob idiom): `{ sa_emails: [], office_emails: [], accounting_emails: [],
digest_emails: [], fallback_admin_email: '', stale_hours: 48 }`. Extend `qteklink_upsert_settings` with a
`p_back_office jsonb` param (null = leave). Read via a new `getBackOfficeSettings(shopId)` in the qteklink DAL.

### RLS + RPCs (all SECURITY DEFINER, `SET search_path = public`, service-role only)
RLS enabled + deny-all + REVOKE anon/authenticated on both new tables; service_role SELECT; INSERT/UPDATE
REVOKEd → mutations only via:
- `back_office_create_issue(p_shop_id, p_kind, p_source, p_payload jsonb, p_actor, p_actor_app)` → insert (status `open`) + audit `created`.
- `back_office_send_to_sa(p_issue_id, p_actor, p_note)` → `open|awaiting_verify → sent_to_sa`; append `bo_notes`; audit `sent_to_sa`/`resent_to_sa`; bump `last_activity_at`.
- `back_office_submit_fix(p_issue_id, p_actor, p_sa_note)` → `sent_to_sa → awaiting_verify`; set `sa_notes`; audit `sa_submitted`.
- `back_office_verify(p_issue_id, p_actor, p_actor_app)` → `(open|sent_to_sa|awaiting_verify) → verified`; audit `verified`.
- `back_office_upsert_reopened(p_shop_id, p_tekmetric_ro_id, p_cycle jsonb)` → dedup upsert for detection + audit `detected`.
- `back_office_close_open_ro(p_shop_id, p_tekmetric_ro_id, p_closed_at)` → flips matching `open_ro` rows' `context.ro_status` to `ro_closed`, bumps `last_activity_at`, audit `ro_closed` (decision #12).
- `back_office_dashboard_counts(p_shop_id, p_month_start date)` → returns open / closed-this-month / stale counts (repo has NO aggregate precedent — this is the one net-new aggregate RPC).
- List reads: qteklink/admin DAL SELECT via the service-role admin client (repo idiom), filtered by `shop_id`.

---

## QuickBooks fetch (qteklink `src/lib/qbo/`)

New `src/lib/qbo/vendor-docs.ts` + Zod schemas in `entities.ts` (none exist today — only `accountSchema`):
- `fetchVendorDocByNumber(shopId, docNumber)`:
  1. `resolveRealmForShop(shopId)` → `new QboClient({ realmId })`.
  2. Query **both** entities: `SELECT * FROM Bill WHERE DocNumber = '<n>'` and `SELECT * FROM Purchase WHERE DocNumber = '<n>'` (one batch of two, or two `client.query()` calls).
  3. Map each hit → `{ qbo_txn_type, qbo_txn_id, vendor_name (VendorRef.name / EntityRef.name), bill_date (TxnDate), total_cents (TotalAmt×100), ro_number (parsed from the customer line), lines[] }`.
  4. **RO# parse:** read the customer line — `Line[].AccountBasedExpenseLineDetail.CustomerRef` (name/value) and/or the line `Description`. **VERIFY the exact field against a real Jeff's bill via the QBO API before finalizing the parser** (open item; Essentials capture mechanism to confirm).
  5. Result semantics: **0** → `not_found` (UI: fix the number, retry); **>1** → return all candidates (UI disambiguates by vendor + date + amount); **1** → autofill.
- `fetchVendorDocAttachments(shopId, qboTxnType, qboTxnId)`: `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.value = '<txnId>'` → return `{ file_name, temp_download_uri }[]`. **VERIFY Attachable works on Essentials** (attachments are not tier-gated, but confirm). Store the ref in `context.attachment`; the row's "view image" opens the (short-lived) `TempDownloadUri` (re-fetch on demand).
- Reuse verbatim: `QboClient`, `tokens.ts`, `errors.ts` (`QboClientError`), `QboActionResult`/`qboFailure`.

---

## RO-watch detection cron (reuse existing pipeline) — reopened ROs **and** open-RO close

New cron edge function **`back-office-ro-watch`** (pg_cron every 30 min via `scheduler_invoke_edge_function`,
keytag-cron idiom). Two jobs in one pass over recent Tekmetric activity:

**A. Reopened-RO detection**
1. Reads new unpost + subsequent repost events from `qteklink_events` since a watermark (the ledger that
   already backs qteklink's live-on-view detection), reusing the existing change-classification primitives
   from the posted-day-sweep / date-moves code (`src/lib/dal/posted-day-sweep.ts`, `date-moves.ts` — extract
   the classify helpers so logic isn't duplicated).
2. Per unposted RO: computes original vs new posted-date and original vs new total → `change_type`.
3. Calls `back_office_upsert_reopened(...)` (dedup per unpost cycle).
4. For NEW rows, calls `back-office-notify` (event `detected`) → alert to office + accounting.

**B. Open-RO auto-close (locked decision #12)**
5. For each `open_ro` issue still `open` with `context.ro_status = 'ro_open'`, checks that RO's current
   Tekmetric status (status id 5=Posted / 6=A/R = "closed") from `qteklink_events` / the `tekmetric_ros`
   mirror.
6. When it has closed → `back_office_close_open_ro(p_shop_id, p_tekmetric_ro_id, p_closed_at)` sets
   `context.ro_status='ro_closed'` + `context.ro_closed_at`, bumps `last_activity_at`, audits, and calls
   `back-office-notify` (event `ro_closed`) → **email the office manager to verify the entries**.

> Exact hook (a standalone cron reading `qteklink_events` vs. extending the existing `detectDateMoves`/sweep
> to also write a back-office row) to be finalized at implement after re-reading the current detection code.
> The cron is the default; it does not perturb the existing webhook/live-on-view contracts. Near-real-time
> (30 min) is acceptable per Chris.

---

## Email (Resend, reuse the qteklink transport)

Two edge functions + one shared template module — all hand-built inline-HTML (repo has no template engine),
burgundy/gold dark theme, deep-links into the app (manual-review email idiom):

- **`supabase/functions/_shared/back-office-email.ts`** — pure HTML builders per event, per kind. Each email
  carries the applicable summary (RO#, bill/expense #, vendor, OM note, and for SA-submitted the SA fix
  note) + a deep link into the relevant app screen.
- **`back-office-notify`** edge fn — input `{ shop_id, issue_id, event }` (`detected` | `ro_closed` |
  `sent_to_sa` | `sa_submitted` | `resent_to_sa` | `verified`). Reads issue + `qteklink_settings.back_office`
  recipients, builds HTML, sends via `_shared/resend-client.ts`, stamps `email_sent_at`/`email_error` on the
  audit row. Recipient rules: `sent_to_sa`/`resent_to_sa` → SA emails; `sa_submitted` → office + accounting;
  `verified` → everyone; `detected` → office + accounting; `ro_closed` → office (verify-the-entries nudge).
  Bearer-auth (service key). **Both apps' server actions call it after the transition RPC succeeds**
  (fire-and-forget; errors → Sentry, never block the user; no silent failures per observability rules).
- **`back-office-daily-report`** edge fn — pg_cron (`0 11 * * 1-6`, keytag-report idiom) → shared
  data-builder `_shared/back-office-dashboard-data.ts` → HTML with **Open issues** + **Stale (>48h)**
  sections (always render section headers; positive empty state = a plain "No open issues" line — the 👍
  emoji is scheduler-app's idiom, not these apps') → Resend with per-day idempotency key. Recipients =
  `digest_emails`. The data-builder is mirrored by the qteklink Dashboard tab query (parity kept by tests —
  the keytag no-drift pattern).

---

## UI

Design spec (mandatory): **`.claude/work/design/back-office-spec.md`** (frontend-design-director; in progress).
Both apps are shadcn `base-nova` on `@base-ui/react` + Tailwind v4 tokens. Freshness via the existing
visibility-gated `router.refresh()` poller (`AutoRefresh` qteklink / `DashboardPoller` admin) + immediate
`router.refresh()` after each action.

### qteklink-app (office manager) — new "Back Office" module
- `app/page.tsx` — add a third `ModuleCard` (Back Office → `/back-office`).
- `app/QtlTabs.tsx` — add a `BACK_OFFICE` tab set: Dashboard / Invoice Issues / Open ROs / Reopened ROs / Misc / Settings.
- `app/back-office/dashboard/page.tsx` — metric cards (Open / Closed-this-month / Stale) + stale table with days-open.
- `app/back-office/invoice-issues/page.tsx`, `open-ros/page.tsx`, `reopened-ros/page.tsx`, `misc/page.tsx`, `settings/page.tsx`.
- Components (`src/components/back-office/`): `AddInvoiceDialog` (QBO fetch + not-found/fallback states + view-image), `AddMiscDialog`, `IssueTable`, `IssueRow`, `SendToSaButton`, `AddNoteResendDialog`, `VerifyButton`, `BackOfficeStatusBadge`, `ChangeTypeBadge`, `BackOfficeSettingsForm` (chip lists — payroll `AlertEmailsCard` idiom).
- Actions (`src/actions/back-office/`): `fetchVendorDocAction`, `createInvoiceIssueAction`, `createOpenRoAction`, `createMiscAction`, `sendToSaAction`, `addNoteAndResendAction`, `verifyIssueAction`, `updateBackOfficeSettingsAction` — each `wrapQtekAction` + `requireQtekUser()` (approver/admin gate) + `QboActionResult`/`qboFailure`, then fire `back-office-notify`.
- DAL (`src/lib/dal/back-office.ts` + `src/lib/back-office/`): list reads (admin client, shop-scoped), status-machine wrappers, QBO fetch, change-type classifier, dashboard counts, settings read.

### admin-app (service advisors) — new `/back-office` fix-it queue
- Add a `NAV_ITEMS` entry in admin-app's `TopNav` (the nav idiom — confirm the implementer may edit the
  client `usePathname()` nav). `app/back-office/page.tsx` — the SA queue (items `sent_to_sa`, plus a
  secondary `awaiting_verify` follow-up view), tabbed/filtered by kind, visible to all admin users
  (`requireAdmin()` only).
- Components (`src/components/back-office/`): `BackOfficeQueue`, `QueueRow`, `SubmitFixDialog`,
  `BackOfficeStatusBadge` (ported to stay visually identical across apps).
- Action `src/actions/back-office/submit-fix.ts`: `submitFixAction` — `wrapAdminAction` + `requireAdmin()` →
  `back_office_submit_fix` RPC → fire `back-office-notify` (`sa_submitted`).
- DAL `src/lib/back-office.ts` — read queue (admin client, shop-scoped).

---

## File-by-file change list

**New migrations** (`supabase/migrations/`): `..._back_office_issues.sql`, `..._back_office_issue_events.sql`,
`..._back_office_rpcs.sql`, `..._back_office_settings_column.sql` (+ `qteklink_upsert_settings` extension),
`..._back_office_detect_cron.sql`, `..._back_office_daily_report_cron.sql`.

**New edge fns** (`supabase/functions/`): `back-office-notify/`, `back-office-detect-reopened/`,
`back-office-daily-report/`; **new shared** `_shared/back-office-email.ts`, `_shared/back-office-dashboard-data.ts`.
Register all three in `config.toml` (verify_jwt=false; bearer-auth in-handler).

**qteklink-app:** `app/page.tsx` (edit), `app/QtlTabs.tsx` (edit), `app/back-office/**` (6 pages new),
`src/components/back-office/**` (new), `src/actions/back-office/**` (new), `src/lib/dal/back-office.ts` (new),
`src/lib/back-office/**` (new), `src/lib/qbo/vendor-docs.ts` (new), `src/lib/qbo/entities.ts` (edit: add Bill/Purchase/Attachable schemas),
`src/lib/dal/settings.ts` (edit: `getBackOfficeSettings`).

**admin-app:** `app/dashboard/page.tsx` (edit), `app/back-office/**` (new), `src/components/back-office/**`
(new), `src/actions/back-office/submit-fix.ts` (new), `src/lib/back-office.ts` (new).

**Tests:** Vitest DAL (status transitions, QBO parser incl. Bill+Purchase+multi-match+RO-line, change-type
classifier, dashboard counts, settings parse); pgTAP (RLS row-counts, guarded-transition no-ops, reopened
dedup unique); Playwright E2E (full cross-app round-trip + multi-tenant isolation); MSW QBO mocks.

---

## Build order (one ship)

1. **Backend**: migrations (tables + RPCs + settings) → QBO `vendor-docs` + schemas → detection cron →
   notify + digest edge fns + templates. Unit + pgTAP tests alongside (TDD).
2. **Functional UI** (orchestrator): both apps' pages/actions/DAL wired to real data + the status machine,
   plain styling.
3. **Design polish** (frontend-implementer): apply `back-office-spec.md`.

## Verification (the `/feature-verify` gate)

- `npm run typecheck` clean (both apps). Vitest + pgTAP green. `npm run build` clean (both apps).
- Playwright E2E: OM create → send-to-SA → (admin) SA submit → (qteklink) OM verify → disappears; +
  multi-tenant isolation; + reopened auto-detect creates a row.
- Manual: real QBO fetch for a Bill and a Purchase against Jeff's realm (confirm RO-line + attachment).
- `/code-review` fail-closed gate + Claude review agents (security/pattern/regression/supabase/quickbooks/
  sentry/vercel + the UI-diff reviewers) + `/feature-cross-verify`.
- Deploy per `deployment.md`: `git push` (apps) + `supabase functions deploy` + `supabase db push` (CLI);
  verify Vercel `state: READY` + advisors.

## Open items (resolve during implement, not blocking the plan)

1. Pull a real Jeff's Bill **and** Purchase via the QBO API; pin the exact customer-line field holding the
   RO# and confirm `Attachable` works on Essentials, before finalizing the parser.
2. Finalize the reopened-RO detection hook (standalone cron vs. extending existing detection) after
   re-reading `posted-day-sweep.ts` / `date-moves.ts`.
3. Confirm how admin-app resolves `shop_id` server-side (Jeff's-only today) for the SA queue's shop scope.
4. Confirm `back-office-notify` fire-point (server action after RPC) is acceptable latency, or move to a DB
   trigger + pg_net if immediacy matters.
