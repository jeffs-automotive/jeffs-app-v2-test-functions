# QTekLink — Build Plan

> Feature: `qteklink` · Phase: **plan** · **v6 (2026-06-04 — build-ready; tax design finalized)**
> An in-house **Tekmetric → QuickBooks Online** financial sync — a *comparable app* to the commercial
> "Accounting Link by Back Office" (**not** that product). Separate Next.js app at
> `qteklink.jeffsautomotive.com` (Entra + email allowlist). Runs hands-off with a deterministic
> reconciliation gate + human approval; **fails closed**. Foundation: the shipped **`qbo-api-client`**.
> **Posting mechanism = QBO `JournalEntry`** (matches AL; confirmed against Jeff's live books + Intuit
> docs + a `quickbooks-compliance` PASS, 2026-06-04). Research: `research-findings.md` + §1.

---

## 0. Goal, scope & app shape

One-way **Tekmetric → QBO** sync (nothing flows back). Fixes the commercial product's three gaps:
1. **Every fee maps to the account we choose** (AL lumps most into Shop Supplies).
2. **Auto-correct + alert on post-hoc RO changes.** *(Trigger: Tekmetric **unpost → repost** with a changed total/date. Our QBO correction is a **reversing/adjusting entry** — §7 — never a destructive edit of a closed-period JE.)*
3. **Non-cash "payments" book to the right expense/contra account** — no Undeposited-Funds ghost deposits.

**App shape:** own **Next.js 15 app `qteklink-app/`** (sibling to `scheduler-app/`, `admin-app/`), own **Vercel project**, `qteklink.jeffsautomotive.com`. Auth = **Microsoft Entra** (Supabase Azure provider) **gated to an in-app email allowlist** (not the whole domain). Shares the repo's `supabase/` + `.claude/`. The `qbo-api-client` library **moves into `qteklink-app`**.

**Scope LOCKED (Chris):**
- **IN:** RO **revenue** (parts/labor/sublet/fees, net of discount), **A/R**, **cash/payments** (Undeposited), **credit-card processing fees**, **non-cash** routing, **change/refund/void** handling.
- **OUT:** COGS / parts cost / sublet cost / A/P / vendor bills / POs / inventory. **Only expense posted = credit-card fees.**
- **Sublet *sales* → income** (Sales – Sublet), never A/P.
- **A/R *not* tracked by customer** → plain JE lines, RO#/name in the description; **bulk receivable** (Chris confirmed). API-permitted at minorversion 75 (live-verified; AL does it) — kept as a **build-time live-API check + fail-closed guard** (§13/§17), since the QBO *UI* mandates a name and it's minorversion-sensitive.

---

## 1. What we learned (empirical — 2026-06-03/04, live QBO realm 9341455608740708 + webhook firehose)

The commercial AL posts **3 summarized daily JEs** (`JA-RO`/`JA-PAY`/`JA-FEE`), **dated independently**. We post **per-RO** but keep the **same date separation** (§5).

- **Reconciliation identity (verified):** `partsSales + laborSales + feeTotal − discountTotal + taxes = totalSales`; categories **gross**, `discountTotal` one lump. **All money integer cents.**
- **Discounts** blanket RO-level (no category signal) → **labor → parts → sublet → fee waterfall** (50 days confirmed). Post income **NET**; **no discount account/line** (Chris). Pass-through/mandated fees are **excluded** from the waterfall (§6).
- **Paid RO** shows only `amountPaid` → correlate the payment stream by **`repairOrderId`**.
- **Payments** (`payment_made`, integer cents, by `repairOrderId`, `data.id` = payment id): `paymentType`, `arPayment`, `paymentDate`, **`applicationFee`** = Tekmerchant processing fee (cents; on every card payment — our CC-fee source). **Refund** = separate event, own `data.id`, **negative** amount, `applicationFee:null`. **Void** = the **same `data.id`** flipped `voided:true`. **Non-cash** = `paymentType.code="OTH"` + `otherPaymentType.name`.
- **Posting mechanism = `JournalEntry`, confirmed (the pivotal validation):** Jeff's live **Deposit** records link directly to AL's JEs (`LinkedTxn: JournalEntry`, e.g. $14,050.42 + $5,754.75 to PNC Checking) → **JE-to-Undeposited DOES flow into the Make Deposits / bank-rec workflow**; the bookkeeper's routine is unchanged. Tax is **self-calculated** → JE → Sales Tax Payable is fine (no native Sales-Tax-Center dependency). Both confirmed by Intuit docs + `quickbooks-compliance`.
- **Transport:** shared-secret `?token=` — **Tekmetric cannot HMAC**; **no idempotency key**; **out-of-order**; repeats; refunds/voids land `unknown`.
- **All target QBO accounts already exist** (§4); ids realm-specific, resolved via `qbo_accounts`.

