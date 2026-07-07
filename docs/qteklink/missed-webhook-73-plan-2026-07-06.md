# QTekLink — 7/3 missed-webhook fix + safety-net repair (plan, 2026-07-06)

Feature marker: `qteklink-missed-webhook-73`. Diagnosis session 2026-07-06 (Chris-reported
"$21.38 sales mismatch between QTekLink and Tekmetric for 7/3/26").

## Why

Two confirmed defects, one incident:

1. **The $21.38:** RO **#153886** (Tekmetric id 343820173, Danielle Dockery, total $21.38,
   paid in full by Discover CC — payment 61605782) was posted in Tekmetric 2026-07-03 13:51:14Z,
   but its `ro_posted` webhook **never arrived** (isolated single-event loss; neighbors at
   13:38/13:41/13:58Z all landed). The 7/3 **sales** draft (30 ROs, $8,306.44, posting
   `3e26ffad`, still `pending`) is missing the RO; the 7/3 **payments** draft DOES carry her
   $21.38 payment. Tekmetric live 7/3 = 35 posted ROs / **$8,327.82** (4 are $0.00, excluded by
   design). If 7/3 were approved as-is, day A/R nets **−$21.38**. Full-window sweep (6/11–7/6,
   641 posted ROs): this is the ONLY missed posting webhook.

2. **The silent safety net:** `runTekmetricCompletenessCheck` (`qteklink-app/src/lib/dal/safety-net.ts`)
   exists to flag exactly this (`missed_ro_webhook` review item) but has been **vacuous since it
   shipped**: `listPostedRepairOrders` (`qteklink-app/src/lib/tekmetric/client.ts` ~L79) reads a flat
   `ro.repairOrderStatusId`, while the real Tekmetric `/repair-orders` list response only carries
   the **nested** `repairOrderStatus: { id, code, name, postedOrAccrecv }` (verified live
   2026-07-06 via the `tekmetric-api-testing` probe — `repairOrderStatusId` is `undefined` on
   every row). Every RO parses to `repairOrderStatusId: null` → the status filter drops all →
   `checked: 0, gaps: 0` every night. The wrong flat shape is ALSO baked into the shared test-kit
   fixture (`test-kit/fixtures/tekmetric.ts` `repairOrderWithStatus`), so the contract suite
   passes while pinning the wrong contract.

## Locked decisions

- Chris approved the two-part proposal 2026-07-06 ("go ahead"): fix the parse + backfill RO
  #153886 into 7/3.
- Backfill uses the EXISTING `qteklink-app/scripts/tekmetric-ro-backfill.mjs` (already proven for
  the pre-go-live keytag-firehose gap; inserts `ro_posted` rows in the exact live-webhook shape;
  DB-generated `event_hash` = `kind|source_id|event_time_raw` makes a future genuine Tekmetric
  replay dedup to a 23505 → 200).
- Add `--only-missing` to the backfill script: without it, a 7/3 run would insert redundant
  `ro_posted` rows for the ~11 ROs captured as `ro_sent_to_ar` (different kind → different hash →
  no dedup). Harmless but noisy in an append-only PII ledger; the flag makes the script the
  precise "backfill affordance" the backlog called for.
- 7/3 draft refresh: the nightly reconciles only the PRIOR day and `sweepPostedDays` only touches
  POSTED days, so the pending 7/3 sales draft rebuilds on the next day-view (live-on-view) or a
  direct `runDailyReconciliation(7476, '2026-07-03')` one-off (precedent: the 4/14 RO-151604
  correction scripts). We run the one-off so the correction is verified now, not on Chris's next
  page load.
- No UI changes — backend/script only. No design spec needed.

## File-by-file changes

| File | Change |
|---|---|
| `qteklink-app/src/lib/tekmetric/client.ts` | `listPostedRepairOrders`: parse status from the real nested shape — `numOrNull(raw.repairOrderStatus?.id)` with the flat `raw.repairOrderStatusId` kept as a fallback (defensive against Tekmetric shape drift). Type the raw row locally (nested + flat optional) instead of casting to the parsed `TekmetricRepairOrder`. |
| `test-kit/fixtures/tekmetric.ts` | `repairOrderWithStatus(statusId)` emits the REAL nested shape (`repairOrderStatus: { id, code, name, postedOrAccrecv }`), keyed off the verified live payload. Only consumer is the qteklink contract suite (repo-grep confirmed). |
| `qteklink-app/src/lib/tekmetric/__tests__/client.contract.test.ts` | Rework the posted-status family to run fixtures THROUGH `listPostedRepairOrders` (mockFetchPages) and assert the PARSED `repairOrderStatusId` — the regression test that would have caught the vacuous net. Keep the 5-AND-6 invariant assertions. |
| `qteklink-app/scripts/tekmetric-ro-backfill.mjs` | Add `--only-missing`: before insert (and in the dry-run summary), query `qteklink_events` for posting events (`ro_posted`/`ro_sent_to_ar`) by `tekmetric_ro_id` for the fetched ROs; skip captured ones. |
| `test-kit/README.md` | Update the tekmetric posted-status row: the contract now also pins the NESTED `repairOrderStatus.id` parse (the 2026-07-06 $21.38 incident). |

Safety-net logic (`safety-net.ts`) itself is CORRECT and unchanged — its unit tests inject the
parsed shape and stay as-is.

## Phasing (single branch, sequential)

1. **Code fix + tests** (implement phase; gated paths unlock).
2. **Verify**: `npm run typecheck` + `vitest run` + `next build` in qteklink-app; `/code-review` gate.
3. **Ship**: commit → push main → confirm Vercel READY (standing prod-push pre-approval).
4. **Backfill 7/3** (data op, after code ships):
   a. Dry-run: `node --env-file=.env.local scripts/tekmetric-ro-backfill.mjs 2026-07-03 2026-07-03 --only-missing` — expect exactly 1 missing RO (343820173).
   b. `--insert --only-missing` — expect `Inserted 1`.
   c. One-off tsx: `runDailyReconciliation(7476, '2026-07-03')` (no QBO write; `auto_post=false`, day pending) → sales draft v1 refreshes in place.
   d. SQL-verify: 7/3 sales draft = 31 RO debit lines, total **$8,327.82**, RO 153886 line = 2138¢; constituents include 343820173.

## Verification (success =)

- Contract suite fails on the OLD client code with the new nested fixture (checked by running the
  new test against the pre-fix parse mentally/locally) and passes on the new.
- typecheck/tests/build clean; `/code-review` gate `pass`.
- 7/3 sales draft totals $8,327.82 and balances (debits = credits).
- Payments draft untouched (34 payment ids incl. 61605782).
- The NEXT nightly safety-net run reports `tekmetricChecked > 0` for 7/6 (was 0 forever) — check
  the Vercel cron log / `results[].safetyNet` after 7/7 07:00Z.

## Open questions

None blocking. Follow-ups deliberately OUT of scope (stay on the existing backlog): auto-close of
`missed_ro_webhook` items on the net's re-check; the sweep's UTC-sliced 35-day lookback; per-shop
webhook tokens.
