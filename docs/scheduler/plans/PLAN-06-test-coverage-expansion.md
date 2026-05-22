---
plan: 06
title: Test coverage expansion + DAL refactor
audit_findings: [I-TEST-1, I-TEST-2, I-TEST-3, I-TEST-4, I-TEST-5, I-TEST-6, I-TEST-7, I-TEST-8]
research_inputs: [research-cicd-testing]
estimated_effort: 1-2 weeks
prerequisites: [Plan-01 Phase 3 (CI), Plan-01 Phase 4 (critical-path tests scaffolded)]
risk_level: low
---

# Plan 06 — Test coverage expansion + DAL refactor

> Plan 01 Phase 4 lands tests for the 4 most-critical untested surfaces (`diagnose-concern`, `run-diagnostics`, both Tekmetric webhooks, Playwright happy-path). This plan fills in the rest + does the DAL refactor that the architecture has been calling for.

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **I-TEST-1** | quality | 24 of 25 Server Actions untested | 1 |
| **I-TEST-2** | quality | IdleTimer untested (2026-05-21 event-reset fix has no regression guard) | 2 |
| **I-TEST-3** | quality | Webhook idempotency unverified by test | 3 |
| **I-TEST-4** | quality | Cron handlers untested (4 cron edge fns) | 3 |
| **I-TEST-5** | quality | The 6 "Other" subcategories routing untested | 4 |
| **I-TEST-6** | quality | No `src/lib/dal/` directory; business logic mixed into actions | 5 |
| **I-TEST-7** | quality | pgTAP files exist but no script runs them (now in CI per Plan 01) | 6 |
| **I-TEST-8** | quality | No test for `error.tsx` / `global-error.tsx` Sentry capture | 6 |

## Research summary

- **Thin Action / Fat DAL is Vercel's OFFICIAL position** (nextjs.org/docs/app/guides/data-security), not just a community heuristic. Coverage threshold should be 85-90% on DAL with Server Actions excluded from coverage. [cicd-testing §7]
- **`buildMockSupabase` chain-mock fixture** is the canonical pattern for testing Server Actions without a real Supabase. Shared `tests/fixtures/mock-supabase.ts` eliminates the per-test boilerplate that currently varies across our 11 test files. [§4]
- **AI SDK `MockLanguageModelV2`** is the canonical mock for any `generateObject`/`generateText` call. For our Anthropic SDK direct path, use `vi.mock("@anthropic-ai/sdk")` per `diagnose-concern.test.ts` pattern (Plan 01 Phase 4A). [§4 + §8]
- **Deno edge-fn test patterns:** stub `fetch` with `using { stub } = ...` + `returnsNext`. Real-Supabase integration via `supabase start` in CI. Sentry spy assertions. Idempotency assertions via DB-level lookups. [§5]
- **Playwright OTP bypass via backend test-mode flag** — `TEST_MODE_OTP_BYPASS_PHONE_PREFIX=+15555550` env var, OTP send path returns code `999999` for matching phones. Cleaner than mocking Telnyx HTTP layer. [§6]
- **basejump-supabase_test_helpers** — pgTAP helpers for RLS testing. Cardinal rule: assert row counts, NOT exceptions (RLS silently filters blocked UPDATE/DELETE). [Appendix]

---

## Phase 1 — Server Action coverage (~1 week, ~24 tests)

**Goal:** Cover the remaining 24 untested Server Actions with the same Vitest pattern as `submit-start-over.test.ts` + the Plan 01 Phase 4 work.

### Phase 1A — Shared fixtures (~0.5 day)

**Files:**
- New `scheduler-app/tests/fixtures/mock-supabase.ts`
- New `scheduler-app/tests/fixtures/mock-next-cache.ts`
- New `scheduler-app/tests/fixtures/mock-sentry.ts`

