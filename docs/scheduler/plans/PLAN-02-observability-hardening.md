---
plan: 02
title: Observability hardening
audit_findings: [I-OBS-1, I-OBS-3, I-OBS-4, I-OBS-5, I-OBS-7, I-OBS-8, I-INT-6]
research_inputs: [research-sentry-observability]
estimated_effort: 3 days
prerequisites: [Plan-01 Phase 3 (CI gate)]
risk_level: low
---

# Plan 02 — Observability hardening

> Close every gap that lets a real production issue go silently undetected. None of these are emergencies, but combined they're the difference between "we see the issue immediately" and "we hear about it from a customer."

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **I-OBS-1** | obs | 13 of 17 edge fns lack `withSentryScope` (breadcrumb leak across concurrent Deno requests) | 1 |
| **I-OBS-3** | obs | Webhook receivers silently 401 on token-mismatch — no Sentry warning | 2 |
| **I-OBS-8** | obs | Stale `captureMessage` info calls surface as Sentry issues (false alarms) | 2 |
| **I-OBS-4** | obs | 4 scheduler crons have no Sentry Cron Monitoring check-ins | 3 |
| **I-OBS-5** | obs | `diagnose-concern.ts` Anthropic SDK direct path emits no `gen_ai.*` spans (no token/cost visibility) | 4 |
| **I-INT-6** | obs | Anthropic prompt cache hit-rate not measured | 4 |
| **I-OBS-7** | obs | `scheduler_error_log` schema column inconsistency (created_at vs occurred_at) | 5 |

## Research summary

- **Sentry Deno SDK does NOT auto-instrument `Deno.serve`** — no scope separation between concurrent requests in warm isolates. Pattern: `defaultIntegrations: false` + wrap entire handler in `Sentry.withScope` + **`await Sentry.flush(2000)` before response** (otherwise events drop on isolate shutdown). [sentry-observability §1]
- **Cron Monitoring HTTP API:** curl-pingable URL `https://<org-ingest>/api/<project-id>/cron/<slug>/<public-key>/?status=in_progress|ok|error`. Can fire from `pg_net` directly — no SDK needed in process. Monitor auto-upserts via `monitor_config` in the first `in_progress` envelope. Rate limited to 6/min/monitor. [§2]
- **`anthropicAIIntegration` (SDK ≥ 10.12.0) auto-instruments direct `@anthropic-ai/sdk` calls** — but does NOT cover Anthropic-via-AI-Gateway. For Gateway: manual `Sentry.startSpan({op: 'gen_ai.chat', attributes: {...}})`. Full attribute schema in research output. **CRITICAL gotcha:** cached/reasoning tokens are SUBSETS of `input_tokens`, not additions — `input_tokens.cached > input_tokens` produces NEGATIVE cost on Sentry's dashboard. [§3]
- **Prompt cache hit-rate formula:** `cache_reads / (cache_reads + cache_writes)`. **CRITICAL:** `system` MUST be an array of content blocks with `cache_control`, not a string (string form silently disables caching). [§4]
- **Webhook signature failure pattern:** `captureMessage(msg, 'warning')` inside `withScope` + `setFingerprint(['webhook-sig-fail', provider, route])` to group attacks into ONE Sentry issue. Configure alert: `level:warning AND count > 10/5min` → security channel. [§5]
- **`captureMessage` at ANY level creates an issue** — even `level: 'info'`. The 2026 fix for "telemetry without issues" is `Sentry.logger.info/.warn/.error` (separate log envelope, never creates an issue). Requires `enableLogs: true` (default in SDK 10.x). [§8]

---

## Phase 1 — Wrap 13 unwrapped edge functions (I-OBS-1, ~1 day)

**Goal:** Every `Deno.serve` handler wrapped in `Sentry.withScope` from `_shared/sentry-edge.ts`. Closes multi-tenant breadcrumb leak.

**13 functions to wrap** (per Agent 2 audit + Agent 5 confirmation):
1. `supabase/functions/tekmetric-webhook/index.ts`
2. `supabase/functions/keytag-tekmetric-webhook/index.ts`
3. `supabase/functions/llm-testing/index.ts`
4. `supabase/functions/tekmetric-bootstrap/index.ts`
5. `supabase/functions/tekmetric-api-testing/index.ts`
6. `supabase/functions/orchestrator-mcp/index.ts`
7. `supabase/functions/mcp-auth/index.ts`
8. `supabase/functions/scheduler-step2-direct/index.ts`
9. `supabase/functions/scheduler-otp-direct/index.ts`
10. `supabase/functions/scheduler-booking-direct/index.ts`
11. `supabase/functions/keytag-seed-from-tekmetric/index.ts`
12. `supabase/functions/tekmetric-list-wip-keytags/index.ts`
13. `supabase/functions/tekmetric-find-ro-by-keytag/index.ts`

