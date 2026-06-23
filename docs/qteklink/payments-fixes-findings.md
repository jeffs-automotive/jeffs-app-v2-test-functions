# QTekLink payments-fixes — live-data findings (2026-06-23)

> Investigation run from the setup session against the LIVE test DB (`itzdasxobllfiuolmbxu`, shop 7476)
> via read-only SQL. Hard numbers below — verify they still hold before implementing (data grows daily).
> Companion to `payments-fixes-research-brief.md`. **Reads/SQL only; no code written.**

---

## Task 1 — CHK payments showing "—" instead of the RO# : ROOT CAUSE CONFIRMED

### What the data says

Payment-type distribution (`qteklink_payment_state`, all time):

| type | payments | ro_id NULL | voided | refunds |
|---|---|---|---|---|
| CC | 774 | 0 | 0 | 8 |
| **CHK** | **134** | **1** | 2 | 0 |
| CASH | 28 | 0 | 0 | 0 |
| OTH | 24 | 0 | 3 | 0 |
| STORE_CREDIT | 2 | 0 | 1 | 0 |
| AFFIRM | 1 | 0 | 0 | 0 |

- CHK almost always HAS `repair_order_id` (only 1/134 null) → **not** a missing-RO-id problem (hypothesis
  N1 ruled out). It's the RO **number** failing to resolve (N2).
- Of **130 distinct CHK RO ids**: only **45** have a `repairOrderNumber` on a `qteklink_events` `ro_*`
  sale-scan event, **49** via the keytag firehose (shopId-matched) → **81 (62%) are UNRESOLVABLE by
  `lookupRoMeta`.** Those show "—" whenever the check isn't same-day as the sale (fleet checks never are).
- The CHK payment-kind events carry **no** `repairOrderNumber` in their body (`would_resolve_if_payment_kinds_scanned = 0`) — so it is NOT a kind-filter miss in `lookupRoMeta`.

### The 81 unresolved are FLEET / A/R-ACCOUNT check payments

All 81 are in the keytag firehose ONLY as **"Payment made by &lt;account&gt;"** events, with
`repairOrderNumber` at **no** JSON path (0 rows mention it anywhere):

| event_text | distinct ROs |
|---|---|
| Payment made by Carmax (+ "carmax") | 72 |
| Payment made by Kleen Tech | 2 |
| Payment made by Flexicon | 2 |
| ACH / Nazareth Key / Deiter Brothers / Jim Kemmerer / John & Joanne DeCray (EMP) | 1 each |

**Mechanism:** commercial fleet accounts (Carmax dominates) pay their A/R balances by check days–weeks
after the RO closes. Tekmetric emits a *"Payment made by X"* webhook carrying `tekmetric_ro_id` +
`payment_id` but **no RO object** (no `repairOrderNumber`). The original sale predates our event capture
(keytag firehose since 2026-05-09; qteklink webhooks since 2026-06-11), so there's no `ro_*` sale-scan
event either. → The number is genuinely **not in our data**. Same-day sales miss (paid a different day),
both event fallbacks miss → "—".

### Recommended fix (validate in the plan)

The number's only source is Tekmetric. **Add an RO# cache, mirroring the shipped customer-name cache**
(2026-06-16: `qteklink_customers` + `qteklink_upsert_customers` RPC, warmed by the nightly cron, read
cache-only on the deterministic view/build path):

- New `qteklink_ros` cache: `(shop_id, realm_id, tekmetric_ro_id) → repair_order_number` (+ updated_at);
  service_role SELECT, upsert via a `qteklink_upsert_ros` RPC.
- Warm it in `runNightlySync` (`src/lib/dal/nightly-sync.ts`) via `getRepairOrderById`
  (`supabase/functions/_shared/tools/repair-orders.ts` → Tekmetric `GET /repair-orders/{id}` →
  `repairOrderNumber`), OFF the view/post path (determinism — the QBO `requestid` hashes the day's
  source state; never fetch inline on view/post).
- Consult it as the FINAL fallback in `lookupRoMeta` (`src/lib/dal/ro-lookup.ts`), cache-only.
- **Warm target matters:** the failing ROs are OLD (fleet A/R), so a "recent days" warm window won't catch
  them — warm the set of `repair_order_id`s that appear in payments but have no resolved number
  (one-time backfill of the existing 81 + steady-state). Decide the exact trigger/window in the plan.
- Scope note: this also fixes the same "—" for any CASH/OTH payment on an old A/R RO, not just CHK — the
  fix is payment-type-agnostic (resolution is keyed on RO id). Good (broader correctness), but call it out.

---

## Task 2 — Store credits → QuickBooks : full lifecycle CONFIRMED from webhooks

### How Tekmetric represents it (verified — Flexicon, customer 44691760)

