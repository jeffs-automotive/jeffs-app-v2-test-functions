# QTekLink payments-fixes — research brief

> Kickoff brief written 2026-06-23 by the setup session (main repo) for the **qteklink-payments-fixes**
> worktree. This is a STARTING POINT, not a plan — verify every claim against current code + real data
> before acting (`never-guess.md`, `feedback_audit_before_changes.md`: Investigate → Plan → Fix → Verify).
> Branch off `main` @ `3d953da`. Two independent workstreams below; **Task 1 is a bug, Task 2 is a feature.**

## Workflow

1. `/feature-start qteklink-payments-fixes` (creates this worktree's own `.feature/` marker).
2. `cd qteklink-app && npm install` before any typecheck/test/build (fresh worktree has no `node_modules`).
3. Research against REAL data first (Supabase MCP `execute_sql`, read-only — project ref `itzdasxobllfiuolmbxu`).
4. `/feature-plan` → `/feature-cross-verify` → `/feature-implement` → `/feature-verify` → `/feature-done`.
   - Suggestion: ship Task 1 (CHK RO#) first as the smaller fix; Task 2 (store credits) is a larger design.

---

## Task 1 — CHK (check) payments not showing the RO# on the Payments tab

**Where it renders:** the breakdown Payments tab row's `roNumber` (shows `—` when null).

### The RO# resolution chain (verified 2026-06-23)

For each payment row, `roNumber` resolves like this:

1. `je.repairOrderId` is the payment's RO id — comes from the C4 reducer
   (`src/lib/payments/reducer.ts:196`, from `data.repairOrderId` on the payment event). **Null if no
   event carried a repairOrderId.**
2. `getDayBreakdown` builds `roNumberByRoId` (`src/lib/dal/daily-breakdown.ts:240-252`):
   - **Source A:** the day's own sale snapshots (`sales` → `snapshot.repairOrderNumber`). Covers
     **same-day** ROs only.
   - **Source B (fallback):** `lookupRoMeta(shopId, realmId, missingRoIds)` for RO ids NOT in same-day
     sales — `src/lib/dal/ro-lookup.ts`. Two sub-sources, newest-first:
     - B1: `qteklink_events` where `event_kind IN RO_SALE_SCAN_EVENT_KINDS` (webhooks live **since
       2026-06-11**).
     - B2: `keytag_webhook_events` firehose (capturing since **2026-05-09**), **REQUIRES** body
       `data.shopId === shopId` (`ro-lookup.ts:38`) — rows without a matching body shopId are skipped.
3. Row value: `roNumber = ro != null ? (roNumberByRoId.get(ro) ?? null) : null`
   (`daily-breakdown.ts:283`).

So a row shows `—` when **either**:
- **(N1)** `je.repairOrderId` is null (the check event carried no `repairOrderId`), OR
- **(N2)** the RO id is present but unresolvable: not a same-day sale (Source A miss) AND not found in
  `qteklink_events` sale-scan kinds (B1 miss) AND not in the keytag firehose with a matching body shopId
  (B2 miss).

### Leading hypothesis (N2) — checks disproportionately pay PRIOR-DAY / old A/R ROs

Cards pay at the counter same-day (Source A hits). **Checks lag** — a customer mails a check, or a fleet
A/R account is paid by check days/weeks after the RO closed. So check payments land on a day whose
snapshot does NOT contain that RO, forcing the B1/B2 fallbacks. For ROs sold **before 2026-06-11**
(qteklink webhooks weren't live) AND not present in the keytag firehose with a body shopId match, BOTH
fallbacks miss → `—`. This predicts: the unresolved `—` rows are mostly CHK and skew to OLDER ro ids.

### First investigation steps (do these before designing a fix)

- Pull real unresolved rows. Confirm whether the failing CHK payments have `repairOrderId IS NULL` (→ N1)
  or a non-null RO id that just won't resolve (→ N2). Read the C4 projection table for the affected day(s)
  and join against the sources. Suggested read-only SQL via Supabase MCP (adjust table/column names after
  confirming against `list_tables`):
  - `qteklink_payment_state` rows for the affected shop/realm/day → inspect `repairOrderId`, `paymentType`.
  - For each non-null RO id, check `qteklink_events` (sale-scan kinds) and `keytag_webhook_events`
    (`raw_body->data->>shopId`) for a `repairOrderNumber`.
- Confirm Tekmetric ALWAYS sets `repairOrderId` on a check payment event (rules out / confirms N1). The
  webhook map: `.claude/work/planning/references/TEKMETRIC_WEBHOOKS_MAP.md`; API:
  `TEKMETRIC_API_DOCS.md` (same dir).

### Candidate fix direction (validate first — don't assume)

If N2 confirmed: add a resolution source that **always** works — fetch/cache the RO's `repairOrderNumber`
by RO id, mirroring the **existing customer-name cache** shipped 2026-06-16:
- Pattern to copy: `qteklink_customers` cache + `qteklink_upsert_customers` RPC, warmed OFF the view/post
  path by the nightly cron (`warmCustomerNamesForRecentDays` in `src/lib/dal/nightly-sync.ts`), read
  CACHE-ONLY on the deterministic view/build path (`getCachedCustomerNames`). See
  `docs/qteklink/je-line-descriptions-2026-06-16-plan.md` and the
  [[qteklink-live-state]] memory bullet for 2026-06-16.
- A parallel `qteklink_ros` (ro_id → repairOrderNumber) cache, warmed by the nightly cron via Tekmetric
  `GET /repair-orders/{id}` (helper already exists: `getRepairOrderById` in
  `supabase/functions/_shared/tools/repair-orders.ts`), then consulted as a final fallback in
  `lookupRoMeta`, would close the gap deterministically without hitting Tekmetric on the view path.
- If N1 confirmed instead: the fix is upstream (why is `repairOrderId` missing on the event) — different fix.

### Determinism guardrail (important)

The view/post path is LIVE-ON-VIEW and the QBO `requestid` hashes the day's `source_state_hash`. Any new
RO#-resolution input read on the BUILD path must be deterministic (cache-only), exactly like the
customer-name cache — do the Tekmetric fetch in the nightly cron, never inline on view/post, or you'll
churn the requestid and the JE line descriptions. (RO# on the Payments TAB display is lower-risk than the
JE line text, but keep the build path deterministic.)

---

## Task 2 — Store credits → QuickBooks (design)

**Goal:** decide how a store credit is represented in the daily QBO JE.

### What we know about the current JE engine

- Payment JE builder: `src/lib/payments/payment-je-builder.ts`. Routes by `method`:
  - **DEPOSIT route** (CC/CASH/CHK/DEBIT/financing-that-deposits): `Dr Undeposited [366] / Cr A/R [235]`,
    plus a card-fee leg. This is for money that lands in the bank.
  - **NON-CASH route** (method `Other`/`OTH` → `otherPaymentType` sub-type): `Dr <mapped noncash_contra>
    / Cr A/R [235]` — no Undeposited, no fee.
- Payment-type labels: `src/lib/payments/payment-type-label.ts` — known codes CC/CASH/CHK/DEBIT/
  AFFIRM/KLARNA. **No "store credit" code today.**
- Mapping roles: `src/lib/mappings/catalog.ts` — `noncash_payment_type` kind always derives role
  `noncash_contra` (`catalog.ts:69-70`). Mapping is set via the `qteklink_set_mapping` RPC.

### The crux question (resolve BEFORE designing)

**How does Tekmetric represent a store credit?** Two possibilities, very different consequences:

1. **A top-level `paymentType.code`** (e.g. `STORE_CREDIT` / its own code). If so, it currently falls
   through to the **DEPOSIT route** (`Dr Undeposited / Cr A/R`) — which is **WRONG**: a store credit is
   not cash hitting the bank. This would be a latent mis-posting to fix.
2. **An `Other`/`OTH` sub-type** (`otherPaymentType.name = "Store Credit"` or similar). If so, it already
   routes NON-CASH and just needs a `noncash_payment_type → <account>` mapping — but the target account is
   NOT a contra in the usual sense (see accounting below).

**Find out empirically:** query real `qteklink_events` payment payloads for store-credit transactions
(`raw_body->data->paymentType` and `->otherPaymentType`) via Supabase MCP, and cross-check against
`TEKMETRIC_API_DOCS.md` / `TEKMETRIC_WEBHOOKS_MAP.md`. Do NOT guess the code/shape.

### Accounting treatment (confirm with Chris + the QBO skill / quickbooks-compliance agent)

A store credit is a **liability** the shop owes the customer, not income or cash:

- **Redemption** (customer pays an RO using existing store credit): no cash in. Reduce the store-credit
  liability, reduce A/R → `Dr <Store Credit Liability> / Cr A/R`. This MATCHES the non-cash route's
  Dr/Cr shape exactly — so IF store credit arrives as a payment event, mapping a `noncash_payment_type`
  "Store Credit" to a **Store Credit Liability** account (Other Current Liability) would post correctly.
  (Caveat: `noncash_contra` semantics — confirm the role/account-type gate `qteklink_role_accepts_type`
  accepts a liability account for `noncash_contra`; may need a new role.)
- **Issuance** (customer is GIVEN store credit — overpayment, or credit instead of a cash refund):
  increases the liability → the reverse direction. **Does Tekmetric even emit an event for issuance?**
  Often store credit is issued as a negative/credit transaction or outside the payment stream entirely.
  This is the open question that decides whether Task 2 is "add one mapping" or "model a new flow."

### Questions for Chris (ask in the new session before planning)

1. At Jeff's, is store credit ever **issued** through Tekmetric, or only **redeemed** as payment? (Decides
   scope.)
2. Which QBO account should store credit book to (existing Other Current Liability, or create one)? Get
   the exact account name/number for the mapping.
3. Should redeemed store credit appear as its own line/type on the Payments tab summary (it will, via the
   `method` display) — any naming preference?

### Reference files (Task 2)

- `src/lib/payments/payment-je-builder.ts` (routes), `payment-type-label.ts` (labels),
  `src/lib/mappings/catalog.ts` + `src/lib/dal/mappings.ts` (mapping kinds/roles + RPC),
  `src/lib/dal/payment-je.ts` (DAL that resolves mappings + calls the builder).
- QBO skill (`/quickbooks`) + the **quickbooks-compliance** review agent for Intuit-correct JE shape.
- `.claude/work/planning/references/TEKMETRIC_API_DOCS.md`, `TEKMETRIC_WEBHOOKS_MAP.md`.
- QBO research/plans: `docs/qbo/` (if present), `docs/qteklink/qteklink-plan.md`,
  `daily-je-rework-plan.md`.

---

## Key files index (both tasks)

| File | Role |
|---|---|
| `src/lib/dal/daily-breakdown.ts` | Builds the breakdown Payments tab + RO# resolution (Task 1) |
| `src/lib/dal/ro-lookup.ts` | `lookupRoMeta` — qteklink_events → keytag firehose fallback (Task 1) |
| `src/lib/payments/reducer.ts` | C4 reducer — where `repairOrderId` / `paymentType` come from |
| `src/lib/payments/payment-je-builder.ts` | C6 JE builder — deposit vs non-cash routing (Task 2) |
| `src/lib/payments/payment-type-label.ts` | Friendly method labels (CHK, etc.) |
| `src/lib/mappings/catalog.ts` | Mapping kinds + posting roles (Task 2) |
| `src/lib/dal/nightly-sync.ts` | Nightly cron — where a deterministic RO#/credit warm would live |
| `supabase/functions/_shared/tools/repair-orders.ts` | `getRepairOrderById` Tekmetric helper |

> Note: that last file has an in-flight `customer_name` edit in the MAIN checkout (the keytag session) —
> it is NOT in this worktree's branch (we branched off committed `main`). Don't be surprised by the diff
> if you compare against the other working tree.
