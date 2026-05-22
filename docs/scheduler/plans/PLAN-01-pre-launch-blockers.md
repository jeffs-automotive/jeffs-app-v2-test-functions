---
plan: 01
title: Pre-launch BLOCKERs
audit_findings: [B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, I-OBS-2, I-INT-5]
research_inputs: [research-supabase-postgres, research-cicd-testing, research-integration-robustness, research-security-hardening]
estimated_effort: 6-8 days
prerequisites: []
risk_level: medium
blocks: [launch]
---

# Plan 01 — Pre-launch BLOCKERs

> **Cannot launch to real customers until every phase here is complete + verified.** All 10 audit BLOCKERs plus the broken cron and Telnyx A2P 10DLC registration check (research surfaced this as a hard launch blocker — carriers have FULLY BLOCKED unregistered SMS since Feb 2025).

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **B1** | sec | `tekmetric-api-testing` accepts publishable anon key | 1 |
| **B2** | sec | `tekmetric-bootstrap` accepts publishable anon key | 1 |
| **B3** | sec | `_bulk_keytag_backfill` RLS disabled (149 rows) | 1 |
| **B4** | sec | `_smoke_test_run` RLS disabled (42 rows) | 1 |
| **I-OBS-2** | correctness | `scheduler-admin-snapshot-prune` cron broken since 2026-05-19 | 1 |
| **B5** | correctness | `tekmetric_webhook_events` lacks idempotency UNIQUE | 2 |
| **B6** | quality | No CI gate; ESLint disabled during builds | 3 |
| **B7** | quality | `diagnose-concern.ts` (1287 LoC) zero tests | 4 |
| **B8** | quality | Both Tekmetric webhook handlers untested (1332 LoC combined) | 4 |
| **B9** | quality | `run-diagnostics.ts` (582 LoC) zero tests | 4 |
| **B10** | quality | `test:e2e` script broken — no `playwright.config.*` | 4 |
| **I-INT-5** | integration | Telnyx A2P 10DLC registration not verified | 5 |

## Research summary

