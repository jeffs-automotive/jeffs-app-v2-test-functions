# Playwright E2E — scheduler-app wizard

## Specs

| Spec | Purpose | Runs in CI? | Env requirements |
|---|---|---|---|
| `wizard-smoke.spec.ts` | Wizard loads + greeting renders + no client errors | Yes | `PLAYWRIGHT_BASE_URL` |
| `wizard-happy-path.spec.ts` | Full returning customer → brake LLM recommendation → confirmation (Tekmetric POST bypassed) | Opt-in | `PLAYWRIGHT_BASE_URL` + `PLAYWRIGHT_TEST_PHONE_E164` + bypasses configured |
| `wizard-diagnostic-llm.spec.ts` | 4 distinct concern categories → LLM routes to expected service (brake, AC, exhaust, check-engine) | Opt-in | Same |
| `wizard-routine-services.spec.ts` | Routine service picker — single + multi-select paths | Opt-in | Same |
| `wizard-edits-from-summary.spec.ts` | Edit-date-from-summary bounce + confirm-directly paths | Opt-in | Same |
| `wizard-start-over.spec.ts` | Footer Start Over wipes state + returns to greeting | Opt-in | Same |
| `wizard-availability.spec.ts` | Date picker offers ≥1 date AND excludes Sundays | Opt-in | Same |

## Quick start

```bash
cd scheduler-app
npx playwright install chromium       # one-time install

# Smoke only (fast — ~30s)
npm run test:e2e -- wizard-smoke

# Full opt-in suite (needs both bypasses configured on the target deploy)
PLAYWRIGHT_TEST_PHONE_E164=+15555550100 \
PLAYWRIGHT_TEST_OTP_CODE=999999 \
PLAYWRIGHT_BASE_URL=https://jeffs-app-v2-test-functions.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=<from Vercel> \
npm run test:e2e
```

## Two bypasses, both env-gated by the same phone number

The test suite requires TWO complementary bypasses, both keyed on
`SCHEDULER_TEST_PHONE_E164` being set to the same E.164 phone on the
target deploy:

### 1. OTP send bypass (Supabase edge fn)

Wired in `supabase/functions/_shared/tools/scheduler-otp.ts` line 285+.
When the customer enters the test phone:

- The `otp_codes` row is inserted with `hash(SCHEDULER_TEST_OTP_CODE)`
- Telnyx SMS send is SKIPPED entirely
- `verifyOtp(SCHEDULER_TEST_OTP_CODE)` succeeds normally

Operator setup:
```
# Supabase Dashboard → Project Settings → Edge Functions → Secrets
SCHEDULER_TEST_PHONE_E164  = +15555550100
SCHEDULER_TEST_OTP_CODE    = 999999
```

### 2. Tekmetric POST bypass (Vercel Server Action) — NEW 2026-05-25

Added 2026-05-25 to `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts`.
When the session row's `phone_e164` matches `SCHEDULER_TEST_PHONE_E164`
on the Vercel runtime:

- `confirmBooking` edge fn call is SKIPPED entirely
- Synthetic confirmation: `appointment_id = null`, `appointment_confirmed_at = now()`, `appointment_verification_status = "confirmed"`
- Hold is released (slot becomes available again in our DB; Tekmetric was never touched)
- Customer advances to `customer_notes` with a 🧪 [TEST MODE] bubble

Operator setup:
```
# Vercel Dashboard → scheduler-app → Settings → Environment Variables
SCHEDULER_TEST_PHONE_E164  = +15555550100   # SAME value as Supabase secret
# (Production + Preview both — leave Development unchecked unless local
#  dev should also use the bypass.)
```

**Both must be set on the same deploy** for the full happy-path suite
to pass. If only the OTP half is set, the wizard advances through OTP
but `submit-summary` will hit Tekmetric for real → creates a test
appointment in the calendar.

### Safety: never set on prod

`SCHEDULER_TEST_PHONE_E164` MUST be unset on production deploys.

The bypass code defaults to "no bypass" when the env var is missing or
empty. There's no in-code production gate (the env var IS the gate) so
the only safety is operator discipline: never set this on
`appointments.jeffsautomotive.com`.