**`mock-supabase.ts` canonical:**
```typescript
// tests/fixtures/mock-supabase.ts
import { vi, type Mock } from "vitest";

export interface SupabaseChainMock {
  from: Mock;
  rpc: Mock;
  // ... add more methods as we use them
}

export function buildMockSupabase(setup: {
  selectRows?: Record<string, unknown[]>;     // {tableName: [rows]}
  insertOk?: boolean | string;                // boolean or error message
  updateRows?: Record<string, unknown[]>;
  rpcResults?: Record<string, unknown>;
}): SupabaseChainMock {
  const fromMock = vi.fn((table: string) => {
    const rows = setup.selectRows?.[table] ?? [];
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
          // ... continue chain
        })),
        // ...
      })),
      insert: vi.fn().mockResolvedValue({
        error: typeof setup.insertOk === "string"
          ? { message: setup.insertOk }
          : setup.insertOk === false
            ? { message: "insert_failed" }
            : null,
      }),
      // ... update, upsert, delete, etc
    };
  });

  return {
    from: fromMock,
    rpc: vi.fn((fnName: string) => Promise.resolve({
      data: setup.rpcResults?.[fnName] ?? null,
      error: null,
    })),
  };
}
```

**`mock-next-cache.ts`:**
```typescript
// tests/fixtures/mock-next-cache.ts
import { vi } from "vitest";

export function mockNextCache() {
  vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
    revalidateTag: vi.fn(),
  }));
  vi.mock("next/headers", () => ({
    headers: vi.fn(() => new Headers()),
    cookies: vi.fn(() => ({
      get: vi.fn(() => ({ value: "test-chat-id" })),
      set: vi.fn(),
    })),
  }));
}
```

### Phase 1B — Write tests for the 24 actions (~5 days, ~3 tests/day)

**24 actions to cover (excluding `submit-start-over` which has tests + Plan 01 Phase 4B `run-diagnostics`):**

1. submit-greeting
2. submit-phone-name
3. submit-otp
4. resend-otp
5. submit-multi-account-choice
6. submit-no-match-choice
7. submit-partial-verification-choice
8. submit-new-customer-info
9. submit-customer-info-edit
10. submit-vehicle-pick
11. submit-new-vehicle
12. submit-service-and-concern-picker
13. submit-explanation
14. submit-clarification-answer
15. submit-testing-service-approval
16. submit-second-routine-pass
17. submit-appointment-type
18. submit-date
19. submit-waiter-time
20. submit-summary
21. submit-customer-notes
22. submit-customer-question
23. submit-escalate
24. dismiss-escalation + submit-back + fire-transcript-dispatch (group)

**Per-action test template:** `tests/unit/actions/{action-name}.test.ts`

Each action gets 4-8 tests covering:
- Happy path
- Invalid Zod input → returns `ok: false, error: "invalid_input"`
- Session not found → returns appropriate error
- Idempotency check fires (where applicable)
- Race protection (where applicable — `current_step` mismatch returns no-op)
- Sentry.captureException fires on DB error
- Each branch (e.g., `submit-multi-account-choice` has 3 branches: 'select', 'create_new', 'cancel')

**Sample test for submit-vehicle-pick (post-Plan-04 with validation):**
```typescript
// tests/unit/actions/submit-vehicle-pick.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMockSupabase } from "../../fixtures/mock-supabase";
import { mockNextCache } from "../../fixtures/mock-next-cache";

mockNextCache();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => buildMockSupabase({
    selectRows: { customer_chat_sessions: [{ id: "chat-123", customer_id: 7001 }] },
    rpcResults: { apply_wizard_transition: { id: "chat-123", current_step: "service_and_concern_picker" } },
  }),
}));

vi.mock("@/lib/scheduler/tekmetric/customers", () => ({
  fetchVehiclesForCustomer: vi.fn().mockResolvedValue({
    ok: true,
    vehicles: [{ id: 5001, year: 2021, make: "Toyota", model: "Camry" }],
  }),
}));

describe("submitVehiclePickV2", () => {
  it("happy path — known vehicle", async () => {
    const result = await submitVehiclePickV2({ chat_id: "chat-123", vehicle_id: 5001 });
    expect(result.ok).toBe(true);
  });

  it("rejects vehicle_id not in customer's vehicle list (I-COR-4)", async () => {
    const result = await submitVehiclePickV2({ chat_id: "chat-123", vehicle_id: 9999 });
    expect(result).toEqual({ ok: false, error: "vehicle_id_not_owned", timestamp: expect.any(Number) });
  });

  // ... 5-6 more
});
```

**Verification:**
1. `cd scheduler-app && npm run test:coverage` after each batch
2. Track coverage growth on DAL-eligible files (post-refactor in Phase 5)