- **`verify_jwt = true` accepts the anon key** (it's a "valid JWT" — both anon and service_role are signed by the project). For operator-only fns: `verify_jwt = false` + handler-side bearer check using `crypto.timingSafeEqual`. The Supabase 2026 SDK has `auth: 'secret:<name>'` but a custom helper is more flexible. [supabase-postgres research §1]
- **`_`-prefix has zero special meaning to Splinter.** Either DROP after verification OR `ALTER TABLE … SET SCHEMA internal` AND remove `internal` from the API's exposed schemas list. [§3]
- **`pg_cron` body silent-fail root cause confirmed:** raw `BEGIN…EXCEPTION…END;` is invalid SQL at the top level. Wrap in `DO $cron$ ... $cron$;` (named dollar-quote to avoid collision) OR (strongly preferred) move logic to a named function and `SELECT fn_name();` from the cron body. Re-raise after catch for cron.job_run_details to record 'failed'. [§5]
- **Webhook idempotency: synthetic SHA-256 hex over canonicalJSON({provider, event_type, resource_id, shop_id, minute_bucket})**. `INSERT … ON CONFLICT (event_hash) DO NOTHING RETURNING id` is the atomic claim primitive. Return HTTP 200 on duplicate to stop provider retry loops. [§4]
- **Next.js 16 REMOVED `next lint` AND the `eslint.ignoreDuringBuilds` option** — so that line in our config is now dead code. `@rushstack/eslint-patch` is on death row (rushstack#5049 still open). Recommended 2026 approach: skip `eslint-config-next`, import `@next/eslint-plugin-next` directly. [cicd-testing research §2]
- **Thin Action / Fat DAL is Vercel's OFFICIAL position** (nextjs.org/docs/app/guides/data-security), not just a community heuristic. Coverage threshold should be 85-90% on DAL with Server Actions excluded from coverage. [§7]
- **A2P 10DLC unregistered traffic is FULLY BLOCKED since Feb 2025 (not throttled).** Registration is on Telnyx (not Tekmetric). Verify via `GET /v2/10dlc/brand/{id}` and `GET /v2/10dlc/campaign/{id}`. TCR Trust Score 0-100 governs MPS throughput. Use case = `2FA` for OTP. [integration-robustness research §4]
- **Anthropic SDK mocking via `vi.mock`** — the canonical Vitest pattern for our 1287-LoC `diagnose-concern.ts`. Full test code patterns in research [§8].
- **Playwright OTP bypass strategy:** community recommends a backend test-mode flag (env var `TEST_MODE_OTP_BYPASS_PHONE_PREFIX=+15555550`) that returns `code: '999999'` for matching phones, bypassing real Telnyx send. [§6]

---

## Phase 1 — Quick fixes (~2 hours)

Three independent fixes that close 5 BLOCKERs + the broken cron.

### Phase 1A — Edge function auth lockdown (B1 + B2)

**Goal:** Stop the Supabase publishable anon key from being sufficient to invoke `tekmetric-api-testing` or `tekmetric-bootstrap`.

**Files to change:**
- `supabase/config.toml` — add `[functions.tekmetric-api-testing]` + `[functions.tekmetric-bootstrap]` entries with `verify_jwt = false`
- `supabase/functions/tekmetric-api-testing/index.ts` — add `checkSchedulerBearer()` at handler top
- `supabase/functions/tekmetric-bootstrap/index.ts` — add `checkSchedulerBearer()` at handler top

**Code change:**

```toml
# supabase/config.toml
[functions.tekmetric-api-testing]
verify_jwt = false

[functions.tekmetric-bootstrap]
verify_jwt = false
```

```typescript
// supabase/functions/tekmetric-api-testing/index.ts (top of Deno.serve)
import { checkSchedulerBearer } from "../_shared/scheduler-auth.ts";

Deno.serve(async (req) => {
  const authCheck = await checkSchedulerBearer(req);
  if (!authCheck.ok) {
    return new Response(
      JSON.stringify({ error: authCheck.reason }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  // ... rest of handler
});
```

Same change in `tekmetric-bootstrap/index.ts`.

**Verification:**
1. `npx supabase functions deploy tekmetric-api-testing tekmetric-bootstrap`
2. `curl.exe -X POST https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/tekmetric-api-testing -H "Authorization: Bearer <ANON_KEY>"` → expects **401** with `{error: "missing_bearer"}` or similar
3. Same curl with `Bearer <SERVICE_ROLE_KEY>` → expects **200** (or the original behavior)
4. Confirm no other code path calls these fns with the anon key (grep `tekmetric-api-testing` + `tekmetric-bootstrap` across scheduler-app/)

**Risk + rollback:**
- LOW. If a legitimate caller breaks, revert the `config.toml` lines + redeploy. The `checkSchedulerBearer` helper already exists; we're just gating an already-tested function with already-tested auth.

### Phase 1B — Scratch tables cleanup (B3 + B4)

**Goal:** Remove the 2 anon-exposed scratch tables.

**Files to change:**
- New migration `supabase/migrations/20260522NNNNNN_scheduler_drop_scratch_tables.sql`

**Decision required from Chris:** drop or schema-move?

Both options work; research recommends DROP for "one-time backfill" tables and SCHEMA MOVE for "ops tables we still query." We need to verify whether either table is referenced in code first.

**Pre-flight check (do this first):**
```bash
grep -rn "_bulk_keytag_backfill\|_smoke_test_run" supabase/ scheduler-app/ docs/
```

If zero matches → DROP (Option A). If matches exist → SCHEMA MOVE (Option B).

**Option A — DROP migration:**
```sql
BEGIN;
DROP TABLE IF EXISTS public._bulk_keytag_backfill;
DROP TABLE IF EXISTS public._smoke_test_run;
COMMIT;
```

**Option B — Schema move migration:**
```sql
BEGIN;
CREATE SCHEMA IF NOT EXISTS internal;
ALTER TABLE public._bulk_keytag_backfill SET SCHEMA internal;
ALTER TABLE public._smoke_test_run SET SCHEMA internal;
-- Also: remove 'internal' from API exposed_schemas in supabase/config.toml
COMMIT;
```

If Option B, also update `supabase/config.toml`:
```toml
[api]
schemas = ["public", "graphql_public"]
# do NOT add "internal"
```

**Verification:**
1. `npx supabase db push`
2. `mcp__supabase__list_tables` confirms the tables are gone from `public` (or moved to `internal`)
3. `mcp__supabase__get_advisors type=security` shows zero `rls_disabled` warnings

**Risk + rollback:**
- DROP: irreversible without a backup. Run `SELECT * FROM _bulk_keytag_backfill; SELECT * FROM _smoke_test_run;` and save the JSON to `.tmp/scratch-backup-2026-05-22.json` before drop, in case something references them.
- SCHEMA MOVE: easily reversed with `ALTER TABLE internal._bulk_keytag_backfill SET SCHEMA public;`.

### Phase 1C — Fix broken cron (I-OBS-2)

**Goal:** `scheduler-admin-snapshot-prune` cron has been silently failing daily since 2026-05-19. Wrap the body in a named function + call it from the cron.

**Files to change:**
- New migration `supabase/migrations/20260522NNNNNN_fix_snapshot_prune_cron.sql`

**Migration:**
```sql
BEGIN;

-- Named function (replaces the broken inline cron body)
CREATE OR REPLACE FUNCTION public.run_admin_snapshot_prune()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pruned_count INTEGER;
BEGIN
  UPDATE public.scheduler_admin_audit_log
     SET pre_state_snapshot = NULL,
         snapshot_pruned_at = now()
   WHERE pre_state_snapshot IS NOT NULL
     AND snapshot_pruned_at IS NULL
     AND occurred_at < now() - interval '30 days';

  GET DIAGNOSTICS v_pruned_count = ROW_COUNT;

  IF v_pruned_count > 0 THEN
    INSERT INTO public.scheduler_error_log
      (origin, origin_id, surface, level, error_code, message, context)
    VALUES (
      'cron', 'scheduler-admin-snapshot-prune', 'cron/admin-snapshot-prune',
      'info', 'prune_run',
      format('pruned %s snapshots', v_pruned_count),
      jsonb_build_object('pruned_count', v_pruned_count)
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.scheduler_error_log
    (origin, origin_id, surface, level, error_code, message, context)
  VALUES (
    'cron', 'scheduler-admin-snapshot-prune', 'cron/admin-snapshot-prune',
    'error', SQLSTATE, SQLERRM,
    jsonb_build_object('detail', 'snapshot prune fn threw')
  );
  RAISE; -- re-raise so cron.job_run_details records 'failed'
END;
$$;

-- Reschedule the cron with the function call
SELECT public.cron_unschedule_if_exists('scheduler-admin-snapshot-prune');
SELECT cron.schedule(
  'scheduler-admin-snapshot-prune',
  '30 3 * * *',
  'SELECT public.run_admin_snapshot_prune();'
);

COMMIT;
```

**Verification:**
1. `npx supabase db push`
2. Manually invoke: `SELECT public.run_admin_snapshot_prune();` via execute_sql
3. Tomorrow 03:30 UTC: query `cron.job_run_details` for the job — expects `status='succeeded'`
4. If a Sentry Cron Monitoring check-in is wired (Plan 02), it should now ping `ok`

**Risk + rollback:**
- LOW. Worst case the prune doesn't run for a week — the snapshots are already not being pruned, so no regression. Rollback by `DROP FUNCTION run_admin_snapshot_prune; SELECT cron.unschedule('scheduler-admin-snapshot-prune');`.

---

## Phase 2 — Webhook idempotency at DB level (B5, ~1 day)

**Goal:** Add UNIQUE constraint + synthetic hash to both `tekmetric_webhook_events` and `keytag_webhook_events` so Tekmetric retries become DB-level no-ops, not application-side deduped errors.

**Files to change:**
- New migration `supabase/migrations/20260522NNNNNN_webhook_event_idempotency.sql`
- `supabase/functions/tekmetric-webhook/index.ts` — switch `.insert()` → `.upsert(..., {onConflict: 'event_hash', ignoreDuplicates: true})`
- `supabase/functions/keytag-tekmetric-webhook/index.ts` — same switch

**Migration:**
```sql
BEGIN;

-- Add synthetic event_hash columns
ALTER TABLE public.tekmetric_webhook_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

ALTER TABLE public.keytag_webhook_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

-- Backfill (best-effort hash on existing rows — older rows may have NULL which is OK,
-- they won't conflict with anything since they're already persisted)
UPDATE public.tekmetric_webhook_events
   SET event_hash = encode(
     digest(
       coalesce(action_type, '') || ':' ||
       coalesce(ro_number::text, '') || ':' ||
       coalesce(status_id::text, '') || ':' ||
       coalesce(date_trunc('minute', received_at)::text, ''),
       'sha256'
     ),
     'hex'
   )
 WHERE event_hash IS NULL;

UPDATE public.keytag_webhook_events
   SET event_hash = encode(
     digest(
       coalesce(event_kind, '') || ':' ||
       coalesce(tekmetric_ro_id::text, '') || ':' ||
       coalesce(status_id::text, '') || ':' ||
       coalesce(date_trunc('minute', received_at)::text, ''),
       'sha256'
     ),
     'hex'
   )
 WHERE event_hash IS NULL;

-- Unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS tekmetric_webhook_events_event_hash_uniq
  ON public.tekmetric_webhook_events (event_hash)
  WHERE event_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS keytag_webhook_events_event_hash_uniq
  ON public.keytag_webhook_events (event_hash)
  WHERE event_hash IS NOT NULL;

-- For NEW rows: require event_hash
ALTER TABLE public.tekmetric_webhook_events
  ALTER COLUMN event_hash SET NOT NULL;
-- (Keep keytag NULL-able since some older rows may legitimately not hash)

COMMIT;
```

**Handler change** (canonical):
```typescript
// supabase/functions/tekmetric-webhook/index.ts (replace lines ~186-201)
const eventHash = await sha256Hex(JSON.stringify({
  action_type: payload.action_type,
  ro_number: payload.data?.repairOrderNumber,
  status_id: payload.data?.repairOrderStatus?.id,
  minute_bucket: new Date(payload.data?.updatedDate || Date.now())
    .toISOString().slice(0, 16), // YYYY-MM-DDTHH:MM
}));

const { data: inserted, error: insertErr } = await sb
  .from("tekmetric_webhook_events")
  .upsert(
    { event_hash: eventHash, ...payloadRow },
    { onConflict: "event_hash", ignoreDuplicates: true }
  )
  .select("id")
  .single();

if (insertErr) {
  // Real error (not idempotency)
  console.error("webhook_insert_failed", { error: insertErr.message });
  await Sentry.captureException(insertErr, { tags: { surface: "tekmetric-webhook" } });
  return new Response("ok", { status: 200 }); // still 200 to stop Tekmetric retry storm
}

if (!inserted) {
  // Duplicate event — already processed
  console.log("webhook_duplicate_ignored", { event_hash: eventHash });
  return new Response("ok", { status: 200 });
}
```

**Verification:**
1. `npx supabase db push`
2. Deploy both webhook fns: `npx supabase functions deploy tekmetric-webhook keytag-tekmetric-webhook`
3. Curl probe with a sample payload twice in a row — second one should land as no-op (no error, no new row)
4. `SELECT COUNT(*), COUNT(DISTINCT event_hash) FROM tekmetric_webhook_events WHERE received_at > now() - interval '1 hour'` — counts should match

**Risk + rollback:**
- MEDIUM. The backfill UPDATE rewrites every existing row. If the hash formula has a bug, old rows could land with a wrong hash. Test the formula on a small sample first.
- Rollback: drop the unique index + the event_hash column. `ALTER TABLE … DROP COLUMN event_hash CASCADE;`

---

## Phase 3 — CI gate + ESLint fix (B6, ~2 days)

**Goal:** Establish `.github/workflows/ci.yml` that gates merges on typecheck + lint + tests. Fix the ESLint flat config so it actually runs.

### Phase 3A — Update Next.js config + ESLint (4 hours)

**Files to change:**
- `scheduler-app/next.config.ts` — remove the dead `eslint.ignoreDuringBuilds: true` block (Next.js 16 removed this option entirely)
- `scheduler-app/package.json` — uninstall `@rushstack/eslint-patch` + `eslint-config-next` (if present); install `@next/eslint-plugin-next` directly
- `scheduler-app/eslint.config.mjs` — flat config using `@next/eslint-plugin-next`

**Code:**
```js
// scheduler-app/eslint.config.mjs
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: {
      "@next/next": nextPlugin,
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Observability rules per .claude/rules/observability.md
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
];
```

```typescript
// scheduler-app/next.config.ts (delete the eslint block entirely)
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ... other config
  // REMOVED: eslint: { ignoreDuringBuilds: true } — Next.js 16 ignores this anyway
};

export default withSentryConfig(nextConfig, { /* sentry options */ });
```

**Verification:**
1. `cd scheduler-app && npm install` (after editing package.json)
2. `cd scheduler-app && npm run lint` — expects clean run (or surface real lint issues to fix)
3. If lint surfaces issues, fix them THIS phase or document each one as an exception

### Phase 3B — CI workflow (1 day)

**Files to change:**
- New `.github/workflows/ci.yml`

**Code:**
```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quick-check:
    name: Quick check (lint + typecheck)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: 'scheduler-app/package-lock.json'
      - run: cd scheduler-app && npm ci
      - name: Typecheck
        run: cd scheduler-app && npm run typecheck
      - name: Lint
        run: cd scheduler-app && npm run lint

  vitest:
    name: Vitest
    runs-on: ubuntu-latest
    needs: [quick-check]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: 'scheduler-app/package-lock.json'
      - run: cd scheduler-app && npm ci
      - name: Vitest
        run: cd scheduler-app && npm run test

  deno-test:
    name: Deno tests
    runs-on: ubuntu-latest
    needs: [quick-check]
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v1.x
      - name: Deno test
        run: deno test --allow-all --no-check supabase/functions/

  pgtap:
    name: pgTAP
    runs-on: ubuntu-latest
    needs: [quick-check]
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.x
      - name: Start local Supabase
        run: supabase start
      - name: Run pgTAP
        run: supabase test db
      - name: Stop Supabase
        run: supabase stop
        if: always()

  # Playwright job added in Phase 4 once playwright.config.ts exists
```

### Phase 3C — Husky + lint-staged pre-commit (4 hours)

**Files to change:**
- `scheduler-app/package.json` — add `husky` + `lint-staged` devDeps + `prepare` script
- New `scheduler-app/.husky/pre-commit`
- New `scheduler-app/.husky/pre-push`

**Code:**
```json
// scheduler-app/package.json (add)
{
  "scripts": {
    "prepare": "cd .. && husky scheduler-app/.husky"
  },
  "devDependencies": {
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["eslint --fix"]
  }
}
```

```bash
# scheduler-app/.husky/pre-commit
#!/bin/sh
cd scheduler-app && npx lint-staged
```

```bash
# scheduler-app/.husky/pre-push
#!/bin/sh
cd scheduler-app && npm run typecheck
```

> **Critical:** Don't pass filenames to tsc — it ignores tsconfig.json when files are listed. Use function syntax or move to pre-push (which is what we're doing).

**Verification:**
1. `cd scheduler-app && npm install`
2. `chmod +x .husky/pre-commit .husky/pre-push`
3. Make a trivial change with an ESLint error → `git commit` → expects pre-commit to refuse
4. `git push` with a TS error → expects pre-push to refuse

**Risk + rollback:**
- LOW. Hooks can be bypassed with `--no-verify`. Worst case: delete `.husky/` and remove `prepare` script.

---

## Phase 4 — Critical test coverage (B7, B8, B9, B10 — ~3 days)

The audit identified 4 highest-risk untested surfaces:
- B7: `diagnose-concern.ts` (1287 LoC, just-refactored 3-stage LLM)
- B9: `run-diagnostics.ts` (582 LoC Server Action — linchpin)
- B8: Both Tekmetric webhook handlers (1332 LoC combined)
- B10: Playwright wizard happy-path (script broken, no config)

Implement in this order to derisk first.

### Phase 4A — `diagnose-concern.ts` unit tests (1 day, ~15 tests)

**Goal:** Cover each stage's prompt assembly, JSON Schema gating, retry, and failSafe.

**Files to add:**
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.test.ts`
- `scheduler-app/tests/fixtures/mock-anthropic.ts` (shared)

**Approach (from research §8):**
- Use `vi.mock("@anthropic-ai/sdk")` to intercept the SDK
- Return canned structured-output responses per stage
- Assert: stage 1/2/3 are called in order; prompts contain expected substrings; failSafe() returns null on stage 1 error; 2-attempt retry path fires once on transient

**Mock fixture:**
```typescript
// scheduler-app/tests/fixtures/mock-anthropic.ts
import { vi } from "vitest";

export function mockAnthropicSDK(stages: Array<Record<string, unknown>>) {
  const create = vi.fn();
  for (const stage of stages) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(stage) }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: "end_turn",
    });
  }
  return {
    beta: { messages: { create } },
    // ... other SDK surface
  };
}
```

**Sample tests:**
```typescript
// scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockAnthropicSDK } from "../../../../../tests/fixtures/mock-anthropic";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => mockAnthropicSDK([
    { matched_category_key: "brake_inspection", confidence: "high", reasoning: "..." },
    { matched_subcategory_slug: "metallic_grinding", confidence: "high", reasoning: "..." },
    { extracted_facts: { noise_descriptor: "grinding" }, confidence: "high", reasoning: "..." },
  ])),
}));

