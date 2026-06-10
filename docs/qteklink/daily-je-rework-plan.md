# QTekLink — daily-JE posting rework (align to Accounting Link's structure)

> Status: SHIPPED 2026-06-10 (all 6 steps merged, 1954c3e..c7fff1b + the audit-hardening follow-up; kept as the design record). v1 2026-06-09; v2 2026-06-10 folds the Gemini +
> GPT cross-verify (`.claude/work/ai-review-2026-06-10T02-08-35Z.md`). Settles a fundamental
> divergence: QTekLink posts one JE per RO/payment; AL posts a few **daily category JEs**.
> Chris's decision: match AL's STRUCTURE, but keep QTekLink's deposit-vs-contra payment ROUTING
> (deliberately more correct than AL, which deposits everything).
>
> **Cutover fact (verified live 2026-06-10):** `qteklink_postings` has ZERO posted rows (80
> pending: 49 sale + 31 payment), zero `qbo_je_id`s, and `qteklink_ro_state` is EMPTY — QTekLink
> has never written a JE to QBO. Both reviewers' "historical per-RO cutover" blockers are MOOT:
> there is nothing to migrate or reverse. Cutover = retire the pending per-RO rows + switch the
> enqueue path; the existing clean-date policy (which days QTekLink owns vs AL) is unchanged.

---

## 1. What AL actually does (the research)

Every business day, AL posts **up to 3 category JournalEntries** (DocNumber prefix `JA`):

