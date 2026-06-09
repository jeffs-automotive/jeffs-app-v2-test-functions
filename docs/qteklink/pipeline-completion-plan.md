# QTekLink — pipeline completion & wiring plan

> Status: PLAN (awaiting Chris approval + cross-verify). Authored 2026-06-08 from a two-batch,
> 14-agent wiring audit + live-DB + live-payload research. Covers every gap found, the corrected
> (data-grounded) payment-fee model, and the new payments-mapping surface Chris requested.
> Vehicle: the feature workflow (`/feature-start qteklink-pipeline-completion` → plan → cross-verify →
> implement → verify). Note: `qteklink-app/` is NOT a phase-guarded path, but `supabase/migrations/` +
> `supabase/functions/` ARE — those steps run in the `implement` phase.

---

## 0. The one fact that explains the symptoms

The **C4 payment reducer (`reduceShopPaymentState`) has zero production callers.** It projects
`qteklink_events` → `qteklink_payment_state`, which the approval dashboard + reconcile read for ALL
payments/fees. Its own header says "the nightly cron calls it"; the cron doesn't. So `payment_state`
is permanently empty → payments + CC-fees are blank on every day, and the nightly reconcile enqueues
only SALE postings (live: 11 postings, all `kind=sale`). Sales work because they read events directly.

Everything in Workstream A flows from fixing that single missing call.

---

## 1. Data-grounded payment-fee model (corrected)

Verified against the 603 live `payment_made` payloads:

- **`applicationFee` (integer cents) is a UNIVERSAL field on every payment**, and it IS the
  automatic-vs-manual signal:
  - `CC` applicationFee=185 ($1.85), **`AFFIRM` applicationFee=4184 ($41.84 ≈ 5%)** → Tekmetric-processed.
  - `CASH` applicationFee=null, `CHK`=0, `OTH`(e.g. "Mistake")=0 → no Tekmetric fee.
- **Rule:** `applicationFee > 0` ⇒ Tekmetric-processed → deposit + **automatic** fee line; `null`/`0` ⇒
  no Tekmetric fee → no auto fee (entered manually in QBO if needed). Auto-derived per-payment from the
  webhook — exactly as Chris described.
- **Affirm/Klarna** arrive as their OWN `paymentType.code` (`AFFIRM`, `KLARNA`), `otherPaymentType=null`
  — NOT as "Other". **Synchrony** is external (not via Tekmetric) → arrives as `OTH` +
  `otherPaymentType.name="Synchrony"`, applicationFee=0 → deposit-like, manual fee.
- **Already implemented correctly:** the reducer captures `applicationFee` universally; the builder
  auto-fees any non-"Other" payment with fee>0 (so Affirm already posts like a card) and deposit-likes
  Synchrony. The gap is account *configurability*, not fee logic.

---

## Workstream A — Unblock the payment pipeline  🔴 BLOCKER

**A1. Wire the reducer into the nightly cron.** In `runNightlySync` (`src/lib/dal/nightly-sync.ts`),
call `await reduceShopPaymentState(shopId)` BEFORE `runDailyReconciliation` (it returns
`{realmId:null}` cleanly for unconnected shops). Makes `payment_state` fresh before drafts build.
- Files: `src/lib/dal/nightly-sync.ts` (+ import). Test: `__tests__/nightly-sync.test.ts` asserting
  reduce-runs-before-reconcile, and that a per-shop reduce error is captured + doesn't abort other shops.

**A2. One-time backfill.** Run `reduceShopPaymentState(7476)` once (ops script
`scripts/qteklink-reduce-payment-state.mjs`, mirroring the existing scripts) to project the 603
backlogged events into `payment_state` so historical days show payments immediately. Non-gated.

**A3. Consider webhook-time projection (decision D-proj).** Optionally also re-reduce on each payment
webhook for near-real-time, vs. nightly-only. Recommendation: nightly is enough for the daily-approval
model; defer real-time. (Document the choice.)

---

## Workstream B — Payments-mapping surface + fee accounts  🟠 (needs decisions)

