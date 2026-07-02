# QTekLink — resolution-workflow overhaul (self-serve fix-it, late-payment redate, failed-state exits)

**Feature:** `qteklink-resolution-workflow` · **Dates:** 2026-07-01/02 · **Branch:** `main` (standalone; absorbs + retires the `qteklink-fixes` worktree)
**Status:** plan → awaiting Chris approval to implement
**Mandate (Chris):** "Make sure the issues that need to be manually resolved have a quality workflow and can actually be resolved by the user… users can do everything in app and I don't need your help to fix the issues."

---

## 1. Incident + root cause (verified)

6/29 showed "2 unresolved issues" + a locked approve button after Chris resolved every fix-it item.
Verified live: the day **was posted successfully on 6/29**; the "2 issues" are two late Carmax checks
($83.57 + $673.53, dated 6/29, received 6/30) whose auto-correction failed **QBO 6540** (the payments
JE was already swept into a deposit — QBO locks the whole JE; proven empirically: a byte-identical
lines + add-only update AND a one-description-only update were both rejected).

Six confirmed defects (adversarial 4-agent verification, file:line evidence in the marker):
1. The approve-lock counts **posting-ledger** state; the fix-it list is a **separate queue** — resolving items can never unlock the day.
2. After resolving, the lock says "fix them on the fix-it list" → the list is **empty**. Unsatisfiable.
3. `failed` has **no exit**: the diff skips failed+unchanged-hash forever; no RPC/button/sweep can retry. The in-app help text prescribes an impossible action.
4. Review items never **auto-resolve** when the underlying condition clears.
5. The approve button renders on **already-posted** days.
6. Two more days (6/22, 6/26) are **invisibly** wedged by **$0 descriptions-only** corrections (our own deploys moving `source_state_hash`) — stuck failed rows the UI can't even see.

Audit of all 16 review kinds + 4 attention statuses: only `unmapped` is fully self-serve today; 9 kinds
unlabeled; a silent **under-posting** class exists (line-cap/unparseable/missed-webhook leave money out
of QBO while the day looks clean); `manual_payment_conflict` is an unfixable zombie.

## 2. Chris's decisions

- **Late payments → fix the date in Tekmetric.** No addendum JE, no deposit surgery. Email the office
  ("Void this payment: $X on RO #### — take it on a different day"), watch void + payment webhooks,
  **auto-resolve** when the payment is re-dated.
- **Retire the `qteklink-fixes` worktree**; build on main; absorb its approved posted-day design.
- Chris clears the stuck days **himself with the new UI** (acceptance test).

## 3. Design principles

- The **posting ledger is the single source of truth**; the lock, the banner count, and the fix-it list
  all derive from ONE day-scoped read model. Review items become a projection, never a second truth.
- Every terminal human decision is a **first-class ledger status** with a lock-step SECURITY DEFINER RPC
  (acknowledge precedent; store-credit lesson: widen EVERY constraining object in one migration).
- Book-touching resolutions are **Pattern S** (dry-run summary + bound hash → confirm → execute).
- **Prevent before resolve**: corrections QBO will reject or that change nothing financially are never staged.
- Items **auto-close only when the system can prove** the condition cleared.
- Every fix-it card carries **the real action for its kind** — a note-only Resolve that changes nothing is a dead end.

## 4. The build (7 parts)

### Part A — Late-payment redate flow (Chris's design; mirrors date-moves)

New table **`qteklink_payment_redates`** (mirrors `qteklink_ro_date_moves` conventions: shop_id+realm_id
scoping, deny-all RLS, SECURITY DEFINER RPCs, statuses `pending | approved | resolved`):
- **Detect** (in the live-on-view reconcile + nightly sweep, like `detectDateMoves`): payment P whose
  shop-local `payment_date` day D has a **live posted payments JE** that does **not** contain P →
  upsert a pending redate (dedup: one open row per payment) capturing amount, RO id, RO# (via
  `lookupRoMeta`), customer, original day.
- **Email once** on creation via `sendQteklinkEmail`, to the DATE CHANGE ALERT list (same recipients as
  RO date-moves — it is the same business event). Chris's wording, short:
  *Subject:* `QTekLink: void + re-date a payment` · *Body:* `Void this payment: $673.53 on RO 152706 — take it on a different day. (It came in for 6/29, which is already posted to QuickBooks.)`
- **Hold**: while a redate is `pending`, the day-draft builder **excludes P from day D's desired
  payments** (exact mirror of the date-move exclude at day-drafts.ts:108) → no correction stages, no
  6540, the posted day stays quiet.
- **Auto-resolve**: when P is **voided** (or its projected day no longer equals D), flip the redate to
  `resolved` — the hold lifts (moot), the fix-it card closes itself, the re-entered payment flows
  through its new day normally. This is exactly "watching for void webhooks and payment webhooks for
  that RO and payment" — the projection already ingests them; the reconcile applies them.
- **Escape hatch** (rare): an admin "Post it to this day anyway" action (`approved`, mirror of
  date-move approve) lifts the hold → the correction stages → nightly/manual post → if deposit-locked,
  the Part-B retry/accept flow takes over.

### Part B — Failed-state exits: Retry + Accept (Pattern S)

One migration (store-credit-style lock-step) adds status **`accepted`** + two RPCs:
- `qteklink_retry_daily_posting(...)`: `failed → approved` (the manual analog of the poster's
  retryable path). UI: **"I unlinked the deposit — retry now"** — dry-run shows the exact JE +
  amount, hash-bound; execute re-verifies, then `postDailyPostingById` (same requestid — the
  crash-safe resend contract, content verified unchanged). On success: auto-resolve the paired
  poster review items.