**Canonical wrap (verify `_shared/sentry-edge.ts` exports this shape):**

```typescript
import { withSentryScope } from "../_shared/sentry-edge.ts";

Deno.serve(async (req) =>
  withSentryScope(req, "scheduler-otp-direct", async (scope) => {
    // ... existing handler body
    // scope.setTag(...), scope.setUser(...) inside this block stay scoped
  })
);
```

**`_shared/sentry-edge.ts` `withSentryScope` should ensure:**
- `defaultIntegrations: false` on init (already present per research)
- `Sentry.withScope` wraps the entire handler
- Region/execution_id tags set INSIDE the scope (not globally)
- `await Sentry.flush(2000)` BEFORE the response (per Topic 1 research — otherwise events drop on isolate shutdown)

**Verification:**
1. `npx supabase functions deploy <each-of-13>`
2. Trigger each function (real or smoke-test) → Sentry shows isolated breadcrumbs per request
3. Spot check: invoke 2 concurrent requests on `scheduler-otp-direct` → no shared breadcrumb leak

**Risk + rollback:**
- LOW. Adding `withSentryScope` is purely additive. Rollback per-function by reverting the import + wrap.

---

## Phase 2 — Webhook signature failure alerting + captureMessage cleanup (I-OBS-3 + I-OBS-8, ~3 hours)

### Phase 2A — Webhook 401 alerts (I-OBS-3)

**Goal:** Add `Sentry.captureMessage('warning')` on token-mismatch + fingerprint to dedupe attacks into ONE issue.

**Files:**
- `supabase/functions/tekmetric-webhook/index.ts:153-157`
- `supabase/functions/keytag-tekmetric-webhook/index.ts:297-298`

**Code (canonical):**
```typescript
// At the 401 branch in each webhook
if (!bearersEqual(tokenParam, WEBHOOK_TOKEN)) {
  await Sentry.withScope((scope) => {
    scope.setLevel("warning");
    scope.setTag("surface", "tekmetric-webhook");
    scope.setTag("event", "signature_fail");
    scope.setFingerprint(["webhook-sig-fail", "tekmetric", "/functions/v1/tekmetric-webhook"]);
    scope.setContext("request", {
      ip: req.headers.get("x-real-ip") ?? "unknown",
      user_agent: req.headers.get("user-agent") ?? "unknown",
      url: req.url,
    });
    Sentry.captureMessage("Tekmetric webhook signature failed", "warning");
  });
  return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
}
```

**Sentry alert rule (one-time setup, manual in Sentry dashboard):**
- `tags.event:signature_fail AND count > 10 in 5 minutes` → fires to security channel

**Verification:**
1. Curl webhook with wrong token: `curl.exe -X POST "...?token=WRONG" -d '{}'`
2. Check Sentry: one warning event with fingerprint `webhook-sig-fail:tekmetric:/functions/v1/tekmetric-webhook`
3. 12 retries → one issue (not 12) with count=12 → alert fires

### Phase 2B — Downgrade info-level captureMessage to Sentry.logger.info (I-OBS-8)

**Goal:** Stop spurious "issues" from `runDiagnostics` routing-decision breadcrumbs.

**Audit cited issues:** J + G in Sentry — `runDiagnostics: 1 concern(s) → second_routine_pass` and similar.

**Files (need to audit then fix):**
```bash
grep -rn "Sentry.captureMessage" scheduler-app/src/ supabase/functions/ | grep -v test
```

For each call, decide:
- **Security-relevant** (signature fail, auth fail, RFC violation) → keep `captureMessage('warning')` with fingerprint
- **Informational telemetry** (routing decision, cache hit, retry attempt) → migrate to `Sentry.logger.info(...)`
- **Error-equivalent** (real failure not throwing) → upgrade to `captureException`

**Migration pattern:**
```typescript
// BEFORE
Sentry.captureMessage("runDiagnostics: 1 concern(s) → second_routine_pass", {
  level: "info",
  tags: { chat_id, surface: "run-diagnostics" },
});

// AFTER
Sentry.logger.info("runDiagnostics: {result}", {
  result: "second_routine_pass",
  concern_count: 1,
  chat_id,
  surface: "run-diagnostics",
});
```

