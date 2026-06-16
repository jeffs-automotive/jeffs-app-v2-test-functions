# QTekLink — JE line descriptions: payment type · RO# · customer (2026-06-16)

> Feature: `qteklink-je-line-descriptions`. Each payment line (and per-payment card-fee line) in
> the daily QBO journal entries should carry **payment type · human RO# · customer name** so the
> office can identify check vs credit-card lines when doing the bank deposit in QuickBooks
> (checks deposit separately from cards). Re-post **updates 6/15 + 6/13 in place** (no delete).

## Problem (verified in live data, 2026-06-16)

The posted payments JE `26059` (day 2026-06-15) lines read:

```
PAY 60212451 — RO 328577176              ← internal payment id + internal Tekmetric RO *id*
PAY 60216784 — RO 337732285 (refund)
```

So every payment line has the internal payment id and the internal **RO id** (e.g. `328577176`),
with **no payment type, no customer, and not the human RO number**. The *sales* JE already uses the
human `RO 153330` (sale-builder `docNumber = "RO " + repairOrderNumber`); payments are inconsistent
because `payment-je-builder` only has `repairOrderId` (the id), not the number/customer.

Desired line format (confirmed; adjustable):

```
Credit Card · RO 153330 · John Smith
Check · RO 153331 · Carmax
Credit Card · RO 153330 · John Smith (refund)
```

## Decisions (Chris, 2026-06-16)

1. **Fetch real customer names from Tekmetric.** The name is **not stored anywhere** — the webhook
   payload (`qteklink_events.raw_body.data`) carries `customerId` (e.g. `44695835`) and
   `repairOrderNumber`, but **no name**; no customer-name table exists (Supabase MCP introspection).
   → add a Tekmetric customer fetch + a cache table.
2. **Re-post via UPDATE-IN-PLACE** (no delete). The line `description` is part of
   `dailySourceState` → `source_state_hash` (daily-postings.ts:40-53). Changing the builder makes
   the affected days show "changed since posted"; re-approving posts a **full-replacement UPDATE**
   under the live JE id + current SyncToken (daily-poster.ts:200-235). Same JE number, no gap.
3. **Correct both posted days 6/15 (JEs 26058/59/60) and 6/13 (26055/56/57).** Going-forward days
   get the new format automatically. Earlier days are Accounting-Link `acknowledged` (terminal — never re-posted).

## Tekmetric customer API (verified against the in-repo Deno clients)

- `GET /customers/{id}?shop={shopId}` → `{ id, firstName, lastName, ... }` (auth: Bearer).
  Reference: `_shared/tools/keytag-extras.ts:182-194` (RO → customerId → `/customers/{id}` → name) and
  `_shared/tools/scheduler-customer.ts:44-60` (`TekmetricCustomer` shape).
- Display name quirk: commercial customers store the company in `firstName` ("Carmax"); people use
  `firstName`+`lastName`; both blank → `Customer #<id>` (`keytag-extras.ts:56` `customerDisplayName`).
- qteklink-app already has the OAuth client-credentials → token exchange (`src/lib/tekmetric/client.ts`
  `getAccessToken`), used by the nightly `listPostedRepairOrders`. Reuse it for the customer GET.

## Design

### A. Cache table (migration — `supabase/migrations/`)

`qteklink_customers` — one row per (shop, Tekmetric customer):

| column | type | notes |
|---|---|---|
| `shop_id` | `BIGINT NOT NULL` | tenant key |
| `tekmetric_customer_id` | `BIGINT NOT NULL` | the Tekmetric customer id |
| `display_name` | `TEXT` | resolved name (null until/if resolvable) |
| `first_name` | `TEXT` | raw, audit |
| `last_name` | `TEXT` | raw, audit |
| `fetched_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | last successful fetch |
| PK | `(shop_id, tekmetric_customer_id)` | |

RLS: service_role-only (matches `qteklink_events` / `qteklink_payment_state`; the app uses the admin
client). No PII beyond a name (no encryption — consistent with the RO snapshots already stored in
`qteklink_events`). Upsert via a small `SECURITY DEFINER` RPC `qteklink_upsert_customers` (or a plain
admin upsert — decide at build; prefer RPC for consistency with the other qteklink writes).

### B. Tekmetric client (`src/lib/tekmetric/client.ts`)

Add `getCustomerById(shopId, customerId, deps?) → { firstName, lastName } | null` (reuses
`getAccessToken`; 404 → null; other HTTP error → throw) + a pure `customerDisplayName({firstName,
lastName}, customerId)` mirroring the Deno helper (commercial-in-firstName; `Customer #<id>` fallback).

### C. Customers DAL (`src/lib/dal/customers.ts`)