Today the deposit account (Undeposited [366]) and fee account (cc_fee [309]) are **hardcoded system
mappings**; routing is a name heuristic (`NONCASH_METHODS={other,oth}`). Generalize to an explicit,
discoverable payments-mapping surface — the analog of the item-mapping picker.

**B1. Discovery RPC** `qteklink_discover_payment_types` (mirrors `qteklink_discover_tekmetric_items`):
returns the distinct payment identities seen in `qteklink_events` — first-class `paymentType.code`
(CC/AFFIRM/KLARNA/CASH/CHK/DEBIT…) AND each `otherPaymentType.name` (Synchrony/Mistake…) — each with
its current mapping (account + role) or null, plus whether it carries `applicationFee>0` (so the UI can
show "automatic fee" vs "manual").

**B2. Mapping model.** Extend `qteklink_mappings` to map a payment type → { deposit/clearing account,
fee account (nullable), route: deposit | contra }. The automatic-vs-manual fee is NOT stored — it's
derived per-payment from `applicationFee` at build time. (So a type can be "deposit" with a fee account;
a payment of that type books the fee only if its webhook applicationFee>0.)

**B3. Builder change.** Replace the hardcoded `undepositedAccountId`/`ccFeeAccountId` lookups with the
per-type mapped deposit + fee accounts (falling back to the system defaults when unmapped, so nothing
regresses). Keep the existing auto-fee logic (fee>0 → fee line). Refund-with-fee still fail-closes.
- Files: `payment-je-builder.ts`, `src/lib/dal/payment-je.ts` (resolve per-type), `src/lib/dal/day-drafts.ts`.
  Pure-function tests for each route × {payment, refund} × {fee>0, fee=0}.

**B4. UI** — a dedicated "Payment mappings" section (separate from item mappings) listing each payment
type with its mapped accounts, "automatic/manual fee" annotation, and an editor. Reuse the
`mapTekmetricItemAction` pattern (admin-gated, Pattern-S not needed — it's config, reversible).
- Files: `app/mappings/` (new sub-section/component), `src/actions/mappings.ts`, DAL.

**B5. Decision D-affirm-acct — ✅ RESOLVED 2026-06-08:** Affirm/Klarna processing fees post to the
**same CC-fees account [309]** as credit cards (unify all Tekmetric processing fees). This is the
builder's CURRENT behavior, so the fee-account logic needs NO change — the payments-mapping surface (B2)
still adds per-type **deposit/clearing account** flexibility, but the fee account stays the single
`cc_fee` mapping for every processed type.

---

## Workstream C — Posting lifecycle correctness  🟠

**C1. Failed-posting recovery (dead-end states).** `failed` and `needs_resolution` have NO exit
transition — a hard QBO fault strands a posting forever. Add an RPC `qteklink_requeue_failed_posting`
(failed → approved, audited) + an admin "Retry" affordance on `/postings`. (`needs_resolution` is also
never *set* by any RPC today — either wire it or drop it from the status set.)
- Files: migration (gated), `src/lib/dal/postings.ts`, `app/postings/`. pgTAP + unit tests.

**C2. Corrections (v>1) — close the guaranteed dead-end (decision D-corr).** `postings.ts` enqueues a
correction when a posted sale's source hash changes, but `poster.ts:106` always routes v>1 →
`mark_failed` ("flow not built"). Two options:
  - (a) **Build the correction-update flow** (desired-vs-posted diff using the orphaned `getRoStateByRo`,
    post an adjusting JE). More work; the "right" long-term answer.
  - (b) **Stop enqueuing corrections** until (a) ships (guard the enqueue), so we never mint a posting no
    code can post. Minimal + safe.
  Recommendation: (b) now, (a) as a tracked follow-up. Decision needed.

**C3. Refund/void netting.** A standalone refund (no `payment_made` sibling — 4 live, −$67.80) projects
as an orphan negative payment with no original to net against and no flag. Add RO-level correlation:
when a refund/void has no matching prior payment in `payment_state`, raise a §9 review item rather than
silently posting a bare negative. (Voids are already suppressed by the builder; refunds are the gap.)
- Files: `src/lib/dal/payment-state.ts` or a reconcile-time check in `day-drafts.ts`; review-item kind.

---

## Workstream D — Classification & data correctness  🟡

**D1. Explicit refund/void event kinds.** Today refunds/voids land `event_kind='unknown'` and are
recovered only by the `payment_id`-present heuristic. Add `payment_refunded` / `payment_voided`
classification in the webhook (regex on the live "Refund issued…/Payment voided…" texts) so a future
Tekmetric shape change can't silently drop money. Downstream still keys on `payment_id` (no behavior
change), but classification becomes explicit + monitorable.
- Files: `supabase/functions/qteklink-webhook/index.ts` (gated), its test.

