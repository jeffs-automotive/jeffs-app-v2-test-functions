# Back Office — Reopened-RO: net-change filtering + full history + dedicated alerts

**Feature:** `back-office-reopened-history` · **Status:** plan APPROVED (Chris, 2026-07-18) → implement · **Date:** 2026-07-18
**Builds on:** [[back-office-module-shipped]] (shipped 2026-07-17). Prior plan: `docs/back-office/back-office-plan.md`.

---

## 1. Why

The **Reopened ROs** tab currently tracks *every* RO that gets unposted/reposted and shows only the
**latest unpost cycle's** before→after. Problems Chris reported:

1. **Noise.** ROs reopened and re-closed with *no real change* still get tracked + alerted. Staff
   unpost/repost constantly during normal edits — most is not an issue.
2. **Confusing summary.** The single latest-cycle before→after reads as nonsense without the surrounding
   activity. RO #154119 shows "posted date Jul 16 → Jul 14" — looks like James re-posted two days earlier
   for no reason. The **net** change across the whole saga is a **total drop of −$42.39** (date unchanged),
   which the latest-cycle view misses.
3. **No same-day tolerance.** Reopening an RO the same day it was posted to apply a coupon is routine; only
   changes that reach back to an already-closed day matter.

### Locked decisions (Chris, 2026-07-18)

| # | Decision | Choice |
|---|---|---|
| D1 | **What to track** | Only ROs with a **real net change** to posted-date or total (subject to the same-day rule, D6). Reopened + reclosed with no net change → **not tracked, not alerted**. Only tracked ROs get a history. |
| D2 | **Baseline = net first vs final, in LOCAL time** | Compare the RO's **original** posted state (before the first reopen) to its **final** re-close. A value changed then **put back** = a *correction* = no net change (nets out automatically). |
| D3 | **Mid-edit ROs** | **Wait until re-closed.** No row/alert while currently unposted; evaluate + alert once it re-posts. |
| D4 | **Alert recipients** | **Dedicated list only** — new `reopened_emails` field on Back Office → Settings. Empty ⇒ no reopened-RO alert sent (no fallback). |
| D5 | **History detail** | **Posting-lifecycle** (what we already store): every post / sent-to-A-R / unpost (reopen) / payment, each with **date + time (local)**, posted-date, total, actor. |
| D6 | **Same-day carve-out** | If the reopen was **finished on the same local calendar day the RO was originally posted**, a **total** change is routine → **not** flagged; only a genuine (non-corrected) **date** change is flagged. If reopened on a **later** local day, **any** net change (date and/or total) is flagged. |
| D7 | **No time limit** | Baseline reaches back to the original posting however long ago — "if it's ever unposted it should count." (No settle-gap heuristic.) After a prior issue is **verified**, a *new* reopen re-baselines from that verified state (§4.1) so already-handled deltas don't re-fire. |

### The hard feasibility constraint behind D5 (researched, not assumed)

`qteklink_events` is our Tekmetric **webhook** ledger — **not** Tekmetric's UI activity log. Verified live
(4,093 rows): `ro_posted` 2047, `payment_made` 1497, `ro_sent_to_ar` 310, `unknown` 146, `ro_unposted` 93.
The richer UI-only verbs Chris pasted — *"reopened"* (own line), *"marked complete"*, *"received
authorization"*, *"added a previous job"*, *"marked job complete"* — appear **0 times**. Tekmetric never
webhooks them. So the history is built from the **posting lifecycle we do receive** (post / sent-to-A-R /
unpost / payment). Reproducing the verbatim UI feed needs a new data source (the unbuilt
[Tekmetric Bridge](../tekmetric/headless-automation-research.md)) — **out of scope**, follow-up in §8.

> Our ledger has **no** distinct "reopened" event — Tekmetric's UI pairs *unposted* + *reopened* at the
> same second. Our `ro_unposted` **is** the reopen; the history labels it **"Unposted (reopened)."**

---

## 2. The decision function (the heart of this feature)

For each RO, from its full lifecycle history (all in local shop time):

```
baseline = original posted state before the first reopen
           (or the last VERIFIED reopened-issue's final state for this RO — D7 re-baseline)
final    = the current re-closed posted state           (skip entirely if currently unposted — D3)

netDateChanged  = final.postedDate  != baseline.postedDate     (business dates, shop-local)
netTotalChanged = final.totalCents  != baseline.totalCents
laterDay        = final posting's LOCAL calendar day  !=  baseline posting's LOCAL calendar day
```

| laterDay | netDate | netTotal | Track? | change_type |
|---|---|---|---|---|
| — (currently unposted) | — | — | **No** (wait) | — |
| no (same day) | no | yes | **No** | — |
| no (same day) | no | no | **No** | — |
| no (same day) | **yes** | any | **Yes** | `date_changed` |
| yes (later day) | no | **yes** | **Yes** | `total_changed` |
| yes (later day) | **yes** | no | **Yes** | `date_changed` |
| yes (later day) | **yes** | **yes** | **Yes** | `date_and_total_changed` |
| yes (later day) | no | no | **No** | — |