- `qteklink_accept_daily_variance(...)`: `failed → accepted` (terminal). UI: **"Keep QuickBooks
  as-is"** — dry-run states plainly what stays out of QBO; execute resolves the paired items.
- TS ripples (complete set, tested): `statusToColumn('accepted')` → posted-column with a
  "kept as-is" badge in the breakdown; `enqueueDailyPosting` treats `accepted` like
  failed/rejected (unchanged hash → skip; a later REAL change still stages v N+1);
  `computeScope` parity (failed/rejected/accepted + unchanged hash never enter the approve-day
  dry-run — fixes the "modal promises an update that execute skips" lie).
- Also unlocks: `reconnect_required`, `qbo_error`, `ar_entity_rejected` — every post-failure kind
  gets Retry/Accept instead of a dead Resolve.

### Part C — Cosmetic-delta suppression + stuck-correction obsoletion (self-healing)

- Extract `lineSignature`/`classifyChange` from posted-day-sweep.ts into a shared pure module
  (`src/lib/daily/je-delta.ts`).
- **Never stage a cosmetic correction**: in `enqueueDailyPosting` (and `computeScope`), when a live
  posted JE exists and the desired delta vs it is **descriptions-only** (same docNumber, same
  constituents, identical account|type|amount line sequence) → skip. Wording/cache deploys stop
  producing $0 corrections that trip 6540.
- **Obsolete moot stuck versions**: when the latest version is `failed`/`pending` but the desired
  state now matches the live posted JE (or differs only cosmetically) → system-close it
  (`rejected` by "system (superseded — desired matches posted)"), auto-resolving paired review
  items. This heals 6/22 + 6/26 **automatically on ship**, and heals 6/29 the moment Chris voids +
  re-dates the two checks — his exact acceptance test.

### Part D — ONE day-scoped attention model (the lock and the list agree)

New read model `listDayAttentionItems(shopId, date)` merging: gate-blocked drafts, failed/stuck
posting versions (with their real actions), open pending redates, and day-relevant review items —
deduped, each with typed actions. The approve-lock count, the banner, and `/approvals/review`
(day-scoped by default, "all days" toggle) all render THIS list. Blocking vs informational is
explicit per item (a pending redate on a posted day informs; it doesn't lock anything).

### Part E — Review-item convergence + labels + deep-links

- Reconcile auto-resolves gate-emitted kinds that stop being emitted for the day
  ("system (condition cleared)"); mapping kinds close when a matching **active mapping exists**.
  Poster kinds close only via Retry-success/Accept (Part B). Redates via Part A.
- `KIND_LABELS`/`KIND_HELP` for **all** kinds, in shop language; unmapped cards deep-link to
  `/mappings?focus=<source_key>` (MappingEditor preselects); manual-payment conflict gets a
  delete-manual-payment affordance (kills the zombie).
- The silent under-posting class (`daily_unbalanced`, `daily_line_cap`, `snapshot_unparseable`,
  `missed_ro_webhook`) becomes **visible day attention items** — a day can no longer look clean
  while money is missing from QBO.

### Part F — Posted-day approvals UX (absorb the worktree design)

Implement the approved `qteklink-approvals-fixes` spec from the retired worktree: "Approved &
posted to QuickBooks" panel replaces the approve button when posted (+ `!hasPosted` render gate),
remove the Accounting-Link card, keep the acknowledged banner; extend with the two new states —
failed exception inset ("with 1 exception — open the fix-it list") and accepted note.

### Part G — Tests (TDD; incident replays)

Vitest fixtures replaying the real incidents: (a) 6/29 — failed deposit-locked v2 with 2 added
payments → exactly 1 blocking attention item [retry, accept]; accept → unlock; retry → posted;
void-path → Part C obsoletes + auto-resolves (Chris's flow end-to-end); (b) 6/26 — descriptions-only
delta → nothing stages; stuck v2 obsoleted; (c) accepted + later real change → v N+1 stages;
(d) redate detect/email-once/hold/auto-resolve/approve-escape; (e) statusToColumn + enqueue matrix
for `accepted`; (f) pgTAP for the migration (status CHECK, RPCs, redate table RLS/grants).

## 5. Explicitly out of scope

- **Addendum JEs** (rejected — Chris chose Tekmetric-side redating).
- Backfill/repair for `missed_ro_webhook` / `posted_je_missing` (surfaced + labeled now; repair
  affordances are a follow-up).
- The old pending inventory (4/14, 6/12) — surfaced to Chris; his call (approve vs acknowledge), no code.

## 6. Rollout

1. Migration (`accepted` + redate table + RPCs) → `supabase db push` (Chris approves).
2. Code: Parts C+D+E land together (the self-healing + single source of truth), then A, B, F.
3. Verify: typecheck / vitest / build / lint / `/code-review` + the 4 design-diff reviewers (UI touched).
4. Deploy → **6/22 + 6/26 self-heal on the first nightly/view**; Chris runs the 6/29 void+re-date
   acceptance test; then exercises Retry/Accept on any future deposit-locked correction.

## 7. Key risks

- The approve-lock changes data source (D) — a bug could unlock a dirty day → incident-replay tests
  are the gate; fail-closed defaults preserved (unknown states still lock).
- Cosmetic test must stay strictly conservative (any amount/account/order change ≠ cosmetic).
- Obsoletion must never close a version whose delta is REAL money (guarded by the same conservative test).
- Redate holds change day-draft membership — the hold applies **only** while a pending redate exists
  for a payment already absent from the posted JE (can't mutate posted content).