---

## 2. Architecture

Two Tekmetric streams (sale + payment), correlated by `repairOrderId`. **Sale and payment post as SEPARATE, independently-dated JE entries.** Pipeline: durable intake → reduce → build → reconcile → (gate) → post.

```
Tekmetric ──> [qteklink-webhook]  ── store raw, THEN 200 (duplicate/replay = 200, not a failure;
 (ro_posted +     5xx ONLY if it can't store) ──>  qteklink_events (raw, append-only)   │ reduce
  payment/refund/void)                                                                   ▼
                                qteklink_payment_state (current DESIRED state, per (shop,realm,payment_id))
                                                   │  nightly cron (qteklink-sync), settle window,
                                                   │  pinned source-state version/hash
                                                   ▼
   [build]  per-RO SALE draft + per-PAYMENT drafts (payment-dated); each diffed vs already-posted
            (qteklink_postings) → new / reversing-correction / skip. Payment drafts HELD until the
            RO's sale draft is reconciled/posted (no payment against missing A/R).
                                                   ▼
   [reconcile] deterministic checks ──fail/unknown──> resolution queue + ERROR email
                                                   │ pass
                                                   ▼
   [gate] BOTH human-approve AND auto_post re-validate source_state_hash at post time; stale → rebuild
          (human-gated rebuild returns to `pending` for re-approval; never post what wasn't reviewed)
                                                   ▼
                              [post] qteklink-post (locked, idempotent) ─> QBO + APPROVAL email
```

- **`qteklink-app/`** (Entra + allowlist): COA refresh, mapping config, approval queue, resolution queue, audit trail, reconciliation dashboard, alert-recipient + allowed-user settings.
- **Edge (Deno, `Sentry.withScope`):** `qteklink-webhook`, `qteklink-sync` (cron), `qteklink-post`, `qteklink-email`.
- **Intake (LOCKED):** dedicated `qteklink-webhook` going forward. **No risky historical backfill** — AL already posted all history into QBO; QTekLink **starts at a clean cutover date** (§9).

---

## 3. Data model

Every table: `shop_id NOT NULL` **+ `realm_id NOT NULL`, both in every uniqueness key + account FK** (QBO ids are realm-specific). Money `BIGINT` cents; TS `TIMESTAMPTZ`; PK `UUID`.

**Immutability:** `qteklink_events` + `qteklink_postings` (+ approvals + QBO responses) are **append-only audit ledgers**. `qteklink_payment_state` + `qteklink_ro_state` are **mutable reducer/projection** tables.