**Risk + rollback:**
- LOW. Tests are additive. If a test breaks for a wrong reason, fix or skip with a `// FIXME` comment.

---

## Phase 2 — IdleTimer regression test (I-TEST-2, ~3 hours)

**Goal:** Prevent regression of the 2026-05-21 event-reset fix. Currently zero tests on `IdleTimer.tsx` (241 LoC).

**Files:**
- New `scheduler-app/src/components/scheduler/wizard/IdleTimer.test.tsx`

**Test approach (jsdom + fake timers):**
```typescript
// IdleTimer.test.tsx
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IdleTimer } from "./IdleTimer";

describe("IdleTimer", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("does not show warning before 4:40", async () => {
    render(<IdleTimer chatId="chat-1" currentStep="greeting" />);
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes
    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();
  });

  it("shows warning at 4:40", () => {
    render(<IdleTimer chatId="chat-1" currentStep="greeting" />);
    vi.advanceTimersByTime(4 * 60 * 1000 + 40 * 1000);
    expect(screen.getByText(/Are you still there/)).toBeInTheDocument();
  });

  it("mousemove resets the timer (regression guard for 2026-05-21 fix)", () => {
    render(<IdleTimer chatId="chat-1" currentStep="greeting" />);
    vi.advanceTimersByTime(4 * 60 * 1000); // 4:00
    // Fire mousemove — should reset
    window.dispatchEvent(new MouseEvent("mousemove"));
    vi.advanceTimersByTime(40 * 1000); // would have fired warning, but we reset
    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();
  });

  it("visibilitychange resets the timer (regression guard)", () => {
    render(<IdleTimer chatId="chat-1" currentStep="greeting" />);
    vi.advanceTimersByTime(4 * 60 * 1000);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(40 * 1000);
    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();
  });

  it("captures phase listeners survive stopPropagation", () => {
    // Test that listeners attached at capture phase still fire even when a
    // child element calls stopPropagation
    render(<IdleTimer chatId="chat-1" currentStep="greeting" />);
    vi.advanceTimersByTime(4 * 60 * 1000);
    const evt = new KeyboardEvent("keydown", { bubbles: true });
    evt.stopPropagation();
    window.dispatchEvent(evt);
    vi.advanceTimersByTime(40 * 1000);
    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();
  });

  it("fires beacon on reload at 5:00", () => {
    const sendBeaconSpy = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    const locationReloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    render(<IdleTimer chatId="chat-1" currentStep="greeting" />);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(sendBeaconSpy).toHaveBeenCalledWith(expect.stringContaining("chat_id=chat-1"));
    expect(locationReloadSpy).toHaveBeenCalled();
  });

  it("pagehide fires beacon for tab close", () => { /* ... */ });

  it("disabled prop skips entire timer", () => {
    render(<IdleTimer chatId="chat-1" currentStep="completed" disabled />);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();
  });
});
```

**Verification:**
1. `npm run test IdleTimer` → all pass
2. If any test fails, the regression we're protecting against has been reintroduced

---

## Phase 3 — Webhook + cron handler tests (I-TEST-3 + I-TEST-4, ~3 days)

### Phase 3A — Webhook idempotency tests (~1 day)

After Plan 01 Phase 2 lands the UNIQUE constraint, add tests asserting the idempotency contract:

**Files:**
- `supabase/functions/tekmetric-webhook/index.test.ts` (extend Plan 01 Phase 4C base)
- `supabase/functions/keytag-tekmetric-webhook/index.test.ts`

**Sample tests:**
```typescript
Deno.test("tekmetric-webhook: duplicate event_hash returns 200 + no new row", async () => {
  using stub = stubFetch();
  // First request
  const res1 = await sendWebhook(samplePayload);
  expect(res1.status).toBe(200);
  // Second identical request
  const res2 = await sendWebhook(samplePayload);
  expect(res2.status).toBe(200);
  // Verify only 1 row in DB
  const { count } = await sb.from("tekmetric_webhook_events").select("id", { count: "exact", head: true });
  expect(count).toBe(1);
});

Deno.test("tekmetric-webhook: payload variants get distinct hashes", async () => {
  const payload1 = { ...samplePayload, data: { ...samplePayload.data, repairOrderNumber: 152222 } };
  const payload2 = { ...samplePayload, data: { ...samplePayload.data, repairOrderNumber: 152223 } };
  await sendWebhook(payload1);
  await sendWebhook(payload2);
  const { count } = await sb.from("tekmetric_webhook_events").select("id", { count: "exact", head: true });
  expect(count).toBe(2);
});
```

