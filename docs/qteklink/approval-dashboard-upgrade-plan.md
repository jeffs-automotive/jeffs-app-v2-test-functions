# QTekLink — Approval-Dashboard Upgrade Plan (v2)

**Status:** PLAN (awaiting Chris approval — no code yet)
**Date:** 2026-06-08 · **v2** folds in the Gemini + GPT cross-verify (rounds 1+2; resolutions in §12)
**Supersedes UX of:** `app/approvals/` (review-queue-only) + the common path of `app/postings/`

---

## 0. What Chris asked for + decisions

> Main approval dashboard = a **daily snapshot**: **total sales (with sales tax)**, **total payments**,
> **total credit-card fees**, and a per-transaction-type table (Count / Unapproved / Approved / Posted
> / Total). **Approve from this screen.** A separate **breakdown page** with three tabs: **Summary**
> (macro line items), **RO** (collapsible → parts/labor/fees/tax), **Payments** (two-column: payment + fee).

**Decisions locked (2026-06-08):**
1. **Approve = post in one click** → bulk **live** QBO write → guarded by **Pattern S** (§6).
2. **Approve scope = whole-day + per-type** (master button + per-row).
3. **A "Needs attention" column** for not-yet-postable transactions.
4. **(v2)** The column formerly "Approved" is renamed **In progress** (under approve=post it only ever
   holds transient/in-flight/retrying rows — see the status model §3a).
5. **(v2)** `/postings` **stays** as the per-posting **reject/retry** surface (no longer an open question).

---

## 1. Goals / non-goals

**Goals** — one daily-snapshot approval screen (3 KPIs + the table + approve controls + date nav); a
3-tab breakdown page; approve-and-post a day/type in one guarded, auditable action.

**Non-goals (this upgrade)** — the nightly reconcile **cron** (task #21); the **JE-correction** flow
(`posting_version > 1`, still deferred — but v2 *surfaces* "source changed since posted", §3a); changing
the JE/accounting shapes; multi-shop rollout (but shop+realm scoping is a **safety invariant**, §11).

---

## 2. Current system (what we build on)

- **`qteklink_postings`** — per-transaction lifecycle: `kind ∈ {sale,payment,fee,correction}` (only
  sale+payment produced), `batch_date` (shop-local), `status ∈ {pending, approved, posting, posted,
  needs_resolution, rejected, failed}`, `proposed_je` (jsonb lines), `source_state_hash`, `qbo_je_id`,
  `approved_by`/`approved_at`. Logical identity = `(shop,realm,tekmetric_ro_id,kind,coalesce(payment_id,0),
  posting_version)` (unique). **Conditional-status RPCs + a lease provide the locking** we rely on:
  `qteklink_approve_posting` (WHERE pending), `qteklink_claim_posting` (WHERE approved, SKIP LOCKED,
  sets `lease_until`), `qteklink_mark_posted`, `qteklink_reject_posting`. The poster's `mark_failed`
  routes **retryable→`approved`** (auto-retried) and **permanent→`failed`**.
- **`qteklink_review_items`** — resolution queue (open/resolved), one OPEN per (kind, subject). A blocked
  transaction has an open item and is **not** enqueued → "Needs attention."
- **`qteklink_ro_state`** — per-RO SALE projection (last JE id + SyncToken + `source_snapshot_hash`).
- **Pure reconcile (no DB):** `rollupDay` (`src/lib/reconcile/daily-rollup.ts`) builds + gates every
  draft → `{postableSaleDrafts, postablePaymentDrafts, reviewItems, netByAccount}`. **The snapshot
  engine** for *not-yet-posted* rows (§3a precedence).
- **CC fee** = two lines *inside* the payment JE (`Dr CC-Fees / Cr Undeposited`) → "Payment Fee" is a
  **derived** row (§3b).
- **Business date** = txn timestamp → shop-local day via `toShopLocalDate` (tz from `qteklink_settings`).

---

## 3. Screens

### 3.1 Daily snapshot — the main dashboard (`/approvals`)

```
┌─ Daily approval — [ ◀ ]  Fri Jun 6, 2026  [ ▶ ]   [📅]   [↻ Refresh] ───────────────┐
│   Total sales (incl. tax)     Total payments        Total CC fees                    │
│        $10,667.65                $15,117.75             $376.68                       │
│                                                                                      │
│  Type             Count  Needs attn  Unapproved  In progress  Posted      Total      │
│  Repair Order       38     1,204.00    9,463.65        0.00     0.00    10,667.65     │
│  Customer Payment   32         0.00   15,117.75        0.00     0.00    15,117.75     │
│  Payment Fee        28         0.00      376.68        0.00     0.00       376.68     │
│  ──────────────────────────────────────────────────────────────────────────────     │
│  [ Approve+post ROs ▲QBO ]   [ Approve+post payments ▲QBO ]   ⚠ 1 needs attention →   │
│            [  Approve + post everything unapproved (this day) → live QBO write  ]      │
│  View line items:  [ Open breakdown → ]                                                │
└────────────────────────────────────────────────────────────────────────────────────┘
```
- **3 KPIs** = the row totals. (KPI "Total payments" = **gross** A/R reduction; the fee is the separate
  CC-fee KPI; net-to-Undeposited = payments − fees, shown on the Payments tab.)
- **Every approve button carries the live-write marker (▲QBO)** since approve = post (v2).
- "Payment Fee" has **no button** — fees approve/post **with** their parent payment.

### 3a. The exhaustive status → column model (v2 — resolves the core blocker)

Each transaction maps to **exactly one** column. **Persisted posting wins** over the live draft
(source-of-truth precedence); a transaction with no posting falls back to the live draft / source.

| State of the transaction | Column | In bulk "approve+post" scope? |
|---|---|---|
| Postable live draft, **no posting row yet** | **Unapproved** | ✅ yes |
| posting = `pending` | **Unapproved** | ✅ yes |
| posting = `approved` (incl. a requeued **retryable** failure) | **In progress** | ✅ yes (finish/retry it) |
| posting = `posting` (lease held, mid-write) | **In progress** | ⛔ no — **locked** (claim/lease) |
| posting = `posted` | **Posted** | ⛔ no |
| posting = `failed` (**permanent**) | **Needs attention** | ⛔ no — per-row retry on `/postings` |
| posting = `rejected` | **Needs attention** | ⛔ no — terminal; never re-swept |
| posting = `needs_resolution` | **Needs attention** | ⛔ no |
| **Open review item**, no posting | **Needs attention** | ⛔ no |

**Bulk scope = {unenqueued postable draft, `pending`, `approved`}** only. This kills the three
cross-verify dangers at once: an in-flight `posting` row can't be double-written (excluded + lease),
a `rejected` row can't be silently re-posted (excluded), and a transient **retryable** failure (which
lives in `approved`) **is** re-driven by a re-click (the "re-run clears transient failures" behavior).
`Total = Needs attn + Unapproved + In progress + Posted` (every source transaction of that type).