**D2. `ro_sent_to_ar` classifier (decision D-ar).** 0 live rows; the regex never matched real Tekmetric
wording, and ~57 on-A/R ROs arrive as plain `ro_posted` (captured correctly, so no money drop). Capture
one real on-A/R RO's `event` text → fix the regex OR confirm A/R ROs come as `ro_posted` and correct the
stale "21% arrive as ro_sent_to_ar" note in `events/kinds.ts`. Needs a live sample.

**D3. Seed `qteklink_settings` (decision D-settings).** 0 rows → all-defaults (correct for Jeff's: 6%,
$1/tire, America/New_York, auto_post OFF). Seed an explicit Jeff's row so config is visible + the
auto_post toggle works, AND confirm the defaults stay shop-agnostic-safe (a 2nd shop must not silently
inherit PA tax). Recommendation: seed via the existing `SettingsForm`/`upsertShopSettings` once live.

---

## Workstream E — Operational wiring  🟡 (some are Chris-actions)

**E1. COA auto-refresh.** `qbo_accounts_sync` is reachable only via a manual admin button — new/renamed/
deactivated QBO accounts silently go stale in the mapping UI + JE labels. Add a COA refresh to the
nightly cron (cheap, one QBO query) and/or on-connect. Files: `src/lib/dal/nightly-sync.ts`, `coa.ts`.

**E2. Set `CRON_SECRET` in Vercel** (Chris action) — without it the nightly job 401s every night
(fail-closed). `vercel env add CRON_SECRET production` with a generated 32-byte secret.

**E3. Register the qteklink-webhook in Tekmetric** (Chris action) — recent edge logs show live Tekmetric
POSTs hitting the keytag/firehose webhooks but NOT qteklink-webhook, and events stop at 06-06. Confirm
the qteklink-webhook URL (+`?token=`) is registered so live data flows. I can help verify via a test POST.

---

## Workstream F — UX & dead-code cleanup  ⚪

**F1. Non-admin navigation (decision D-roles).** `viewer`/`approver` land on the dashboard with no nav
to the read-only pages they're authorized for, and the two roles are never differentiated. Either expose
read-only nav links to non-admins, or collapse to admin-only for v1. Recommendation: show read-only nav
to viewer/approver (the pages already enforce read-only); defer richer role distinctions.

**F2. App-shell polish.** Add `app/not-found.tsx` (+ optional `loading.tsx`) so `notFound()` renders a
branded page instead of the default 404.

**F3. Dead-code removal** (confirmed orphaned, only tests/no one import them):
`buildShopRoSaleJe`, `buildShopPaymentJe`, `buildShopManualPaymentJe` (superseded by `buildDayDrafts`);
`setMappingAction` (superseded by `mapTekmetricItemAction`); `getQtekSession` (unused); `getRoStateByRo`
(KEEP if C2(a) wires it, else remove); RPC `qteklink_get_allowed_user` (kept only for tests — remove with
its pgTAP, or leave documented); `qbo-webhook` edge fn (orphaned — document as intentional stub or
remove); `settleWindowMinutes` (dead config — wire a real settle window or remove the field).

---

## Open decisions (need Chris)

