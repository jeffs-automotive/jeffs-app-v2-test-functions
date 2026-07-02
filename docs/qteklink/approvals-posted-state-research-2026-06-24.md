# QTekLink approvals — posted days show the Approve+post button (research + verification)

**Feature:** `qteklink-approvals-fixes` · **Phase:** research · **Date:** 2026-06-24
**Worktree:** `~/worktrees/qteklink-fixes` (branch `qteklink-fixes`, qteklink module lock held)

## Symptom (Chris, 2026-06-24)
> "If a day was approved and posted it should show approved and posted instead of having the
> approve and post button." + "Get rid of the Accounting Link card — we won't be using it anymore."

## Diagnosis — confirmed
The render gate in [`qteklink-app/app/approvals/page.tsx:168`](../../qteklink-app/app/approvals/page.tsx)
shows `<ApproveDayControls>` (the "Approve + post this day" button) whenever:

```
role === "admin" && !isAcknowledged   // ← never checks hasPosted
```

`hasPosted` is computed (line 84) but **never gates the controls** — so a fully-posted day still shows
the live approve+post button, with no "approved & posted" status. The *"Mark as covered"* card right
below (line 171) DOES gate on `!hasPosted`; the posted-state guard was applied there but omitted for the
approve controls.

**Live data (shop 7476):** 2026-06-13 … 06-23 (9 days) are fully `posted` with no open work, and each
currently shows the active button. ≤ 06-11 are `acknowledged` ("Covered by Accounting Link"); 06-12 is
`pending` (open). 06-22 has `payments:failed` (already locks the button via needs-attention).

---

## Verification (Chris asked "let's verify") — BOTH claims CONFIRMED

### 1. Payments + fees are immutable once swept into a QBO deposit — TRUE
- QBO Fault code **6540 → `deposit_locked`** (`qteklink-app/src/lib/qbo/errors.ts:70`):
  *"Deposited Transaction cannot be changed … Only the payments + fees daily JEs can hit this (they
  touch Undeposited Funds); the sales JE never does."*
- `classifyPostError` (`daily-poster.ts:88-92`): `deposit_locked` is **not retryable**, raises a
  distinct `qbo_deposit_locked` review item, and "the failed version + unchanged hash makes the diff
  'skip' next sweep, so it never re-hammers QBO."
- ⇒ Once a day's payments are deposited in QBO, QTekLink cannot change payments/fees for that day. A
  manual "re-post payments/fees" button would only ever fail.

### 2. Sales corrections to posted days post AUTOMATICALLY — TRUE (independent of `auto_post`)
- `auto_post` (live value **`false`** for 7476, confirmed via `qteklink_settings`) gates **first-time**
  posting ONLY — `runNightlySync` step 3 (`nightly-sync.ts:144`) is the only `if (settings.autoPost)`.
- The **posted-day correction sweep is UNCONDITIONAL**: `runNightlySync` calls `sweepPostedDays`
  (`nightly-sync.ts:157`) every run; `sweepPostedDays` → `applyDayCorrections` has **no `auto_post`
  gate** (only reads `dayCorrectionAlertEmails`/`shopTimezone`). For every already-posted day-category
  with a staged pending correction it `approveDailyPosting(…, "system (auto-correction)")` +
  `postDailyPostingById(…)` (`posted-day-sweep.ts:319-321`), then emails the office manager the diff
  (suppressed only for same-day churn).
- The sweep docstring (`posted-day-sweep.ts:277-284`): *"every PENDING version whose category has a
  posted prior gets approved (system) + posted … First-time (never-posted) categories are left for
  human approval."*
- Sales JEs never hit `deposit_locked`, so sales corrections always post. ⇒ "any sales changes happen
  automatically" is correct.

### Correction to the stale memory note
`qteklink-live-state.md` said *"auto_post is OFF for 7476, so nothing auto-posts → re-approve."* That is
**too broad / misleading**: `auto_post` gates only **first-time** posting; posted-day **corrections
auto-post nightly via `sweepPostedDays` regardless of `auto_post`**. Memory updated 2026-06-24.

---

## Decided design (Chris, 2026-06-24)

Day-level display states on `/approvals`:

1. **Open / not yet posted** (no posted version, not acknowledged) → keep today's **Approve + post**
   button (+ lock banner when items need attention). First-time posting stays the manual human gate.
2. **Posted** (a posted version exists) → show an **"Approved & posted to QuickBooks"** status; **hide
   the approve+post button entirely.** No "re-post/update" button — corrections auto-post nightly and
   payments/fees are immutable post-deposit.
   - *Optional (design-spec call):* a subtle "a change was detected — it'll post tonight" hint when a
     correction is staged (`correctionStaged`), since the sweep is nightly. Informational only, no button.
3. **Acknowledged** (Accounting Link history, ≤ 06-11) → **TBD pending Chris** (see open question).

**Derivation:** purely from data the page already fetches (`postings` via `listDailyPostingsForDay` +
`snapshot.needsAttentionCount`) — `hasPosted` already exists at `page.tsx:84`. No extra draft-build, so
no perf regression.

**Design treatment:** full `frontend-design-director` spec requested (plan phase).

## Remove the Accounting Link card (Chris, 2026-06-24)
The *"Mark as covered by Accounting Link"* card (`page.tsx:171-181`, `AcknowledgeDayButton.tsx`) is
retired — QTekLink now posts every day, so there are no new days to acknowledge.

**DECIDED (Chris, 2026-06-24): (a) card only, keep banner.** Remove the *"Mark as covered by Accounting
Link"* action card (`AcknowledgeDayButton` + its card wrapper, `page.tsx:171-181`) so no new days can be
acknowledged. KEEP the "Covered by Accounting Link" banner + the `isAcknowledged` gate so the ~20
historical acknowledged days (May–06-11) still render correctly and never show an approve button. The
`acknowledge-day` action/DAL stays in place (just unreferenced from the UI).

## Other open items
- Chris mentioned "some issues" (plural) — collect the rest before the design spec so we batch.