| JE | One line per… | The other side |
|----|----|----|
| **`JA-RO-<date>`** (sales) | **Dr A/R [235] per RO** (RO# + customer name; incl. $0 ROs) | **Cr income aggregated per account** (Sales-Parts, Labor, Tires…); **Dr discount per account**; **Cr Sales-Tax [250] / PTAL [252]** |
| **`JA-PAY-<date>`** (payments) | **Cr A/R [235] per payment** + **Dr Undeposited [366] per payment** (method + customer) | — (AL deposits ALL types; split into multiple JEs by deposit batch) |
| **`JA-FEE-<date>`** (CC fees) | **Dr Bank/CC-Fees [309] per CC payment** + **Cr Undeposited [366] per CC payment** | — ("Tekmerchant Application Fee") |

Confirmed consistent across 2 weeks. Non-`JA` entries (month-end accruals, term loan, manual
checks) are Jeff's own JEs — out of scope.

## 2. Target model for QTekLink

**AL's structure + QTekLink's routing.** Per business day, build + post **up to 3 non-empty
category JEs** (an empty category produces NO JE/posting row — never an empty JE):

- **`sales`** (`QTL-RO-<date>`) — **itemized Dr A/R per RO** (desc `RO <number>`); **Cr income /
  tax / PTAL aggregated per (account, postingType)** (desc `Daily sales <date>`). **NO discount
  lines** — C5 nets discounts into income (Chris's standing decision; differs from AL's
  gross+discount shape; A/R totals identical). $0 ROs skipped (D4).
- **`payments`** (`QTL-PAY-<date>`) — **per payment, both sides itemized**, routed by the C6
  builder exactly as today: deposit route (card/cash/check **+ financing mapped
  "deposits-like" — Synchrony/Affirm → Dr the mapped deposit account**) vs contra route
  (TPP/Mistake/Shop Vehicle → Dr the mapped contra account), Cr A/R. **Refund lines keep their
  flipped postingTypes** (Dr A/R / Cr deposit-or-contra) — the aggregator preserves per-line
  direction and NEVER nets (the same account may legitimately appear on both sides).
- **`fees`** (`QTL-FEE-<date>`) — **per CC payment, itemized**: Dr CC-Fees / Cr Undeposited
  (desc `PAY <id> — CC fee`). NOT aggregated — matches AL and keeps Undeposited line-matching.

**Fee extraction is structural, not positional:** `PaymentJeLine` gains `part: "gross" | "fee"`.
The C6 builder tags its lines; the daily builder routes `gross` → `payments`, `fee` → `fees`.
No description-matching, no line-index assumptions, no double-count/drop path.

**Manual method-picks are INCLUDED** (the JE is now the posting subject, so the old "UUID
payment id can't form a posting identity" skip in `daily-reconcile.ts` / `approve-post-day.ts`
disappears — a long-standing deferral this rework closes).

## 3. The new posting model (replaces the per-RO grain)

**A NEW table `qteklink_daily_postings`** — the old `qteklink_postings` stays untouched (and its
write path live) until the cleanup step, so there is **no deploy-ordering skew**: the migration
is purely additive; app + cutover ship as one release.

Row = one category JE attempt: `(shop_id, realm_id, business_date, category, posting_version)`
unique; `category IN ('sales','payments','fees')`; same state machine + lease + SECURITY DEFINER
RPCs as today; plus:

- `qbo_je_id` + **`qbo_sync_token`** — first-class columns (updated from every QBO response);
  the correction/update flow needs the current SyncToken. `qteklink_ro_state` is NOT used by the
  daily model (retired at cleanup).
- `constituents` JSONB — the **sorted source membership** (`{ro_ids:[…]}` /
  `{payment_ids:[…]}`); a payment with a fee belongs to BOTH `payments` and `fees`; a void
  affects both. Drives review-item correlation + the breakdown views.
- `source_state_hash` = sha256 of `{category, businessDate, docNumber, constituents, per-
  constituent lines (sorted, with postingType + part)}` — membership changes trip the hash even
  when totals coincide. (Lines are a deterministic function of source + mappings, so source and
  mapping changes that alter the accounting always trip it; churn that doesn't change the
  accounting deliberately doesn't.)
- `requestid` = hash of `(shop, realm, business_date, category, version)`; PrivateNote marker
  `QTL|<shop>|<realm>|day=<date>|<category>|v<version>`.
- Line-count guard: a category JE with > 900 lines → review item, never posted (Jeff's volume
  is ~100–200 lines/day; QBO's practical cap is far above, this is a cheap safety).

## 4. Corrections / update flow — MANDATORY scope (was deferred per-RO; can't be deferred here)

At day grain every post-posting source change (late payment, void, RO edit, mapping fix,
resolved review item) lands on an already-posted day. Both reviewers called this the core risk.

1. **Staleness recheck at post time (hard requirement):** claim the daily row → REBUILD the
   desired category JE from latest source → compare hash vs the claimed row → mismatch =
   release + re-enqueue the fresh version; never post stale.
2. **Correction = full-replacement UPDATE** of the existing QBO JE (`toQboJournalEntry` already
   supports `id + syncToken + sparse:false`): source change after `posted` → enqueue version
   N+1 → poster sends the rebuilt lines as an update under the stored `qbo_sync_token`; store
   the new SyncToken back. A stale-token QBO error → mark_failed(retryable) + re-read the JE.
3. **Category became EMPTY after correction** (e.g. the day's only payment voided): a QBO JE
   can't be updated to zero lines → the correction posts a **JournalEntry DELETE**
   (`operation=delete` with id + SyncToken); the daily row gets a terminal `deleted` status.
4. **Mixed postable + blocked days: partial category JEs are ALLOWED.** A blocked RO/payment is
   excluded by the gates exactly as today (visible in the breakdown's Needs-attention); when
   resolved, the day's hash changes → a correction version folds it into the posted JE. (The
   alternative — block the whole category — would let one bad RO hold up a day's books.)
5. **Per-category independence:** the 3 rows post sequentially but independently; QBO writes
   aren't transactional across JEs. A failed category leaves the others posted — its row stays
   `approved`/`failed` and retries on the next run; the approvals UI shows per-category status.
   This is the same partial-failure surface as today, at 3-row grain instead of ~80.
6. **Review items for a day-level failure:** new subject kind `day` (subjectRef
   `<date>:<category>`) — a daily-JE QBO failure can't attach to a single RO.

## 5. What's REUSED vs REWORKED

**Reused (no change to the math):** the C5 SALE line builder (A/R = RO total, income split by
account, discount waterfall netted into income, tax/PTAL split), the C6 PAYMENT routing
(deposit incl. deposits-like financing vs contra, refund flips, void suppression), the §8/§9
gates + review queue (incl. "fee-side unmapped blocks the whole payment" — kept, fail-closed),
the mappings model + payments-mapping view, `buildDayDrafts`.

**Reworked:** the daily aggregation builder (NEW, pure TS), the posting table + RPCs (NEW,
additive), the poster (day-grain claim + staleness recheck + create/update/delete), reconcile
enqueue (3 daily rows), approve flow (scope = the category rows; summary per category),
corrections (day grain), review-item `day` subject; then cleanup retires the per-RO path +
tables' write paths.

## 6. Settled decisions (D1–D6 + review fold-ins)

| # | Decision | Settled |
|---|----------|---------|
| D1 | Income credit grouping | **Aggregate per (account, postingType)** on the sales JE only; payments/fees JEs stay fully itemized. NEVER net Dr against Cr. |
| D2 | `JA-PAY` split | **One payments JE/day** (AL splits by deposit batch — deferred; Undeposited lines stay itemized per payment, so bank-deposit matching keeps its grain). |
| D3 | Names on lines | Sale A/R lines: `RO <number>` (snapshot lacks the customer name). Payment lines: `PAY <id> — RO <ro>` initially — `payerName` exists in raw event payloads but NOT in `qteklink_payment_state`; adding it = small reducer + migration enhancement (optional follow-up). A/R stays entityless on the mapped bulk-receivable OCA account (settled §13; `ar_entity_rejected` guard remains). |
| D4 | $0 ROs | **Skip.** Only `ro_posted`/`ro_sent_to_ar` events enter drafts at all (unbilled ROs never appear); among those, `totalSales === 0` contributes no lines → no A/R row. Retires the $0-RO empty-posting bug. |
| D5 | DocNumber | **`QTL-RO-…` / `QTL-PAY-…` / `QTL-FEE-…`** (final — a `JA-` mirror could collide with AL's real entries while both run). ≤ 18 chars, under QBO's 21-char cap. |
| D6 | Contra payments placement | **Inside the payments JE** (each line routes to its own Dr account). |

## 7. Sequencing (each step: TDD + typecheck/tests/build + the review battery + Chris's gates)

1. **C6 `part` tags + the daily-JE builder** (pure TS) — `buildDailyJournalEntries(date,
   postableSales, postablePayments)` → up to 3 category JEs + constituents. Explicit tests:
   balanced-from-balanced aggregation; fee extraction (no dup/drop); refund flip preserved;
   contra inside payments; $0-RO skip; empty categories → null; mixed blocked/postable day;
   deterministic ordering + hash stability; line-count guard. (Hash-impact note: `part` lands in
   per-payment `proposed_je` content too — safe, zero posted rows exist to spuriously "correct".)
2. **Migration: `qteklink_daily_postings`** + enqueue/claim/mark/requeue RPCs (+ `deleted`
   status, `qbo_sync_token`, `constituents`) + least-priv + pgTAP (row counts). Additive only.
3. **Poster v2** — day-grain claim → staleness recheck (rebuild + hash compare) → create OR
   full-replacement update OR delete → SyncToken write-back. Mocked client; live post gated.
4. **Reconcile + approve at day grain** — `runDailyReconciliation` upserts the ≤3 daily rows;
   `/approvals` approve+post = the category rows (scope_hash = the bundle hash, per-category
   summary/status); remove the individual `/postings` approve + "Post next approved" controls.
5. **Corrections end-to-end** — post-posting source change → version N+1 → update/delete path;
   `day` review-item subject.
6. **Cutover + cleanup** — reject/retire the 80 pending per-RO rows, retire the per-RO enqueue +
   poster path + `ro_state` writes, remove the old `/postings` UI. (Old table kept as audit.)

The first LIVE post becomes: Chris approves one day → up to 3 JEs land in QBO.

## 8. Impact note

Supersedes the C8 per-RO posting layer + C7's enqueue grain; C5/C6 JE math is reused (C6 gains
line `part` tags). The detailed views (breakdown tabs) stay per-RO/payment — only the posting
grain changes. Closes the manual-method-pick posting deferral. The $0-RO bug is retired by D4.