| ID | Decision | Recommendation |
|----|----------|----------------|
| D-affirm-acct | ✅ RESOLVED 2026-06-08 | Same CC-fees acct [309] — unify all processing fees (no builder change) |
| D-corr | Corrections v>1: build the update flow now, or guard enqueue until later? | Guard now (b), build later |
| D-settings | Seed an explicit Jeff's settings row now? | Yes, once live |
| D-ar | `ro_sent_to_ar`: fix regex or update the stale note? | Capture a live sample, then decide |
| D-roles | Expose read-only nav to viewer/approver? | Yes |
| D-proj | Reduce payments real-time on webhook, or nightly only? | Nightly only for now |

---

## Suggested sequencing (small, reviewable PRs)

1. **PR1 — Unblock (A1+A2+A3 decision).** Wire reducer + backfill. Smallest change, biggest unlock;
   payments light up immediately. Full review battery + the live single-payment smoke (Chris-gated).
2. **PR2 — Payments-mapping surface (B).** Discovery RPC + mapping model + builder per-type accounts + UI.
3. **PR3 — Lifecycle correctness (C).** Failed-retry, corrections guard, refund netting.
4. **PR4 — Classification + ops (D + E1).** Explicit refund/void kinds, ro_sent_to_ar, COA auto-refresh.
5. **PR5 — UX + cleanup (F).** Non-admin nav, not-found, dead-code removal.
6. **Ops (E2/E3):** CRON_SECRET + Tekmetric registration — Chris, any time.

Each PR: TDD (tests with/before code), then the full review battery — Claude specialists (security /
regression / pattern / quickbooks / supabase, opus) + `/code-review` (fail-closed) + `/feature-cross-verify`
(Gemini+GPT) — then Chris approves the merge; every QBO-write + deploy step is Chris-gated.

---

## What we verified is already CORRECT (no action)

Token refresh (proactive + 401-retry) fully wired; auth airtight (every entrypoint guarded, shopId
server-derived); all 24 app RPCs exist live with exact signatures; money tables locked
(REVOKE + SECURITY DEFINER); test suite green (305/305) with no test residue in code or DB; Sentry
wired (error.tsx/global-error/onRequestError); env hygiene clean; the SALE path end-to-end; the
reducer's refund/void folding; part-category + fee mappings complete.

---

## Cross-verify refinements (Gemini 2.5 Pro + GPT-5.5, 2026-06-09)

Artifact: `.claude/work/ai-review-2026-06-09T02-03-04Z.md`. Both models CONFIRMED the core blocker and
that A1 is essential. Refinements folded in below.

### PR1 (unblock) — harden it
- **A1 — isolate the reducer so it can't block SALES.** `reduceShopPaymentState` fails CLOSED (throws on
  a corrupt `payment_id` / unsafe RO id / DB error / pagination cap). A bare `await
  reduceShopPaymentState(shopId)` before reconcile would let ONE bad payment event block sales too —
  regressing "payments missing, sales work" → "both blocked." Wrap it in its OWN try/catch
  (Sentry.captureException + continue to reconcile); the payment side degrades alone. Per-shop isolation
  already lives in the cron's outer loop (`route.ts`), so the "one shop's failure doesn't abort others"
  test targets THAT loop, not `runNightlySync`.
