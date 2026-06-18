# Keytag dashboard + manual-review list + review-email reformat — plan

> Feature marker: `.feature/current-feature.json` (`keytag-dashboard-review-list`).
> Status: **plan phase** — awaiting Chris's approval before `/feature-implement`.
> Architecture context: `.claude/memory/keytag/keytag_system_architecture.md`.

---

## 1. Why

Three related gaps in the keytag admin surface (`admin-app/app/keytags`):

1. **Manual reviews are not browsable.** The Manual Reviews tab is *lookup-by-code only* — you must already
   have a 6-char code to see anything. There's no way to see "what reviews are open right now." Operators
   want a list they can scan, expand, and resolve in place.
2. **No at-a-glance pool dashboard.** The morning `keytag-daily-report` email is the only place the full pool
   picture (counts, stale tags, A/R-without-tag, the 180-tag grid) exists. During the day there's no live
   equivalent — you reload tabs or wait for tomorrow's email.
3. **Review emails don't link anywhere actionable + are verbose.** Each review email is a wall of narrative
   that tells you to go type a code into Claude Desktop. With a real review page, the email should be a
   short line that *links* straight to the review.

## 2. Locked decisions (from Chris)

| # | Decision | Source |
|---|---|---|
| D1 | **Email = per-review, new brief format.** Keep one email per review at issuance (real-time). Reformat each to a brief line: **review code · key tag # · RO# · short description · link to the review page**. NOT consolidated into a digest. | Q1 answer |
| D2 | **Dashboard = new default tab, keep Live state.** Add a `Dashboard` tab mirroring the daily-report *layout*; make it the module's default landing (`?tab` default flips `live` → `dashboard`); the existing **Live state** tab stays as-is. | Q2 answer |
| D3 | **Manual reviews = expandable list + search bar.** Replace the paste-a-code form with a list: each review is a row; click expands to issue + options + resolve flow. A **search bar** filters by **review code, key tag, and RO#**. A **completed-reviews toggle** at the top (default **off** = open only). | Q3 answer |
| D4 | **Dashboard is live via polling, not realtime.** Updates every ~60s + on page load. **Server-cached snapshot** so each poll is cheap and doesn't re-pull everything. | Chris (2nd message) |
| D8 | **Email link base URL = `https://admin.jeffsautomotive.com`** (stored as `KEYTAG_REVIEW_BASE_URL` secret). | Plan-review |
| D9 | **Daily-report ARN table stays UNCHANGED.** Only the per-review emails (ORP/DRF/REG/PAF) get the new brief format + link. → The daily-report refactor (D5) is therefore byte-identical email output, pure data extraction. | Plan-review |
| D10 | **Search fields = review code, key tag, RO# only.** No customer-name search (not stored on the review row). | Plan-review |

### Recommended implementation defaults (need Chris's ✔ — see §8)

- **D5 — Shared dashboard-data module.** Extract the daily-report's data build (counts / stale+names /
  ROs-without-tags / grid) into `supabase/functions/_shared/keytag-dashboard-data.ts`; have **both** the
  email and the new `getKeytagDashboard` tool consume it. Guarantees the dashboard and email never drift.
- **D6 — Polling mechanism:** `unstable_cache(fn, keys, { revalidate: 60, tags: ['keytag-dashboard'] })`
  around the dashboard fetch + a tiny client `DashboardPoller` calling `router.refresh()` every 60s.
  (No TanStack Query in admin-app; this is the RSC-native fit. Next 15 pinned → `unstable_cache`, not
  `'use cache'`.)
- **D7 — `KEYTAG_REVIEW_BASE_URL` Supabase secret** for the email deep link. Default to the admin app URL.
  Deep link: `${KEYTAG_REVIEW_BASE_URL}/keytags?tab=manual-reviews&review=${code}`.

## 3. Architecture overview

```
                         ┌─────────────────────────── admin-app (/keytags) ───────────────────────────┐
  Tabs (page.tsx)        │  [Dashboard*]  Live state  Assign/Release  Posted/Revert  Reconcile         │
                         │   Manual reviews  Audit history       (* = new default landing)              │
                         └────────────┬───────────────────────────────────┬───────────────────────────┘
                                      │ callKeytagTool(...)                │ callKeytagTool(...)
                                      ▼                                    ▼
                        getKeytagDashboard (NEW tool)        listManualReviews (NEW tool)
                                      │                                    │
   orchestrator-mcp ─────────────────┼────────────────────────────────────┼──────────────────────────
   (getOrchestratorTools)            ▼                                    ▼
                        _shared/keytag-dashboard-data.ts        keytag_manual_reviews (direct read,
                        (NEW shared build, also used by                  filter by context->>...)
                         keytag-daily-report email)
```

