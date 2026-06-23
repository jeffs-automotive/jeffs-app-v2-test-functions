# QTekLink payments-fixes — implementation plan

> Design artifact derived from `payments-fixes-findings.md` (live-data investigation, 2026-06-23) +
> Chris's decisions. **Not yet cross-verified** — the worktree session should run `/feature-plan` →
> `/feature-cross-verify` (Gemini+GPT) + the `quickbooks-compliance` agent on the Task 2 accounting before
> `/feature-implement`. TDD throughout (tests with the code). All code edits happen in the worktree session
> (gated paths blocked elsewhere).
>
> **Sequence:** ship **Task 1** first (self-contained, no QBO-account dependency), then **Task 2**.

---

## Decisions locked (Chris, 2026-06-23)

- Store credit IS issued via Tekmetric (unattached real-tender check) AND redeemed (`STORE_CREDIT` type).
- Store-credit holding account = a NEW QBO **Other Current Liability** "Customer Store Credit".
- Accounting: **issue → Cr** the liability (Dr Undeposited); **redeem → Dr** the liability (Cr A/R).

---

## Task 1 — RO# cache so fleet/A/R check payments resolve their RO number

**Problem (confirmed):** 81/130 CHK RO ids (fleet A/R — Carmax etc.) have no `repairOrderNumber` in any
captured event; only Tekmetric has it. Resolution chain today: same-day sales → `lookupRoMeta`
(`qteklink_events` `ro_*` kinds → keytag firehose). All miss for old A/R ROs → "—".

**Approach — mirror the shipped customer-name cache** (`src/lib/dal/customers.ts` +
`qteklink_customers` + `qteklink_upsert_customers` RPC + nightly warm). Cache-only on the build/view path
(determinism); Tekmetric fetch only in the nightly cron.

### Changes

1. **Migration** (`supabase/migrations/`): new table `qteklink_ros`
   `(shop_id int, realm_id text, tekmetric_ro_id bigint, repair_order_number text, updated_at timestamptz,
   PK (shop_id, realm_id, tekmetric_ro_id))`. service_role-only (RLS enabled, no policies → service_role
   bypasses; mirror `qteklink_customers`). SECURITY DEFINER `qteklink_upsert_ros(p_shop_id, p_realm_id,
   p_ros jsonb)` `SET search_path = public`. (Acquire the shared **migrations lock** for a monotonic
   timestamp — `module-manifest.json` shared_surfaces.)
2. **New DAL** `src/lib/dal/ro-numbers.ts` (mirror `customers.ts`):
   - `getCachedRoNumbers(shopId, realmId, roIds): Map<number,string>` — CACHE-ONLY read (no fetch).
   - `resolveRoNumbers(shopId, realmId, roIds)` — read-through: fetch missing via `getRepairOrderById`
     (`supabase/functions/_shared/tools/repair-orders.ts` is Deno/edge — qteklink-app needs its OWN
     Tekmetric client call; the app already has `src/lib/tekmetric/client.ts` with `getCustomerById` —
     add a `getRepairOrderById`/`getRepairOrder` there returning `repairOrderNumber`), upsert via RPC,
     Sentry-capture + skip per-RO failures (never fail the money build).
   - `warmRoNumbersForRecentDays(shopId, realmId, {days})` — nightly: select payment RO ids in window
     **plus** the backlog of RO ids that appear in payments but are still uncached/unresolved, resolve +
     cache. (Window alone misses the OLD fleet ROs — explicitly include unresolved-backlog ids.)
3. **`src/lib/dal/ro-lookup.ts`** — add `qteklink_ros` cache as the FINAL fallback in `lookupRoMeta`
   (cache-only). Order: same-day sales (caller) → `qteklink_events` `ro_*` → keytag firehose → **ros cache**.
4. **Nightly cron** (`src/lib/dal/nightly-sync.ts` `runNightlySync`): call `warmRoNumbersForRecentDays`
   alongside `warmCustomerNamesForRecentDays`. One-time effect: the 81 existing unresolved fill in on the
   next nightly run; already-posted days then show "changed since posted" → re-approve (auto_post OFF for
   7476, so nothing auto-posts) — same UX as the 6/16 customer-name rollout.

### Tests (TDD)
- `ro-numbers.test.ts`: cache-hit returns map; cache-miss → fetch+upsert path (mock Tekmetric); per-RO
  fetch failure is skipped not thrown; DB error throws.
- `ro-lookup.test.ts`: extend — when events miss but the ros cache has the number, `lookupRoMeta` returns it.
- `daily-breakdown.test.ts`: a fleet-check payment row whose RO is only in the ros cache shows the RO#, not "—".

### Notes
- Payment-type-agnostic: also fixes "—" for CASH/OTH on old A/R ROs (resolution is keyed on RO id). Call out.
- The "—" stays until the nightly warm runs (cache-only view path) — acceptable + deterministic.

---

## Task 2 — Store credit (issue + redeem) → QBO

**Problem (confirmed):** `STORE_CREDIT` (top-level paymentType) routes to the deposit path
(`Dr Undeposited / Cr A/R`) → overstates Undeposited; and the unattached issuance check (`repairOrderId:
null`) is dropped as malformed. Correct: issue `Dr Undeposited / Cr Customer Store Credit`; redeem
`Dr Customer Store Credit / Cr A/R`.

### Prereq (Chris / out-of-band)
- Create the **Customer Store Credit** Other-Current-Liability account in QBO (the real one for shop 7476).
  Capture its `qbo_account_id`. Then add the mapping (below). Run the **quickbooks-compliance** agent on
  the JE shape (Dr/Cr direction, account types) before posting anything live.