describe("diagnoseConcern", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path — 3 stages return validated picks", async () => {
    // ... arrange catalog + concern
    const result = await diagnoseConcern({ /* ... */ });
    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.matched_subcategory_slug).toBe("metallic_grinding");
    expect(result.extracted_facts.noise_descriptor).toBe("grinding");
  });

  it("Stage 1 hallucinated category — null match", async () => { /* ... */ });
  it("Stage 1 LLM error — failSafe returns null + low confidence", async () => { /* ... */ });
  it("Stage 2 returns null subcategory — Stage 3 still runs for facts", async () => { /* ... */ });
  it("Stage 3 fails — safe over-ask (every question marked unanswered)", async () => { /* ... */ });
  it("2-attempt retry on transient", async () => { /* ... */ });
  it("Empty description (<3 chars) — short-circuits without LLM call", async () => { /* ... */ });
  it("chip hint propagates to Stage 1 prompt", async () => { /* ... */ });
  it("Stage 1 + Stage 2 self-reported confidence preserved", async () => { /* ... */ });
  // ... 6 more
});
```

**Verification:**
1. `cd scheduler-app && npm run test diagnose-concern` — all pass
2. Coverage: line coverage >80% on `diagnose-concern.ts`

### Phase 4B — `run-diagnostics.ts` unit tests (1 day, ~10 tests)

**Goal:** Cover the per-concern parallel LLM aggregator + dedup + routing.

**Files to add:**
- `scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.test.ts`
- Mock `diagnoseConcern` + `loadDiagnosticCatalog` + the supabase admin client

**Sample tests:**
- Single concern, testing service match → routes to clarification_question (pending non-empty)
- Multi-concern dedup (2 concerns both → brake_inspection) → 1 unique service in recommendations
- All concerns return null → second_routine_pass
- All concerns return "other" subcategory → second_routine_pass
- Mixed: 2 testing service + 1 other → testing_service_approval
- Idempotency: re-invoking after `diagnostic_processing_complete=true` returns without re-running LLM
- Catalog load failure → action returns ok:false
- One concern's `diagnoseConcern` throws — `Promise.all` would fail-fast; verify our code uses `allSettled` (or accept current behavior as documented)

### Phase 4C — Tekmetric webhook tests (1 day, ~12 Deno tests)

**Goal:** Cover signature + idempotency + 5 flow paths in both `tekmetric-webhook` and `keytag-tekmetric-webhook`.

**Files to add:**
- `supabase/functions/tekmetric-webhook/index.test.ts`
- `supabase/functions/keytag-tekmetric-webhook/index.test.ts`

**Approach (from research §5):**
- Use `using { stub } = ...` to stub `fetch` returns
- Real-Supabase integration: spin up `supabase start` in CI, point handler at local DB
- Assert webhook_events insert path (idempotency)
- Assert each flow path's downstream effects (DB row written, edge fn called, Sentry capture)

**Sample tests for tekmetric-webhook:**
- Valid token + new payload → 200 + row inserted
- Valid token + duplicate payload (same hash) → 200 + no new row
- Invalid token → 401 + Sentry.captureMessage('warning')
- Body too large (DoS guard) → 413
- Missing `action_type` → 400 (with structured error)
- Token query param stripped before persistence

**For keytag-tekmetric-webhook, 5 flow paths × happy + failure:**
- `ro_work_approved` → tag auto-assigned + Tekmetric PATCH
- `ro_status_updated` → status sync
- `ro_sent_to_ar` → mark posted_ar
- `ro_posted` → release tag
- `payment_made` → release tag
- Each path's Tekmetric PATCH failure → captured to Sentry + DB row still updated

### Phase 4D — Playwright wizard happy-path (1 day)

**Goal:** Create `playwright.config.ts` + wire 1 happy-path test for the wizard.

**Files to add:**
- `scheduler-app/playwright.config.ts`
- `scheduler-app/e2e/wizard-happy-path.spec.ts`

**Config (from research §6):**
```typescript
// scheduler-app/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    extraHTTPHeaders: {
      // Vercel preview deployment bypass for CI
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
        "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      }),
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
});
```

**OTP bypass via test-mode env:**
```typescript
// scheduler-app/src/lib/scheduler/wizard/llm/parse-customer-note.ts (in OTP send path)
// In test mode (TEST_MODE_OTP_BYPASS_PHONE_PREFIX set), return a canned code
// for phone numbers matching the prefix
const TEST_MODE_PREFIX = process.env.TEST_MODE_OTP_BYPASS_PHONE_PREFIX;
if (TEST_MODE_PREFIX && phoneE164.startsWith(TEST_MODE_PREFIX)) {
  return { code: "999999", expires_at: /* ... */ };
}
```

**Test:**
```typescript
// scheduler-app/e2e/wizard-happy-path.spec.ts
import { test, expect } from "@playwright/test";