**Configuration check** — verify `enableLogs: true` in:
- `scheduler-app/sentry.server.config.ts`
- `scheduler-app/sentry.edge.config.ts`
- `scheduler-app/sentry.client.config.ts` (or instrumentation-client.ts)

**Cleanup:** mark the 4 stale Sentry issues (J, G, K, A) as resolved or deleted via Sentry dashboard.

**Verification:**
1. Trigger a `runDiagnostics` call that previously created an "issue" → no new issue created, telemetry visible in Sentry Logs UI
2. Verify Sentry's Issue stream no longer fills with routing decisions

**Risk + rollback:**
- LOW. `Sentry.logger` is additive. If something doesn't surface, fall back to `captureMessage('info')`.

---

## Phase 3 — Sentry Cron Monitoring on 4 scheduler crons (I-OBS-4, ~4 hours)

**Goal:** Sentry alerts when a cron MISSES (doesn't fire at all) or FAILS (fires but errors). Currently we only see failures via `scheduler_error_log` query.

**4 crons to monitor:**
1. `scheduler-appointments-sync` — `*/10 * * * *`
2. `scheduler-transcript-dispatcher` — `*/5 * * * *`
3. `keytag-bulk-reconcile` — `0 10 * * *`
4. `keytag-daily-report` — `0 11 * * *`

(Plus `scheduler-hold-reaper`, `scheduler-error-log-prune`, `scheduler-admin-snapshot-prune` — research suggests less critical since they're DB-internal and easier to spot-check, but optional to add.)

**Approach:** HTTP API check-ins via `pg_net.http_post` from within the cron body itself. No SDK needed in the Deno fn.

**New migration:**
```sql
-- supabase/migrations/20260522NNNNNN_sentry_cron_checkins.sql
BEGIN;

-- Helper that fires a check-in to Sentry
CREATE OR REPLACE FUNCTION public.sentry_cron_checkin(
  p_monitor_slug TEXT,
  p_status TEXT, -- 'in_progress', 'ok', 'error'
  p_check_in_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dsn TEXT;
  v_project_id TEXT;
  v_public_key TEXT;
  v_ingest_host TEXT;
  v_url TEXT;
  v_check_in_id UUID;
BEGIN
  v_dsn := public.tekmetric_get_secret('sentry_dsn'); -- store in Vault
  -- parse DSN: https://<public-key>@<ingest-host>/<project-id>
  v_public_key := split_part(split_part(v_dsn, '@', 1), '//', 2);
  v_ingest_host := split_part(split_part(v_dsn, '@', 2), '/', 1);
  v_project_id := split_part(v_dsn, '/', length(v_dsn) - length(replace(v_dsn, '/', '')) + 1);

  v_check_in_id := coalesce(p_check_in_id, gen_random_uuid());

  v_url := format(
    'https://%s/api/%s/cron/%s/%s/?status=%s&check_in_id=%s',
    v_ingest_host, v_project_id, p_monitor_slug, v_public_key, p_status, v_check_in_id::text
  );

  -- For first check-in (in_progress), include monitor_config to upsert
  IF p_status = 'in_progress' THEN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'monitor_config', jsonb_build_object(
          'schedule', jsonb_build_object('type', 'crontab', 'value', '*/10 * * * *'),
          'checkin_margin', 5,
          'max_runtime', 30,
          'timezone', 'UTC'
        )
      ),
      timeout_milliseconds := 5000
    );
  ELSE
    PERFORM net.http_get(url := v_url, timeout_milliseconds := 5000);
  END IF;

  RETURN v_check_in_id;
END;
$$;

-- Wrap each cron body with check-ins
SELECT public.cron_unschedule_if_exists('scheduler-appointments-sync');
SELECT cron.schedule(
  'scheduler-appointments-sync',
  '*/10 * * * *',
  $cron$
  DO $body$
  DECLARE
    v_check_in_id UUID;
  BEGIN
    v_check_in_id := public.sentry_cron_checkin('scheduler-appointments-sync', 'in_progress');
    BEGIN
      PERFORM public.scheduler_invoke_edge_function('appointments-sync', '{}'::jsonb);
      PERFORM public.sentry_cron_checkin('scheduler-appointments-sync', 'ok', v_check_in_id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.sentry_cron_checkin('scheduler-appointments-sync', 'error', v_check_in_id);
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES (
        'cron', 'scheduler-appointments-sync', 'cron/scheduler-appointments-sync',
        'error', SQLSTATE, SQLERRM
      );
      RAISE;
    END;
  END;
  $body$;
  $cron$
);

-- Repeat for the other 3 crons (transcript-dispatcher, keytag-bulk-reconcile, keytag-daily-report)
-- ... with each cron's specific schedule in the monitor_config

COMMIT;
```

**Configuration check:**
- Store the project's Sentry DSN in Vault: `SELECT public.tekmetric_set_secret('sentry_dsn', 'https://<key>@<host>/<id>', 'Sentry project DSN for cron check-ins');`

**Verification:**
1. Apply migration: `npx supabase db push`
2. Wait 10 min for `scheduler-appointments-sync` to fire OR manually invoke
3. Sentry → Crons → expect to see `scheduler-appointments-sync` monitor with status `OK`
4. Force a failure (e.g., temporarily break the edge fn) → Sentry shows `ERROR` check-in
5. Skip a run (kill the cron) → Sentry alerts "missed" after the next expected window

**Risk + rollback:**
- MEDIUM. The cron body change is the same kind of change that broke `scheduler-admin-snapshot-prune` — be CAREFUL with the dollar-quote nesting and the `EXCEPTION` placement. Test the migration on a Supabase branch first.
- Rollback: re-apply the pre-this-migration cron schedule (saved by `cron_unschedule_if_exists`).

---

## Phase 4 — Anthropic prompt cache hit-rate + gen_ai.* spans (I-OBS-5 + I-INT-6, ~1 day)

**Goal:** Make Anthropic token usage + cache effectiveness visible in Sentry. Currently flying blind.

### Phase 4A — Wrap each diagnostic stage in a manual span

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts:854-910` (`callAnthropicStage` function)

**Code:**
```typescript
async function callAnthropicStage<T>(
  stageName: "stage1" | "stage2" | "stage3",
  client: Anthropic,
  args: {
    model: string;
    system: Anthropic.MessageParam["content"]; // MUST be array of blocks for caching
    messages: Anthropic.MessageParam[];
    schema: object;
    temperature: number;
  },
): Promise<StageResult<T>> {
  return Sentry.startSpan(
    {
      name: `diagnose-concern.${stageName}`,
      op: "gen_ai.chat",
      attributes: {
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": args.model,
        "gen_ai.request.temperature": args.temperature,
      },
    },
    async (span) => {
      const start = Date.now();
      const res = await client.beta.messages.create({
        model: args.model,
        max_tokens: 4096,
        system: args.system,
        messages: args.messages,
        // ... structured outputs beta config
      });

      const inputTokens = res.usage?.input_tokens ?? 0;
      const outputTokens = res.usage?.output_tokens ?? 0;
      const cacheReadTokens = (res.usage as any)?.cache_read_input_tokens ?? 0;
      const cacheWriteTokens = (res.usage as any)?.cache_creation_input_tokens ?? 0;

      span.setAttributes({
        "gen_ai.response.id": res.id,
        "gen_ai.usage.input_tokens": inputTokens, // total, INCLUDES cached
        "gen_ai.usage.output_tokens": outputTokens,
        "gen_ai.usage.input_tokens.cached": cacheReadTokens, // SUBSET of input_tokens
        "gen_ai.usage.input_tokens.cache_write": cacheWriteTokens, // SUBSET of input_tokens
        "gen_ai.response.finish_reasons": [res.stop_reason ?? "unknown"],
        "scheduler.stage": stageName,
        "scheduler.latency_ms": Date.now() - start,
      });

      // Parallel log for ad-hoc queries
      Sentry.logger.info("anthropic_call_complete", {
        stage: stageName,
        model: args.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read: cacheReadTokens,
        cache_write: cacheWriteTokens,
        latency_ms: Date.now() - start,
      });

      return res;
    }
  );
}
```

**CRITICAL gotcha (research §3):** Don't make `cache_read_input_tokens > input_tokens` — they're a subset, not separate. Sentry's cost calculation breaks if you set them up wrong.

### Phase 4B — Restructure system prompts as cache-control blocks

**Goal:** Verify Anthropic prompt caching is actually working (research §4 says `caching: 'auto'` may or may not actually mark `cache_control` — verify by inspecting the request).

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` (where each stage's system prompt is built)

**Change Stage 1 prompt from string to array of blocks:**
```typescript
// BEFORE
const stage1SystemPrompt = `You are the diagnostic categorisation helper for Jeff's Automotive...`;

// AFTER (stable prefix gets cache_control)
const stage1SystemPrompt = [
  {
    type: "text" as const,
    text: `You are the diagnostic categorisation helper for Jeff's Automotive...
... (static catalog of 23 testing services + 6 'other' subcategories — stable across all calls)
... (decision rules — stable)`,
    cache_control: { type: "ephemeral" as const },
  },
  {
    type: "text" as const,
    text: `<chip hint line and customer description follow below as USER message>`,
    // No cache_control — this part varies per call
  },
];
```

**Same for Stage 2 (per-category subtree is cacheable per-subtree) and Stage 3 (29-slot schema is fully static).**

**Dashboard creation (manual in Sentry):**
- Create dashboard "Diagnose-concern LLM cost"
- Widgets:
  - Total tokens / call by stage (avg, p95, p99)
  - Cache hit rate = `cache_read / (cache_read + cache_write)` over 7d
  - Cost / day (compute from token rates)
  - Latency by stage (p50, p95)
  - Stage 1 confidence distribution

**Verification:**
1. Deploy + invoke diagnose-concern with a real concern
2. Sentry → Performance → search `op:gen_ai.chat` → see 3 spans per concern with token attributes
3. Sentry → AI Agents view → diagnose-concern shows up
4. Hit rate climbs >50% after a few calls

**Risk + rollback:**
- LOW. Manual spans are additive. If something doesn't work, the surrounding 2-attempt retry already protects correctness.
- Cache_control restructure: if the new array form breaks (unlikely — Anthropic supports both), revert. Don't enable both `providerOptions.gateway.caching: 'auto'` AND explicit `cache_control` — pick one.

---

## Phase 5 — `scheduler_error_log` column name fix (I-OBS-7, ~30 min)

**Goal:** Determine canonical column name (`created_at` vs `occurred_at`) and update all callers + docs.

**Investigation step:**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'scheduler_error_log'
ORDER BY ordinal_position;
```

Based on the MCP probe error in the audit, the table has `occurred_at` (not `created_at`). Update:

**Files (audit shows many references in migrations):**
- All references to `scheduler_error_log.created_at` in code → change to `occurred_at`

```bash
grep -rn "scheduler_error_log.*created_at\|created_at.*scheduler_error_log" scheduler-app/ supabase/ docs/
```

**Update docs:**
- `docs/scheduler/audit-2026-05-22/07-orchestrator-mcp-probes.md` already references `occurred_at` correctly
- `.claude/memory/scheduler/scheduler_system_architecture.md` — verify reference

**Verification:**
1. `grep -rn "scheduler_error_log" scheduler-app/ supabase/ docs/` — confirm no `created_at` references on this table
2. Sample query `SELECT MAX(occurred_at) FROM scheduler_error_log;` → returns a date

**Risk + rollback:**
- LOW. Doc/grep change only. No data migration.

---

## Sequence with other plans

- **Plan 01 Phase 3 (CI gate)** must be done first — adding `withSentryScope` wraps to 13 functions without CI risks regressions.
- Independent of Plans 03, 04, 05, 06, 07 — runs in parallel.

## Open questions for Chris

1. **Sentry Cron Monitoring DSN:** what's the project's full DSN? Need to add to Supabase Vault as `sentry_dsn` secret.
2. **Sentry alert channel for webhook sig-fail:** is there an existing security channel (Slack? PagerDuty? email-only)? Where should the alert route?
3. **`captureMessage` audit:** before mass-migrating to `Sentry.logger`, do you want a pull request that LISTS all 30+ existing calls + your decision per-call (info → logger vs warning → keep vs error → captureException)?

## Success criteria

- [ ] All 17 Deno edge functions wrap `Deno.serve` in `withSentryScope`
- [ ] Both Tekmetric webhook receivers fire `captureMessage('warning')` on sig-fail
- [ ] No "false issue" alerts from routing-decision `captureMessage` calls; they appear in Logs UI instead
- [ ] All 4 scheduler crons have Sentry monitor records updating on every fire
- [ ] Sentry "Diagnose-concern LLM cost" dashboard renders with all 5 widgets
- [ ] Anthropic prompt cache hit rate > 50% on Stage 1 (Stage 2/3 may be lower)
- [ ] `scheduler_error_log.occurred_at` is the consistently-used column name everywhere

**Estimated effort:** 3 days.