| # | when | payment_id | paymentType | amount | repairOrderId | meaning |
|---|---|---|---|---|---|---|
| 1 | 6/22 17:59 | 60746251 | **CHK** (check "Santander 410791") | $281.15 | **null** | **ISSUANCE** — unattached real check → becomes store credit |
| 2 | 6/22 18:01 | 60746349 | **STORE_CREDIT** (id 9) | $147.15 | 326180629 | **REDEMPTION** — credit applied to an RO |
| 3 | 6/23 16:22 | 60746349 | (voided) | $147.15 | 326180629 | redemption voided |
| 4 | 6/23 16:24 | 60822951 | **STORE_CREDIT** | $147.15 | 326180629 | re-redeemed |

- **Issuance signal** = a **real-tender payment (CHK/…) with `repairOrderId: null`** (event also has
  `arPayment:false`, `customerId:null`). There is **NO explicit "store credit issued" webhook** — issuance
  is implicit in an unattached payment. Across the WHOLE dataset exactly **one** payment has a null
  `repair_order_id` (this issuance check), so detection is clean today — but the semantic ("null-RO real
  tender = store-credit issuance") must be CONFIRMED (Tekmetric store-credit docs + Chris), not assumed for
  every future null-RO payment.
- **Redemption signal** = `paymentType.code = STORE_CREDIT` (id 9), attached to a real RO.
- $147.15 of the $281.15 was spent → ~$134.00 store credit remains for Flexicon.

### The bug TODAY

- **Redemption** (`STORE_CREDIT`): in neither `PAYMENT_TYPE_LABELS` nor `NONCASH_METHODS`, so
  `buildPaymentJournalEntry` (`src/lib/payments/payment-je-builder.ts`) routes it down the **DEPOSIT** path
  → `Dr Undeposited / Cr A/R`. The Undeposited debit is wrong (no cash moved) → **Undeposited overstated**.
- **Issuance** (CHK, `repairOrderId: null`): the builder treats a null-RO payment as malformed
  ("can't be enqueued as a posting"), so the real $281.15 cash receipt is dropped / queued and the
  liability is never recorded.

### Correct accounting (credit the liability on issue, debit on redeem)

**Account decision (Chris, 2026-06-23):** a NEW QBO **Other Current Liability** account named
**"Customer Store Credit"** (the textbook home — the residual balance correctly reports as money owed to
customers; NOT the income-statement Over/Short clearing account). Validate exact name/number + the QBO JE
shape with the **quickbooks-compliance** agent before building.

**Issuance** (real check, no RO — money in, liability created):
```
Dr  Undeposited Funds          $281.15      (real check → deposits to bank)
  Cr  Customer Store Credit [OCL]   $281.15  (we now owe the customer)
```

**Redemption** (STORE_CREDIT applied to RO — no cash, relieve receivable):
```
Dr  Customer Store Credit [OCL] $147.15      (draw down what we owe)
  Cr  Accounts Receivable           $147.15  (relieve the RO's receivable)
```
(The RO's SALE posts A/R normally; the redemption relieves that A/R. No Undeposited movement on redeem.)

**Net across the example:** Undeposited +$281.15 (real deposit); A/R −$147.15 (RO relieved); Customer Store
Credit −$281.15 + $147.15 = **−$134.00** (residual liability Flexicon still holds). Balances.

### What the implementation will need (validate in the plan)

1. **Redemption routing:** add `PAYMENT_TYPE_LABELS["STORE_CREDIT"]="Store Credit"`; route STORE_CREDIT to a
   non-cash-style path `Dr <Over/Short> / Cr A/R` (today only `other`/`oth` route non-cash). Needs a
   `STORE_CREDIT → Over/Short` mapping. Confirm the role/account-type gate (`qteklink_role_accepts_type`)
   accepts the chosen account type; may need a new posting role/kind beyond `noncash_contra`.
2. **Issuance handling (NEW flow):** recognize a real-tender payment with `repairOrderId: null` as a
   store-credit issuance → `Dr Undeposited / Cr Over/Short`. The builder currently can't post a no-RO
   payment — genuinely new logic that must distinguish issuance from a truly malformed payment.
3. **Void/re-make** (6/22→6/23) already handled by the reducer (voided → suppressed) + the day-grain
   correction; re-verify once routing changes.
4. **Determinism:** new mapping/account reads stay on the deterministic build path (already true — the
   `requestid` hashes source state + mappings).

---

## Net

- **Task 1** is a well-understood data-availability gap with a proven-pattern fix (RO# cache, like the
  customer-name cache). No ambiguity in the diagnosis; the design choice is the warm trigger/window.
- **Task 2** has a confirmed representation + a confirmed live mis-posting, but the accounting model
  (esp. issuance + the target liability account) needs Chris's input + Intuit-doc verification before a plan.

> These findings live on the `qteklink-payments-fixes` branch (worktree). Implementation (code in
> `qteklink-app/src/**`, `supabase/functions/**`, migrations) must happen in a session whose working dir
> IS the worktree — the phase guard in the main checkout is currently held by the keytag session
> (`keytag-live-board`, verify phase).