## Running against environments

### Local dev (with both bypasses on local Supabase)
```bash
SCHEDULER_TEST_PHONE_E164=+15555550100 SCHEDULER_TEST_OTP_CODE=999999 npm run dev
# in another terminal:
PLAYWRIGHT_TEST_PHONE_E164=+15555550100 PLAYWRIGHT_TEST_OTP_CODE=999999 \
  npm run test:e2e
```

### Test sandbox (Vercel preview / staging)
```bash
PLAYWRIGHT_BASE_URL=https://jeffs-app-v2-test-functions.vercel.app \
PLAYWRIGHT_TEST_PHONE_E164=+15555550100 \
PLAYWRIGHT_TEST_OTP_CODE=999999 \
VERCEL_AUTOMATION_BYPASS_SECRET=<from Vercel> \
npm run test:e2e
```

### Production (smoke only — never the full suite)
```bash
PLAYWRIGHT_BASE_URL=https://appointments.jeffsautomotive.com \
npm run test:e2e -- wizard-smoke
```

The full suite auto-skips when `PLAYWRIGHT_TEST_PHONE_E164` is unset
(which it should be when targeting prod).

## Skipping the suite

- `SKIP_PLAYWRIGHT_E2E=1` — explicit opt-out of all opt-in specs
- `PLAYWRIGHT_TEST_PHONE_E164` unset — auto-skips the bypass-requiring specs

## What each opt-in spec verifies

### `wizard-happy-path` (1 test, ~120s)
- Full happy path through brake_inspection LLM recommendation
- Confirms wizard reaches `customer_notes` via the Tekmetric bypass

### `wizard-diagnostic-llm` (4 tests, ~60-120s each)
- Brake concern → brake_inspection
- AC concern → AC-related service
- Exhaust concern → exhaust_service
- Check-engine concern → check-engine / diagnostic service

Asserts the LLM correctly maps concerns to service categories via
keyword pattern matching (LLM outputs are non-deterministic — exact
string match would flake).

### `wizard-routine-services` (2 tests, ~30-60s each)
- Single routine service (oil change)
- Multi-routine (oil change + tire rotation)

Skips the LLM diagnostic round-trip entirely.

### `wizard-edits-from-summary` (2 tests, ~60-120s each)
- Edit date from summary → bounces back to date_pick → returns to summary
- Confirm directly from summary (no edits)

### `wizard-start-over` (1 test, ~30s)
- Footer Start Over wipes session state + returns to greeting

### `wizard-availability` (1 test, ~30s)
- Date picker offers ≥1 enabled date
- No Sunday dates appear as enabled (closed_dates seed)

## Common failure modes

- **Both bypasses not set on the same deploy** — happy-path tests advance
  to summary but confirmation hits real Tekmetric → test fails AND a
  test appointment lands in the shop calendar. Set both env vars before
  running.
- **LLM timeout (>90s)** — Stage 1+2+3 normally takes 8-30s but cold
  starts on AI Gateway can push past 90s. The diagnostic-llm spec sets
  90s waits already; bump if your environment is consistently slower.
- **Vehicle picker selector mismatch** — wizard auto-advances for
  single-vehicle returning customers. The spec uses `isVisible({ timeout: 5000 })`
  fallback to handle both shapes — no action needed unless tests start
  failing on the vehicle step.
- **Test customer has no vehicle on file** — seed a vehicle via
  Tekmetric for the test phone before first run.

## Adding a new spec

Use the helpers in `e2e/helpers/wizard.ts` instead of duplicating
greeting/phone/OTP/vehicle selectors. Pattern:

```typescript
import { test } from "@playwright/test";
import {
  SKIP_IF_NO_TEST_PHONE,
  SKIP_REASON_IF_NO_TEST_PHONE,
  progressToSummary,
  confirmAndExpectTestBypass,
} from "./helpers/wizard";

test.describe("my new flow", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("does the thing", async ({ page }) => {
    await page.goto("/");
    await progressToSummary(page, { /* opts */ });
    // ... assertions specific to your flow ...
    await confirmAndExpectTestBypass(page);
  });
});
```