### Changes

1. **Mapping** for `STORE_CREDIT → Customer Store Credit`:
   - Add a posting role for a store-credit liability. Today `resolvePaymentMappings` only consumes `system`
     + `noncash_payment_type` kinds; `payment_type` rows are ignored and `derivePostingRole` has no
     `payment_type` case. Cleanest: add a new role (e.g. `store_credit_liability`) + consume a
     `kind='payment_type', source_key='STORE_CREDIT'` mapping row in `resolvePaymentMappings` →
     `m.storeCreditAccountId`. Update `catalog.ts` (POSTING_ROLES, ROLE_LABELS, `derivePostingRole`
     `payment_type` case) + the DB `qteklink_role_accepts_type` gate so the role accepts an
     **Other Current Liability** account type. Add a migration row (or admin mapping UI step) binding
     STORE_CREDIT → the new account.
   - Confirm whether the existing mappings admin UI (`app/mappings`) can express a `payment_type` mapping;
     if not, add the surface (small).
2. **Builder** `src/lib/payments/payment-je-builder.ts`:
   - **Redemption:** new branch — `method === 'STORE_CREDIT'` → `Dr storeCreditAccountId / Cr A/R` (gross,
     flipped for a refund), no fee, no Undeposited. Add `unmapped` push if `storeCreditAccountId` missing.
   - **Issuance:** when `repairOrderId == null` AND it's a real tender (NOT STORE_CREDIT) AND treated as a
     store-credit issuance → `Dr Undeposited / Cr storeCreditAccountId`. This is the NEW no-RO route; today
     a null-RO payment can't be enqueued (docNumber/route). Decide the detection predicate carefully (see
     open question) — fail closed to the resolution queue if ambiguous, don't guess.
   - `ResolvedPaymentMappings` gains `storeCreditAccountId: string | null`.
   - `PAYMENT_TYPE_LABELS["STORE_CREDIT"] = "Store Credit"` (`payment-type-label.ts`).
3. **Daily JE builder / day-drafts** (`src/lib/daily/*`, `src/lib/dal/day-drafts.ts`): ensure a no-RO
   issuance payment is INCLUDED in the day's payments JE (it's keyed by date, not RO). Verify the
   day-grain rollup + the `part: "gross"` split handles a payment with `repairOrderId: null`.
4. **payment-je.ts** `resolvePaymentMappings`: consume the new `payment_type/STORE_CREDIT` row.

### Tests (TDD)
- `payment-je-builder.test.ts`: STORE_CREDIT redemption → `Dr storeCredit / Cr A/R`, balanced, no
  Undeposited/fee; missing mapping → `unmapped`. Issuance (CHK, repairOrderId null, flagged issuance) →
  `Dr Undeposited / Cr storeCredit`, balanced. A null-RO payment NOT classified as issuance stays
  suppressed/queued (no guess).
- `payment-type-label.test.ts`: STORE_CREDIT → "Store Credit".
- Daily builder test: a day with an issuance (no RO) + a redemption posts both legs; day balances; the
  Flexicon example reconciles (Undeposited +281.15, A/R −147.15, Customer Store Credit −134.00 net).
- Mapping/role test + pgTAP for `qteklink_role_accepts_type` accepting OCL for the new role.

### OPEN QUESTION to settle in the plan phase (with Chris)
- **Issuance detection.** "Real-tender payment with `repairOrderId: null` = store-credit issuance" is a
  heuristic (1 case in all data today, but unverified as a general rule). Confirm against Tekmetric's
  store-credit docs / support whether an unattached payment is ALWAYS a store-credit issuance, or whether
  other null-RO payments exist (deposits/prepayments) that must NOT post as issuance. Until confirmed,
  consider routing issuance candidates through the resolution queue for a human confirm rather than
  auto-posting (fail closed — `never-guess`).

---

## Verify / ship (worktree session)
- `qteklink-app`: `npx tsc --noEmit`, `npx vitest run`, `npm run build` clean.
- pgTAP for the new RPCs/role gate; `supabase db push` (CLI) for migrations; deploy any touched edge fns
  (CLI). MCP deploy tools are denied — `deployment.md`.
- `/code-review` fail-closed gate + `quickbooks-compliance` (Task 2) + `supabase-compliance` (migrations).
- Human gates: Chris approves the QBO account creation, the merge to `main`, and each deploy step.

## Files index
| File | Task | Change |
|---|---|---|
| `supabase/migrations/<new>` | 1,2 | `qteklink_ros` + RPC; store-credit role/account-type gate + mapping |
| `src/lib/dal/ro-numbers.ts` (new) | 1 | RO# cache DAL (mirror customers.ts) |
| `src/lib/dal/ro-lookup.ts` | 1 | ros-cache final fallback |
| `src/lib/dal/nightly-sync.ts` | 1 | warm RO#s nightly |
| `src/lib/tekmetric/client.ts` | 1 | add getRepairOrder(by id) → repairOrderNumber |
| `src/lib/payments/payment-je-builder.ts` | 2 | STORE_CREDIT redeem route + null-RO issuance route |
| `src/lib/payments/payment-type-label.ts` | 2 | STORE_CREDIT label |
| `src/lib/dal/payment-je.ts` | 2 | resolve store-credit mapping |
| `src/lib/mappings/catalog.ts` | 2 | new role + payment_type derive |
| `src/lib/daily/*`, `src/lib/dal/day-drafts.ts` | 2 | include no-RO issuance in daily JE |
| `app/mappings/*` | 2 | (maybe) surface the STORE_CREDIT mapping |