- A **corrected** value (changed then restored) leaves `netX = false` automatically → no false alert.
- **Same-day + both changed** → flagged as `date_changed` (date is the issue; the total still shows in the
  history for context, it just isn't the trigger).
- Chris's coupon example (later day, date wrong→corrected, total changed) → row `later/no/yes` →
  `total_changed`. Exactly "the only issue here is the total sales change." ✓

---

## 3. Golden example — RO #154119 (tekmetric_ro_id 345457958)

Full lifecycle we have stored (8 events, ascending; **times ET / shop-local**):

| # | at (ET) | event_kind | posted date | total | actor |
|---|---|---|---|---|---|
| 1 | Jul 14, 4:59 PM | ro_sent_to_ar | Jul 14 | $1,450.10 | james@ |
| 2 | Jul 16, 2:51 PM | ro_unposted (reopened) | — | *(was $1,450.10)* | james@ |
| 3 | Jul 16, 2:52 PM | ro_sent_to_ar | Jul 14 | $1,407.71 | james@ |
| 4 | Jul 16, 2:52 PM | ro_unposted (reopened) | — | — | james@ |
| 5 | Jul 16, 2:53 PM | payment_made | — | — | Chaim Mishory |
| 6 | Jul 16, 2:53 PM | ro_posted | Jul 16 | $1,407.71 | james@ |
| 7 | Jul 16, 2:57 PM | ro_unposted (reopened) | — | — | james@ |
| 8 | Jul 16, 2:57 PM | ro_posted | Jul 14 | $1,407.71 | james@ |

- **baseline** = event 1 → Jul 14, $1,450.10 · local day **Jul 14**.
- **final** = event 8 → Jul 14, $1,407.71 · local day **Jul 16**.
- **laterDay** = Jul 16 ≠ Jul 14 → **true**. netDate = false (Jul14→Jul14), netTotal = true (−$42.39).
- → **`total_changed`** (today's latest-cycle logic mislabels this `date_changed`).
- **saga_started_at** = event 2's `at` (informational); **reopened_by** = james@; **history** = events 1–8.

The acceptance-anchor unit test asserts exactly the above.

---

## 4. Data model changes

No new tables/columns. Change the `reopened_ro` row's `context` shape + the dedup rule.

### 4.1 Detection — `supabase/functions/_shared/back-office-detect.ts` (rewrite core; keep it PURE)

- Narrow `ChangeType` to `date_changed | total_changed | date_and_total_changed`.
- Add `parseActor(eventText)` (trailing `… by <actor>`; generalizes `parseUnpostedBy`) and payer parse for
  `"Payment made by <name>"`.
- Add `toShopLocalDay(iso, tz)` = the shop-local calendar day (reuse `toShopLocalDate`, en-CA `YYYY-MM-DD`).
- **Replace** `buildReopenedCycle` with `buildReopenedSaga(lifecycle, payments, tz, anchor?)`:
  1. `lifecycle` = `ro_posted|ro_sent_to_ar|ro_unposted`; `payments` = `payment_made`; each sorted asc by `at`.
  2. If no unpost, or the **last lifecycle event is an unpost** → return `{ skip: true }` (D3, currently open).
  3. `final` = last lifecycle event (a posting).
  4. `baseline` + saga window:
     - **anchor present** (a prior VERIFIED reopened issue for this RO — D7): `baseline` = anchor state
       (`{postedDate,totalCents,at}`); saga window = events with `at >= anchor.at`; the first unpost after
       the anchor is `saga_started_at`.
     - **no anchor**: `baseline` = the posting immediately before the **first** unpost in the full history
       (the original booked state); saga window = the full history.
  5. `laterDay` = `toShopLocalDay(final.at,tz) !== toShopLocalDay(baseline.at,tz)`.
  6. Apply the **§2 decision table** → a `change_type` or `{ skip: true }` (D1/D6). Same-day + net-total-only
     ⇒ skip; same-day + net-date ⇒ `date_changed`; later-day ⇒ per net.
  7. `history` = all lifecycle + payment events in the saga window (from `baseline` posting through `final`),
     ascending, mapped to the §4.2 entry shape (postings carry `posted_date`+`total_cents`; payments carry
     `payer`; every entry carries `actor` + local `at`).
  8. Return the saga (`change_type`, `saga_started_at`, `reopened_by`, `baseline_*`, `final_*`, `final_at`,
     `history`) or `{ skip: true }`. **Pure + side-effect-free** (unchanged contract; DB reads stay in the cron).

### 4.2 `context` jsonb — new shape (one active row per RO)

```jsonc
{
  "ro_number": "154119",
  "change_type": "total_changed",            // date_changed | total_changed | date_and_total_changed
  "saga_started_at": "2026-07-16T18:51:32Z", // first unpost of the current saga (informational)
  "reopened_by": "james@jeffsautomotive.com",// actor of that first unpost (replaces `unposted_by`)
  "baseline_posted_date": "2026-07-14",      // business date before the first reopen (shop-local)
  "baseline_total_cents": 145010,
  "final_posted_date": "2026-07-14",
  "final_total_cents": 140771,
  "final_at": "2026-07-16T18:57:16Z",        // received_at of the final posting (D7 re-baseline anchor)
  "history": [ /* ascending; see §3 — each {seq, at, kind, actor, posted_date?, total_cents?, payer?} */ ]
}
```

`total_cents` **column** = `final_total_cents`. Keys `original_*`/`new_*`/`unposted_by` are **renamed** to
`baseline_*`/`final_*`/`reopened_by`; every reader is updated (§5–6) and all rows are rebuilt (§4.4).

### 4.3 Dedup — one active issue per RO (index swap)

```sql
DROP INDEX IF EXISTS public.back_office_issues_reopened_cycle;
CREATE UNIQUE INDEX back_office_issues_reopened_active
  ON public.back_office_issues (shop_id, tekmetric_ro_id)
  WHERE kind = 'reopened_ro' AND status <> 'verified';
```

At most one **un-verified** reopened issue per RO. Re-detection refreshes it; verifying it frees the slot;
a later reopen (D7) inserts a fresh active row anchored at the verified state.

### 4.4 One-time cleanup + backfill

Live: 18 `reopened_ro` rows (11 disqualified, 7 qualify, **0 human-touched**). Migration deletes them
(cascade removes their `detected` audit rows); then the cron backfills the qualifying sagas in the new shape:

```sql
DELETE FROM public.back_office_issues
 WHERE kind='reopened_ro' AND status='open' AND source='tekmetric_detection';
```

Backfill = one manual invocation of `back-office-ro-watch?lookback_hours=<wide>` (idempotent; §8).

### 4.5 RPC `back_office_upsert_reopened` (new migration; `CREATE OR REPLACE`)

- Guard: require `p_cycle->>'change_type'` (one of the three).
- `ON CONFLICT (shop_id, tekmetric_ro_id) WHERE kind='reopened_ro' AND status <> 'verified' DO UPDATE SET
  context=p_cycle, total_cents=(p_cycle->>'final_total_cents')::bigint, ro_number=coalesce(...), updated_at=now()`.
- On insert (`xmax=0`) → `back_office_issue_events` `detected` row (note = change_type). REVOKE/GRANT unchanged.

---

## 5. Alert recipients (D4) — no migration (whole-blob RMW)

- `supabase/functions/back-office-notify/index.ts` — `recipientsFor('detected')` returns **`reopened_emails`
  only** (was `office ∪ accounting`). Empty ⇒ existing "no recipients" path (log + `captureMessage` +
  stamp + 200, no send). `detected` is used only for `reopened_ro`.
- `qteklink-app/src/lib/dal/back-office.ts` — `reopenedEmails: string[]` on `BackOfficeSettings` + DEFAULT;
  map in `getBackOfficeSettings` (`strList(blob.reopened_emails)`) + send in `upsertBackOfficeSettings`.
- `qteklink-app/src/actions/back-office/settings.ts` — add `reopenedEmails` to schema + parse `reopened_emails`.
- `qteklink-app/src/components/back-office/SettingsForm.tsx` — new `ListField name="reopened_emails"`
  ("Reopened-RO alert recipients") in the edit form + the read-only mirror; retune the Accounting help text.

---

## 6. UI — history timeline + net diff (D2/D5) · **design spec: `.claude/work/design/back-office-reopened-history-spec.md`**

Design-and-wiring only (no logic/data-contract changes; the history is already in `context.history`).

- **Both** `IssueDetailDialog.tsx` (qteklink office-manager + admin-app SA, rendered identically) — for
  `reopened_ro`: read renamed keys; add a **History** section rendering `context.history` ascending with
  **local date+time**, action label ("Sent to A/R" / "Posted" / "Unposted (reopened)" / "Payment received"),
  posted-date + total for postings, payer for payments — per the design spec's timeline treatment.
- `qteklink-app/src/components/back-office/IssueTable.tsx` — reopened row's `DiffPair`/`DeltaChip` read
  `baseline_*` → `final_*` (net); optional "N events" affordance per spec. No column changes.
- `qteklink-app/src/lib/back-office/format.ts` (+ admin-app twin) — `formatEventDateTime(iso)` (local date+time).
- `supabase/functions/_shared/back-office-email.ts` — renamed keys; drop the now-impossible
  `unposted`/`reposted` labels; **append a compact history list** to the `detected` email (D5 — Chris: describe
  the issue, show the RO#, show the history).

---

## 7. Testing (TDD)

| Layer | What |
|---|---|
| **Deno unit** (`back-office-detect.test.ts`) | RO #154119 golden → `total_changed` + baseline/final + `final_at` + 8 history entries + `reopened_by`. Decision-table cases: same-day total-only → skip; same-day date → `date_changed`; same-day date+total → `date_changed`; later total-only → `total_changed`; later date-only → `date_changed`; later date+total → `date_and_total_changed`; corrected date (wrong→back) → nets out; currently-unposted → skip; D7 anchor re-baseline. All day math asserted in a non-UTC tz to prove local-time correctness. |
| **Deno** (notify) | `recipientsFor('detected')` = `reopened_emails` only; empty ⇒ `[]`. |
| **pgTAP** (`back_office_issues.test.sql`) | New index `back_office_issues_reopened_active`; one active row per RO (2nd upsert = update); verify frees the slot for a new active row. |
| **Vitest** (qteklink DAL) | settings round-trip `reopenedEmails`. |
| **Settings action** | `reopened_emails` validated + parsed. |
| **RTL** (both dialogs) | History renders with local date+time; missing/empty history degrades gracefully. |

Verify gate: `tsc --noEmit`, vitest, `deno check`/`deno test`, `npm run build` (all three apps), `/code-review`
(fail-closed), UI-diff hard gate (design/wiring/dead-code/behavior-parity).

---

## 8. Deploy (human-gated per `deployment.md` + [[always-push-to-prod]])

1. `supabase db push` — the new migration (index swap + cleanup + RPC).
2. `supabase functions deploy back-office-ro-watch back-office-notify --project-ref itzdasxobllfiuolmbxu`.
3. **One-time backfill** — `back-office-ro-watch?lookback_hours=<wide>` once (curl.exe + scheduler bearer);
   confirm rebuilt rows via `execute_sql`.
4. `git push origin main` → Vercel builds scheduler/admin/qteklink; **confirm each `state: READY`**.
5. Verify: `get_advisors(security)` no net-new WARNs; RO #154119 shows `total_changed` + 8-event history;
   set `reopened_emails` + confirm routing.

### Follow-up (out of scope)
- Full Tekmetric UI activity feed → needs the Tekmetric Bridge. Filed under [[tekmetric-bridge-platform]].

---

## 9. File-by-file change list

**Backend / edge (commit 1):**
- `supabase/migrations/2026071817xxxx_back_office_reopened_saga.sql` — **new**: index swap, cleanup delete,
  `CREATE OR REPLACE back_office_upsert_reopened` (new shape + active-row dedup).
- `supabase/functions/_shared/back-office-detect.ts` — **rewrite**: `buildReopenedSaga`, `parseActor`, payer
  parse, `toShopLocalDay`, net compare, same-day/later-day, D7 anchor, history builder.
- `supabase/functions/_shared/back-office-detect.test.ts` — **rewrite/extend** (decision table + golden).
- `supabase/functions/back-office-ro-watch/index.ts` — payments in history pull, per-RO verified-anchor
  lookup, `buildReopenedSaga`, skip-on-`skip`, `lookback_hours` backfill switch.
- `supabase/functions/back-office-notify/index.ts` — `recipientsFor('detected')` → `reopened_emails`.
- `supabase/functions/_shared/back-office-email.ts` — renamed keys, narrowed labels, history list.
- `supabase/tests/database/back_office_issues.test.sql` — new index + active-row dedup assertions.

**App (commit 2):**
- `qteklink-app/src/lib/dal/back-office.ts` — `reopenedEmails` (type + DEFAULT + get/upsert).
- `qteklink-app/src/actions/back-office/settings.ts` — schema + parse.
- `qteklink-app/src/components/back-office/SettingsForm.tsx` — new field (edit + read-only).
- `qteklink-app/src/components/back-office/IssueTable.tsx` — baseline→final diff.
- `qteklink-app/src/components/back-office/IssueDetailDialog.tsx` — History timeline; renamed keys.
- `admin-app/src/components/back-office/IssueDetailDialog.tsx` — History timeline; renamed keys.
- `qteklink-app/src/lib/back-office/format.ts` (+ admin-app twin) — `formatEventDateTime`.
- Tests: qteklink DAL vitest, settings-action test, RTL for both dialogs.

**Design spec:** `.claude/work/design/back-office-reopened-history-spec.md`.

---

## 10. Resolved judgment calls
- ~~SAGA_SETTLE_HOURS~~ → **no time limit** (D7); baseline reaches to the original posting; re-baseline after verify.
- Email history → **include** (D5).
- All day math + timestamps → **shop-local time** (Chris, 2026-07-18).
