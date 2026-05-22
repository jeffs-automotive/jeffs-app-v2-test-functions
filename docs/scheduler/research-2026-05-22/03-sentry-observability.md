---
schema_version: "2.0"
agent: research-sentry-observability
tier: "01-research"
timestamp: "2026-05-22T16:00:00Z"
module_slug: null
module_short_code: null
module_number: null
run_id: null
parent_artifacts: []
sources_cited:
  - https://supabase.com/docs/guides/functions/examples/sentry-monitoring
  - https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/functions/examples/sentry-monitoring.mdx
  - https://docs.sentry.io/platforms/javascript/guides/deno/enriching-events/scopes/
  - https://docs.sentry.io/platforms/javascript/guides/deno/crons/
  - https://docs.sentry.io/platforms/javascript/guides/node/crons/
  - https://docs.sentry.io/product/crons/getting-started/http/
  - https://develop.sentry.dev/sdk/telemetry/check-ins/
  - https://docs.sentry.io/platforms/javascript/guides/node/ai-agent-monitoring/
  - https://docs.sentry.io/platforms/javascript/guides/node/tracing/instrumentation/ai-agents-module/
  - https://develop.sentry.dev/sdk/telemetry/traces/modules/ai-agents/
  - https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/
  - https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/anthropic/
  - https://startdebugging.net/2026/04/how-to-add-prompt-caching-to-an-anthropic-sdk-app-and-measure-the-hit-rate/
  - https://technspire.com/en/blog/prompt-caching-2026-real-cost-wins
  - https://docs.sentry.io/platforms/javascript/configuration/filtering/
  - https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/
  - https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/
  - https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/
  - https://docs.sentry.io/platforms/javascript/enriching-events/fingerprinting/
  - https://docs.sentry.io/concepts/data-management/event-grouping/fingerprint-rules/
  - https://docs.sentry.io/product/ai-in-sentry/seer/
  - https://docs.sentry.io/pricing/quotas/manage-seer-budget/
  - https://blog.sentry.io/seer-debug-with-ai-at-every-stage-of-development/
  - https://docs.sentry.io/platforms/javascript/usage/
  - https://docs.sentry.io/platforms/javascript/logs/
  - https://docs.sentry.io/platforms/javascript/guides/node/logs/
  - https://develop.sentry.dev/sdk/telemetry/logs/
status: complete
open_questions:
  - "Sentry's HTTP cron check-in endpoint pattern (https://${ORG_INGEST_DOMAIN}/api/${PROJECT_ID}/cron/${MONITOR_SLUG}/${PUBLIC_KEY}/) — confirm exact host shape for our self-hosted project ID + DSN public key when wiring pg_cron via pg_net."
  - "Does Sentry's anthropicAIIntegration auto-populate gen_ai.usage.input_tokens.cached from Messages-API cache_read_input_tokens? Docs do not state this explicitly; field-test on a real call before relying on dashboards."
  - "Sentry.logger.info create-issue behavior in 2026 SDK versions ≥ 10: docs imply log envelope is separate from event envelope (no issue), but explicit confirmation from a sample event would close the loop."
next_tier_consumers:
  - "orchestrator (Chris) — for adapting findings into implementation plans"
---

# Research: Sentry + observability hardening best practices (2026-current)

Eight topics, pure web research. Each topic carries a summary, best-practice guidance, a canonical code example pulled from the cited source, gotchas, and 3-5 sources.

---

## Topic 1 — Sentry Deno SDK `withScope` per-request isolation in Supabase Edge Functions

### Summary

The Sentry Deno SDK does not (as of May 2026) instrument `Deno.serve`, so the Supabase Edge runtime — which reuses the V8 isolate across requests for a "warm" function — has NO scope separation between tenants. Without explicit per-request scoping, global breadcrumbs and tags from request A leak into request B's exception report. This is a multi-tenant security issue (PII from one shop appearing in another shop's Sentry event), not just an observability quirk. Supabase docs are explicit: *"all globally captured breadcrumbs and contextual data will be shared, which is not the desired behavior."*

### Best practices

1. **Disable default integrations** at init: `defaultIntegrations: false`. The default integrations include `Breadcrumbs`, `LinkedErrors`, `GlobalHandlers`, `ContextLines`, and `FunctionToString` — every one of these stores state on the global scope. Disabling them eliminates the leak source at the root.
2. **Wrap every `Deno.serve` handler body in `Sentry.withScope`** — push a fresh isolation scope per request. Inside the scope, attach tenant context (`scope.setTag("shop_id", ...)`, `scope.setUser({ id: employee_id })`, `scope.setContext("request", { surface, region })`).
3. **`await Sentry.flush(2000)` BEFORE returning the Response.** Deno isolates can be terminated immediately after the Response resolves; un-flushed events are lost. The 2-second timeout balances request latency against event delivery.
4. **Pass context directly to `captureException`/`captureMessage` as a fallback** for codepaths outside the withScope wrap (e.g., top-level `try` outside the handler) — use the 3-arg form `Sentry.captureException(e, { tags: {...}, contexts: {...} })`.
5. **Don't rely on `setTag` calls outside `withScope`** — they mutate the global scope and leak.

### Canonical example (from Supabase docs, augmented per Sentry Deno docs)

```typescript
import * as Sentry from 'https://deno.land/x/sentry/index.mjs'

Sentry.init({
  dsn: SENTRY_DSN,
  defaultIntegrations: false,        // critical — disables global breadcrumbs / handlers
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
})

Deno.serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    // Per-request tenant context — never escapes this scope
    scope.setTag('region', Deno.env.get('SB_REGION'))
    scope.setTag('execution_id', Deno.env.get('SB_EXECUTION_ID'))
    scope.setTag('surface', 'appointments-sync')
    // shop_id/employee_id derived from request body or JWT — set inside scope ONLY

    try {
      const body = await req.json()
      scope.setTag('shop_id', body.shop_id)
      // ... handler work ...
      return new Response(JSON.stringify({ ok: true }))
    } catch (e) {
      Sentry.captureException(e)         // automatically inherits this scope
      await Sentry.flush(2000)           // critical — drain before response
      return new Response(JSON.stringify({ ok: false }), { status: 500 })
    }
  })
})
```