- **A2 — the backfill is a financial write; gate it.** Populating `payment_state` changes what the
  dashboard/reconcile treats as postable. Require dry-run counts + shop/realm confirmation + audit output
  + explicit Chris approval before the live backfill (even though it's not a QBO write).
- **A1 must include orphan-refund DETECTION (pull from C3).** The backfill projects the 4 live standalone
  refunds (−$67.80). With auto_post OFF they only display, but PR1 should flag them to the review queue,
  not surface them as silently-postable negatives.
- **E2/E3 are PR1 PREREQUISITES, not "any time."** Without `CRON_SECRET` the nightly job 401s; without the
  Tekmetric webhook registration no NEW live data flows. PR1 helps only backfilled data until both are set.

### Workstream B — reconcile with the "same cc_fee account" decision + the REAL mapping shape
- **No per-type fee account.** Per D-affirm-acct (all processing fees → `cc_fee`), B2/B3 simplify to mapping
  a per-type **deposit/clearing account ONLY**; the fee account stays the single system `cc_fee`. (Removes
  the B2/B3-vs-B5 contradiction the review flagged.)
- **Use the existing row shape.** `qteklink_mappings` is one `(kind, source_key, qbo_account_id,
  posting_role, pass_through)` row — model payment-type deposit accounts with the SAME role-per-row
  convention already used for `noncash_contra`/`undeposited_funds`, NOT a new multi-column schema.
- **First-class codes need a builder/DAL dimension.** Today all non-"Other" methods share one Undeposited +
  cc_fee; `ResolvedPaymentMappings` + the builder must gain a per-`paymentType.code` deposit-account lookup
  (CC/AFFIRM/KLARNA/CASH/CHK/DEBIT), falling back to system Undeposited.
- **Fallback is first-class ONLY.** System-default fallback applies to first-class processed codes; "Other"/
  OTH subtypes MUST stay fail-closed (unmapped → review), never silently post to Undeposited.
- **applicationFee on the deposit-like path too.** The current OTH/deposit-like branch ignores
  `signedProcessingFeeCents`; apply the fee>0 → fee-line rule on EVERY deposit route so a future
  fee-bearing financing type can't drop its fee.
- **Fix the stale builder comment:** the deposit-like path lists "Synchrony/Affirm" — Affirm goes through
  the CARD path (own code, fee on webhook); only Synchrony (external, OTH) is deposit-like-no-fee.

### Workstream C — reframe as "post-time reconciliation & lifecycle" (bigger than first scoped)
Four findings converge: the system needs a desired-vs-posted reconciliation at POST time, not just
enqueue-time gates.
- **Manual payments silently dropped (BLOCKER, both models).** `daily-reconcile` skips manual picks
  (UUID id / no RO) — they build into the snapshot as "postable" yet never enqueue/post. Raise a review
  item (or build the manual-payment posting identity) instead of silently dropping.
- **Late voids aren't reversed.** A void of an ALREADY-POSTED payment is only "suppressed" (no JE) — no
  reversal — and `buildDayDrafts` filters by original `payment_date`, so a void arriving days later for an
  old date is never revisited. Needs the desired-vs-posted diff (same capability as corrections) + a
  look-back keyed on `latest_event_at`, not `payment_date`.
- **Post-time `source_state_hash` recheck (deferred in poster).** Between approval and posting,
  events/mappings/settings can change; the poster writes the stored `proposed_je` without rebuilding. Add
  an explicit final hash-bound recheck (rebuild-or-abort) before the QBO write.
- **Retry must distinguish transient vs rebuild-required.** Confirm transient QBO failures
  (throttle/network) route to `approved` (retry), not `failed`; a "Retry" on a mapping/account failure must
  REBUILD the draft (re-reconcile), not re-post the stale JE.
- **`needs_resolution`:** wire a producer + exit, or remove it from the status set.

### Smaller, folded in
- **null `payment_date` → review item.** A `payment_state` row with null date is excluded by
  `buildDayDrafts`' date filter with no review — fail-close it.
- **D1 structured-first:** classify refund/void from `data.refund`/`data.voided` (already in the reducer);
  regex only as fallback/observability.
- **D3 elevated:** the all-defaults settings fallback is multi-tenant-UNSAFE (a 2nd shop silently inherits
  PA tax/tz) — enforce a settings row at onboarding before any 2nd shop connects.
- **Reducer first-vs-latest:** amount/`applicationFee` take the FIRST non-null event; confirm Tekmetric
  payments are immutable, else switch to latest-wins so an amended fee isn't stale.
- **Nice-to-have:** surface reducer event/payment counts in `NightlyShopResult`; fix the stale "nightly cron
  calls reduceShopPaymentState" header when A1 lands; COA refresh BEFORE reconcile if added to nightly.