### Phase 3B — Cron edge function tests (~2 days)

**4 cron edge fns to cover:**
- `appointments-sync`
- `transcript-dispatcher`
- `keytag-bulk-reconcile`
- `keytag-daily-report`

**Per-fn test surface:**
- Happy path
- Tekmetric API down (mock fetch returns 503)
- Empty result set (no rows to process)
- Sentry captures fire on error
- `withSentryScope` wrap actually runs (assert via spy)
- pg_cron body's `BEGIN…EXCEPTION` wraps catch errors and write to `scheduler_error_log` (covered by `cron.job_run_details` query in Plan 02 Phase 3)

---

## Phase 4 — "Other" subcategory routing test (I-TEST-5, ~3 hours)

**Goal:** Cover the wizard's branching when all concerns route to "other" subcategories (→ second_routine_pass).

**File:**
- Add to `scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.test.ts` (the file from Plan 01 Phase 4B)

**Cases:**
1. Single concern → `other/multiple_symptoms_not_sure_what_category` → second_routine_pass
2. Multiple concerns ALL "other" → second_routine_pass
3. Mix of testing-service + "other" → testing_service_approval (the testing services win)
4. All concerns return null match → second_routine_pass
5. Mix of null + "other" → second_routine_pass

---

## Phase 5 — DAL refactor (I-TEST-6, ~3-4 days)

**Goal:** Extract business logic from Server Actions into `src/lib/dal/` per Vercel's official Thin Action / Fat DAL pattern. Then enable the 80% coverage threshold (currently aspirational only).

**Approach:** Incremental — refactor one action per day. Each refactor:

1. Create `src/lib/dal/{domain}.ts` (e.g. `src/lib/dal/holds.ts`, `src/lib/dal/vehicles.ts`, `src/lib/dal/customers.ts`).
2. Move business logic (DB writes, branch decisions, validation) from action into DAL function.
3. Server Action becomes 5-12 line wrapper: Zod parse → `requireSession()` → call DAL fn → return envelope.
4. DAL function is pure TypeScript, no Server-Action-specific decorators — fully unit-testable.
5. Move existing action's tests + add coverage on the DAL function.

**Example refactor: submit-vehicle-pick → dal/vehicles.ts**

```typescript
// scheduler-app/src/lib/dal/vehicles.ts (NEW)
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchVehiclesForCustomer } from "@/lib/scheduler/tekmetric/customers";

export interface PickVehicleInput {
  chat_id: string;
  vehicle_id: number;
}

export type PickVehicleResult =
  | { ok: true }
  | { ok: false; error: "session_not_found" | "vehicle_id_not_owned" | "transition_failed" };

export async function pickVehicleForSession(input: PickVehicleInput): Promise<PickVehicleResult> {
  const supabase = createSupabaseAdminClient();

  const { data: row } = await supabase
    .from("customer_chat_sessions")
    .select("customer_id")
    .eq("id", input.chat_id)
    .single();

  if (!row) return { ok: false, error: "session_not_found" };

  const vehicles = await fetchVehiclesForCustomer({ customer_id: row.customer_id });
  if (!vehicles.vehicles?.some((v) => v.id === input.vehicle_id)) {
    return { ok: false, error: "vehicle_id_not_owned" };
  }

  // ... apply transition via apply_wizard_transition RPC (Plan-04 Phase 1A)
  const { error: transitionErr } = await supabase.rpc("apply_wizard_transition", { /* ... */ });
  if (transitionErr) return { ok: false, error: "transition_failed" };

  return { ok: true };
}
```

