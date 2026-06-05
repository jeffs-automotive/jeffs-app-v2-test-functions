# Accounting Link (Tekmetric → QuickBooks) — Research & Findings

> **Status:** Research / pre-build. No code written yet.
> **Date:** 2026-05-28
> **Goal:** Build an in-house replacement for "Accounting Link by Back Office" — a
> Tekmetric → QuickBooks Online financial sync — that fixes the gaps in the
> commercial product and can run hands-off with an automated reconciliation check.
> **Target accounting system:** QuickBooks **Online** (confirmed with Chris).

---

## Table of contents

1. [What "Accounting Link by Back Office" is](#1-what-accounting-link-by-back-office-is)
2. [The drawbacks we're fixing + our goals](#2-the-drawbacks-were-fixing--our-goals)
3. [Existing infrastructure in this sandbox](#3-existing-infrastructure-in-this-sandbox)
4. [Empirical findings from real production data](#4-empirical-findings-from-real-production-data)
5. [Locked decisions](#5-locked-decisions)
6. [Open design questions](#6-open-design-questions)
7. [Next steps](#7-next-steps)
8. [Sources & data provenance](#8-sources--data-provenance)

---

## 1. What "Accounting Link by Back Office" is

The Back Office (TBO) sells accounting bridges for auto shops. "Accounting Link" is
middleware that takes financial activity out of Tekmetric and writes the matching
transactions into accounting software so the bookkeeper never double-enters. It is a
**one-way sync: Tekmetric → QuickBooks**. Two products: *Accounting Link Online*
(QuickBooks Online, Sage Intacct, NetSuite) and *Accounting Link Desktop* (QuickBooks
Desktop).

**What it moves** (per Tekmetric's support docs):

| Tekmetric event | What it sends to QuickBooks |
|---|---|
| Customer payment on an RO or A/R | Payment received → lands in the **Deposits** window |
| RO sent to A/R | Creates an **A/R charge** (customer owes) |
| A/R later paid | Clears the A/R charge **and** posts the payment to Deposits |
| Sublet (when RO is posted) | Through **Accounts Payable** — amount, RO #, check # |
| Parts PO marked received | Sent when the PO is received |
| Return order (marked complete) | Sent to Accounting Link |

**How it posts:** configurable **individual vs. summarized** entries; data flows into
Accounting Link first with a **validate-before-send** review step (plus an "Auto
Approve" toggle). Features: Auto Approve, Audit Trail, multi-location, end-of-day
warning emails.

---

## 2. The drawbacks we're fixing + our goals

Chris's pain points with the commercial product (the requirements for ours):

1. **Fee mapping is not fully customizable.** Accounting Link maps only *certain*
   fees; the rest dump into one chart-of-accounts bucket. **We want every fee
   (including ones added later in Tekmetric) to be mapped to a QBO account of our
   choosing.**
2. **No notification of post-hoc changes.** ROs sometimes get reopened from A/R (to
   add a coupon before payment) or a posted RO gets reopened for a refund/edit. The
   office manager isn't told, so she finds out only when QBO doesn't reconcile. **We
   want an automatic email when an already-posted/A/R RO is unposted then reposted
   with a changed total or date.**
3. **No correct handling of non-cash "payments."** Internal work (shop vehicles, the
   in-house tire protection plan) is run through Tekmetric and "paid" with a non-cash
   payment type. Accounting Link dumps everything into **Undeposited Funds**, forcing
   the office manager to create a **zero-dollar bank deposit with a negative line to an
   expense account** — a "ghost transaction" that never reconciles. **We want these
   booked straight to the right expense/contra account, no ghost deposits.**

Overarching goals: **run hands-off** with minimal human touch, and a **reconciliation
check before posting** — deterministic math as the authoritative gate, with an
optional **LLM second pass** for fuzzy anomalies, escalating to a human only when it
can't safely auto-post.

---

## 3. Existing infrastructure in this sandbox

Verified by inspecting the test Supabase project (`itzdasxobllfiuolmbxu`) on 2026-05-28.

- **`keytag_webhook_events`** — this is the **RO + payment firehose**. Tekmetric's
  keytag webhook URL receives the RO-lifecycle and payment events and stores the full
  payload in `raw_body` (jsonb). **This is the event stream the accounting link needs.**
- **`tekmetric_webhook_events`** — a *separate* general firehose wired to the
  **scheduler's** appointment/customer events only (no ROs, no payments). Not relevant
  to accounting.
- **Shared helpers** in `supabase/functions/_shared/`: `tekmetric.ts` /
  `tekmetric-client.ts` (API client), `oauth.ts`, `sentry-edge.ts`,
  `log-edge-error.ts`, and the **manual-review** system (`manual-review.ts`,
  `manual-review-email.ts`, `tools/manual-review-tools.ts`) — a proven async
  "anomaly → 6-char code + email → human resolves" pattern we should **reuse** for the
  reconciliation-escalation path.
- **Established webhook pattern** to mirror (`tekmetric-webhook/index.ts`): validate a
  `?token=` query param (Tekmetric can't send custom headers), parse body, redact
  secrets, classify event, extract IDs, insert, **return 200 unconditionally** so
  Tekmetric doesn't retry-storm.
- **QBO Online** reference bundle at `Plan/references/QBO/` (read-only) + a live QBO
  connection. CloudEvents v1.0 webhooks are now mandatory (since 2026-05-15).

### Tekmetric webhook transport facts (affect intake design)
- Auth = shared-secret **`?token=`** in the URL. **No HMAC, no signature.**
- **No idempotency key** and **delivery order is not guaranteed** (out-of-order seen).
- **Multiple webhook destinations are supported** (keytag URL + scheduler URL already
  run in parallel) — so a dedicated accounting URL is feasible, or we consume from
  `keytag_webhook_events`.
- The **same RO appears multiple times** (created → status updated → posted …), each
  carrying the full payload. The sync must act on the **posted / A/R** snapshot and
  de-dupe.
- **Payments are webhook-only** — Tekmetric has *no* REST endpoint for payments. The
  webhook is the only way to ever see a payment.
- All money is **integer cents**.

---

## 4. Empirical findings from real production data

Source: `keytag_webhook_events`, **3,885 real Jeff's Automotive RO/payment events**,
2026-05-09 → 2026-05-28. 3,473 carried a full `jobs[]` array; **608 had a discount**.

### 4.1 Event mix (the accounting-relevant stream)

| event_kind | count | note |
|---|---|---|
| ro_status_updated | 2,081 | |
| ro_work_approved | 890 | customer approved/declined jobs |
| payment_made | 405 | `payment_id` populated; the centerpiece |
| ro_posted | 358 | invoice finalized |
| ro_sent_to_ar | 137 | moved to A/R |
| unknown | 16 | **includes refunds (3) and voids (4)** — need their own classifier |

⚠️ **Zero `unposted` events appeared in this 19-day window.** The unpost/repost flow is
the trigger for drawback #2's change-email. The event exists in Tekmetric's catalog
(`Repair Order #{N} unposted by {email}`) but we have **not** captured one — we must
confirm unposts are actually delivered to our webhook before relying on them.

### 4.2 The reconciliation formula (verified)

On every RO: **`partsSales + laborSales + feeTotal − discountTotal + taxes = totalSales`**.
`partsSales`/`laborSales`/`feeTotal` are **GROSS** (pre-discount); `discountTotal` is a
single lump. Example RO 152805: $53.86 + $64.94 + $11.88 − $25.00 + $6.34 = **$112.02** ✓.

### 4.3 Deducing the discount split — tested and resolved

Chris's hypothesis (sum line items, subtract from RO totals to find the parts-vs-labor
discount split) **does not work**, for two data-proven reasons:

1. **RO category totals are already gross**, so for a fully-authorized RO the line-item
   sum equals the total and the subtraction yields zero.
2. **`jobs[]` includes declined estimate work.** Summing line items overcounts wildly.
   Starkest case, **RO 152351**: billed parts **$46.95** vs. summed parts line items
   **$1,114.61**; billed labor **$114.76** vs. **$1,727.71**. The customer approved ~$47;
   the rest is declined estimate lines still in the payload.

**Also, discount names carry no category signal.** The real discounts are almost all
blanket **RO-level** promos/loyalty (`Rewards`, `AAA Discount`, `Friends/Family`, coupon
codes). The *only* category-tagged discounts are two job-level
`Package Price Adjustment on Parts` / `…on Labor` (from package-priced canned jobs).

**Solution (the approach we'll use): pro-rata allocation on clean RO totals.** Ignore
line items entirely (they're contaminated by declined work). Split `discountTotal`
across parts/labor/fees by their **gross share**, using a largest-remainder rounding
rule so the pennies tie out exactly. This reconciles to `totalSales` **by construction**.

> Worked example, RO 152805 ($25.00 discount over $130.68 gross): parts −$10.30, labor
> −$12.42, fee −$2.28 → net income lines $43.56 / $52.52 / $9.60, +$6.34 tax = **$112.02** ✓.

Pass-through the two `Package Price Adjustment` job discounts as already-categorized.
Edge case: if gross base is 0 but a discount exists, handle explicitly (don't divide by
zero) — e.g. fully-comped $0 ROs (RO 152874: discount $100.97 == parts+labor, total $0).

### 4.4 Real discount catalog (608 discounted ROs)

| Discount name | Level | Occurrences | ~Total |
|---|---|---|---|
| Rewards | RO | 295 | $11,212 |
| AAA Discount | RO | 149 | $5,825 |
| Friends/Family Discount | RO | 21 | $5,018 |
| $25 off $100 or more | RO | 50 | $1,250 |
| AAA Free Inspection w/Paid Emission | RO | 42 | $1,132 |
| $75 Off $750 or more | RO | 14 | $1,050 |
| Kleentec | RO | 16 | $419 |
| Package Price Adjustment on Parts | **job** | 15 | $374 |
| Package Price Adjustment on Labor | **job** | 15 | $174 |
| Fleet Company / $15 off State&Emission / Shop / FMC / Military Veteran / AI | RO | <15 each | small |

### 4.5 Real fee catalog (drives the customizable fee→account mapping)

~9 distinct fees. Same fee can appear at RO and job level (map by **name**, both levels).

| Fee name | ~Total seen |
|---|---|
| Shop supplies | $46,167 |
| Hazmat/Oil Disposal Fee | $15,061 |
| Equipment Maintenance | $10,069 |
| **TIRE PROTECTION PLAN** | $7,150 |
| Tire disposal | $4,604 |
| State Communication Fee | $2,990 |
| Storage Fees | $1,040 |
| 5 PACK DISPOSAL FEE | $997 |
| Shipping | $298 |

**Gotchas:** fee/discount names have inconsistent casing and **trailing spaces**
(`"AAA Discount "`, `"Military Veteran "`) → the mapping key must **trim + match
case-insensitively**.

⚠️ **The "TIRE PROTECTION PLAN" appears as a *fee* (revenue line), not (here) as the
non-cash *payment* Chris described.** So that flow has two sides — the fee that gets
billed, and the non-cash "payment" that covers it. The non-cash treatment must be
designed deliberately (don't assume).

---

## 5. Locked decisions

- **QuickBooks Online** is the target (not Desktop).
- **Discounts: net into each income line via a LABOR → PARTS → SUBLET → FEE waterfall**
  (fill labor first, overflow to parts, etc.). **CORRECTED 2026-06-03** from live
  Accounting-Link QBO journal-entry analysis (50 posting days): the real books debit a
  "Labor Discount" (Sales-Labor) every day with a smaller overflow to Sales-Parts, and
  never reach sublet/fees. The earlier **pro-rata hypothesis (Section 4.3) was wrong.**
  We post income **NET** and do **not** track a discount account/line in QBO (per Chris).
  See `accounting-link-plan.md` §6.
- Build inside the **test sandbox only**. `dotfiles-v2` and prod `jeffs-app-v2` are
  reference-only.

---

## 6. Open design questions

1. **Intake topology:** dedicated new `accounting-link` webhook URL + table, vs. consume
   RO/payment events from the existing `keytag_webhook_events`.
2. **Non-cash payment flow** (shop vehicles, tire protection plan): which Tekmetric
   payment types/customers are "non-cash," the QBO target expense/contra account for
   each, and whether revenue is recognized or just expensed. Needs office-manager input.
3. **QBO posting model:** Sales Receipt (paid) vs. Invoice + Payment (A/R); per-RO detail
   vs. summarized daily entries; how the deposit-to account is set to avoid Undeposited
   Funds for non-cash.
4. **Fee → account mapping table:** seed from Section 4.5; define the QBO account/item
   per fee + an "unmapped fee detected" alert.
5. **Unpost delivery:** confirm Tekmetric actually delivers `unposted` events to our
   webhook (none seen in the sample) — gates drawback #2's change-email.
6. **Reconciliation gate:** exact deterministic checks; where the LLM second-pass sits;
   reuse the manual-review (6-char code + email) pattern for escalations.

---

## 7. Next steps

- **Leaning:** build the intake first — a dedicated `accounting-link` webhook receiver +
  table (mirroring the `keytag_webhook_events` pattern: token auth, redact, classify
  incl. refund/void, store raw, de-dupe, return 200). It unblocks everything downstream
  and can land before every parsing detail is locked.
- Then design the parse/map layer: discount pro-rata, fee→account mapping, non-cash
  handling, and the QBO posting model.
- Then the reconciliation gate + change-email.

---

## 8. Sources & data provenance

**Empirical** (this doc's tables in §4): live query of `keytag_webhook_events` in the
test Supabase project `itzdasxobllfiuolmbxu`, 2026-05-28. Real Jeff's Automotive
production webhook traffic (shop 7476), 2026-05-09 → 2026-05-28.

**Tekmetric API/webhook facts:** `Plan/references/Tekmetric/` reference bundle
(read-only) — `05-webhooks.md`, `06-core-entities-reference.md`,
`08-known-tekmetric-behaviors.md`.

**QuickBooks Online facts:** `Plan/references/QBO/` reference bundle (read-only).

**Product (Accounting Link):**
- https://support.tekmetric.com/hc/en-us/articles/360036630693-BACK-OFFICE-Accounting-Link-Integration
- https://support.tekmetric.com/hc/en-us/articles/360051828434-Accounting-Link-and-Tekmetric-Integration-FAQs
- https://www.tekmetricbackoffice.com/online
- https://www.tekmetricbackoffice.com/products
