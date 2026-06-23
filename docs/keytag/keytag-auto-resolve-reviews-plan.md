# Keytag manual-review AUTO-RESOLUTION — design

> Status: **design / proposal** (no code yet). Originated from Chris's question — *"Can any of the manual
> reviews auto-resolve when they're fixed?"* — and sharpened by his follow-up observation that *"over half
> the items in manual review have already been closed and don't belong there anymore."* A live-DB check
> (2026-06-23) confirmed that and then some: **all 70 currently-open reviews are stale** (§0). Research
> basis: workflow `wf_4ad2c29d-72c` (investigate → synthesize → adversarial verify) + the 2026-06-23 audit.

---

## 0. The live backlog finding (2026-06-23) — this is the headline

There are **70 open reviews. Every one is moot** — its RO's tag has already been released (no RO currently
holds a tag), by an **authoritative terminal signal**, not a fragile inference:

| Category | Open | Why each is already moot (last release reason) |
|---|---:|---|
| `ar_no_prior_tag` (ARN) | 37 | `orchestrator_manual_release_ar_confirmed` — an advisor already confirmed + released the A/R keys |
| `ar_regression` (REG) | 7 | 4× `webhook:payment_made_ar_balance_paid` (A/R paid) · 3× advisor-confirmed release |
| `work_approved_drift` (DRF) | 25 | 14× `webhook:ro_posted_paid` · 10× `orchestrator_manual_release` · 1× A/R paid |
| `orphan_release` (ORP) | 1 | `orchestrator_manual_release` — advisor released |

So the review list isn't a live work queue — it's mostly a graveyard of situations that were **already
handled** (by a payment, a posting, or an advisor) where nobody clicked "resolve." That's the real problem
to fix, and it reframes the whole feature: the win isn't "auto-fix anomalies," it's **auto-close reviews
whose subject is gone.**

## 1. The governing safety principle — and the window that makes it safe

Two very different things; only one is ever safe to automate:

- **Auto-RESOLVE (close-as-moot)** — close a review whose situation has *already been settled* by the world
  (the RO got posted/paid, or an advisor released the keys). Sets `resolved_at` + writes an audit row;
  changes **zero** key-tag state. **Safe.**
- **Auto-FIX** — take a tag mutation (release/assign/force-assign/revert/mark-posted) automatically. This is
  exactly what the manual-review system exists to *prevent* — it caused the wrongful-release incidents.
  **Never from the auto path.**

**The key insight (corrected from the first pass):** a review's question — *"what tag belongs on these
keys?"* — only has meaning **while the physical keys are in the shop**, i.e. while the RO is still open
(WIP or A/R). The moment the RO terminally closes (posted-paid, or A/R paid off and the car leaves), there
are **no keys left to tag** — so the review is moot **regardless of category**. The first-pass design asked
the wrong question ("could an event re-derive the keys answer?", which is genuinely impossible for
DRF/REG/ARN) instead of the right one ("is there still anything to act on?").

When in doubt, still **leave it open** — but "the RO has terminally closed / an advisor already released it"
is not in doubt; it's the definition of done.

## 2. Per-category verdict — REVISED (mootness-on-close, all categories)

| Code | Auto-resolve on close? | Trigger (the authoritative moot signal) | Guardrail |
|---|---|---|---|
| **ORP** orphan_release | ✅ Yes | RO **confirmed** posted-paid / A-R-paid (the *confirming* event — **not** the suspicious release that raised the ORP itself). | The release is the thing under review, so don't close on the release event; close on a later posted/paid confirmation. |
| **DRF** work_approved_drift | ✅ Yes | RO posted-paid, or A/R paid, or advisor release. | — |
| **REG** ar_regression | ✅ Yes | A/R balance paid, or advisor-confirmed release. | Chris's original REG re-post example is still a **trap** for *auto-FIX* (re-posting does NOT restore the released tag) — but auto-*RESOLVE* on the RO closing is fine. |
| **ARN** ar_no_prior_tag | ✅ Yes | RO leaves A/R (paid), or advisor-confirmed release. | Resolving ARN also quiets the 7 AM "ROs Without Key Tags" digest (`fetchRosWithoutKeytags` reads open ARN) — desired here, since a closed RO shouldn't be on that list. |
| **PAF** tekmetric_patch_fail | ⚠️ Separate (not mootness) | PAF isn't about keys-in-shop; it's a DB↔Tekmetric sync mismatch. Close when a later PATCH makes Tekmetric match our DB — but its nominated signal never fires today (§3). | Keep as the one true fast-follow. |

The unifying rule for the four physical-key categories: **auto-resolve an open review the moment its RO
reaches a terminal state (posted-paid / A-R-paid) or an advisor releases its keys** — because at that point
the keys are no longer in the shop awaiting a tag decision. ORP carries the extra guardrail above.