test("wizard happy-path: brake_squealing → confirmation", async ({ page }) => {
  await page.goto("/book-v2");
  await expect(page.getByText("Hello!")).toBeVisible();
  await page.getByText("Let's go").click();

  // Phone + name
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill("Customer");
  await page.getByLabel("Phone").fill("+15555550100"); // matches TEST_MODE prefix
  await page.getByText("Continue").click();

  // OTP (bypassed via test mode — code is "999999")
  await page.getByLabel("Code").fill("999999");
  await page.getByText("Verify").click();

  // Vehicle pick (assume seed has a vehicle for this customer)
  await page.getByText(/Toyota Camry/i).first().click();

  // Service picker — pick "💬 Other Issue" + concern
  await page.getByText("Other Issue").click();
  await page.getByLabel("Concern").fill("brakes squealing when I stop");
  await page.getByText("Continue").click();

  // Diagnostic loading
  await expect(page.getByText("brake_inspection")).toBeVisible({ timeout: 30_000 });

  // Date pick — pick the next available date
  await page.getByRole("button", { name: /next month/i }).click();
  await page.getByRole("button", { name: /^15$/ }).click();

  // Waiter time pick
  await page.getByText(/9:00 AM/).click();

  // Summary
  await page.getByText("Confirm").click();
  await expect(page.getByText(/You're booked/i)).toBeVisible({ timeout: 15_000 });
});
```

**Verification:**
1. Local: `cd scheduler-app && npx playwright install chromium && npm run test:e2e`
2. CI: add Playwright job to `.github/workflows/ci.yml`

**Risk + rollback:**
- LOW. The test-mode OTP bypass is gated on an env var that's NOT set in production. If something goes wrong, the test fails — no production effect.

---

## Phase 5 — A2P 10DLC verification (I-INT-5, ~30 min + dashboard time)

**Goal:** Confirm Telnyx brand + campaign are registered with TCR for our OTP traffic. Unregistered traffic is FULLY BLOCKED since Feb 2025 — this is a hard launch blocker that's invisible until you try to send.

**Steps:**

1. **List brands:**
   ```bash
   curl.exe -X GET "https://api.telnyx.com/v2/10dlc/brand" \
     -H "Authorization: Bearer $TELNYX_API_KEY" \
     -H "Accept: application/json"
   ```
   Expects at least 1 brand with `status: VETTED_VERIFIED` (or `VERIFIED`).

2. **List campaigns:**
   ```bash
   curl.exe -X GET "https://api.telnyx.com/v2/10dlc/campaign" \
     -H "Authorization: Bearer $TELNYX_API_KEY" \
     -H "Accept: application/json"
   ```
   Expects at least 1 campaign with `usecase: "2FA"`, `status: ACTIVE`, and our `TELNYX_FROM_NUMBER` in the `phone_numbers` array.

3. **If unregistered:**
   - Register brand via Telnyx Mission Control portal (Compliance → 10DLC)
   - Pay Enhanced Vetting (~$40) for higher Trust Score → higher MPS throughput
   - Register campaign with `usecase: '2FA'`
   - Associate `TELNYX_FROM_NUMBER` with the campaign

4. **Document in DEFERRED-AUDIT-ITEMS.md:**
   - Brand ID
   - Campaign ID
   - TCR Trust Score
   - Use case
   - MPS limit (Messages Per Second)

**Verification:**
1. After registration, send a real OTP to a test number from each carrier (AT&T, Verizon, T-Mobile) — verify delivery
2. Check `cron.job_run_details` for any Telnyx `auth` or `provider_error` errors

**Risk + rollback:**
- LOW. Worst case the registration takes 1-2 weeks to approve. Plan accordingly — Chris should start registration NOW even before Phase 1-4 land.

---

## Sequence with other plans

- **Plan 02 (Observability)** depends on Phase 3 (CI) being in place — adding `withSentryScope` wraps without CI risks regressions.
- **Plan 03 (Security)** depends on Phase 1A (edge fn auth) — additional security work builds on the bearer-check pattern established here.
- **Plan 04 (Atomicity)** depends on Phase 4 (tests) — refactoring multi-step writes into RPCs without tests is a recipe for new bugs.
- **Plan 05 (Integrations)** can run in parallel with Plan 04 — independent surfaces.
- **Plan 06 (Test expansion)** depends on Phase 3 + Phase 4 — establishes the test patterns + CI infrastructure.

## Open questions for Chris

1. **Phase 1B decision:** drop or schema-move `_bulk_keytag_backfill` + `_smoke_test_run`? Recommend DROP if grep returns zero references (likely).
2. **A2P 10DLC:** are brand + campaign already registered? If not, start the registration NOW in parallel with Phase 1-4 (1-2 week approval window).
3. **Playwright test environment:** local Supabase via `supabase start`, or against a Supabase branch, or against a Vercel preview deployment? Recommend local for CI (fastest, most isolated).

## Success criteria

Plan 01 is complete when:
- [ ] All 10 BLOCKERs from the audit + I-OBS-2 + I-INT-5 are closed
- [ ] CI workflow gates every PR + push to main
- [ ] Lint runs on every commit via husky
- [ ] `diagnose-concern.ts` + `run-diagnostics.ts` + both Tekmetric webhook handlers have unit/Deno tests
- [ ] One Playwright wizard happy-path test runs in CI
- [ ] Telnyx 10DLC brand + campaign verified registered with `status: ACTIVE`
- [ ] Supabase advisors show zero `rls_disabled` warnings
- [ ] `cron.job_run_details` shows `scheduler-admin-snapshot-prune` succeeded at least once

**Estimated effort:** 6-8 days of focused work.

**Estimated calendar time:** 1.5 weeks (allowing for A2P 10DLC approval window in parallel).
