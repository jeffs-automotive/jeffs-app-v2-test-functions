# Playwright E2E — scheduler-app wizard

Two suites:

| Spec | Purpose | Runs in CI? | Env requirements |
|---|---|---|---|
| `wizard-smoke.spec.ts` | Validates `/book` loads + greeting card renders + no client errors | Yes | `PLAYWRIGHT_BASE_URL` |
| `wizard-happy-path.spec.ts` | Full returning-customer booking flow → brake_inspection recommendation → confirmation | Opt-in only | `PLAYWRIGHT_BASE_URL` + `PLAYWRIGHT_TEST_PHONE_E164` + Supabase OTP-bypass env on the target project |

## Running locally

```bash
# Install the chromium binary once
cd scheduler-app
npx playwright install chromium

# Smoke only (fast — boots local dev server, ~30s)
npm run test:e2e -- wizard-smoke

# Full happy-path (needs Supabase OTP bypass configured)
PLAYWRIGHT_TEST_PHONE_E164=+15555550100 \
PLAYWRIGHT_TEST_OTP_CODE=999999 \
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
npm run test:e2e -- wizard-happy-path
```

## Running against a Vercel preview

```bash
PLAYWRIGHT_BASE_URL=https://scheduler-app-<sha>.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=<from Vercel> \
npm run test:e2e -- wizard-smoke
```

## Running against prod (caution — uses real Tekmetric + real DB)

```bash
PLAYWRIGHT_BASE_URL=https://appointments.jeffsautomotive.com \
npm run test:e2e -- wizard-smoke
```

The happy-path spec is auto-skipped against prod unless you set
`PLAYWRIGHT_TEST_PHONE_E164` to a phone number that the prod Supabase
project's edge functions recognize as the OTP-bypass phone. This is by
design — you don't want a Playwright run to create fake appointments in
prod data.

## OTP bypass — how it works

Edge function `_shared/tools/scheduler-otp.ts` checks two env vars:

- `SCHEDULER_TEST_PHONE_E164` — exact E.164 phone (e.g. `+15555550100`)
- `SCHEDULER_TEST_OTP_CODE` — 6-digit static code (e.g. `999999`)

When the customer-facing wizard sends an OTP to a phone matching
`SCHEDULER_TEST_PHONE_E164`, the edge function:

1. Inserts the otp_codes row with `code_hash = sha256(salt, TEST_OTP_CODE)`
2. SKIPS the Telnyx SMS send entirely
3. Logs `send_otp_test_bypass` to the function's stdout

So the customer in test mode immediately knows the OTP without an SMS
arriving — perfect for Playwright.

## Skipping the happy-path spec

Set `SKIP_PLAYWRIGHT_E2E=1` to skip both happy-path tests (smoke still runs).
The happy-path spec also self-skips if `PLAYWRIGHT_TEST_PHONE_E164` is unset.

## What the happy-path test verifies

1. Wizard loads at `/book`
2. Greeting card "Have you been to our shop before?" renders
3. Returning-customer flow → phone + OTP
4. Vehicle picker (auto-advances if 1 vehicle on file)
5. Service picker → "Other Issue"
6. Concern free-text → Stage 1+2+3 LLM diagnose
7. Recommendation surfaces (brake_inspection for the seed text)
8. Customer accepts → confirmation card

If any step times out or doesn't surface the expected element, the test
fails with a Playwright trace + screenshot of the last successful state.

## Common failure modes

- **OTP bypass not configured on target Supabase project** — the verify
  step times out because no real SMS arrives. Configure the env vars
  on the right project (test = `itzdasxobllfiuolmbxu`, prod =
  `lrsazdxnbtjczpvngcud`).
- **Vehicle picker selector mismatch** — wizard may auto-advance for
  single-vehicle returning customers. The spec uses `isVisible({ timeout: 5000 })`
  fallback to handle both shapes.
- **LLM timeout (>60s)** — Stage 1+2+3 normally takes 8-30s but cold
  starts on AI Gateway can push past 60s. Increase the `expect(...)`
  timeout in the diagnostic step.
- **Test customer has no vehicle on file** — seed a vehicle via
  Tekmetric for the test phone before first run.