```typescript
// scheduler-app/src/lib/scheduler/wizard/actions/submit-vehicle-pick.ts (NOW THIN)
"use server";
import { wrapAction } from "../instrument-action";
import { z } from "zod";
import { pickVehicleForSession } from "@/lib/dal/vehicles";

const inputSchema = z.object({ chat_id: z.string().uuid(), vehicle_id: z.number().int() });

export const submitVehiclePickV2 = wrapAction("submitVehiclePickV2", async (args) => {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid_input", timestamp: Date.now() };

  const result = await pickVehicleForSession(parsed.data);
  if (!result.ok) return { ...result, timestamp: Date.now() };

  revalidateTag(`session-${parsed.data.chat_id}`);
  return { ok: true, timestamp: Date.now() };
});
```

**Now `pickVehicleForSession` is unit-testable independently of Server Action machinery.**

**Vitest config update (after refactor):**
```typescript
// scheduler-app/vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/lib/dal/**/*.ts"], // ONLY DAL — actions are thin wrappers
      exclude: ["**/*.test.ts", "**/types.ts"],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
```

**Refactor priority (most-complex first to derisk):**
1. `submit-summary` (Tekmetric confirm + verification mismatch — Plan 04 Phase 4)
2. `submit-vehicle-pick` (validation — Plan 04 Phase 3A)
3. `submit-multi-account-choice` (validation — Plan 04 Phase 3B)
4. `submit-phone-name` (Telnyx send + retry — Plan 05 Phase 4)
5. `run-diagnostics` (LLM aggregator — Plan 01 Phase 4B already tests; just extract)
6. ... continue down the list

---

## Phase 6 — pgTAP runner in CI + error.tsx tests (I-TEST-7 + I-TEST-8, ~4 hours)

### Phase 6A — Wire pgTAP into CI

**File:**
- `.github/workflows/ci.yml` (the `pgtap` job from Plan 01 Phase 3B)

This is already in Plan 01 Phase 3B's CI workflow — `supabase test db` runs in the `pgtap` job.

Add a `package.json` script for local convenience:
```json
{
  "scripts": {
    "test:db": "cd ../supabase && supabase test db"
  }
}
```

### Phase 6B — error.tsx + global-error.tsx Sentry capture tests

**Files:**
- New `scheduler-app/app/error.test.tsx`
- New `scheduler-app/app/global-error.test.tsx`

**Test:**
```typescript
// app/error.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import Error from "./error";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("error.tsx", () => {
  it("calls Sentry.captureException on mount", () => {
    const testError = new Error("Test error");
    testError.digest = "abc123";

    render(<Error error={testError} reset={() => {}} />);

    expect(Sentry.captureException).toHaveBeenCalledWith(testError);
  });

  it("renders error.digest (not error.message) to user", () => {
    const testError = new Error("Sensitive backend message");
    testError.digest = "abc123";

    const { container } = render(<Error error={testError} reset={() => {}} />);

    expect(container.textContent).toContain("abc123");
    expect(container.textContent).not.toContain("Sensitive backend message");
  });
});
```

---

## Sequence with other plans

- **Plan 01 Phase 3 (CI gate)** must be done first — no point in writing more tests without CI to enforce them.
- **Plan 01 Phase 4 (critical tests)** establishes the patterns — extend here.
- **Plan 04 (atomicity)** lands RPC changes that the Server Action tests must mock — coordinate the test updates with the RPC introductions.

## Open questions for Chris

1. **DAL refactor scope:** all 25 actions in one push, or incremental over 2-3 sprints? Recommend incremental — refactor while writing tests.
2. **Coverage threshold ramp:** start at 60% and ramp to 85%? Or hard 85% from day 1 (would block PRs that touch DAL without full coverage)?
3. **`tests/unit/actions/` directory:** create now or wait until Plan 01 Phase 4 settles into `tests/unit/`?

## Success criteria

- [ ] 24 untested Server Actions have ≥4 unit tests each
- [ ] IdleTimer has regression-guard tests for the 2026-05-21 fix
- [ ] Webhook idempotency tests assert duplicate-rejection
- [ ] 4 cron edge fns have happy + failure path tests
- [ ] "Other" subcategory routing covered in `run-diagnostics.test.ts`
- [ ] `src/lib/dal/` exists with extracted business logic for at least 10 of 25 actions
- [ ] Vitest coverage threshold enforced at 85% on `src/lib/dal/` files
- [ ] pgTAP runs in CI on every PR + main push
- [ ] `error.tsx` + `global-error.tsx` Sentry-capture tests pass

**Estimated effort:** 1-2 weeks (depending on DAL refactor scope).