- `getCachedCustomerNames(shopId, ids[]) → Map<number, string>` — DB read of `display_name`.
- `ensureCustomerNames(shopId, ids[]) → Promise<void>` — for ids missing from the cache, fetch
  `/customers/{id}` and upsert `display_name`. **Best-effort + resilient**: per-id try/catch, never
  throws (a money build must not fail because a name lookup 500'd; Sentry-capture the failure).
  Only fetches MISSING ids (steady state ≈ 0 fetches; first backfill of 6/15+6/13 ≈ ≤50 fetches).

### D. RO → {repairOrderNumber, customerId} resolution

The payment build needs, per payment's RO: the human `repairOrderNumber` **and** the `customerId`.
Both live in `qteklink_events.raw_body.data` (and the keytag firehose). Generalize the existing
`daily-breakdown.ts` `lookupRoNumbers` into a shared `lookupRoMeta(shopId, realmId, roIds) →
Map<roId, { repairOrderNumber: string|null, customerId: number|null }>` (qteklink_events first, keytag
fallback, body shopId must match — same multi-tenant guard as today). daily-breakdown reuses it.

### E. Enrichment in `day-drafts.ts` (the DB seam — NOT the pure builder)

In `buildDayDrafts`, after building the payment rows:
1. Collect distinct payment RO ids.
2. `lookupRoMeta(roIds)` → `{repairOrderNumber, customerId}` per RO.
3. `ensureCustomerNames(distinct customerIds)` then `getCachedCustomerNames(...)`.
4. For each payment set `input.repairOrderNumber = meta.repairOrderNumber` and
   `input.customerName = names.get(meta.customerId) ?? null`.

`PaymentForBuild` gains `repairOrderNumber?: string | null` and `customerName?: string | null`.
Manual method-picks set both null (no RO/customer link) — they already carry `repairOrderId`.

### F. Description (pure `payment-je-builder.ts`)

Build deterministically from the inputs (so it stays unit-testable + hash-stable):

```
parts = [ typeLabel(method, otherPaymentType),
          repairOrderNumber ? `RO ${repairOrderNumber}` : (repairOrderId != null ? `RO ${repairOrderId}` : null),
          customerName ]            // each dropped if null/empty
desc  = parts.filter(Boolean).join(" · ") + (isRefund ? " (refund)" : "")
```

- `typeLabel`: friendly payment type — reuse the `FIRST_CLASS_LABELS` map (CC→Credit Card, CASH→Cash,
  CHK→Check, …) from the payment-methods catalog; for Other/OTH use `otherPaymentType` (Synchrony, …).
- Fall back to the RO **id** only when the human number is unresolved (honest, never blank).
- The **fee line** description mirrors the gross line + ` — card fee` (so the fees JE lines also carry
  type · RO# · customer). Same `part:"fee"` structural tag; no behavior change.

### G. Determinism / hash churn (the money-safety bit)

- The description (incl. customer name) is in `source_state_hash`. `buildDayDrafts` ensures+reads the
  cache **within the same call** (ensure is awaited before the build reads), so a single build is
  self-consistent; once a name is cached it is stable → the hash is stable across the reconcile,
  approve, and poster-recheck builds. Amounts NEVER depend on the name.
- For **6/15 + 6/13**: after deploy + cache warm, the days show "changed since posted"; Chris clicks
  **Approve + post this day** → UPDATE in place of the payments (+ fees) JE. Sales JE descriptions are
  unchanged → sales category is a no-op (skip).
- Worst case (a transient Tekmetric failure leaves a name uncached): that line omits the customer
  this build and adds it next build → one extra "changed since posted". Safe (human re-approves;
  amounts unchanged). `ensureCustomerNames` retries missing ids every build until resolved.

## Touch list

- `supabase/migrations/<ts>_qteklink_customers.sql` (cache table + RLS + upsert RPC) — **gated**.
- `qteklink-app/src/lib/tekmetric/client.ts` — `getCustomerById` + `customerDisplayName`.
- `qteklink-app/src/lib/dal/customers.ts` (new) — `getCachedCustomerNames`, `ensureCustomerNames`.
- `qteklink-app/src/lib/dal/daily-breakdown.ts` — extract/`lookupRoMeta`.
- `qteklink-app/src/lib/dal/day-drafts.ts` — enrichment.
- `qteklink-app/src/lib/payments/payment-je-builder.ts` — description format + `PaymentForBuild` fields.
- `qteklink-app/src/lib/dal/payment-je.ts` — `stateRowToPayment` passes through new fields (default null).
- Possibly share `FIRST_CLASS_LABELS`/`typeLabel` (today in `payment-methods.ts` catalog).
- Regen `database.types.ts` after the migration (new table).

## Tests (TDD)

- `payment-je-builder.test.ts` — description = `type · RO# · customer` for card/cash/check/Other;
  refund appends `(refund)`; missing customer/RO# gracefully dropped; fee line mirrors + ` — card fee`.
- `customers.test.ts` — `ensureCustomerNames` fetches only missing ids, upserts, is resilient to a
  per-id fetch failure (never throws); `getCachedCustomerNames` maps rows.
- tekmetric `client.test.ts` — `getCustomerById` (200 → name, 404 → null), `customerDisplayName`
  (person, commercial-in-firstName, both-blank → `Customer #id`).
- `daily-breakdown.test.ts` / `day-drafts` — `lookupRoMeta` returns repairOrderNumber + customerId;
  body-shopId guard preserved.
- pgTAP — `qteklink_customers` RLS (service_role only) + upsert RPC.

## Verify + ship

- `npm run typecheck` + `vitest` + `npm run build` + **`/code-review`** gate (touches the live posting
  path — fail-closed). Optionally `/feature-cross-verify` on the plan.
- Deploy: `supabase db push` (migration) → `git push origin main` (Vercel app). MCP deploys denied.
- Warm the cache for 6/15 + 6/13 (view the days, or a one-off backfill), confirm both show "changed
  since posted", then **Chris re-approves each day** (the live QBO UPDATE is his gated action).

## Out of scope

- Sales JE line descriptions (already carry the human RO#; could add customer later — not asked).
- Separate clearing accounts per payment type (a structural redesign; the description satisfies the
  bank-deposit-identification need).
- Backfilling customer names for `acknowledged` (Accounting-Link) days — terminal, never re-posted.