Manual-review **email** (`_shared/manual-review-email.ts`) reformat is independent of the above — it just
changes the HTML per review and adds the deep link.

## 4. File-by-file change list

### 4a. Database (`supabase/migrations/`)

- **NEW** `…_keytag_manual_reviews_list_view.sql` *(optional / only if we want server-side search)* — a
  `SECURITY DEFINER` `list_manual_reviews(p_only_open boolean, p_search text, p_limit int)` RPC, or rely on
  PostgREST filtering from the tool (no migration). **Lean: no migration** — the `listManualReviews` tool
  reads `keytag_manual_reviews` directly via the service-role client and filters in TS (table is low-volume,
  same direct-read pattern `issueManualReview`'s dedup gate already uses). Revisit only if volume grows.

> Net: **no new migration expected.** (If §8/D5 review surfaces a need, it'll be a read-only RPC with
> `SET search_path = public`.)

### 4b. Edge / shared TS (`supabase/functions/`)

| File | Change |
|---|---|
| `_shared/keytag-dashboard-data.ts` | **NEW.** `buildKeytagDashboardData(sb, shopId)` → `{ counts, staleDetails[], rosWithoutKeytags[], tags[] }`. Lifts the existing logic out of `keytag-daily-report/index.ts` verbatim (counts, stale w/ serial Tekmetric customer-name map, ARN join to latest `released`, grid rows). Pure data; no HTML. |
| `keytag-daily-report/index.ts` | **Refactor** to call `buildKeytagDashboardData()` for its data, keep its `buildReportHtml()`. Email output **byte-identical** (regression-tested). Per D9, the "Repair Orders Without Key Tags" table is **NOT** changed. |
| `_shared/tools/manual-review-tools.ts` | **ADD** `listManualReviewsTool(sb, args)` → reads `keytag_manual_reviews`, returns `{ ok, count, results: ReviewListItem[] }`. `ReviewListItem` = `{ code, category, issue_summary, ro_number, tag_color, tag_number, options, issued_at, resolved_at, resolved_choice, resolved_by_user_label }`. Args: `{ only_open?: boolean; search?: string; limit?: number }`. No lockout (not code-guessing). |
| `_shared/tools/keytag-dashboard-tool.ts` | **NEW.** `getKeytagDashboardTool(sb, shopId)` → `{ ok, generated_at, counts, stale[], ros_without_tags[], grid[] }` via `buildKeytagDashboardData`. |
| `_shared/orchestrator-tools.ts` | **ADD** two `tool({...})` entries in `getOrchestratorTools`: `listManualReviews` + `getKeytagDashboard`. Auto-exposed by `mcp-tool-registry.ts`. |
| `_shared/manual-review-email.ts` | **Reformat** `buildHtml()` to the brief line (code · tag · RO# · short description) + a prominent **"Open the review"** button linking to `${KEYTAG_REVIEW_BASE_URL}/keytags?tab=manual-reviews&review=${code}`. Keep the Claude-Desktop fallback line. `buildSubject` unchanged-ish. |

### 4c. admin-app (`admin-app/`)

| File | Change |
|---|---|
| `src/lib/orchestrator/types.ts` | **ADD** `listManualReviews` + `getKeytagDashboard` to `KeytagToolMap` with arg/return interfaces mirroring the edge shapes. |
| `app/keytags/page.tsx` | Add `dashboard` to the valid-tab list; **default → `dashboard`**; render new `<DashboardTab>`; thread `review` search param into `<ManualReviewsTab>`. |
| `src/components/keytag/KeytagsTabs.tsx` | Add the **Dashboard** trigger (first) + `TabsContent`; new `dashboard` prop. |
| `src/components/keytag/DashboardTab.tsx` | **NEW** Server Component. Fetches via cached `getKeytagDashboard`; renders count cards + stale table + ROs-without-tags table + R/Y grids + legend, mirroring the email layout in admin-app UI idiom. Hosts `<DashboardPoller>`. |
| `src/components/keytag/DashboardPoller.tsx` | **NEW** `"use client"`. `setInterval(() => router.refresh(), 60_000)` + cleanup; shows a subtle "updated HH:MM" + manual refresh button. |
| `src/lib/keytag/dashboard-cache.ts` | **NEW.** `getCachedDashboard(actorEmail)` = `unstable_cache` wrapper (60s) around `callKeytagTool('getKeytagDashboard', …)`. |
| `src/components/keytag/ManualReviewsTab.tsx` | **Rewrite** from lookup-only to: header + completed toggle + `<ManualReviewSearch>` + `<ManualReviewList>`. Server Component fetches `listManualReviews`; reads `?review=` / `?show_completed=` / `?q=` search params (AuditHistoryTab pattern). |
| `src/components/keytag/ManualReviewList.tsx` | **NEW.** Renders rows; each row is an expandable disclosure (`<details>`/Accordion) showing the issue + context + options + the existing resolve flow. Auto-expands the row matching `?review=`. |
| `src/components/keytag/ManualReviewSearch.tsx` | **NEW** `"use client"`. Search bar (updates `?q=`) + completed toggle (updates `?show_completed=`), debounced, URL-param driven (mirrors `AuditHistoryFilters`). |
| `src/components/keytag/LookupManualReviewForm.tsx` | **Retire/trim.** Its result-display + resolve wiring moves into `ManualReviewList` rows. Keep `ResolveManualReviewForm.tsx` as-is (reused per row). |
| `src/actions/keytag/list-manual-reviews.ts` | **NEW** if any list action needs to be client-invoked; otherwise the Server Component calls the tool directly (preferred, like AuditHistoryTab). |

### 4d. Config / deploy

- **`KEYTAG_REVIEW_BASE_URL`** Supabase secret (Chris sets via `supabase secrets set`). Document default.
- Edge fn redeploys: `orchestrator-mcp`, `keytag-daily-report` (both import the new shared module).
- `admin-app` redeploy via `git push` (Vercel).

## 5. Phasing (commit plan)

1. **Backend-1 — shared data + tools.** `keytag-dashboard-data.ts`, refactor `keytag-daily-report` onto it
   (no behavior change — regression-test the email), add `getKeytagDashboard` + `listManualReviews` tools +
   admin `KeytagToolMap` types. TDD: vitest/deno tests for the data build + tools.
2. **Backend-2 — email reformat.** `manual-review-email.ts` brief format + deep link + `KEYTAG_REVIEW_BASE_URL`;
   carry code+link into the daily-report ARN table. TDD: snapshot/structure tests.
3. **Frontend-1 — manual review list.** `ManualReviewsTab` rewrite + list + search + toggle + `?review=`
   deep-link expansion. (Functional wiring by orchestrator; design polish per the spec.)
4. **Frontend-2 — dashboard tab.** `DashboardTab` + poller + cache + tab/default wiring.
5. **Design polish** per `frontend-design-director` spec (implementer, design-and-wiring only).

## 6. Verification

- `npm run typecheck` clean (admin-app + any tsc on shared).
- Unit tests: `keytag-dashboard-data` parity, `listManualReviews` filtering (code/keytag/RO, open-vs-all),
  email builder structure (code/tag/RO/link present), daily-report unchanged.
- `npm run build` (admin-app) clean.
- **Behavior-parity:** the daily-report email is byte-stable after the data-extraction refactor (regression test).
- `/code-review` fail-closed gate (45 atomic agents).
- **UI hard gate** at verify: `design-review` + `wiring-review` + `dead-code-review` + `behavior-parity-review`
  blocker-free (per `orchestration.md`).
- Manual smoke: open `/keytags` → Dashboard is default + matches the morning email; poll updates after 60s;
  Manual reviews list expands/searches/toggles; an email deep link lands on the right expanded review.

## 7. Frontend design spec

UI work is significant (new dashboard tab + reworked reviews list). Per `orchestration.md`, a
`frontend-design-director` spec is **mandatory** in this phase. Spec path:
`.claude/work/design/keytag-dashboard-review-list-spec.md` (dispatched this phase; linked in the marker
`artifacts.design_spec`).

## 8. Open questions — RESOLVED in plan review (2026-06-18)

1. **D5 (shared data extraction):** ✅ Approved — refactor `keytag-daily-report` onto shared
   `keytag-dashboard-data.ts`; email output byte-identical (regression-tested).
2. **D6 (polling):** ✅ Approved — `unstable_cache` (60s, shared) + `router.refresh()` poller.
3. **D7 / D8 (`KEYTAG_REVIEW_BASE_URL`):** ✅ `https://admin.jeffsautomotive.com`.
4. **Search 4th field:** ✅ No — code / key tag / RO# only (D10).
5. **Daily-report ARN table:** ✅ Leave unchanged (D9).

No open questions remain. Ready for `/feature-implement` on Chris's go-ahead.