| Table | Purpose / keys |
|---|---|
| `qteklink_events` | Append-only raw. **Unique `(shop_id, realm_id, event_hash)`.** Hash = stable business identity (event kind + source id + event time), not the whole body. Durable **before** the 200; a unique conflict = already-have-it → **200**. Cols incl. `tekmetric_event_at`, `received_at`, `payment_id`, `tekmetric_ro_id`. |
| `qteklink_payment_state` | Current desired state. **Unique `(shop_id, realm_id, payment_id)`.** `signed_amount_cents`, `signed_processing_fee_cents`, `status`(succeeded/voided), `is_refund`, `payment_type`, `other_payment_type`, `payment_date`, `voided_at`, `repair_order_id`, `latest_event_at`, `reduced_from_event_ids`. **Reducer:** order by `tekmetric_event_at`, **tie-break `received_at` then event id**; `voided` terminal (late `succeeded` can't un-void) but immutable facts hydrated even if void arrives first; fallback when `tekmetric_event_at` bad. |
| `qbo_accounts` | COA mirror. **Unique `(shop_id, realm_id, qbo_account_id)`.** `name`,`account_type`,`account_sub_type`,`active`,`synced_at`. Manual refresh; post-time validation (§8h). |
| `qteklink_mappings` | Editable. `kind`,`source_key`(canonical),`source_id`,`qbo_account_id`,`posting_role`,`active`,`effective_from`. **Unique `(shop_id, realm_id, kind, coalesce(source_id,source_key))`; one active per source.** `posting_role` validated vs account type. **Resolved account is snapshotted into the posting** (later edits never retro-generate corrections). |
| `qteklink_allowed_users` | App access allowlist. `shop_id`, **`entra_object_id`** (immutable), `email`(CITEXT), `role` (`viewer`/`approver`/`admin`), `active`. Auth binds to object id; email is display/secondary. |
| `qteklink_ro_state` | Per-RO projection. **Unique `(shop_id, realm_id, tekmetric_ro_id)`.** `ro_number`,`last_total_cents`,`last_posted_date`,`source_snapshot_hash`,`sale_qbo_je_id`,`sale_qbo_sync_token`,`status`. (SALE JE only.) |
| `qteklink_postings` | Append-only "what we posted." `batch_date`,`tekmetric_ro_id`,`payment_id`(null for sale),`kind`(sale/payment/fee/correction),`txn_date`,`posting_version`,`proposed_je jsonb`(persisted discount allocation + snapshotted accounts + a deterministic **private-note idempotency marker**),`source_state_hash`,`recon_status`,`status`,`approved_by`,`approved_at`,**`requestid` unique `(shop_id, realm_id, requestid)`**,`lease_until`,`qbo_je_id`,`qbo_response jsonb`. **Unique `(shop_id, realm_id, tekmetric_ro_id, kind, payment_id, posting_version)`.** |
| `qteklink_review_items` | Fail-closed resolution queue. `kind`(unmapped_fee/new_payment_type/recon_mismatch/qbo_error/orphan_payment/ar_entity_rejected),`context`,`proposed_options`,`status`,`resolution`. |
| `qteklink_alert_recipients` | `shop_id`,`realm_id`,`alert_type`,`email`,`active`. Edited only by an `admin`-role user; changes audited. |
| `qteklink_settings` | `shop_id`,`realm_id`,`auto_post bool`(default **false**),`settle_window_minutes`,`shop_timezone`. |

**Posting lifecycle (state machine):** `pending → approved → posting → posted` (human gate), or `pending → posting → posted` (auto_post). Branches: recon fail → `needs_resolution`; rejected → `rejected`; stale at post → rebuild new `pending`; QBO retryable → back to `approved/pending`; permanent QBO error → `failed` + alert. `posting` carries a **lease** (`lease_until`) + a recovery job re-queues expired leases (crash safety).

**Desired-vs-posted = corrections.** Builder diffs `qteklink_payment_state` + RO snapshot (desired) vs `qteklink_postings` (posted): new → post; changed → **reversing/adjusting** posting; unchanged → skip.

**RLS + tenant scoping:** service-role-only for raw/PII tables; allowlisted-admin read on config/queue via `(select get_employee_shop_id())`. **Server-side jobs use service-role → so every DAL query MUST scope `shop_id`+`realm_id`** (RLS alone doesn't protect service-role paths); pgTAP proves cross-shop + cross-realm isolation. Raw bodies PII-scrubbed before any Sentry/log/email.

---

## 4. The mapping (LOCKED)

**Income (Cr, NET of discount):** Labor → Sales–Labor `[275]`; Parts default/Tire/Battery → `[272]`/`[270]`/`[271]`; Sublet → Sales–Sublet `[276]`; Fee: Shop supplies + Equipment Maintenance → Sales–Shop Supplies `[273]`; Fee: Hazmat/Oil + Tire disposal + 5 PACK DISPOSAL → Sales–Hazmat `[277]`; **Fee: State Communication Fee → Sales – Sublet `[276]`** (a third-party emissions-communications charge — routed to **sublet income**, *not* COGS, *not* tax — Chris); Fee: TIRE PROTECTION PLAN → Tire Protection Plan Sale `[1150040009]`.

**Tax (Cr) — split Tekmetric's authoritative lump `taxes`:** **Tire Tax → PTAL Payable `[252]`** = `tire_qty × $1.00` (PA per-tire fee; `tire_qty` = Σ *authorized* part-line quantities where `partType.code='TIRE'`). **Sales tax → Sales Tax Payable `[250]`** = `taxes − tire_fee` (the remainder of the lump). The split is validated by a sanity check (§8): on 524 real ROs, `round(subtotal×6%) + tire_qty×$1` tied to `taxes` for **98.1% exactly**, and the per-tire $1 is exact even on tax-exempt ROs (Tekmetric exposes **no** tax breakdown or tax-exempt flag — confirmed — so the lump is the source of truth and exemption is read from a $0 sales-tax portion).

> **Comprehensive mapping is the point of the app:** *every* Tekmetric line — fees, part categories, sublet, taxes, payment types — resolves to a QBO account via `qteklink_mappings`; **any unmapped item routes to the resolution queue (§9), so nothing is ever left unmapped.**

**A/R + cash:** A/R → Accounts Receivable `[235]` (no `EntityRef`); CC fee → Bank/Credit Card Fees `[309]`.

**Non-cash (`OTH` → `otherPaymentType.name`) → expense/contra, NOT Undeposited:** Tire Protection Plan → Tire Protection Plan Redemption `[1150040010]`; Shop Vehicle → Shop Vehicle Repair `[1150040014]`; **Mistake / Other / new → resolution queue**.

`[id]` realm-specific, FK-bound `(shop_id, realm_id, qbo_account_id)`. Keys canonicalized; prefer `source_id`. **Any unmapped key → resolution queue (§9).**

---

## 5. Posting model — separate, independently-dated JEs

**SALE — one per RO, dated to the RO's posted date in the shop's local timezone** (`TxnDate` is a date — convert from UTC in `shop_timezone`). DocNumber `RO <#>`. Dr A/R `[235]` = net total; Cr each income account = gross − allocated discount (§6); Cr Sales Tax `[250]`.

**PAYMENT — one per payment id, dated to the payment date** (own posting row + `requestid` + `qbo_je_id`):
- **Card/cash/check (gross→net invariant):** Dr Undeposited `[366]` **gross** / Cr A/R **gross**; then (if `applicationFee`>0) Dr Bank/CC Fees `[309]` / Cr Undeposited `[366]`. Undeposited nets to the deposit → flows into Make Deposits (verified §1).
- **Refund** (separate negative id, `applicationFee:null`) → own posting, refund-dated.
- **Void** (same id flipped) → not-yet-posted: suppress; already-posted: **reversing** posting per §7.
- **Non-cash (`OTH`)** → Dr <mapped expense> / Cr A/R.

A single RO has many payment rows/dates — each its own posting; never folded into the RO-dated sale JE. Posts balance (Σdr=Σcr) before submit. The bookkeeper continues to create bank deposits via Make Deposits (QTekLink posts only the JE-to-Undeposited entries — no Deposit objects).

---

## 6. Discounts — net waterfall (no discount account)

Allocate `discountTotal` **Labor → Parts → Sublet → Fees**, **capped at each bucket's gross** (never below 0). **Any fee can be discounted** — no fee is excluded (Chris). (Tire Tax isn't in this waterfall because it's a *tax*, not a fee — §4.) Residual after all buckets → resolution queue (fail-closed; practically never reached). Post income **NET**; **persist the per-category allocation** in `proposed_je`.

---

## 7. Change detection (fix #2) + corrections

- Collapse repeated unpost→repost flaps to the **latest** snapshot. Trigger on **any account-affecting change** (total, posted date, fee/part category, taxable status, payment type, non-cash routing) via `source_snapshot_hash`.
- **Open period** → re-send the RO's sale JE as a **full balanced line set** under the stored `SyncToken` (QBO JE update replaces ALL lines — confirmed; not a sparse patch). **Closed/reconciled period** → dated **reversing/adjusting** entry (`kind=correction`); never destructively edit a closed JE.
- **Correction date:** the event's own date if that period is open, else the current open period — deterministic, recorded on the posting.
- **Paid-RO reduced:** sale correction lowers A/R; a **refund** raises A/R → net to zero. **Account credit** → correction leaves **negative A/R = the credit**. Separate events (no double reversal).
- **Unpost delivery unconfirmed** (0 in 19 days) — §17; fall back to total/date deltas at sync.

---

## 8. Reconciliation gate — deterministic (no LLM)

Exact arithmetic only. All must hold or → resolution + error email (rest of batch proceeds): (a) RO identity; (b) mapped fee lines sum to `feeTotal`; (c) **tax sanity check** — `round(subtotal × 6%) + tire_qty×$1` ties to `taxes` (±2¢): pass → post the split (tire_fee→PTAL, remainder→Sales Tax Payable); a **$0 sales-tax portion** (`taxes − tire_fee == 0`) is a recognized **tax-exempt** RO and also passes; **any other mismatch FLAGS to the resolution queue** (rare off-rate case → resolved by a **manual JE** for now — a proper fix is TBD) — the full `taxes` lump is still posted so the JE stays balanced; (d) JE balances Σdr=Σcr; (e) A/R = net total; (f) **payment-state total = `amountPaid`** (against the pinned cumulative source state, not just windowed payments); (g) every key mapped; (h) every target account **exists + active** in `qbo_accounts` (pre-post freshness); (i) discount capped, no negative line; (j) no duplicate — **separately scoped**: source entity id (`data.id`), source-state content hash, QBO `requestid` (each a distinct uniqueness layer); (k) the draft's `source_state_hash` still matches latest. **No LLM.**

---

## 9. Fallbacks & cutover — fail-closed

- **Unmapped fee / new payment type / recon mismatch / QBO error** → typed `qteklink_review_items`; human resolves (picks account / classifies money-vs-non-cash / fixes) → **rebuild the draft, apply the saved mapping, resume posting**. Never auto-buckets; never strands the RO.
- **Cutover (simplified):** AL owns all pre-cutover history (already in QBO). QTekLink **posts from a clean cutover datetime forward** for the connected realm only — no historical replay/backfill. **In-flight edge** (RO's sale posted by AL pre-cutover, paid post-cutover via QTekLink) → the payment is an **`orphan_payment`** (no QTekLink sale to clear) → human applies a defined opening-balance/credit-A/R rule; never creates unexplained negative A/R.

---

## 10. Human gate / auto-post + nightly pipeline

- `qteklink_settings.auto_post` (default **false**).
- **Nightly `qteklink-sync`:** reduce → build sale + payment drafts (respect `settle_window_minutes`; **hold a payment draft until its RO's sale is reconciled/posted**) → reconcile → enqueue `pending` (or auto path). Build reads a **pinned source-state version**; the draft stores `source_state_hash`.
- **Post-time (BOTH human + auto):** re-validate `source_state_hash` vs latest → **stale: rebuild** (human-gated rebuilds return to `pending` for re-approval; auto rebuilds + re-reconciles). The UI tells the approver when their click triggered a rebuild instead of a post.
- **Concurrency/idempotency:** `FOR UPDATE SKIP LOCKED` + lease + the atomic lifecycle (§3); **`requestid` once per logical create, reused on retry**, unique `(shop_id, realm_id, requestid)`; a durable posting row records the operation **before** the QBO call + a **private-note marker** so a crash-after-create is detected by query (DocNumber alone isn't authoritative).

---

## 11. Email alerts (configurable, per type)

`qteklink_alert_recipients` (shop+realm-scoped; **admin-role editable + audited** — recipients are an exfiltration path, so changes are restricted + logged). **Error** (recon mismatch, QBO failure, failed auto-post, stale-draft, unresolved item, queue backlog) and **approval summary**, with **throttle/debounce + digest** (no alert storms). **Email bodies PII-scrubbed** (same redaction as Sentry). Reuse Resend + React Email + `_shared/manual-review-email.ts`; delivery failures → Sentry + a retry/dead-letter.

---

## 12. Observability & escalation

No silent failures. **All server-side surfaces — edge, cron, sync, post workers — wrapped in `Sentry.withScope` with PII scrubbing + `shop_id`/`realm_id` tags** (not just edge). **Cron bodies re-raise after logging** (an `EXCEPTION` handler that swallows makes a failed job look successful — it must mark the job failed + alert). Metrics (tagged `shop_id`/`realm_id`, no PII/high-cardinality labels): events by kind, unknown/refund/void, dedup hits, drafts built/posted/failed, QBO dup-prevention hits, recon failures by reason, queue age, stuck-`posting` count, unmatched payment↔RO. High-severity (cron didn't run, OAuth disconnected) escalate beyond a UI item.

---

## 13. QBO write layer (`qbo-api-client`, in `qteklink-app`)

`Account` query; `JournalEntry` **create** (stable `requestid`); **update** = **full balanced line-set re-send under `SyncToken`** (QBO replaces ALL lines on a JE — *not* a sparse patch; confirmed by `quickbooks-compliance`); **query** (private-note marker / DocNumber+date for idempotency + verification). Zod entities. **OAuth `invalid_grant` / revoked / realm-mismatch = HARD fail → pause posting for that realm + a `reconnect-required` resolution item** (a realm mismatch is a tenant-boundary violation, never a blind retry); transient 5xx/429 reuse the client's **retry/backoff + Fault** handling. **A/R-line `EntityRef` watch (C5/C6):** verify against the live API at minorversion 75 that Entity-less A/R JE lines post; add an `ar_entity_rejected` fail-closed guard so a future tightening surfaces to the queue, never a silent drop. minorversion=75 (SDK default).

---

## 14. Auth, multi-tenant & access

- **Auth:** Entra (Supabase Azure provider). **`requireQtekUser()`** binds to the **Entra tenant + immutable `object id`** (email is display/secondary; CITEXT) and admits only **active** rows in `qteklink_allowed_users`. Enforced at **every server entrypoint** — middleware **and** route handlers, server actions, and cron/post endpoints (middleware alone doesn't cover server-side paths). Allowlist is **app-managed** (a settings screen — no Entra dashboard per person); only `admin`-role users edit it, and edits are audited. Optional belt-and-suspenders: Entra **"user assignment required"** (one-time Azure config). Azure redirect URL for `qteklink.jeffsautomotive.com` is a setup step.
- **Tenant/realm:** `shop_id`+`realm_id` on every table, in every uniqueness key + account FK; **DAL tenant predicates everywhere** (service-role bypasses RLS); RLS + pgTAP cross-shop/cross-realm tests.

---

## 15. Phasing (TDD)

| Phase | Deliverable |
|---|---|
| **C0** | Scaffold **`qteklink-app/`** (Next 15, shadcn/ui, Tailwind v4 brand) + **Entra auth → `qteklink_allowed_users`** (object-id bound, all-entrypoint) + Vercel project + domain. Move `qbo-api-client` here. Add `qteklink-app/{src,app}` to the phase-guard gated paths. |
| **C1** | COA sync: `Account` query + `qbo_accounts` (shop+realm) + admin Refresh. |
| **C2** | `qteklink_mappings` + UI (one-active, role-compat, snapshot). |
| **C3** | Intake: `qteklink-webhook` → `qteklink_events` (durable-then-200, dup=200, stable-identity hash); classify; clean cutover (§9, no backfill). |
| **C4** | `qteklink_payment_state` reducer (per realm; precedence + tie-break; void/refund; signed fee). |
| **C5** | SALE JE builder (RO-152805 fixtures): waterfall net + caps + fee exclusion + persisted allocation + shop-tz TxnDate. **+ live-API A/R-Entity check.** |
| **C6** | PAYMENT/refund/void/non-cash + CC-fee postings (gross→net) + desired-vs-posted diff. **+ A/R-Entity fail-closed guard.** |
| **C7** | Reconciliation gate (§8) + fail-closed resolution queue + reprocess (§9). |
| **C8** | Posting + human gate: `qteklink_postings` lifecycle + lease, nightly cron, approval UI, `auto_post`, `qteklink-post` (idempotent, source-hash re-check, realm-mismatch hard-fail). |
| **C9** | Change detection (§7) + email alerts (throttle/scrub/audit) + observability (all-surface Sentry, cron re-raise, tagged metrics). |

Human gates: Chris approves merges + each deploy; **first real QBO write is human-gated.**

---

## 16. Test strategy + `/code-review` agents

**Tests:** Vitest (waterfall+caps+fee-exclusion, recon checks, JE balance, **payment-state reducer** — out-of-order/dup/void/refund/tie-break, mapping resolution, non-cash routing, paid-RO-change netting, shop-tz date, **idempotency/concurrency** — double-click approval, crash-after-create, stale rebuild, stuck-`posting` recovery; real fixtures); pgTAP (RPCs, shop+realm scoping + uniqueness, append-only, allowlist, PII least-privilege — row counts); MSW (QBO + Tekmetric incl. refund/void/non-cash); Playwright (allowlist gate, mapping UI, COA refresh, approval + resolution→reprocess, multi-tenant isolation).

### Code review runs on EVERY build phase (per-phase agent matrix)

Each phase closes with `/feature-verify` → fail-closed **`/code-review`** atomic gate on changed files **+ the agents that fit what the phase touches** (orchestrator-dispatched, logically):

| Phase | Review agents |
|---|---|
| **C0** app scaffold + Entra/allowlist auth | security-review · pattern-review · supabase-compliance · vercel-compliance |
| **C1** `Account` + `qbo_accounts` migration + UI | quickbooks-compliance · supabase-compliance · security-review · pattern-review |
| **C2** mappings table + UI | supabase-compliance · security-review · pattern-review |
| **C3** intake edge fn + events table | security-review · sentry-compliance · supabase-compliance |
| **C4** payment-state reducer + migration | pattern-review · security-review |
| **C5** SALE JE builder | quickbooks-compliance · pattern-review |
| **C6** payment/refund/void/non-cash + CC-fee | quickbooks-compliance · pattern-review |
| **C7** reconciliation gate + resolution queue | pattern-review · security-review |
| **C8** posting + human gate + approval UI + cron | quickbooks-compliance · security-review · sentry-compliance · vercel-compliance |
| **C9** change detection + emails + observability | quickbooks-compliance · security-review · sentry-compliance |

Every phase also gets **regression-review** + the atomic gate; existing **QBO atomic agents** guard the write layer.

### QTekLink-specific `qtl-*` agents — post-build review/testing layer

Authored **after** the app (Chris): `qtl-je-balances`, `qtl-discount-waterfall-capped`, `qtl-sale-payment-date-split`, `qtl-payment-reducer-stateful`, `qtl-noncash-not-undeposited`, `qtl-ccfee-gross-net`, `qtl-durable-before-200`, `qtl-money-cents-bigint`, `qtl-reconcile-before-post`, `qtl-unmapped-to-queue`, `qtl-requestid-unique-once`, `qtl-dedup-payment-id`, `qtl-posted-vs-desired-correction`, `qtl-stale-draft-recheck`, `qtl-append-only-financial`, `qtl-shop-realm-scoped`, `qtl-txndate-shop-tz`, `qtl-mapping-snapshot-role`, `qtl-allowlist-objectid-gated`, `qtl-ar-entity-guard`, `qtl-realm-mismatch-hardfail`, `qtl-income-net-no-discount-acct`, `qtl-no-silent-failures`. **Safeguard:** every invariant has a failing TDD test in its phase + the per-phase agents above — nothing ships unprotected; the `qtl-*` agents add ongoing regression review.

---

## 17. Open questions / risks (verify during build)

1. **A/R JE line without `EntityRef`** — API-permitted at minorversion 75 + live-proven, but UI-mandated + minorversion-sensitive → C5/C6 live-API check + the `ar_entity_rejected` fail-closed guard (§13).
2. **Settle/completeness window** tuning.
3. **Unpost event delivery** — confirm; else sync-time deltas.
4. **First production QBO write** is human-approved.
5. **Webhook security** — Tekmetric can't HMAC → per-shop rotatable token, header-over-query where possible, constant-time compare, log/Sentry redaction, rate limiting; invalid token not stored, logged separately (still 200).
6. **Tax handling — RESOLVED.** Tekmetric exposes no tax breakdown or tax-exempt flag anywhere (lump `taxes`; customer carries only `customerType`). Post the lump split as `tire_qty×$1` → PTAL `[252]` + remainder → Sales Tax Payable `[250]`; the `round(subtotal×6%)+tire_qty×$1` formula is the **sanity check** (98.1% exact / 524 ROs); zero-sales-tax = recognized exemption (passes); a failed check **flags → resolution queue → manual JE** for now (rare off-rate edge case; fix TBD).

*(Resolved since v4: JE-vs-native → JournalEntry, confirmed via live books + Intuit docs + quickbooks-compliance PASS; tax-via-JE supported (self-calculated); Undeposited-via-JE flows into Make Deposits; pass-through fees excluded from discounting; cutover simplified to clean-date.)*

---

## 18. Sources

Live QBO realm 9341455608740708 (JournalEntry / Account / **Deposit** queries — Deposits link to AL JEs, proving the Make-Deposits workflow). `keytag_webhook_events` firehose. `research-findings.md`. Intuit docs (Bank Deposits / Undeposited Funds / JournalEntry / Automated Sales Tax) + the project `quickbooks` skill. Plan v1→v5 incorporates the 2026-06-04 GPT-5.5 ×2 + Gemini 2.5 Pro cross-verifies, the back-half (§8-14) dual review, the separate-app decision, and the `quickbooks-compliance` PASS verdict.