### Gotchas

- The `@supabase/sentry-js-integration` package (npm) does NOT solve this — it instruments Supabase JS client calls (DB queries, RPCs), not the `Deno.serve` request boundary. It's complementary, not a substitute.
- `Sentry.setTag(...)` called outside `withScope` writes to global scope and WILL leak. Lint for this pattern.
- The `region` and `execution_id` tags shown in Supabase docs (set globally) are technically wrong for warm isolates — move them inside the withScope wrap.
- The Deno SDK is imported from `https://deno.land/x/sentry/index.mjs`. Pin a version (`/x/sentry@7.x/index.mjs`) — `x/sentry` without a version pulls latest and can break.

### Sources

- [Monitoring with Sentry | Supabase Docs](https://supabase.com/docs/guides/functions/examples/sentry-monitoring)
- [supabase/supabase sentry-monitoring.mdx on GitHub](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/functions/examples/sentry-monitoring.mdx)
- [Scopes | Sentry for Deno](https://docs.sentry.io/platforms/javascript/guides/deno/enriching-events/scopes/)
- [How does Sentry work on Edge Functions when minimum Deno is 2? · supabase #33629](https://github.com/orgs/supabase/discussions/33629)

---

## Topic 2 — Sentry Cron Monitoring (Check-ins) in 2026

### Summary

Sentry Cron Monitoring tracks two-step check-ins: an `in_progress` envelope when a job starts, and a terminal `ok` or `error` envelope when it finishes. Sentry computes "missed" (never received `in_progress` within the schedule + `checkin_margin`) and "failed" (received `in_progress` but no terminal within `max_runtime`, or explicit `status: error`). The SDK API (`Sentry.withMonitor`, `Sentry.captureCheckIn`) wraps in-process code; the HTTP API (curl-pingable URL) is the path for database-level schedulers like pg_cron that have no SDK in their execution context.

### Best practices

1. **For our 4 scheduler crons** (appointments-sync, transcript-dispatcher, keytag-bulk-reconcile, keytag-daily-report), use the HTTP API approach: have the pg_cron job invoke a Sentry check-in URL via `pg_net` before AND after invoking the edge function. The edge function itself doesn't need to know about cron monitoring — the database is the source of truth for "did this fire on schedule."
2. **Auto-upsert monitors on first check-in** by including `monitor_config` in the initial `in_progress` envelope. No separate "create monitor" step needed. Schedule, timezone, margins all defined in the payload.
3. **Slug naming**: use kebab-case, prefix by domain (`scheduler-appointments-sync`, `scheduler-transcript-dispatcher`). Slugs are visible in alert messages and Slack notifications, so keep them human-readable.
4. **Pass a `check_in_id` (UUID)** between in_progress and terminal calls to disambiguate overlapping executions — same monitor running twice at once won't confuse Sentry's bookkeeping.
5. **`checkin_margin: 1` (minute)** for tight crons that run every few minutes; `checkin_margin: 5-10` for crons running hourly+. `max_runtime` should be 1.5x your p99 runtime — too tight produces false "failed" alerts.
6. **`failure_issue_threshold: 2` and `recovery_threshold: 1`** is a sensible default — don't issue on first miss (could be transient), but resolve immediately on recovery.

### Canonical example — HTTP API for pg_cron

```sql
-- pg_cron job that pings Sentry check-in before + after invoking edge function
SELECT cron.schedule(
  'scheduler-appointments-sync',
  '*/15 * * * *',  -- every 15 min
  $$
  WITH checkin AS (
    SELECT net.http_get(
      url := 'https://o<org>.ingest.us.sentry.io/api/<project_id>/cron/scheduler-appointments-sync/<public_key>/?status=in_progress'
    ) AS req_id
  ),
  invoke AS (
    SELECT net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/appointments-sync',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_fn_secret'))
    ) AS req_id
  )
  SELECT net.http_get(
    url := 'https://o<org>.ingest.us.sentry.io/api/<project_id>/cron/scheduler-appointments-sync/<public_key>/?status=ok'
  );
  $$
);
```

Auto-upserting via JSON body (POST instead of GET):

```json
{
  "monitor_config": {
    "schedule": { "type": "crontab", "value": "*/15 * * * *" },
    "checkin_margin": 1,
    "max_runtime": 10,
    "timezone": "America/Los_Angeles",
    "failure_issue_threshold": 2,
    "recovery_threshold": 1
  },
  "status": "in_progress"
}
```

For the edge function side (Sentry SDK in process — alternative pattern):

```typescript
const checkInId = Sentry.captureCheckIn(
  { monitorSlug: 'scheduler-appointments-sync', status: 'in_progress' },
  {
    schedule: { type: 'crontab', value: '*/15 * * * *' },
    checkinMargin: 1,
    maxRuntime: 10,
    timezone: 'America/Los_Angeles',
  }
)
try {
  // ... work ...
  Sentry.captureCheckIn({ checkInId, monitorSlug: 'scheduler-appointments-sync', status: 'ok' })
} catch (e) {
  Sentry.captureCheckIn({ checkInId, monitorSlug: 'scheduler-appointments-sync', status: 'error' })
  throw e
} finally {
  await Sentry.flush(2000)
}
```

### Gotchas

- **Sentry rate-limits check-ins to 6/minute per monitor environment.** For high-frequency jobs (>6/min), batch into a wrapper monitor or skip Sentry crons entirely (use uptime monitors instead).
- **`max_runtime` is in MINUTES, not seconds.** Easy to set 30 thinking 30s and end up with 30-minute timeouts.
- **HTTP-API check-ins don't auto-include the trace context** — events occurring inside the edge function that fires won't be linked to the cron monitor unless you also do an SDK check-in inside.
- **Don't use HTTP-API check-in with the SDK simultaneously** for the same monitor — race condition on which check-in "wins" the slot.
- **`Sentry.withMonitor` does NOT create a new trace** — events inside associate with the current trace context. If you need a clean trace per cron tick, use `Sentry.startNewTrace` inside.

### Sources

- [Set Up Crons | Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/crons/)
- [Set Up Crons | Sentry for Deno](https://docs.sentry.io/platforms/javascript/guides/deno/crons/)
- [HTTP check-ins | Sentry docs](https://docs.sentry.io/product/crons/getting-started/http/)
- [Check-Ins | Sentry Developer Documentation](https://develop.sentry.dev/sdk/telemetry/check-ins/)
- [Supabase Cron | pg_cron + pg_net docs](https://supabase.com/docs/guides/cron)

---

## Topic 3 — Sentry AI Agent Monitoring + `gen_ai.*` spans for direct Anthropic SDK calls

### Summary

Sentry's AI Agents module is a 2026 product (auto-instrumented via `anthropicAIIntegration` requiring SDK ≥ 10.12.0; manual via `Sentry.startSpan` with `op: "gen_ai.chat"`). It emits OpenTelemetry-compatible `gen_ai.*` span attributes that power three dashboards — AI Agents Overview (cost, tokens, agent run count), Model Details (per-model cost/latency breakdown), Tool Details (per-tool invocation frequency, error rate, p95). Critically, **the integration only auto-instruments calls made via the official `@anthropic-ai/sdk`** — Vercel AI Gateway / AI SDK routes are tracked by `vercelAIIntegration`, not the Anthropic one. For direct SDK calls that the integration misses (because the path through AI Gateway breaks the auto-detect surface), manual span emission is required.

### Best practices

1. **Try `Sentry.anthropicAIIntegration()` first** with `recordInputs/recordOutputs: false` (default unless `sendDefaultPii` is true) — prompts often contain PII for us.
2. **If routing through AI Gateway, you need `Sentry.instrumentAnthropicAiClient(client, opts)`** explicitly per Anthropic client instance — or fall back to manual `Sentry.startSpan` wrapping.
3. **For manual spans, set EXACTLY these attributes** for full dashboard fidelity:
   - `gen_ai.operation.name` = `"chat"` (required)
   - `gen_ai.system` = `"anthropic"` (well-defined value)
   - `gen_ai.request.model` = the model slug you sent (`"claude-sonnet-4-6"`)
   - `gen_ai.response.model` = `result.model` (concrete responding model from response)
   - `gen_ai.usage.input_tokens` = `result.usage.input_tokens` (TOTAL, includes cached)
   - `gen_ai.usage.output_tokens` = `result.usage.output_tokens`
   - `gen_ai.usage.input_tokens.cached` = `result.usage.cache_read_input_tokens` (subset of input_tokens)
   - `gen_ai.usage.input_tokens.cache_write` = `result.usage.cache_creation_input_tokens` (for cache-creation cost)
4. **Span `op` MUST be one of the well-defined values**: `"gen_ai.chat"`, `"gen_ai.invoke_agent"`, `"gen_ai.execute_tool"`, `"gen_ai.embeddings"`, `"gen_ai.text_completion"`, `"gen_ai.handoff"`, `"gen_ai.create_agent"`. Custom op values won't appear in the AI dashboards.
5. **Tag spans with business dimensions** that drive cost attribution: `shop_id`, `surface`, `feature`, `user_tier` (Sentry blog explicitly recommends these for cost slicing).

### Canonical example — manual span wrapping a direct Anthropic SDK call

```typescript
import * as Sentry from '@sentry/node'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()
// Tell Sentry about this client explicitly (in case anthropicAIIntegration didn't pick it up):
const instrumented = Sentry.instrumentAnthropicAiClient(client, {
  recordInputs: false,    // we have PII in prompts
  recordOutputs: false,
})

// Or for a one-off manual span:
await Sentry.startSpan(
  {
    op: 'gen_ai.chat',
    name: 'chat claude-sonnet-4-6',
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.system': 'anthropic',
      'gen_ai.request.model': 'claude-sonnet-4-6',
      'shop_id': shopId,           // custom — for cost attribution
      'surface': 'diagnostic-llm', // custom
    },
  },
  async (span) => {
    const result = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
    })

    span.setAttribute('gen_ai.response.model', result.model)
    // TOTAL input_tokens (which INCLUDES cached) — NOT input_tokens + cache_read
    span.setAttribute('gen_ai.usage.input_tokens',
      result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0))
    span.setAttribute('gen_ai.usage.output_tokens', result.usage.output_tokens)
    span.setAttribute('gen_ai.usage.input_tokens.cached', result.usage.cache_read_input_tokens ?? 0)
    span.setAttribute('gen_ai.usage.input_tokens.cache_write',
      result.usage.cache_creation_input_tokens ?? 0)

    return result
  }
)
```

### Gotchas — CRITICAL

- **Cached and reasoning tokens are SUBSETS, not additions.** `gen_ai.usage.input_tokens` MUST be the total INCLUDING the cached portion. The Anthropic response field `input_tokens` is the non-cached portion only. So our math is `total = input_tokens + cache_read_input_tokens`. Setting `gen_ai.usage.input_tokens.cached` larger than `gen_ai.usage.input_tokens` produces NEGATIVE costs in Sentry's dashboards (Sentry subtracts cached count from total to compute the un-cached rate). This bit other vendors (Langfuse issue #12306) and will bite us if we copy the field naively.
- **`gen_ai.input.messages` and `gen_ai.output.messages`** are stringified JSON. If you opt into recordInputs/recordOutputs, set these as `JSON.stringify(messages)` — and PII-scrub them via `beforeSendSpan` since they contain user prompts.
- **The auto-integration won't pick up an Anthropic client built behind a wrapper** (factory function returning a new client per call) — instrument the constructed client manually.
- **AI dashboards require `tracesSampleRate > 0`** (and ideally `streamGenAiSpans: true` for streaming SDK calls). If you have `tracesSampleRate: 0` for cost reasons, AI dashboards are blind.
- **`gen_ai.cost.*` is optional** — Sentry computes USD cost from token counts × Anthropic's published rates (`claude-sonnet-4-6: $3 input / $15 output / $0.30 cache_read / $3.75 cache_write` for 5m breakpoint). Setting custom cost values overrides Sentry's calculation.

### Sources

- [Set Up AI Agent Monitoring | Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/ai-agent-monitoring/)
- [Instrument AI Agents (manual) | Sentry for Node.js](https://docs.sentry.io/platforms/javascript/guides/node/tracing/instrumentation/ai-agents-module/)
- [AI Agents Module — Sentry SDK Developer Docs (full attribute schema)](https://develop.sentry.dev/sdk/telemetry/traces/modules/ai-agents/)
- [Anthropic Integration | Sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/anthropic/)
- [AI Agent Observability: developer's guide | Sentry Blog](https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/)

---

## Topic 4 — Anthropic prompt cache hit-rate instrumentation

### Summary

Anthropic's Messages API response carries three composite fields that together describe cache behavior: `usage.input_tokens` (non-cached new input), `usage.cache_creation_input_tokens` (tokens written to cache, billed 1.25x or 2x base depending on 5m vs 1h TTL), `usage.cache_read_input_tokens` (tokens read from cache, billed 0.1x base). Hit-rate = `cache_reads / (cache_reads + cache_writes_5m + cache_writes_1h)` — the proportion of cacheable tokens actually served from cache. Anthropic publishes a Prompt Caching Dashboard at `platform.claude.com/usage/cache` showing hit ratio + cost composition, but it's vendor-side and doesn't slice by our business dimensions (shop_id, surface, feature). For per-shop / per-feature attribution, instrument client-side.

### Best practices

1. **Wire the three Anthropic usage fields into Sentry span attributes** (Topic 3 schema) — `gen_ai.usage.input_tokens.cached` for reads, `gen_ai.usage.input_tokens.cache_write` for writes. Sentry's AI Agents dashboard will surface cache cost reduction automatically.
2. **Also emit a non-error Sentry log line** (Topic 8 — `Sentry.logger.info`) per LLM call with cache metrics for ad-hoc querying without span sampling loss.
3. **For dashboards beyond Sentry**, additionally fan-out to PostHog as a `llm_cache_hit` event with `cache_read_tokens`, `cache_write_tokens`, `non_cached_tokens`, `shop_id`, `surface` properties.
4. **Set ALL cache breakpoints intentionally** — `cache_control: { type: 'ephemeral' }` works on system, tools, and message content blocks. Stable content (system prompt, tool definitions, long context) goes BEFORE the breakpoint. Anthropic limits 4 breakpoints per request.
5. **For Vercel AI Gateway `caching: 'auto'`**: Gateway auto-detects stable prefixes and inserts cache breakpoints. But it does NOT guarantee a hit, and the response shape it returns may or may not surface Anthropic's underlying `cache_read_input_tokens` (depends on Gateway version). Field-test by sending two identical calls back-to-back; if the second's `cache_read_input_tokens > 0` in the response, you're getting the metric. If not, you're flying blind and must move OFF `caching: 'auto'` and manage breakpoints explicitly.
6. **Track hit-rate per-surface separately.** A 95% hit rate on `diagnostic-llm-batch` and a 5% hit rate on `chat-with-customer` aren't comparable — they have different prompt structures. Aggregate metric will hide real problems.

### Canonical example — instrumentation wrapper (TypeScript, adapted from startdebugging.net pattern)

```typescript
import * as Sentry from '@sentry/node'
import Anthropic from '@anthropic-ai/sdk'

type CacheUsage = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  output_tokens: number
}

class CacheStats {
  requests = 0
  baseInput = 0
  cacheWrites = 0
  cacheReads = 0
  output = 0

  record(usage: CacheUsage) {
    this.requests++
    this.baseInput += usage.input_tokens
    this.cacheReads += usage.cache_read_input_tokens ?? 0
    this.cacheWrites += usage.cache_creation_input_tokens ?? 0
    this.output += usage.output_tokens
  }

  get hitRate(): number {
    const cacheable = this.cacheReads + this.cacheWrites
    return cacheable > 0 ? this.cacheReads / cacheable : 0
  }

  costUsd(rates: { input: number; output: number }): number {
    const writeCost = this.cacheWrites * rates.input * 1.25
    const readCost = this.cacheReads * rates.input * 0.10
    const baseCost = this.baseInput * rates.input
    const outCost = this.output * rates.output
    return (writeCost + readCost + baseCost + outCost) / 1_000_000
  }
}

const stats = new CacheStats()

export async function cachedCall(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParams,
  ctx: { shopId: string; surface: string }
) {
  return Sentry.startSpan(
    {
      op: 'gen_ai.chat',
      name: `chat ${params.model}`,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': 'anthropic',
        'gen_ai.request.model': params.model,
        'shop_id': ctx.shopId,
        'surface': ctx.surface,
      },
    },
    async (span) => {
      const result = await client.messages.create(params)
      const u = result.usage
      const totalInput = u.input_tokens + (u.cache_read_input_tokens ?? 0)

      span.setAttribute('gen_ai.usage.input_tokens', totalInput)
      span.setAttribute('gen_ai.usage.output_tokens', u.output_tokens)
      span.setAttribute('gen_ai.usage.input_tokens.cached', u.cache_read_input_tokens ?? 0)
      span.setAttribute('gen_ai.usage.input_tokens.cache_write',
        u.cache_creation_input_tokens ?? 0)
      span.setAttribute('cache_hit_rate_for_call',
        totalInput > 0 ? (u.cache_read_input_tokens ?? 0) / totalInput : 0)

      stats.record(u)

      // Non-error log line for ad-hoc query (does NOT create issue)
      Sentry.logger.info('llm_call_complete', {
        model: result.model,
        shop_id: ctx.shopId,
        surface: ctx.surface,
        input_tokens: u.input_tokens,
        cache_read: u.cache_read_input_tokens ?? 0,
        cache_write: u.cache_creation_input_tokens ?? 0,
        output_tokens: u.output_tokens,
      })

      return result
    }
  )
}
```

### Gotchas

- **Cache breakpoints DO NOT survive when system is a plain string.** Anthropic requires `system: [{ type: 'text', text: '...', cache_control: { type: 'ephemeral' } }]` (array of blocks). String form silently disables caching. This is the #1 cause of "I added caching but it doesn't work" — verify the `system` field shape every time.
- **Cache TTL is 5 minutes by default** (also 1-hour available). If your traffic pattern has gaps >5min, you'll see cache_creation on every call. Hit-rate naturally trends low for low-volume features.
- **Vercel AI Gateway `caching: 'auto'`** is convenient but opaque. If you can't measure hit-rate after enabling it, disable it and manage breakpoints explicitly via the SDK.
- **Don't multiply cache_creation by 1x base rate** — it's billed at 1.25x (5m breakpoint) or 2x (1h breakpoint). Cost-tracking formulas that miss this underestimate spend.
- **For batched LLM calls** (the 1-gemini diagnostic batch in your stack), cache hit-rate per-batch is the right unit, not per-call. Aggregate at the batch level.

### Sources

- [How to Add Prompt Caching and Measure Hit Rate | Start Debugging (Apr 2026)](https://startdebugging.net/2026/04/how-to-add-prompt-caching-to-an-anthropic-sdk-app-and-measure-the-hit-rate/)
- [Prompt Caching in 2026: Anthropic, OpenAI, Azure Compared | Technspire](https://technspire.com/en/blog/prompt-caching-2026-real-cost-wins)
- [How We Cut LLM Costs by 59% With Prompt Caching | ProjectDiscovery Blog](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)
- [Anthropic Prompt Caching Dashboard launch | Phemex News](https://phemex.com/news/article/anthropic-unveils-prompt-caching-dashboard-with-key-metrics-75230)
- [Why your Anthropic prompt caching probably isn't working | DEV Community](https://dev.to/leonhail/why-your-anthropic-prompt-caching-probably-isnt-working-and-the-npm-package-i-built-to-fix-it-42c)

---

## Topic 5 — Sentry webhook signature failure alerting (`level: 'warning'`)

### Summary

Webhook signature failures are different from application errors — they're either (a) misconfiguration, (b) attempted abuse / scanning, or (c) clock skew on the sender's side. The right Sentry primitive is `captureMessage(msg, 'warning')` inside a `withScope` that sets fingerprint to a stable key — so 10,000 attack attempts produce ONE issue, not 10,000. Sentry's alert system can then route warning-level events to a separate Slack channel (security@) instead of the default engineering channel.

### Best practices

1. **Always log signature failures**, even when returning 401 — silent rejection is a silent failure per project rule. Use `Sentry.captureMessage(..., 'warning')` so it shows in Sentry but at a non-error severity.
2. **Use `scope.setFingerprint(['webhook-sig-fail', provider, route])`** to group ALL failures of the same shape into ONE issue. Without explicit fingerprinting, every distinct IP/User-Agent will produce a separate issue (Sentry's default grouping uses message + stack, but `captureMessage` overwrites fingerprint).
3. **Capture context**: source IP, User-Agent, provider name, route. NOT the body (could contain attacker payloads with credentials). NOT the signature value (it's secret in 99% of cases).
4. **Set tags**: `webhook.provider`, `webhook.route`, `http.status` (`"401"`). Tags are queryable in Sentry's issue search.
5. **Configure an alert rule** in Sentry: "when an issue with tag `webhook.provider:tekmetric` and `level:warning` fires more than 10 times in 5 minutes, notify security@ via Slack". This bridges "warning" severity into an actual paging signal when volume spikes (real attack indicator).
6. **Distinguish "missing header" from "invalid signature"** with different fingerprints — missing usually means misconfigured caller; invalid usually means attempted forgery. They warrant different responses.

### Canonical example

```typescript
import * as Sentry from '@sentry/nextjs'

export async function verifyWebhookSignature(
  req: Request,
  secret: string,
  provider: 'tekmetric' | 'qbo' | 'ayrshare' | 'resend',
  route: string,
): Promise<boolean> {
  const signature = req.headers.get('x-webhook-signature')
  const body = await req.text()

  if (!signature) {
    Sentry.withScope((scope) => {
      scope.setLevel('warning')
      scope.setFingerprint(['webhook-sig-missing', provider, route])
      scope.setTag('webhook.provider', provider)
      scope.setTag('webhook.route', route)
      scope.setTag('http.status', '401')
      scope.setContext('request', {
        ip: req.headers.get('x-forwarded-for') ?? 'unknown',
        user_agent: req.headers.get('user-agent') ?? 'unknown',
        method: req.method,
      })
      Sentry.captureMessage(
        `Webhook ${provider}:${route} missing signature header`,
        'warning'
      )
    })
    return false
  }

  const expected = computeHmac(body, secret)
  if (!timingSafeEqual(signature, expected)) {
    Sentry.withScope((scope) => {
      scope.setLevel('warning')
      scope.setFingerprint(['webhook-sig-invalid', provider, route])
      scope.setTag('webhook.provider', provider)
      scope.setTag('webhook.route', route)
      scope.setTag('http.status', '401')
      scope.setContext('request', {
        ip: req.headers.get('x-forwarded-for') ?? 'unknown',
        user_agent: req.headers.get('user-agent') ?? 'unknown',
        body_length: body.length,
      })
      Sentry.captureMessage(
        `Webhook ${provider}:${route} signature mismatch`,
        'warning'
      )
    })
    return false
  }

  return true
}
```

### Gotchas

- **`captureMessage` overwrites custom fingerprint set via `scope.setFingerprint`** in some SDK versions — Issue #1721 on sentry-javascript. Verify by checking Sentry's UI shows your custom fingerprint after first event. If overwritten, use server-side fingerprint rules (Issue Grouping settings) as a fallback.
- **Don't include the raw body in `extra` or `context`** — attacker payloads will pollute Sentry events with junk. Capture body LENGTH only.
- **`level: 'warning'` STILL creates an issue.** It just has a different severity color. If you want zero-issue telemetry (purely metrics), use `Sentry.logger.warn(...)` instead (Topic 8) — that goes to the log envelope.
- **Issue Alert webhooks (Sentry → us) and our app's webhooks (vendor → us) are different things.** Don't confuse Sentry's own webhook signature header (`Sentry-Hook-Signature`) with our vendor signature headers.
- **Tekmetric's HMAC scheme uses a non-standard header.** Read each provider's docs; "X-Signature" can mean 5 different things across providers.

### Sources

- [Capturing Errors | Sentry for JavaScript](https://docs.sentry.io/platforms/javascript/usage/)
- [Event Fingerprinting | Sentry for JavaScript](https://docs.sentry.io/platforms/javascript/enriching-events/fingerprinting/)
- [Webhooks signature verification | Sentry docs](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/)
- [Custom fingerprints overwritten by captureMessage · sentry-javascript #1721](https://github.com/getsentry/sentry-javascript/issues/1721)
- [Sentry. Make it work, not just noisy | Aleksandr Chistiakov, Medium](https://medium.com/@aleksandr.chistiakov/sentry-make-it-work-not-just-noisy-ebbfa9c40850)

---

## Topic 6 — Sentry `beforeSend` PII scrubbing — 2026 hardening

### Summary

Sentry recommends layered scrubbing — SDK-side (`beforeSend`) for pre-transmission, plus server-side rules (Project Settings → Security & Privacy → Data Scrubbing) as a second line of defense. Default server-side rules already scrub: credit-card-pattern values, and any field key matching `password`, `secret`, `passwd`, `api_key`, `apikey`, `auth`, `credentials`, `mysql_pwd`, `privatekey`, `private_key`, `token`, `bearer`. Our 39-key blocklist already covers more than the defaults; the gap is making the scrubber fail-closed (drop event if scrubber throws) and verifying coverage with a test suite.

### Best practices

1. **`sendDefaultPii: false`** (the default; double-check it's not flipped). Setting `true` auto-includes IP address, user-agent strings, and other PII Sentry pulls from request frameworks.
2. **`beforeSend` should be wrapped in try/catch** — any exception from inside `beforeSend` causes Sentry to drop the event (Sentry SDK semantics: if `beforeSend` throws, event is silently lost). This is BAD for visibility but GOOD for fail-closed PII safety. Make it explicit:
   ```typescript
   beforeSend(event, hint) {
     try {
       return scrubEvent(event)
     } catch (err) {
       // Fail closed — drop event rather than send unscrubbed
       console.error('[Sentry] beforeSend scrubber threw, dropping event', err)
       return null
     }
   }
   ```
3. **Scrub recursively** — events have deeply nested structures (`event.contexts.*`, `event.extra.*`, `event.user.*`, `event.request.*.data`, `event.breadcrumbs[*].data`, `event.exception.values[*].stacktrace.frames[*].vars`). The 39-key allowlist needs to walk the tree.
4. **Add `beforeSendTransaction` AND `beforeSendSpan` AND `beforeSendLog`** alongside `beforeSend` — transactions/spans/logs all carry user data and have separate hooks. PII can leak through spans (HTTP URLs with PII in query strings) and logs even if errors are scrubbed.
5. **Add a test for the scrubber.** Construct a fake event with PII in 15+ places (email, phone, SSN, credit card, OAuth token, JWT, bearer header, etc.); pass through `beforeSend`; assert each is gone. Without a test, regressions go undetected.
6. **Belt-and-suspenders: also configure server-side scrubbing rules.** If beforeSend ever has a bug, server-side catches the leak. Server-side rules apply at ingest, before storage.

### Canonical example — fail-closed scrubber

```typescript
import * as Sentry from '@sentry/nextjs'

const PII_KEYS = new Set([
  'email', 'phone', 'phone_number', 'first_name', 'last_name',
  'address', 'street', 'city', 'zip', 'postal_code',
  'ssn', 'tax_id', 'dob', 'date_of_birth',
  'credit_card', 'card_number', 'cvv', 'cvc',
  'authorization', 'bearer', 'cookie', 'session', 'api_key', 'apikey',
  'password', 'passwd', 'secret', 'private_key', 'privatekey', 'token',
  'oauth', 'refresh_token', 'access_token', 'jwt',
  'license_plate', 'vin', 'plate',
  /* ... project's full 39-key list ... */
])

const PII_REGEX = [
  /\b\d{3}-\d{2}-\d{4}\b/g,                                        // SSN
  /\b\d{16}\b/g,                                                   // raw card #
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,                   // email
  /\b\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,         // US phone
]

function scrubValue(v: unknown): unknown {
  if (typeof v === 'string') {
    let s = v
    for (const re of PII_REGEX) s = s.replace(re, '[REDACTED]')
    return s
  }
  if (Array.isArray(v)) return v.map(scrubValue)
  if (v && typeof v === 'object') return scrubObject(v as Record<string, unknown>)
  return v
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = scrubValue(v)
    }
  }
  return out
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeSend(event, hint) {
    try {
      return scrubObject(event as unknown as Record<string, unknown>) as typeof event
    } catch (err) {
      console.error('[Sentry] beforeSend threw, dropping event:', err)
      return null   // fail closed
    }
  },
  beforeSendTransaction(event) {
    try { return scrubObject(event as any) as any } catch { return null }
  },
  beforeSendSpan(span) {
    try { return scrubObject(span as any) as any } catch { return null }
  },
  beforeSendLog(log) {
    try { return scrubObject(log as any) as any } catch { return null }
  },
})
```

### Gotchas

- **`beforeSend` runs AFTER all scope data is applied** — `scope.setUser({ email })` flows into `event.user.email` and IS scrubbed if you handle the `user` key. Good. But `scope.setExtra('email', ...)` flows into `event.extra.email` — covered by the same key-set if you walk `extra` recursively.
- **Stack-trace local variables can carry PII.** `event.exception.values[*].stacktrace.frames[*].vars` is set when Sentry captures local variables (Python more than Node, but Node can do it via the linked-errors integration). Walk frames.
- **URLs in `event.request.url` and `event.breadcrumbs[*].data.url`** often carry PII as query params (`?email=user@x.com`). The regex sweep should catch these.
- **Server-side rules are case-INsensitive on field names but case-SENSITIVE on values.** Sentry's UI test panel lets you preview rules against sample events — use it.
- **Don't scrub `event.event_id`, `event.timestamp`, `event.tags.shop_id`** — these are queryable infrastructure, scrubbing them breaks dashboards.

### Sources

- [Scrubbing Sensitive Data | Sentry for JavaScript](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/)
- [Filtering | Sentry for JavaScript (beforeSend null return)](https://docs.sentry.io/platforms/javascript/configuration/filtering/)
- [Server-Side Data Scrubbing | Sentry docs](https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/)
- [Options | Sentry for Node.js (sendDefaultPii default = false)](https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/)
- [Advanced Data Scrubbing | Sentry docs](https://docs.sentry.io/security-legal-pii/scrubbing/advanced-datascrubbing/)

---

## Topic 7 — Sentry Seer (AI root-cause analysis) — when to enable

### Summary

Seer is Sentry's AI debugging agent (GA mid-2025, repriced January 2026): $40/active-contributor/month, billed separately from the main Sentry plan. "Active contributor" = any developer who commits 2+ PRs in a Seer-enabled repository in a calendar month; resets monthly. Bot commits (`[bot]` suffix) are excluded. Seer has three modes: Root Cause Analysis (auto-runs on high-confidence issues), Autofix (generates a PR for the fix), and Code Review (PR scanner pre-merge). All require GitHub integration (cloud OR Enterprise) — no GitLab/Bitbucket as of May 2026. Seer can hand off implementation to Claude Code and Cursor Cloud Agents.

### Best practices

1. **For a solo developer (Chris): Seer is probably right-sized at $40/mo.** Solo means exactly 1 active contributor in any month with merged PRs — predictable cost.
2. **Enable per-repo, not org-wide.** Seer settings → SCM Settings lets you toggle individual repositories. Keep it disabled on infrastructure / monorepo-tooling repos where bug reports don't translate to fixes.
3. **Seer auto-runs Root Cause Analysis only on "high confidence" issues** — Sentry's heuristic picks issues with clear stack traces, recent introduction, and reproducibility signals. Low-signal issues (rare crashes, third-party errors) don't trigger Seer. This is intentional and good for noise control.
4. **Privacy: Seer reads source code from linked GitHub repos AND sends it (or excerpts) to an LLM.** Sentry's policy: "Sentry does not train generative AI models using your data by default." This means the LLM provider may still see your code in-flight (the policy is about training, not transmission). For shop_id/customer PII patterns in stack traces, the PII scrubber in Topic 6 must run BEFORE Seer sees the event.
5. **Seer's PR generation routes through coding agents** (Claude Code or Cursor Cloud Agents). To use Cursor, you need a Cursor Cloud Agents subscription separately. Claude Code is free.
6. **Disable PR creation in Advanced Settings if not desired.** Seer can be configured for "analysis only" — surface RCA + suggested fix as a comment on the Sentry issue without opening a PR.
7. **Wait until after the build-phase MVP for 2-3 modules ships** before enabling. Seer needs real production traffic to provide signal — pre-launch its dashboards will be empty.

### Canonical example — Seer setup checklist

```text
1. Sentry org settings → Seer → Enable
2. Install Seer GitHub App on the org (separate from Sentry GitHub App)
3. Connect specific repos in Seer SCM Settings
4. Project Settings → Seer → Map Sentry project to GitHub repo
5. Advanced Settings → toggle:
   - "Auto-trigger RCA on high-confidence issues": ON
   - "Auto-generate PRs": OFF (start) — let Chris review RCAs first
   - "Allow code transmission to LLM": ON (required for RCA to function)
6. Verify PII scrubber (Topic 6) is active on the Sentry project — events flow
   through scrubber BEFORE Seer reads them
7. Budget cap: Seer budget settings → cap at $40/mo for solo
```

### Gotchas

- **Pricing changed Jan 21 2026.** Pre-Jan-2026 "Legacy Seer pricing" (PR-based billing) is gone — it's $40/seat now. Confirm current invoices match.
- **Seer counts contributors org-wide across all Seer-enabled repos as a single seat.** If you enable Seer on 5 repos and you're the only committer, you're 1 seat. If you bring on a contractor who PRs to 3 of those repos in one month, that's 2 seats = $80.
- **"Open-ended investigation" is experimental and requires GitHub Discussion access request.** Not generally available.
- **No GitLab / Bitbucket / self-hosted SCM support as of May 2026.** GitHub Cloud or Enterprise only.
- **Seer's Code Review (PR scanner pre-merge)** is a SEPARATE feature with separate cost (active in PR review only). Distinct from RCA + Autofix.
- **No per-issue opt-out.** You can't say "don't analyze this issue" after the fact. Workaround: dismiss the Seer recommendation, or fingerprint-group the issue away from Seer's high-confidence threshold.

### Sources

- [Seer | Sentry docs](https://docs.sentry.io/product/ai-in-sentry/seer/)
- [Manage Your Seer Spend | Sentry docs](https://docs.sentry.io/pricing/quotas/manage-seer-budget/)
- [Seer pricing FAQ Jan 21 2026 | Sentry Help Center](https://sentry.zendesk.com/hc/en-us/articles/45551407771931-What-is-the-pricing-for-Seer-January-21-2026)
- [Seer: debug with AI at every stage | Sentry Blog](https://blog.sentry.io/seer-debug-with-ai-at-every-stage-of-development/)
- [Catch bugs in PRs with Seer | Sentry Cookbook](https://sentry.io/cookbook/ai-code-review-seer/)

---

## Topic 8 — `captureMessage` vs `addBreadcrumb` vs `captureException` vs `Sentry.logger`

### Summary

Four APIs, four jobs:

| API | Creates issue? | Use for | Severity |
|---|---|---|---|
| `Sentry.captureException(err)` | Yes (error issue) | Actual errors caught in try/catch | error (default), can override |
| `Sentry.captureMessage(msg, level)` | **Yes** (message issue, even at `info` level) | Notable application events you want as issues (e.g., webhook security failures per Topic 5) | `fatal | error | warning | log | info | debug` (default: `info`) |
| `Sentry.addBreadcrumb({...})` | No — buffered, attached to NEXT error event | Trail of "what led up to" an exception | `fatal | error | warning | log | info | debug` |
| `Sentry.logger.info/warn/error(msg, attrs)` | **No** — sent via separate log envelope, queryable but not an issue | Structured non-error telemetry: counters, request lifecycle, business events | `trace | debug | info | warn | error | fatal` |

**Key insight for our codebase:** captureMessage at `info` STILL creates an issue. If our scheduler code is calling `Sentry.captureMessage('batch complete', 'info')` to mark progress, those are showing up in the issue stream as low-priority alerts — exactly what the project rule "no info-level breadcrumbs as issues" is about. The 2026 fix is `Sentry.logger.info(...)` — that goes to the log envelope (separate transport), shows up in Sentry's Logs UI, but does NOT create an issue.

### Best practices

1. **For an unexpected error caught in try/catch** → `Sentry.captureException(err, { tags: {...} })`. Default severity = error.
2. **For a security/abuse event that you WANT as an issue** (webhook 401s, auth failures, suspicious activity) → `Sentry.captureMessage(msg, 'warning')` inside `withScope` with fingerprint (Topic 5).
3. **For the trail of context before an error** (HTTP requests made, DB queries run, user actions) → `Sentry.addBreadcrumb` — these auto-attach to the next captured event.
4. **For business telemetry / metrics / counters** that you want queryable but NEVER as issues → `Sentry.logger.info` or `.warn`. Requires `enableLogs: true` in init (default `true` since SDK 10.x). 
5. **For exceptions you want to rethrow but record** → `Sentry.captureException(err, { level: 'warning' })` THEN `throw err`. Lower severity if the catcher up-stack will resolve.
6. **Audit existing `captureMessage` calls.** Any `captureMessage(msg, 'info')` that isn't a security event should likely be `Sentry.logger.info(msg, {...attrs})` instead.

### Canonical example — the four APIs in context

```typescript
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableLogs: true,         // default true in 10.x — explicit for clarity
  tracesSampleRate: 0.1,
})

// 1. Breadcrumb: passive context, no event
Sentry.addBreadcrumb({
  category: 'auth',
  message: 'Employee authenticated',
  level: 'info',
  data: { shop_id, employee_id },
})

// 2. Sentry.logger: business telemetry — appears in Logs view, NO issue
Sentry.logger.info('batch_complete', {
  batch_id: batchId,
  total_concerns: 100,
  duration_ms: 4500,
  shop_id,
})

// 3. captureMessage: security/abuse event — IS an issue, warning severity
Sentry.withScope((scope) => {
  scope.setLevel('warning')
  scope.setFingerprint(['webhook-sig-fail', 'tekmetric', '/webhooks/tekmetric'])
  scope.setTag('webhook.provider', 'tekmetric')
  Sentry.captureMessage('Webhook signature mismatch from unexpected IP', 'warning')
})

// 4. captureException: actual error — IS an issue, error severity
try {
  await processOrder(orderId)
} catch (err) {
  Sentry.captureException(err, {
    tags: { surface: 'order-processing', shop_id, order_id: orderId },
  })
  throw err
}
```

### Gotchas

- **`captureMessage` default level is `info` AND `info` creates an issue.** Sentry's UI color-codes it differently (blue dot vs red), but it's in the issue stream. The project's rule about "info-level breadcrumbs surface as issues" likely refers to this exact pattern.
- **`Sentry.logger.*` requires SDK ≥ 8.x with `enableLogs: true`.** Default flipped to `true` in v10. Verify your installed version.
- **Logs are buffered: ~100 items or 5 seconds before flush.** Short-lived Edge / serverless paths may need explicit `await Sentry.flush(2000)` to drain logs before shutdown — same flush pattern as exception delivery.
- **Logs are rate-limited via `log_item` data category in Relay.** High-volume telemetry will be dropped beyond your plan's log quota. For high-cardinality counters, use PostHog instead.
- **Breadcrumbs default `maxBreadcrumbs: 100`** — older breadcrumbs evict. For long-running scopes with high breadcrumb count, this matters.
- **`Sentry.captureMessage(msg)` without a level passes `info`** by API contract. Always explicit: `Sentry.captureMessage(msg, 'warning')` — code review can catch missing severities.
- **`beforeSend` IS called for captureMessage too** (per Sentry docs: "called for both error and message events"). So the PII scrubber covers messages, breadcrumbs (in event.breadcrumbs), and exceptions.

### Sources

- [Capturing Errors | Sentry for JavaScript (captureException, captureMessage, severity levels)](https://docs.sentry.io/platforms/javascript/usage/)
- [Set Up Logs | Sentry for JavaScript (Sentry.logger API)](https://docs.sentry.io/platforms/javascript/logs/)
- [Set Up Logs | Sentry for Node.js (enableLogs default)](https://docs.sentry.io/platforms/javascript/guides/node/logs/)
- [Logs | Sentry SDK Developer Docs (log envelope, buffering, log_item category)](https://develop.sentry.dev/sdk/telemetry/logs/)
- [Breadcrumbs | Sentry for Node.js (addBreadcrumb fields, lifecycle)](https://docs.sentry.io/platforms/javascript/guides/node/enriching-events/breadcrumbs/)
- [Use Sentry effectively (defect capture +20%) | Theodo Blog](https://blog.theodo.com/2020/03/use-sentry-effectively/)