## 3. PAF is the only genuine "not yet"

PAF asks *"is our DB ↔ Tekmetric synced?"* — answerable by a successful PATCH, not by the RO closing. But the
intended signal (`keytags.tekmetric_patch_ok` flipping true) **never fires**: `record_keytag_patched(true)`
is called only in the fresh-assign branch; a PAF'd RO already has a tag, so the next webhook short-circuits
and the nightly reconcile re-patches Tekmetric **without** calling `record_keytag_patched`. To enable PAF
later: have the re-patch path call `record_keytag_patched(true)` and then auto-resolve. (Unchanged from the
first pass.)

## 4. Mechanism

**A. One-time backlog cleanup (do first — clears the 70).**
A single guarded pass that closes every open review whose RO is confirmed moot. The gate (not "close all
blindly", so it's correct + reusable): `keytags` row for the `ro_id` is `available`/absent **AND** the RO's
last tag action is a terminal release (`webhook:ro_posted_paid` / `webhook:payment_made_ar_balance_paid` /
`orchestrator_manual_release*`). On today's data that resolves all 70; the gate protects any future row
where the keys are genuinely still held. Each close writes a `keytag_audit_log`
(`action='manual_review_resolved'`, `source='system:auto'`, reason `auto_cleared:moot_ro_closed`).

**B. The resolver RPC — a new path, not the human one.** Don't drive `resolve_manual_review` from a system
caller: its `p_choice ∈ options[]` check has no universal "cleared" key, and its `user_label` / lockout /
attempts guards are built for advisors and would pollute `keytag_manual_review_attempts`.
- **NEW migration** `auto_resolve_manual_review(p_code, p_reason, p_signal)`: `SECURITY DEFINER`,
  `SET search_path = public`, `FOR UPDATE` + `already_resolved` guard; sets `resolved_at=now()`,
  `resolved_by_user_label='system:auto'`, `resolved_choice='auto_cleared'`, `resolution_notes=p_reason`.
  No attempts insert, no lockout. `REVOKE` from public/anon/authenticated; `GRANT` to `service_role` only.
- **NEW shared helper** `_shared/keytag-auto-resolve.ts` — `autoResolveOpenReviewsForRo(sb, roId, signal)`:
  finds **all** open reviews for `ro_id` (any of the 4 physical-key categories), calls the RPC, writes the
  audit row + `attach_resolution_audit_log`. (The safe half of the existing no-op dispatch branches, with
  the tag-mutation removed.)

**C. Steady-state hooks (so the backlog never rebuilds).** Call the helper right after each **terminal
release** succeeds — these are the exact sites that produced the §0 reasons, so the hook is additive and
fires on the authoritative event (no inference):
- `keytag-tekmetric-webhook` — after `release_keytag_for_ro` succeeds in the `ro_posted` POSTED_PAID branch
  and the `payment_made` A/R-paid branch.
- the orchestrator release tools (`orchestrator_manual_release` / `..._ar_confirmed`) — after the release RPC.
- `keytag-bulk-reconcile` — backstop, in the forward pass, for any RO that closed without a webhook.
- **ORP exception:** only auto-close an ORP on a posted-paid/payment *confirmation*, never on the orphan
  release that raised it.

## 5. Open questions for Chris

1. **Backlog cleanup now?** Run the §4A pass to resolve the 70 stale reviews (recommend: I show you the exact
   list it would close first, you say go, then it runs). *(Recommended.)*
2. **Going-forward scope:** build the all-category mootness-on-close auto-resolver (§4B/C)? PAF stays a
   fast-follow.
3. **Dedup permanence:** auto-closing sets `resolved_at`, which the issuance dedup treats as **permanent** for
   that `(ro_id, category)`. Fine here (a closed RO won't recur). Keep, or allow re-issue on genuine recurrence?
4. **Visibility:** auto-resolved reviews silent, or a line in the daily report ("N reviews auto-cleared as moot")?

## 6. Effort

- **Backlog cleanup (§4A):** **tiny** — the RPC + one guarded pass; reversible-safe (only closes confirmed-moot).
  Could run today after you approve the list.
- **Going-forward (§4B/C):** **small** (~1.5–2 days) — the helper + 3–4 hook sites + pgTAP proving the resolver
  **never mutates a tag**, respects the ORP guardrail, and only fires on terminal signals. Warrants an
  adversarial verify (the first pass was wrong once).
- **PAF:** separate fast-follow, gated on §3.

## 7. What this is NOT

Not auto-FIX — the resolver only sets `resolved_at` + writes an audit row; it never calls
release/assign/force-assign/revert/mark-posted. And it does **not** fire on raw webhook-lifecycle inference —
only on authoritative terminal events (posted-paid / payment / advisor release), the same signals that
already exist in the audit log.
