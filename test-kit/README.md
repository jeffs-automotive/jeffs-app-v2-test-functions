# `test-kit/` — QBO / Tekmetric integration test kit

A shared, reusable library of **cookie-cutter checks** for the integration failure modes we keep
re-hitting when connecting to **QuickBooks Online** and **Tekmetric**. Each recurring bug becomes a
permanent, generic invariant so it can't quietly come back in a new app or a new code path.

It lives at the **root of the app repo** (which already contains all three apps — `scheduler-app`,
`admin-app`, `qteklink-app` — plus the Deno edge functions under `supabase/functions`), so it is
shared by everything *and* checked out in CI with no cross-repo token. (It deliberately does NOT
live in the dotfiles repo: that's for cross-machine config; this is app code consumed by the app
repo's own tests + CI.)

## How it's wired (hybrid, two layers + an index)

The kit is split by **what a check can actually prove** (research 2026-06-21):

1. **Runtime-agnostic fixtures** (`fixtures/*.ts`) — pure TypeScript, **no test-framework imports**,
   so both **Vitest** (the Next apps) and **`deno test`** (the edge functions) import them as plain
   data. Real provider payload shapes, sourced from the live builders + the API references.
2. **Parameterized contract suites** (in each app's own `__tests__`, importing the fixtures) —
   assert the **runtime/value** invariants a static reviewer can't execute (a JE balances after
   rounding, pagination drains, a requestid rotates on content change, a backdated repost still
   orders by received time).
3. **Static atomic agents** (`.agents/code-review/code-review-agents.mjs`) — the fail-closed
   `/code-review` gate encodes the **source-pattern** invariants that must hold on *every* changed
   file even with zero tests (minorversion pinned, requestid present, SyncToken on update, webhook
   signature shape, posted-status set, id-vs-human-number).

### Importing the fixtures (Node / Vitest apps)

Add one alias (mirrors the existing `@` alias) in each app that consumes it:

```ts
// vitest.config.ts → resolve.alias
"@testkit": path.resolve(__dirname, "../test-kit"),
// tsconfig.json → compilerOptions.paths
"@testkit/*": ["../test-kit/*"],
```

```ts
import { backdatedRepostBurst } from "@testkit/fixtures/tekmetric";
import { balancedJe } from "@testkit/fixtures/qbo";
```

Deno edge functions import the same `fixtures/*.ts` by relative path
(`../../../test-kit/fixtures/tekmetric.ts`) — they're plain data, no Vitest. The Deno-side
assertion helpers live next to `supabase/functions/_shared/test-helpers.ts`.

## The catalog — failure mode → invariant → mechanism

| Family | Invariant (the cookie-cutter rule) | Mechanism | Real incident |
|---|---|---|---|
| **time-ordering** | An external entity's CURRENT state is selected by **received_at**, never the provider's backdated business time | contract: `ordering.contract.test.ts` + `fixtures/tekmetric.backdatedRepostBurst` | RO 153211 (`f4e9b83` + `405e38d`) |
| **signed money** | Refunds are **signed/negative**, voids excluded — never `Math.abs()`-then-sum (abs only inside a JE builder that flips Dr/Cr) | contract: `payment-methods.contract.test.ts` | refund double-count (`6f7c89b`) |
| **money typing/balance** | BIGINT integer cents; JE Σdebits=Σcredits; positive `Amount`, direction via `PostingType`; fail-closed on corrupt cents | contract: `journal-entry.contract.test.ts` + `fixtures/qbo` | A/R status-6 drop (`c9f8f64`); 6/15 unbalance class |
| **qbo idempotency** | `requestid` **rotates iff** the content hash changes; UPDATE sends Id + current SyncToken; `?minorversion=` pinned | agents `qbo-write-requestid-idempotency`, `qbo-sparse-update-synctoken`, `qbo-minorversion-pinned` | stale-dedupe divergence (`6df34b3`) |
| **webhook idempotency** | Dedup on the **whole canonical body** (`sha256(raw_body::text)`), INSERT+catch-23505 (never upsert on a partial index) | deno contract: `_shared/webhook-idempotency.contract.test.ts` + agents | dropped 2nd payment (`c83bea3`) |
| **read-time freshness** | A money view **refreshes its projection before reading**, fail-closed; watermark advance is monotonic | contract (in `daily-snapshot.test.ts`) | invisible $333.79 check (`7eed5bc`) |
| **employee comms** | Human-facing surfaces show **RO# / customer / vehicle**, never a DB/provider id | contract (in `posted-day-sweep.test.ts`) + agent `tekmetric-id-vs-human-number` | id-in-email (`6c83927`) |
| **tekmetric posted-status** | A posted/sales rollup counts **both** status 5 (Posted) AND 6 (A/R), and the status is parsed from the **NESTED** `repairOrderStatus.id` (no flat `repairOrderStatusId` exists in the API payload) | contract: `tekmetric/__tests__/client.contract.test.ts` (runs fixtures THROUGH `listPostedRepairOrders`) + agent `tekmetric-posted-status-5-6` | A/R sales dropped (`c9f8f64`); vacuous safety net / RO 153886 $21.38 (2026-07-06) |
| **tekmetric pagination** | Spring pagination drains every page (cap 100) and tolerates a bare-array response | contract: `tekmetric/__tests__/client.contract.test.ts` + `fixtures/tekmetric` | guarded |
| **tekmetric customer name** | Customer name (REST-only) falls back through person → business-in-firstName → `Customer #<id>` (never empty) | contract: `tekmetric/__tests__/client.contract.test.ts` | guarded |

## Layout

```
test-kit/
  README.md            ← this catalog/index
  fixtures/
    tekmetric.ts       ← backdated repost burst, posted-status, pagination, customer fallbacks
    qbo.ts             ← balanced/unbalanced JE inputs, corrupt-cents, update±SyncToken, fault shapes
    webhook.ts         ← distinct-vs-duplicate webhook bodies for whole-body idempotency
```

### Where the suites live (as built)

| Suite | Runtime | Path |
|---|---|---|
| ordering | Vitest | `qteklink-app/src/lib/events/__tests__/ordering.contract.test.ts` |
| journal-entry | Vitest | `qteklink-app/src/lib/qbo/__tests__/journal-entry.contract.test.ts` |
| tekmetric client (pagination + posted-status + name) | Vitest | `qteklink-app/src/lib/tekmetric/__tests__/client.contract.test.ts` |
| signed money | Vitest | `qteklink-app/src/lib/dal/__tests__/payment-methods.contract.test.ts` |
| webhook idempotency + cross-runtime ordering | `deno test` | `supabase/functions/_shared/webhook-idempotency.contract.test.ts` |

CI: the `qteklink-app` job (`.github/workflows/ci.yml`) runs the Vitest suites; the existing
`deno-test` job runs the Deno suite. Static agents run in the fail-closed `/code-review` gate.

Contract suites live in each app next to the code they pin (e.g.
`qteklink-app/src/lib/**/__tests__/*.contract.test.ts`); the Deno suites live under
`supabase/functions/**`. New apps adopt the kit by adding the `@testkit` alias and importing the
fixtures.
