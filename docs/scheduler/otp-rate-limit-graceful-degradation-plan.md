# OTP rate limit — raise to 15/hour + graceful degradation

**Feature:** `otp-rate-limit-and-graceful-degradation` · started 2026-07-17
**Author:** Claude (main loop) for Chris
**Status:** plan

## Problem (reported by Chris, 2026-07-17)

1. The OTP per-phone send limit (**3/hour**) is too tight — a single legitimate
   multi-account session can burn 2–3 sends (phone step + account-select each
   send a code), so a real customer can hit it on their first attempt. During
   testing it trips constantly.
2. **Hitting the limit breaks the rest of the workflow.** Two dead-end paths:
   - **App-layer `rate_limited_phone`** (`checkPhoneRateLimit`, `OTP_PHONE_MAX=3`)
     at `submit-phone-name` / `submit-multi-account-choice` / `resend-otp` →
     returns `{ok:false, error:"rate_limited_phone"}` → the generic
     `SubmitFailedBanner` ("Something didn't go through — tap to try again") →
     an un-winnable **retry loop** until the hour rolls off.
   - **Edge-layer `rate_limited`** (`sendOtp`, `MAX_ACTIVE_CODES_PER_HOUR=3` in
     `_shared/tools/scheduler-otp.ts`) → callers **escalate the session**
     (`status='escalated'`, `nextStep='escalated'`) → terminal "call us" card →
     booking is dead even though the block is temporary.

Both are confirmed by live evidence: Sentry `surface:scheduler-app-client`
warnings (`submitPhoneNameV2 / submitMultiAccountChoiceV2 returned !ok`), the
`rate_limit_buckets` table showing 3/3 for the test phone, and two console
captures (`[wizard] … failed: rate_limited_phone`).

## Enforcement points (both must change together)

| Layer | File | Constant | 3 → |
|---|---|---|---|
| App (Server Actions) | `scheduler-app/src/lib/security/rate-limit.ts` | `OTP_PHONE_MAX` | **15** |
| Edge (OTP send) | `supabase/functions/_shared/tools/scheduler-otp.ts` | `MAX_ACTIVE_CODES_PER_HOUR` | **15** |

Leave `MAX_ATTEMPTS_PER_CODE = 3` (wrong-guesses-per-code) untouched — different concern.

## Plan

### Fix 1 — raise to 15/hour (ship first; fast unblock)
- Bump both constants to `15` and update their comments/docstrings.
- Update tests that assert the old value.
- Deploy: scheduler-app (Vercel, push to `main`) + edge fns that import `sendOtp`
  (`scheduler-otp-direct`, `scheduler-step2-direct`).

### Fix 2 — graceful degradation (a rate-limit is a soft speed-bump, not a dead-end)
- Thread `retry_after_seconds` through `RateLimitOutcome` /
  `checkPhoneRateLimit` (currently discarded) so the UI can say "try again in
  ~N min."
- When rate-limited, **do not escalate to a terminal state**. Keep the customer
  on the phone/otp step with a clear, honest message
  ("You've requested several codes recently — you can try again in ~N minutes,
  or call us at (610) 253-6565") and let them retry after the window.
- Replace the generic `rate_limited_phone` → banner path with the same specific
  "wait N min" message (no un-winnable retry loop).
- Touch points: `rate-limit.ts`, `submit-phone-name.ts`,
  `submit-multi-account-choice.ts`, `resend-otp.ts`, and the
  `WizardSurface` failure surface. TDD each.

### Related (verify live, then decide scope)
- **Start over → auto re-OTP → vehicle picker → pick fails.** `submitStartOverV2`
  correctly wipes the row to `greeting` (incl. `customer_id=null`), so the
  observed "lands on vehicle picker" is most likely a **stale-cache read after
  the wipe** (the `hydrate-session.ts` `revalidateTag`-deferred-during-render
  hazard), and the subsequent pick fails on `customer_id=null`
  (`submitVehiclePickV2` → `session_missing_customer_id`). **Co-debug live with
  DevTools to confirm before fixing** — may be folded into Fix 2 or split out.

## Verify
- `npm run typecheck`, vitest (rate-limit + the 3 actions), `npm run build`.
- `/code-review` gate.
- Live: with the limit at 15, walk the returning-customer flow; force a rate
  limit and confirm the session stays usable + shows the "try again in N min"
  message instead of escalating / looping.

## Deploy
- scheduler-app: `git push origin main` → Vercel (confirm READY).
- edge: `supabase functions deploy scheduler-otp-direct` +
  `supabase functions deploy scheduler-step2-direct --project-ref itzdasxobllfiuolmbxu`.