### 3.2 Breakdown page — 3 tabs (`/approvals/[date]/breakdown`)

> **Data source per row follows the same precedence (§3a):** a **posted/in-progress** row renders its
> **persisted `proposed_je`** (what actually went to / will go to QBO); a **not-yet-posted / needs-
> attention** row renders the **live draft** from `rollupDay` (which includes `unmapped` markers so a
> blocked RO can still be opened and diagnosed). This is why the breakdown can show a needs-attention
> RO's unmapped line even though it has no posting.

- **Tab 1 — Summary (macro):** the day's net **by GL account**, labeled from `qbo_accounts`
  (**shop+realm-scoped join**). Header states it's **"proposed + posted net for the day"** (not "already
  in QBO") and notes if any rows are excluded as Needs attention, so it's never mis-read as the posted
  truth. Posted rows contribute their **persisted** JE; not-yet-posted contribute the live draft.
- **Tab 2 — Repair Orders (collapsible):** one row/RO → expand to labor / parts(by category) / fees(by
  name) / tax, with a status badge + (if needs-attention) the unmapped reason. Source per §3.2 rule.
- **Tab 3 — Payments (two-column):** payment amount + its CC fee side-by-side + net-to-Undeposited +
  status badge.

---

## 4. Routes / page structure

| Route | After |
|---|---|
| `/approvals` | **Daily snapshot** (main dashboard) |
| `/approvals/[date]/breakdown` | **NEW** 3-tab breakdown (`[date]` = ISO **shop-local** `YYYY-MM-DD`, server-validated, never UTC-shifted — §11) |
| `/approvals/review?date=` | the **resolution queue** (resolve item / record manual payment), reachable from the Needs-attention cell, filtered to the day+shop |
| `/postings` | **kept (v2)** — the per-posting **reject / retry / inspect** surface for failed/rejected/stuck rows; reachable from the breakdown's flagged rows. Not the primary path. |
| `/dashboard` | nav points to `/approvals` |

