# Keytag manual-review AUTO-RESOLUTION — design

> Status: **design / proposal** (no code yet). Answers Chris's question: *"Can any of the manual reviews
> auto-resolve when they're fixed — e.g. the A/R regression auto-resolving when the RO is posted again?"*
> Research basis: workflow `wf_4ad2c29d-72c` (investigate → synthesize → adversarial verify against the
> live DB + webhook source). The verify step **falsified** parts of the first-pass design — those
> corrections are folded in below.

---

## 1. The governing safety principle

There are two very different things, and only one is safe:

- **Auto-RESOLVE** — close a review whose anomaly has *cleared on its own* (the missing payment arrived, a
  later write re-synced Tekmetric). It sets `resolved_at` + writes an audit row and changes **zero** key-tag
  state. **Safe.**
- **Auto-FIX** — take a tag mutation (release/assign/force-assign/revert/mark-posted) automatically. This is
  exactly what the manual-review system was *built to prevent* — auto-fixing caused the wrongful-release
  incidents. **Never do this from the auto path.**

The decisive test per category: *"Could a system event ever answer the question this review actually asks?"*
- ORP asks *"are the keys gone?"* → `POSTED_PAID` is ground truth → **answerable**.
- PAF asks *"is our DB ↔ Tekmetric synced?"* → a successful PATCH is ground truth → **answerable** (with a caveat, §3).
- DRF / REG / ARN all ask *"what physical tag is on these keys?"* → **no event observes the physical keys** → **not answerable** → must stay open for a human.

When in doubt, **leave it open**: a stale-but-open review costs a human a glance; a wrongly auto-closed
review re-creates the wrongful-release class of incident and is then permanently dedup-suppressed.

## 2. Per-category verdict (after the adversarial verify)

| Code | Category | Auto-resolve? | Signal / why |
|---|---|---|---|
| **ORP** | orphan_release | ✅ **Yes** (close-as-moot only) | Close when the tag's RO is already `available` — released by the legitimate payment/posted path. **Never** perform the `release` mutation from the auto path; only close a review the world already resolved. |
| **PAF** | tekmetric_patch_fail | ⚠️ **Not yet** | Conceptually clean (close when the Tekmetric keyTag matches our DB), **but the verify proved the nominated signal never fires** — see §3. Needs a small new mechanism first. |
| **DRF** | work_approved_drift | ❌ No | No event observes the physical tag. The only thing that would "clear" it is an auto-assign — itself the forbidden auto-fix. Human-only. |
| **REG** | ar_regression | ❌ No | **Chris's example, and the canonical trap:** re-posting the RO does **not** restore the already-released tag (`mark_keytag_posted` is a no-op with no held tag), so the keys stay untracked. The most tempting signal (re-post) is exactly the one that does *not* fix the condition. Human-only. |
| **ARN** | ar_no_prior_tag | ❌ No (on safety) | No event observes whether the A/R keys carry a tag. *(See §5 — resolving an ARN **does** quiet the daily digest, contrary to the first-pass claim; that's a real lever if the goal is the digest, but the physical-keys exclusion still stands.)* |

**Ground truth that drove this:** the first-pass design claimed the webhook-lifecycle query leaves "2 genuine
untagged-WIP" rows. The verify pulled the live audit log and showed those 2 (RO 152665 / 152455) are both
**POSTED_PAID and released** — resurrected by a stale `status_updated` arriving 0.9–11.3 s after the release.
Of the 10 rows that query returns: **6 are closed/paid-out, 4 are open-DRF, 0 are genuine-no-review.** So the
only legitimately-actionable untagged set is the open DRF/REG reviews — which is why the **REG re-post trap is
the headline**, and why a fragile webhook-lifecycle inference is the wrong basis for any of this.

## 3. The PAF caveat (why it's "not yet")

The intended PAF signal was *"`keytags.tekmetric_patch_ok` flips to true after a later successful PATCH."*
The verify proved this **never happens** for a PAF'd RO: `record_keytag_patched(true)` is only called in the
**fresh-assign** branch, and a PAF'd RO already has a tag, so the next webhook short-circuits at
`getAssignedKeytag → skipped_already_assigned` and the nightly reconcile routes to Branch B (which re-patches
Tekmetric but **never calls `record_keytag_patched`**). So `tekmetric_patch_ok` is never re-set to true →
the auto-resolver would close nothing.

**To enable PAF auto-resolve later:** add a step that, for an already-tagged RO whose Tekmetric keyTag now
matches our DB, calls `record_keytag_patched(true)` **and then** auto-resolves. Do **not** wire the resolver
to Branch B's in-memory `patch.ok` — that would close on a result the DB row doesn't reflect.

## 4. Mechanism (for the recommended ORP-only scope)

**Close-without-mutation — a new RPC, not the human path.** Do *not* drive `resolve_manual_review` from a
system caller: its `p_choice`-must-be-in-`options[]` check has no universal "cleared" key, and its
`user_label` / lockout / attempt-insert guards are built for advisors and would pollute
`keytag_manual_review_attempts`.

- **NEW migration** — `auto_resolve_manual_review(p_code, p_reason, p_cleared_signal)`: `SECURITY DEFINER`,
  `SET search_path = public`, `FOR UPDATE` + the existing `already_resolved` guard; sets `resolved_at=now()`,
  `resolved_by_user_label='system:auto'`, `resolved_choice='auto_cleared'` (a synthetic key not required to
  exist in `options[]`), `resolution_notes=p_reason`. **No** attempts insert, **no** lockout. `REVOKE` from
  public/anon/authenticated, `GRANT` to `service_role` only.
- **NEW shared helper** `_shared/keytag-auto-resolve.ts` — `autoResolveOnClearedCondition(sb, roId)`: finds an
  open ORP for `ro_id` (reuse the dedup query shape), calls the RPC, then writes a `keytag_audit_log`
  `action='manual_review_resolved'`, `source='system:auto'` row (already an allowed CHECK value) +
  `attach_resolution_audit_log` — mirroring the human resolution shape. This is the **safe half** of the
  existing no-op dispatch branches with the tag-mutation removed.
- **Hook points (ORP):**
  - **Real-time:** in `keytag-tekmetric-webhook`, after `release_keytag_for_ro` succeeds in the `payment_made`
    full-pay branch and the `ro_posted` statusId=5 branch → if `keytags.status` for that `ro_id` is now
    `available`, auto-close any open ORP.
  - **Backstop (CORRECTED by verify):** the nightly reconcile — but the hook belongs in the **forward Branch B**
    (`reconcile.ts`) + the reverse WIP/AR fallbacks, **not** the reverse pass (the reverse pass only iterates
    *in-use* tags; a reappeared/re-tagged RO is processed by the forward pass). Close as moot only when the
    keytags row is `available` — **not** on RO-reappearance alone.

## 5. Open questions for Chris

1. **Scope:** ship **ORP-only** auto-resolve now (the one clean win), and treat **PAF** as a fast-follow once
   the re-patch-and-record step (§3) exists? *(Recommended.)*
2. **ARN + the digest:** the first-pass design wrongly said resolving an ARN wouldn't quiet the 7 AM "Repair
   Orders Without Key Tags" table — it **would** (`fetchRosWithoutKeytags` reads unresolved ARN reviews
   directly). So if your goal is *quieting that table*, resolving ARN achieves it — but it also buries the
   "what's on the keys?" question. **Which do you want?** (The safety exclusion for ARN stands on the
   physical-keys argument either way.)
3. **Dedup permanence:** auto-closing sets `resolved_at`, which the issuance dedup gate treats as **permanent**
   — that `(ro_id, category)` will never re-issue. Fine for ORP (re-orphaning re-enters the reverse pass with
   fresh state). Acceptable, or do you want auto-closed reviews to remain re-issuable on recurrence?
4. **Visibility:** auto-resolved reviews silent, or noted in the next daily report ("N reviews auto-cleared")?

## 6. Effort

ORP-only: **small** (~1.5–2 days). One additive RPC (+ pgTAP), the `keytag-auto-resolve.ts` helper, the
webhook hook (2 call sites) + the reconcile Branch-B backstop, and tests proving the resolver **never mutates
a tag** and **never touches DRF/REG/ARN**. PAF is a separate fast-follow gated on §3. DRF/REG/ARN are
deliberately out of scope (the physical-keys exclusion is the whole point).

## 7. What this is NOT

Not auto-FIX. The resolver only ever sets `resolved_at` + writes an audit row; it never calls
release/assign/force-assign/revert/mark-posted. And it is **not** sourced from raw webhook-lifecycle
inference — that surfaces paid-out ROs (the same finding that reshaped the live-board's "untagged" source).