---

## 5. Data model + new read DALs (no new tables)

Two read-only, pure-testable DALs. Both **shop+realm server-derived**, every error thrown, fail-closed.

### `getDailySnapshot(shopId, businessDate) → DailySnapshot`
1. Resolve realm + settings (tz/tax/tire).
2. **Live drafts:** run `rollupDay` over the day's source transactions → postable drafts (+ their debit
   totals) + review items + `netByAccount`.
3. **Persisted postings:** load **all** `qteklink_postings` for `(shop, realm, batch_date)` — *including*
   `posted/posting/failed/rejected/needs_resolution`, not just open ones (resolves "persisted rows
   missing from the live rollup": a posted row whose source later changed still appears).
4. **Merge by logical identity, persisted-posting-wins (§3a precedence):**
   - Posting exists → its **status → column** (§3a) + its **`proposed_je` amount** (debit total). For
     `posted`, compare current source hash vs `source_state_hash` → set `changedSincePosted` flag.
   - No posting, postable draft → **Unapproved**, amount = draft debit total.
   - No posting, blocked (open review item) → **Needs attention**, amount = **source gross**
     (`totalSales` / payment amount — known even when the JE can't fully build).
5. **Derived Payment-Fee row (§3b):** for each payment, take its CC-fee cents (from the payment JE's fee
   lines / the payment-state `applicationFee`); **bucket the fee into the column of its PARENT payment's
   status**; `count` = payments with `fee>0`. A payment blocked for a **fee-account** mapping issue →
   its fee in **Needs attention**; a payment blocked for a payment-level issue → the payment counts under
   Customer Payment (its fee follows the parent into Needs attention too, so fees are never under-counted).
6. Returns `{ businessDate, kpis:{salesCents,paymentsCents,ccFeesCents},
   rows: TypeRow[], needsAttentionCount }`, `TypeRow = { type, count,
   needsAttentionCents, unapprovedCents, inProgressCents, postedCents, totalCents }`.
   `needsAttentionCount` = distinct source transactions in the Needs-attention column.

### `getDayBreakdown(shopId, businessDate) → DayBreakdown`
- **summary** = per-account net (persisted JE for posted rows + live draft for the rest) + shop+realm
  account-name join.
- **ros[]** = `{ roNumber, totalCents, status, changedSincePosted?, lines:[{label, accountName?,
  debit/credit, unmapped?}], reviewReason? }` — lines from the persisted `proposed_je` (posted) or the
  live draft (not-yet-posted).
- **payments[]** = `{ label, method, amountCents, feeCents, netCents, status }`.

---

## 6. The approve-and-post action (Pattern S — safety-critical, v2-hardened)

`approveAndPostDayAction` — **admin-checked on BOTH branches** (the dry-run leaks financial totals;
execute does live writes). Scope ∈ {`day` | `sale` | `payment`}.

**Dry-run (no token):**
1. Re-derive the **in-scope set** = the explicit list of postings/drafts in bulk scope (§3a:
   unenqueued-postable + `pending` + `approved`) for the shop/realm/date/scope.
2. Build the **canonical scope descriptor** = sorted list of `(logical_id, posting_version,
   amountCents, status)` + `{shop, realm, businessDate, scope}`. `scope_hash = sha256(canonical)`.
   (A hash over count/total alone is **insufficient** — two different sets share a total; the per-item
   identity+version+amount+status is what binds it.)
3. Return `{ needs_confirmation:true, summary:{ perType:[{type,count,cents}], totalCents, jeCount },
   expected_confirm_token, scope_hash }`. **No writes.** The confirm modal shows the **per-type**
   breakdown (ROs: a / Payments: b / Fees inside payments: c) — never one blended number.

**Token (Pattern S):** server-issued, **bound to** `(admin_email, shop, realm, businessDate, scope,
scope_hash, expires_at≈5 min)`, single-use; re-verified on execute. (Reuses the keytag Pattern-A token
shape — `confirmation_patterns_decision_tree.md`.)

**Execute (with token + scope_hash):**
1. Validate the token (admin/shop/realm/scope/expiry/unconsumed) + **re-derive the scope and recompute
   `scope_hash`**; if it differs from the token's → **reject** ("the day changed since you reviewed —
   re-open and confirm"). This closes the TOCTOU window for the *set*.
2. For **each posting id in the confirmed set**, in order: `enqueue` (if a bare draft) → `approve`
   (conditional WHERE pending) → **scoped post**: `claim THIS id` (conditional WHERE approved, sets a
   lease — **the per-row lock** that stops a concurrent cron/admin from double-writing) → build JE from
   `proposed_je` → `client.create("journalentry", body, requestid)` → `mark_posted`. **No
   `postNextApproved`** — the bulk path targets the **exact confirmed ids** (resolves "next-approved
   could post a different day/type").
3. **Partial-failure tolerant:** each id is independent; a failure marks it (retryable→`approved`,
   permanent→`failed`) via the existing poster path and **continues**. Returns `{ posted, failed,
   skipped }`; the snapshot re-renders (failures land in In progress (retryable) / Needs attention
   (permanent), never lost).
4. **Idempotent:** re-click only re-touches still-in-scope rows; already-`posted` are no-ops (logical-id
   + `requestid` dedup). Retryable failures (now `approved`) are re-driven; `rejected`/permanent-`failed`
   are excluded.
5. **Audit (no new table):** each posting already records `approved_by/approved_at/qbo_je_id/qbo_response`
   — the per-JE trail. The bulk action additionally emits one structured log (Sentry +
   `console.log(JSON.stringify(...))`) `{admin, shop, realm, date, scope, scope_hash, ids, posted,
   failed}` for "who confirmed these N JEs."

**New backend primitive (P4):** a **scoped** claim — `qteklink_claim_posting(... p_id)` variant (or a
`postApprovedPosting(shopId, postingId)` DAL) that claims a **specific** approved id via the same lease,
so the bulk loop posts exactly the confirmed rows. Small extension of the existing claim RPC.

---

## 7. Reuse (no reinvention)

`rollupDay` / `gateSaleDraft` / `gatePaymentDraft` (build+gate); `netByAccount` (Summary); the
**conditional-status RPCs + lease** `qteklink_enqueue/approve/claim/mark_posted/reject` (the locking +
idempotency); `listPostings` + `proposed_je` (persisted truth); `listOpenReviewItems` + the resolution
forms (Needs attention); `qbo_accounts` (names); `toShopLocalDate` + integer cents; Pattern S token
shape from keytag. The only **new** backend bit is the **id-scoped claim** (§6).

---

## 8. Build sequence (phased, TDD)

1. **P1 — read model.** `getDailySnapshot` + `getDayBreakdown` (the §3a precedence + §5 merge + the
   derived Fee row). Pure-testable (mock rollup + postings). Vitest first. *(no UI, no writes)*
2. **P2 — snapshot UI** (`/approvals`): KPIs + the 6-col table (incl. In progress + Needs attention) +
   date nav + "Open breakdown." Server Component. *(approve buttons inert until P4)*
3. **P3 — breakdown UI** (`/approvals/[date]/breakdown`): Summary / collapsible ROs / Payments, with the
   per-row source precedence + the `changedSincePosted` flag.
4. **P4 — approve-and-post** (the guarded mutation): the id-scoped claim primitive, `approveAndPostDay
   Action` (dry-run/token/execute, scoped, partial-failure, audit log), the confirm modal. Heaviest TDD
   (scope set, hash re-check, partial failure, the bulk-scope status filter, idempotent re-run) + a
   **Chris-gated single-JE live smoke**.
5. **P5 — `/postings` reject/retry surface** (kept per v2) + the `/approvals/review` day filter + nav
   cleanup.
6. **Verify + review battery** + Chris approves the live-post behavior before merge.

Each phase independently mergeable; **P4 is the only live-QBO-write phase.**

---

## 9. Testing

- **Unit (Vitest):** the **full §3a status→column matrix** (every status → its column; `posting`
  excluded from bulk; `rejected`/permanent-`failed` excluded; retryable `approved` included); persisted-
  wins-over-live; `changedSincePosted`; the derived Fee row buckets by parent status; needs-attention $
  from source gross; empty day. The dry-run **scope_hash** is identity+version+amount+status sensitive
  (two equal-total sets hash differently); execute rejects on a changed hash; partial failure leaves the
  right columns; idempotent re-run; admin-gate on **both** branches. Integer cents throughout.
- **Component (RTL):** collapsible RO rows; the confirm modal renders the per-type dry-run summary +
  the ▲QBO warning.
- **E2E (Playwright):** snapshot → confirm → (mocked QBO) post → Unapproved→Posted; a forced mid-flow
  source change → execute rejects on hash mismatch; **multi-tenant** (shop A can't see/scope shop B).
- **Live smoke (Chris-gated):** one real day, one JE, verify in QBO, delete (net-zero) — like C5/C8.

---

## 10. Risks / open questions (v2)

- **Resolved from v1's open list:** `/postings` **stays** (Q1 → requirement); "Approved" → **In
  progress** (Q2). Remaining: **customer name** on rows (snapshot has `customerId` only) — *RO# +
  customer-id label for v1, name later*.
- **Live bulk writes** — mitigated by Pattern S (bound token + per-item scope_hash), the id-scoped
  claim+lease (per-row lock), excluding in-flight/terminal statuses from scope, per-JE idempotency,
  partial-failure tolerance, and the Chris-gated live smoke.
- **Snapshot/QBO drift after a source edit** — surfaced (not silently): posted rows render their
  **persisted** JE + a `changedSincePosted` flag; the actual re-post is the deferred correction flow.
- **Perf at scale** — `rollupDay` on-demand is fine at Jeff's ~38 ROs/day; for large shops, materialize
  the snapshot in the nightly cron (task #21) + paginate the breakdown. *Noted, not built now.*
- **Observability** — the actions are `wrapQtekAction` (Sentry) wrapped; P4 adds the structured bulk-post
  audit log (§6.5) + a success/partial/fail result toast.

---

## 11. Multi-tenant + timezone invariants (safety, not rollout)

- **Every** read, draft build, posting selection, review-item lookup, account-name join, and the
  approve/post writes are scoped by **`shop_id` + `realm_id`** (server-derived; never client). Stated as
  an invariant because these are **live financial writes** — a missing predicate is a cross-tenant
  posting risk the moment a 2nd shop or test data exists.
- **`[date]`** is an **ISO shop-local `YYYY-MM-DD`**, validated server-side (regex + real-date check) and
  used only via `toShopLocalDate`/the shop tz — **never** `new Date(date)` (UTC-shift) — so midnight/DST
  boundaries can't move a transaction to the wrong day.

---

## 12. Cross-verify resolutions (Gemini + GPT, rounds 1+2)

| Theme (finding) | Resolved in |
|---|---|
| **Incomplete status→column mapping** (both, BLOCKER) | §3a exhaustive matrix + bulk-scope filter |
| **Posted rows must show persisted JE, not a live recompute** (GPT) | §3a precedence + §5.4 + §3.2 source rule |
| **Bulk post must target explicit ids, not `postNextApproved`** (GPT) | §6 execute step 2 + the id-scoped claim |
| **`scope_hash` / token contents underspecified** (both) | §6 dry-run step 2 + token binding |
| **TOCTOU / concurrent writes after hash check** (GPT) | §6: hash re-check + per-id claim/lease lock |
| **`/postings` disposition not optional** (both) | §0.5 + §4 + P5 — kept as reject/retry surface |
| **Payment-Fee bucket / needs-attention semantics** (both) | §3b / §5.5 |
| **Needs-attention $ has no source** (both) | §5.4 — source gross |
| **Breakdown can't read `proposed_je` for blocked rows** (both) | §3.2 source rule (live draft for not-yet-posted) |
| **`failed`/`approved-retryable` naming vs enum** (GPT) | §2 + §3a (retryable→`approved`, permanent→`failed`) |
| **Re-run vs partial-failure** (GPT) | §3a (retryable in scope) + §6.4 |
| **Admin auth on both branches / token security** (GPT) | §6 heading + token binding |
| **Account-join + everything shop/realm-scoped** (GPT) | §11 invariant |
| **`[date]` tz contract** (both) | §11 |
| **"Approved" misleading** (both) | §0.4 → In progress |
| **Persisted rows missing from live rollup** (GPT) | §5.3 (load *all* postings for the day) |
| **Confirm audit trail** (GPT) | §6.5 (per-posting columns + structured log; no new table) |
| **Observability / dry-run $X definition / stale breakdown / pagination** (both, NTH) | §10 + §6 per-type summary + §3.2 |

---

## 13. Review plan

Claude specialists (opus): **security** (the bulk live-write + Pattern S token + tenant scoping),
**pattern** (Fat-DAL/thin-action, reuse), **supabase** (the id-scoped claim RPC), **quickbooks** (post
path), **regression** (the `/approvals` + `/postings` reshape). `/code-review` (fail-closed) +
`/feature-cross-verify` at verify. **Human gates:** Chris approves the live-post behavior + the merge +
the live smoke.
```
