---
agent: audit-integrations
timestamp: 2026-05-22T03:00:00Z
integrations_audited: 10
features_researched: 24
---

# Integration audit + 2026 feature research

## Executive summary

Eight integrations are wired (Telnyx, Resend, Vercel, Sentry, Anthropic, Tekmetric, Supabase Auth/DB, AI Gateway via Vercel). Two listed integrations have NO references in scheduler-app/supabase code: **NHTSA** (only mentioned in docs/templates) and **QuickBooks Online / Ayrshare** (zero hits). **Supabase Realtime is also not used** (zero `.channel(` references) — every refresh is action-driven + `revalidatePath`.

Overall integration health is strong on the security + observability axes: all secrets are server-only, both webhook receivers (`tekmetric-webhook`, `keytag-tekmetric-webhook`) auth-gate via `?token=` query param (Tekmetric quirk — no custom headers allowed), every outbound integration call checks the response and routes failures through `Sentry.captureException` + `scheduler_error_log` table, and PII scrubbing in `beforeSend` is duplicated identically in `sentry-edge.ts` and `sentry.server.config.ts`. The Tekmetric client retries once on 401 after refreshing its module-scope token cache. Transcript dispatch already uses Resend's `Idempotency-Key` header with `transcript:<session_id>` keying. The OTP `otp_codes` table enforces both per-code attempts (3) and per-phone-per-hour active codes (3).

**Top gaps worth closing in 2026:**

1. **No circuit-breaker around Tekmetric** — every call to Tekmetric is a bare `fetch`, no opossum (project standard per `.claude/rules/observability.md` rule 12) on either the Telnyx or Tekmetric or Resend surfaces. On Vercel-hosted Node runtime this is doable; on Deno Edge it isn't (Edge runtime can't load Node modules) so an alternative pattern (Upstash-Redis-backed distributed counter) is needed.
2. **Sentry Cron Monitoring is not configured** for any of the 4 scheduler crons (`appointments-sync`, `transcript-dispatcher`, `keytag-bulk-reconcile`, `keytag-daily-report`) — they have `BEGIN…EXCEPTION` wraps writing to `scheduler_error_log`, but no Sentry check-in pings so a missed/late run is silent.
3. **Vercel BotID is not enabled** on the customer-facing chat endpoint or the OTP request path — both are unauthenticated entry points to the SMS-send + Tekmetric-customer-create pipeline. Today, a scripted attacker could mass-trigger Telnyx SMS sends (3/hr per phone is the only gate; nothing blocks 1000 distinct phones per hour).
4. **Sentry AI Agent Monitoring is partially wired** (`Sentry.vercelAIIntegration({ force: true })` is in `sentry.server.config.ts` line 41) but the Anthropic SDK direct path in `diagnose-concern.ts` (line 100, 157) bypasses the AI SDK — its 3 stages emit only manual `Sentry.addBreadcrumb` calls, no `gen_ai.*` spans. This is documented in DEFERRED-AUDIT-ITEMS.md OBS-5.
5. **Resend inbound email is not wired** — staff-reply-to-transcript flow doesn't exist; advisors must open Tekmetric to add a note. Inbound webhook would let customer-context replies flow back into `customer_chat_sessions.staff_notes`.
6. **Tekmetric webhook signature verification is impossible** (Tekmetric only supports `?token=` query param) — this is a vendor limitation, not a code fix. Mitigated correctly today by scrubbing the `token` query param before persisting headers (lines 127-132 of `tekmetric-webhook/index.ts`).

The audit found no BLOCKER-level security issues. Several IMPORTANT and NICE findings below.

---

## Part 1 — Per-integration audit

### Telnyx (SMS — OTP send only)

- **Files referencing**:
  - `supabase/functions/_shared/tools/scheduler-otp.ts` (canonical send path; lines 119-211 = `sendViaTelnyx`)
  - `supabase/functions/scheduler-step2-direct/index.ts` (consumer)
  - `supabase/functions/scheduler-otp-direct/index.ts` (consumer)
  - `scheduler-app/src/lib/scheduler/wizard/actions/resend-otp.ts` (Server Action that calls the edge function)
  - `scheduler-app/src/lib/scheduler/wizard/actions/submit-phone-name.ts` (Server Action that calls scheduler-step2-direct, which sends OTP)
  - `scheduler-app/src/lib/scheduler/step2-direct-client.ts` (HTTP client)
  - `scheduler-app/src/components/scheduler/heritage/PhoneNameCard.tsx` (just an icon comment)
- **Env vars**: `TELNYX_API_KEY` (server-only, Deno.env.get, NEVER prefixed with NEXT_PUBLIC_), `TELNYX_FROM_NUMBER`, optional `TELNYX_MESSAGING_PROFILE_ID`. Also gated by `SMS_PROVIDER` env (`telnyx` | `stub` | `disabled`) — defaults to `telnyx` when API key present (scheduler-otp.ts:222-225).
- **Webhook signature verification**: N/A — Telnyx → us only happens via the messaging API response; no Telnyx-to-us webhooks are wired (delivery-status webhook is a TODO per scheduler-otp.ts:90-92).
- **Error handling**: Excellent. Differentiates `auth | invalid_number | rate_limit | provider_error | network | config` (scheduler-otp.ts:175-188). On 401/403 returns `auth`; on 422 returns `invalid_number`; on 429 returns `rate_limit`. Wrapped with `AbortSignal.timeout(15_000)` (line 159). Failures log a structured JSON error (line 386-395).
- **Fallback when down**: Partial — `submit-phone-name.ts` lines 168-194 catch Step2DirectError and route to `escalated` status with `"Please call us at (610) 253-6565"` bubble. NO circuit breaker; consecutive Telnyx outages just produce N escalations.
- **Idempotency**: Per-code (5-min TTL, single-use `consumed_at`), per-phone (3 active codes/hr in `otp_codes` rate-limit guard at scheduler-otp.ts:307-319). On `send_failed` for system-side errors (`auth | config | network | provider_error | rate_limit`), the just-inserted `otp_codes` row is consumed so a retry doesn't penalize the hourly quota. `invalid_number` (customer-side) DOES count against the quota by design.
- **Rate limiting**: `MAX_ACTIVE_CODES_PER_HOUR = 3` (line 28) + `MAX_ATTEMPTS_PER_CODE = 3` (line 29). 15-second hard timeout. No exponential backoff (no retry loop on transient errors).
- **Issues found**:
  - IMPORTANT: no Telnyx delivery-status webhook handler. If `to[0].status` comes back "queued" from Telnyx but the actual delivery fails (carrier reject, invalid number, opt-out), we never know — customer just doesn't get the SMS and we burn an attempt-counter slot. Add a webhook handler under `supabase/functions/telnyx-message-webhook` + DB table `telnyx_message_events`.
  - IMPORTANT: no exponential backoff on transient `network`/`provider_error`/`rate_limit` failures. Today these get a single attempt + escalate. Add 2-retry exponential backoff (500ms → 1500ms) BEFORE consuming the otp_codes row.
  - NICE: hardcoded shop phone "6102536565" in error messages (scheduler-otp.ts:554, submit-phone-name.ts:213). Should come from shop config (acceptable Phase-1 deferral; flagged in shop-agnostic.md context but the scheduler-app is currently single-tenant by design).

### Resend (email — transcript + staff notification)

- **Files referencing**:
  - `supabase/functions/transcript-dispatcher/index.ts` (lines 48-186 — transcript email; uses Idempotency-Key)
  - `scheduler-app/src/lib/scheduler/wizard/staff-notification.ts` (lines 27-205 — appointment notification email)
  - `supabase/functions/_shared/manual-review-email.ts` (keytag manual-review emails — separate flow)
  - `package.json:33` (`"resend": "^4.0.0"`)
- **Env vars**: `RESEND_API_KEY` (server-only, both Node + Deno surfaces). Recipient/from in `SERVICE_TEAM_EMAIL`, `TRANSCRIPT_FROM_EMAIL`, `SCHEDULER_STAFF_EMAIL_TO`, `SCHEDULER_STAFF_EMAIL_FROM`. All server-only. None NEXT_PUBLIC_.
- **Webhook signature verification**: N/A — we don't receive Resend webhooks today (no inbound email parsing, no delivery-event tracking).
- **Error handling**: Good. transcript-dispatcher checks `res.ok`, parses error body, persists `last_error` + bumps `attempts` (lines 168-185). On 5 attempts marks status `failed`. staff-notification.ts checks `result.error`, captures to Sentry with `level: "warning"`, returns `{ sent: false, reason }` so the customer's success flow continues unaffected (lines 167-184).
- **Fallback when down**: transcript dispatch has a 5-attempt retry with backstop cron + `attempts >= 5 → failed`. Staff notification is fire-and-forget (no retry — by design, transcript email is the durable record).
- **Idempotency**: STRONG. transcript-dispatcher passes `Idempotency-Key: transcript:<session_id>` (line 158). Treats HTTP 409 (idempotency replay) as success (lines 856-867). staff-notification.ts does NOT use Idempotency-Key — at-most-once, accepted because the email is convenience, not the record.
- **Rate limiting**: N/A from our side. Resend's own rate-limit (currently 2 req/sec on Pro) would manifest as 429 → retry path.
- **Issues found**:
  - IMPORTANT: no Resend webhook handler for delivery events (`email.delivered | email.bounced | email.complained`). If a transcript bounces (service@jeffsautomotive.com mailbox full, DNS hiccup), we mark it sent and never investigate. Fix: subscribe to `email.bounced` + `email.complained`, write to `resend_email_events` table, alert advisors on persistent bounces to their inbox.
  - NICE: staff-notification.ts uses plain text only (line 163, no `html` field). Acceptable for now (advisors click through to Tekmetric), but a 2-line HTML version with a "Confirm received" mailto: link would speed advisor triage.
  - NICE: `extractPrimaryEmail` (staff-notification.ts:207-230) silently picks first email if no `is_primary` flag set. Consider Sentry breadcrumb when this fallback fires — signals upstream data shape drift.

### Vercel (hosting + AI Gateway)

- **Files referencing**:
  - `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts:158` (`AI_GATEWAY_API_KEY` fallback to `VERCEL_OIDC_TOKEN`)
  - `supabase/functions/llm-testing/index.ts:50,84` (`AI_GATEWAY_API_KEY`)
  - `scheduler-app/scripts/eval-diagnose-concern.ts:60-116`, `anthropic-sdk-smoke.mjs:11-34` (eval scripts strip VERCEL_* env to test direct-Anthropic-key path)
  - `scheduler-app/next.config.ts` (Sentry tunnelRoute `/monitoring`)
- **Env vars**: `AI_GATEWAY_API_KEY` (server-only), `VERCEL_OIDC_TOKEN` (automatic OIDC fallback), `VERCEL`, `VERCEL_ENV` (auto-set by Vercel). All server-only. No NEXT_PUBLIC_*.
- **Webhook signature verification**: N/A — no Vercel→us webhooks.
- **Error handling**: AI Gateway sits BEHIND the Anthropic SDK, so all Gateway error handling reduces to the Anthropic SDK's two-attempt retry in `callAnthropicStage` (diagnose-concern.ts:854-910). Stage 1 failure → safe-null result, Stage 2 → testing service still recommended, Stage 3 → safe over-ask (every question marked unanswered).
- **Fallback when down**: AI Gateway models fallback chain configured: `providerOptions.gateway.models = [<primary>, FALLBACK_MODEL]` (diagnose-concern.ts:867) → on primary failure, gateway cascades to `anthropic/claude-sonnet-4-6`. Good pattern.
- **Idempotency**: N/A (LLM calls are idempotent-ish by definition; temperature=0 makes them more so).
- **Rate limiting**: Implicit via Gateway. No client-side rate limit on our end.
- **Issues found**:
  - IMPORTANT: `Sentry.vercelAIIntegration({ force: true })` is configured (sentry.server.config.ts:41) but `diagnose-concern.ts` uses the Anthropic SDK directly, not the AI SDK's `generateObject`/`generateText` — so gen_ai.* spans are NOT emitted for the 3 diagnostic stages. Per Sentry docs, the Vercel AI integration only auto-instruments AI SDK calls. To get full token-tracking + cost-tracking spans, either (a) use the AI SDK adapter `@ai-sdk/anthropic` for the diagnose path (matches what `staff-notification` etc don't need but diagnose does), or (b) manually start `gen_ai.*` spans around the Anthropic SDK call. This is the OBS-5 deferred item.
  - NICE: Vercel Cron is configured via Supabase pg_cron (not Vercel Cron) per scheduler design. Documented + intentional.

### Sentry (observability)

- **Files referencing** (61 hits — exhaustive list elided; key surfaces):
  - `scheduler-app/sentry.server.config.ts` (Node SDK init, beforeSend PII scrubber)
  - `scheduler-app/sentry.edge.config.ts` (Edge SDK init)
  - `scheduler-app/instrumentation-client.ts` (browser SDK init + Session Replay configured at 10% baseline + 100% on error)
  - `scheduler-app/instrumentation.ts` (`onRequestError = Sentry.captureRequestError`)
  - `scheduler-app/next.config.ts` (`withSentryConfig` wrapper, source-map upload, tunnelRoute `/monitoring`)
  - `supabase/functions/_shared/sentry-edge.ts` (Deno SDK + `withSentryScope` per-request isolation wrapper, used by appointments-sync, transcript-dispatcher, keytag-bulk-reconcile, keytag-daily-report)
  - `scheduler-app/src/lib/scheduler/wizard/instrument-action.ts` (`Sentry.withServerActionInstrumentation` wrap factory)
  - `scheduler-app/middleware.ts:34,70` (defensive captureException on cookie-set failure)
- **Env vars**: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (client only, required by Vercel exposure rules), `SENTRY_AUTH_TOKEN` (server-only build-time), `SENTRY_ORG`, `SENTRY_PROJECT`, `EDGE_FN_SENTRY_DSN` (Deno edge runtime DSN; note name does not start with SUPABASE_ because Supabase forbids that prefix on user secrets per sentry-edge.ts:11-14). All correctly scoped.
- **Webhook signature verification**: N/A.
- **Error handling**: Excellent — full pattern in place. `instrumentation.ts` wires `onRequestError`; `error.tsx` + `global-error.tsx` call captureException; every Server Action goes through `wrapAction` → `Sentry.withServerActionInstrumentation`; every edge function uses `withSentryScope(req, surface, handler)` for per-request isolation (which is REQUIRED in Deno edge runtime — the SDK does not auto-isolate across concurrent invocations per sentry-edge.ts:25-28).
- **Fallback when down**: Sentry no-ops gracefully if DSN missing (`if (!DSN) return await handler()`).
- **Idempotency**: Sentry deduplicates by event_id; our PII scrubber is a `beforeSend` hook (fail-closed: throws → drop event entirely, per server.config:81-87).
- **Rate limiting**: `tracesSampleRate: 0.1` in prod / 1.0 in dev. Edge functions sample at `0.05` (sentry-edge.ts:63) — lower because edge fires on cron + every webhook. Session Replay at `replaysSessionSampleRate: 0.1` baseline + `replaysOnErrorSampleRate: 1.0`. Conservative + cost-aware.
- **Issues found**:
  - IMPORTANT: Sentry Cron Monitoring not wired for ANY of the 4 scheduler crons. Today a stuck/skipped cron (e.g., appointments-sync stops firing because the cron expression breaks) is invisible until appointments stop showing fresh times. Add `Sentry.withMonitor("appointments-sync", () => {...})` wraps with appropriate `schedule: { type: 'crontab', value: '...' }` configs.
  - IMPORTANT (OBS-5 deferred): `gen_ai.*` spans not captured for the 3 diagnose-concern stages because they bypass the AI SDK. See Vercel section above for the fix.
  - IMPORTANT (OBS-6b deferred): project-level Sentry Data Scrubbing rules are documented as needed (sentry-edge.ts:18-23) but require manual Sentry dashboard configuration. Not visible from the codebase. Verify in Sentry UI: Settings → Security & Privacy → Data Scrubber → add `email`, `phone`, `phone_e164`, `tekmetric_error_text` to the safe-fields list.
  - NICE: Supabase Log Drain → Sentry is gated by Team plan ($599/mo) per sentry-edge.ts:3-8 + observability.md. Org is on Pro. Until upgrade, Postgres/Auth/Realtime/Storage failures land only in `scheduler_error_log` + Supabase dashboard logs. Wired direct `@sentry/deno` covers 4 edge functions (the scheduler-relevant ones).

### Anthropic (LLM via direct SDK + AI Gateway routing)

- **Files referencing**:
  - `package.json:22` (`"@anthropic-ai/sdk": "^0.97.1"`)
  - `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` (`import Anthropic from "@anthropic-ai/sdk"`, 3-stage diagnostic classifier, lines 100-1287)
  - `scheduler-app/src/lib/scheduler/wizard/llm/parse-customer-note.ts`
  - `scheduler-app/src/lib/scheduler/wizard/llm/summarize-concern.ts`
  - `scheduler-app/scripts/eval-diagnose-concern.ts`, `anthropic-sdk-smoke.mjs`, `anthropic-smoke.mjs` (eval/smoke harness)
  - `supabase/functions/llm-testing/index.ts` (test endpoint)
  - `supabase/functions/_shared/orchestrator-router.ts`, `_shared/specialists/{scheduler,diagnostic,keytag}.ts` (orchestrator-mcp path)
- **Env vars**: `ANTHROPIC_API_KEY` (server-only, never used directly — gateway-routed instead); `AI_GATEWAY_API_KEY` (primary auth in scheduler-app), `VERCEL_OIDC_TOKEN` (fallback). Per-stage model overrides via `DIAGNOSE_CONCERN_STAGE1_MODEL` / `STAGE2_MODEL` / `STAGE3_MODEL` / generic `DIAGNOSE_CONCERN_MODEL`. All server-only.
- **Webhook signature verification**: N/A.
- **Error handling**: Excellent. `callAnthropicStage` (diagnose-concern.ts:840-917) wraps every Anthropic call with: 2-attempt retry, Zod schema validation of LLM output, per-stage Sentry.captureException with `surface: "diagnose_concern_llm"` + `stage: 1|2|3` + `attempt: 0|1` tags, per-stage typed fallbacks (Stage 1 → safe-null; Stage 2 → keep testing-service recommendation; Stage 3 → safe over-ask).
- **Fallback when down**: AI Gateway `providerOptions.gateway.models = [<primary>, FALLBACK_MODEL]` cascades on primary failure. Per-stage fallback returns ensure customer always sees SOMETHING (recommend service, ask all questions, etc.).
- **Idempotency**: Temperature=0 + constrained-decoding via Anthropic's structured-outputs-2025-11-13 beta gives near-deterministic outputs. No prompt caching markers set yet but `providerOptions.gateway.caching = 'auto'` (line 868) auto-inserts cache_control on the system prompt.
- **Rate limiting**: None client-side. Implicit via Gateway + Anthropic's per-org tier limits.
- **Issues found**:
  - NICE: prompt caching is set to `'auto'` but we're not measuring cache-hit-rate. Per Anthropic docs, prompt caching can save up to 90% on cost + 85% on latency for long stable prompts (Stage 1 system prompt rebuilds the full category catalog every call — ~5-8KB, perfect cache candidate). Add a Sentry tag `cache_hit_rate` from `msg.usage.cache_read_input_tokens / msg.usage.cache_creation_input_tokens` and dashboard it.
  - NICE: 3-stage diagnostic is a strong candidate for the Anthropic **Message Batches API** for batch eval runs (used at `scripts/eval-diagnose-concern.ts`) — currently those run serially. Batches API gives 50% cost reduction.
  - NICE: no use of Anthropic's **memory tool** (released 2026). Would enable retaining customer-described concerns across return visits without re-asking. Defer per single-shop Phase-1 scope.

### Tekmetric (shop management — webhooks IN + REST OUT)

- **Files referencing** (108 hits — many; key surfaces):
  - `supabase/functions/_shared/tekmetric-client.ts` (auth, retry, paginated fetch)
  - `supabase/functions/_shared/tekmetric.ts` (env names, vault names, base URL)
  - `supabase/functions/tekmetric-webhook/index.ts` (general-purpose receiver, query-token auth)
  - `supabase/functions/keytag-tekmetric-webhook/index.ts` (keytag-specific receiver, query-token auth + self-authored-loop guard)
  - `supabase/functions/tekmetric-{bootstrap,api-testing,find-ro-by-keytag,list-wip-keytags}/index.ts`
  - `supabase/functions/appointments-sync/index.ts` (cron-driven full pull)
  - `supabase/functions/scheduler-{booking-direct,step2-direct,otp-direct}/index.ts`
  - `supabase/functions/_shared/tools/{scheduler-customer,scheduler-slots,scheduler-admin,repair-orders,keytag-management,keytag-extras}.ts`
- **Env vars**: `TEKMETRIC_API_KEY` is NOT used directly — the token lives in Supabase Vault (`tekmetric_get_secret` RPC, tekmetric-client.ts:21). `TEKMETRIC_SHOP_ID` (=7476, public-ish), `TEKMETRIC_WEBHOOK_TOKEN` (the URL-query-param secret). All server-only.
- **Webhook signature verification**: PARTIAL — Tekmetric does NOT support custom HTTP headers (vendor limitation; documented at tekmetric-webhook.ts:6-7 + keytag-tekmetric-webhook.ts:2-3). The `?token=<TEKMETRIC_WEBHOOK_TOKEN>` URL param is the ONLY auth surface. Token is correctly stripped from `raw_query_string` before persistence (tekmetric-webhook.ts:127-132) so it doesn't leak into the audit table.
- **Error handling**: Excellent. `tekmetricFetch` (tekmetric-client.ts:84-118) retries once on 401 after refreshing the module-scope token cache (R4-IMPORTANT-A-4 fix 2026-05-16). `tekmetricGetJson` truncates error bodies to 300 chars (line 132). Cron-pull failures in appointments-sync go to `scheduler_error_log` + Sentry via `withSentryScope`.
- **Fallback when down**: appointments-sync uses a local shadow table — if Tekmetric is down, scheduler reads still work from the shadow (lines 8-12 of appointments-sync). Direct-write paths (booking, customer create) escalate the customer when Tekmetric fails (submit-phone-name.ts:168-194).
- **Idempotency**: Webhook receiver INSERTs raw events; the keytag receiver has a DB-first check ("does our keytags table say this RO already has a tag?") to break the loop where our own PATCH triggers another webhook (keytag-tekmetric-webhook.ts:36-47). Self-authored-loop filter is belt-and-suspenders (lines 165-171). General-purpose receiver returns 200 unconditionally to prevent retry storms (tekmetric-webhook.ts:195-201).
- **Rate limiting**: None client-side. Tekmetric's own rate-limit (not documented publicly) would surface as 429.
- **Issues found**:
  - BLOCKER: none.
  - IMPORTANT: no circuit breaker around Tekmetric. A sustained Tekmetric outage means every chat session in the wizard's "submit phone" step burns its retry budget then escalates the customer to call the shop phone. Add Upstash-Redis-backed circuit-breaker counter (since opossum can't run in Deno Edge per observability.md rule 12 — distributed state via Upstash is the documented workaround). 5-failure-in-60s → 5-min open; customer sees "We're updating our system — try in a few minutes or call (610) 253-6565" instead of generic escalate.
  - IMPORTANT: webhook token `TEKMETRIC_WEBHOOK_TOKEN` is a single long-lived secret with no rotation strategy. Add a rotation runbook + accept TWO active tokens during rotation windows (env vars: `TEKMETRIC_WEBHOOK_TOKEN` + `TEKMETRIC_WEBHOOK_TOKEN_NEXT`).
  - NICE: `tekmetric-webhook/index.ts` lacks Sentry `withSentryScope` wrap (only the keytag-flavored sibling has it). General-purpose webhook errors don't surface to Sentry today.

### NHTSA (VIN lookup)

- **Files referencing**: NO references in scheduler-app/src or supabase/functions. Only mentions are in:
  - `docs/chat-instructions/scheduler/templates/subcategory-descriptions.md`
  - `docs/chat-instructions/scheduler/subcategory-description-specific/subcategory-descriptions-pulling.md`
  
  These are template documentation, not wired code.

- **no references found** — NHTSA is not currently integrated. Scheduler doesn't VIN-decode at booking time; vehicle data comes from Tekmetric (when an existing customer picks an existing vehicle) or from customer-typed Year/Make/Model strings (for new vehicles via `new_vehicle_info` JSONB column). No NHTSA features researched in Part 2.

### QuickBooks Online (QBO)

- **no references found** — NOT integrated. QBO is presumably handled by Tekmetric's own QBO sync. No features researched in Part 2.

### Ayrshare (social media)

- **no references found** — NOT integrated. No features researched in Part 2.

### Supabase Realtime

- **Files referencing**: NO references in scheduler-app/src or supabase/functions (`Grep .channel\(` returned zero matches).
- **no references found** — scheduler-app does not use Realtime today. Every UI refresh is action-driven via `applyWizardTransition` + `revalidatePath`. Decision noted in chat-design.md per the Phase-1 architecture (server-action-driven, not push-driven). Realtime features still researched in Part 2 because they're a strong candidate for future enhancements.

---

## Part 2 — Feature recommendations by integration

### Sentry

#### Sentry — Cron Monitoring

- **What**: schedule-aware check-in monitoring. Sentry knows when a job SHOULD have run and alerts on missed/late/failed runs. Configurable via `Sentry.withMonitor("appointments-sync", fn, { schedule: { type: "crontab", value: "*/10 * * * *" } })` from inside the edge function, OR via `monitor_slug` query string from the cron caller (Supabase pg_cron can curl-call an edge function that registers its own check-ins).
- **Effort**: 1 day. Wrap each of the 4 scheduler crons (`appointments-sync`, `transcript-dispatcher`, `keytag-bulk-reconcile`, `keytag-daily-report`) with `Sentry.withMonitor`. Create the monitors in Sentry dashboard with appropriate schedules. Test by killing the cron and confirming the alert fires.
- **Why scheduler-app needs it**: today a stuck `appointments-sync` is invisible until a customer reports "slot I picked is no longer available because someone else booked it in the gap." `BEGIN…EXCEPTION` wraps catch THROWS but not MISSED RUNS.
- **PII risk**: zero — only schedule metadata.
- **Recommendation**: ENABLE (4 wraps + 4 monitors).

#### Sentry — AI Agent Monitoring (gen_ai spans)

- **What**: auto-instruments AI SDK calls to capture `gen_ai.*` spans with token usage, model, latency, tool calls. Already partly enabled via `Sentry.vercelAIIntegration({ force: true })` in `sentry.server.config.ts:41` but only auto-instruments calls that go THROUGH the AI SDK. The diagnose-concern.ts 3-stage classifier uses the Anthropic SDK directly, so its spans don't materialize.
- **Effort**: 2-3 days. Either (a) switch diagnose-concern to use `@ai-sdk/anthropic` (`generateObject` with the same JSON Schema), gaining auto-instrumentation, OR (b) manually start `gen_ai.*` spans around each Anthropic call (`Sentry.startSpan({ name: 'gen_ai.chat_completions', op: 'gen_ai.chat_completions', attributes: { 'gen_ai.system': 'anthropic', 'gen_ai.request.model': model, ... } }, callback)`).
- **Why scheduler-app needs it**: Currently we have Anthropic token totals from `msg.usage` but they're emitted as `Sentry.addBreadcrumb` only — they don't show up in the AI Agents dashboard, can't be aggregated by model/stage, can't trigger cost alerts. With proper spans we can see per-stage cost drift in production.
- **PII risk**: medium. Span `inputs`/`outputs` would carry customer concern descriptions. Set `experimental_telemetry.recordInputs: false, recordOutputs: false` (matches scheduler-app convention in `sentry.server.config.ts:36-40`).
- **Recommendation**: ENABLE option (a) — the AI SDK adapter — when DEFERRED-AUDIT-ITEMS.md OBS-5 is picked up. Cleaner long-term.

#### Sentry — Session Replay (ALREADY ENABLED)

- **What**: records DOM + network for browser sessions. ALREADY configured at `instrumentation-client.ts:26-36` with `maskAllText: true, maskAllInputs: true, replaysSessionSampleRate: 0.1, replaysOnErrorSampleRate: 1.0`.
- **Effort**: 0 (already on).
- **Why scheduler-app needs it**: customers describe "it just froze" — replay shows exact UI state at failure.
- **PII risk**: low (already masked).
- **Recommendation**: KEEP. Verify masking covers Wizard step inputs (looks correct based on the code; sanity-check in Sentry UI by opening a recent replay).

#### Sentry — Profiling

- **What**: continuous profiler captures CPU samples + flame graphs from Node + browser. Pairs with traces to show WHICH code is slow.
- **Effort**: 0.5 day. Add `@sentry/profiling-node` for the Next.js Node runtime, set `profilesSampleRate: 0.1`. Edge runtime (Deno) is not supported.
- **Why scheduler-app needs it**: maybe. The diagnose-concern path is the only hot spot worth profiling (3 LLM calls + a deterministic mapper) — LLM latency dominates and isn't profile-fixable. Defer until we have a non-LLM perf complaint.
- **PII risk**: low (stack frames + symbol names, not values).
- **Recommendation**: DEFER. Revisit if Server Action p95 latency stops being LLM-bound.

#### Sentry — Seer (AI root-cause analysis)

- **What**: connects Sentry to the GitHub repo and uses the stack trace + recent commits to surface "this error is probably caused by commit X."
- **Effort**: 0.5 day (Sentry dashboard config + GitHub integration auth).
- **Why scheduler-app needs it**: high signal-to-noise for Chris (solo dev) — instead of opening 5 tabs to triage an exception, Seer points at the suspect commit. Works well when commits are small + focused (project's commit style fits).
- **PII risk**: low (stack frames + code only; no customer data).
- **Recommendation**: ENABLE.

### Resend

#### Resend — Inbound email parsing

- **What**: receive emails to a custom domain (e.g., `reply@jeffsautomotive.com`), parse them, deliver content via webhook. Useful for staff replies, customer follow-up, automated routing.
- **Effort**: 2-3 days. Configure inbound subdomain DNS + Resend dashboard. Build a `supabase/functions/resend-inbound-webhook` to parse + write to `customer_chat_sessions.staff_notes` or `customer_replies` table. Add signature verification using Resend's webhook secret.
- **Why scheduler-app needs it**: today staff cannot reply to a transcript email and have the reply land in the customer's chat session record — they have to copy/paste into Tekmetric. Inbound parsing closes that loop.
- **PII risk**: medium. Inbound emails will carry full customer name + phone + reply content. Use Resend's per-event signature verification before persisting.
- **Recommendation**: ENABLE in Phase 2. Solid productivity win for Chris + advisors.

#### Resend — Webhook delivery tracking (`email.bounced` / `email.complained`)

- **What**: per-event webhooks fire on send/deliver/bounce/complaint/click/open with payload-per-recipient (Resend now emits distinct events per recipient per the 2026 changelog).
- **Effort**: 1 day. Build `supabase/functions/resend-event-webhook` with HMAC signature verification, write to `resend_email_events(id, type, email, session_id, payload, created_at)` table. Alert on persistent bounces (3+ bounces in 24h to the same address → Sentry + DLQ).
- **Why scheduler-app needs it**: today a bounced transcript is invisible — `transcript_emails.status='sent'` but the advisor never receives it. The 5-attempt retry doesn't detect post-acceptance bounces.
- **PII risk**: low (we already store the recipient email in `transcript_emails`).
- **Recommendation**: ENABLE.

#### Resend — Suppression list management

- **What**: Resend auto-suppresses addresses that hard-bounce or complain. Programmatic remove + read API available.
- **Effort**: 0.5 day. Wire a daily cron that pulls the suppression list + flags affected `transcript_emails` rows.
- **Why scheduler-app needs it**: if `service@jeffsautomotive.com` lands on the suppression list during an outage, we want to know IMMEDIATELY.
- **PII risk**: zero.
- **Recommendation**: ENABLE.

#### Resend — Batch sends

- **What**: send up to 100 emails in one API call.
- **Effort**: 1 day if needed.
- **Why scheduler-app needs it**: not really — we send 1 transcript + 1 staff notification per appointment. No bulk path today.
- **Recommendation**: DEFER (no use case).

### Telnyx

#### Telnyx — Delivery-status webhook

- **What**: subscribe to `message.sent`, `message.finalized`, `message.delivery_updated` webhooks → know whether the SMS actually landed.
- **Effort**: 1.5 days. Configure messaging-profile webhook URL in Telnyx dashboard. Build `supabase/functions/telnyx-message-webhook` with signature verification (Telnyx uses Ed25519 public-key signature in the `Telnyx-Signature-Ed25519` header — REAL signature verification, unlike Tekmetric). Write events to `telnyx_message_events(id, message_id, status, raw, created_at)`. If a delivery FAILS, automatically `consumed_at` the matching `otp_codes` row + capture warning.
- **Why scheduler-app needs it**: today we only know Telnyx accepted the message; if the actual carrier rejects it (number opt-out, invalid, blocked), we burn one of the customer's 3-per-hour slots for nothing.
- **PII risk**: low (we already store `phone_e164` in `otp_codes`).
- **Recommendation**: ENABLE. High value-to-effort ratio.

#### Telnyx — Voice AI Agents

- **What**: build a conversational voice agent (in Telnyx's platform) that can answer overflow shop calls, schedule appointments, answer FAQs. Sub-500ms latency, 40+ languages.
- **Effort**: 2-4 weeks for production rollout (scope discovery alone is significant).
- **Why scheduler-app needs it**: HIGH potential — the scheduler-app already has the booking ladder (`scheduler-booking-direct`), the OTP gate, the Tekmetric customer+vehicle resolution. A Telnyx Voice AI Agent could expose THE SAME backend over the phone for callers who don't want to text-chat. Hooks via Tools to the same edge functions.
- **PII risk**: high — voice transcripts contain everything chat does. Use Telnyx's PCI-safe recording-redaction features + scrub before persisting.
- **Recommendation**: STRATEGIC DEFER. Worth a Phase-3 scope doc, not a Phase-2 launch item.

#### Telnyx — Missed-call text-back

- **What**: when an inbound call to the shop number rings out, trigger an outbound SMS to the caller's number with a link to the scheduler-app.
- **Effort**: 2 days. Configure `call.hangup` webhook with the shop's Telnyx voice number → check if `hangup_cause === "originator"` AND call duration was zero/short AND outside-business-hours → send SMS "Sorry we missed you! Book online: https://appointments.jeffsautomotive.com/?ref=missed-call".
- **Why scheduler-app needs it**: directly capturable demand. Per industry benchmarks (NextPhone 2026 reference) missed-call-text-back has high conversion vs. cold callbacks.
- **PII risk**: low (caller's number is the only datum).
- **Recommendation**: ENABLE. Strong fit for the existing Telnyx + scheduler-app stack.

#### Telnyx — A2P 10DLC registration status

- **What**: the registration status of the brand + campaigns Telnyx auto-registers via TCR.
- **Effort**: 1 hour (read the status, document it in scheduler doc).
- **Why scheduler-app needs it**: unregistered or unverified 10DLC traffic is heavily filtered/throttled by carriers in 2026. If we haven't completed A2P registration, OTP delivery rates will degrade silently.
- **PII risk**: zero.
- **Recommendation**: VERIFY (a one-time check). If not registered, register before Phase 2 launch.

### Vercel

#### Vercel — BotID

- **What**: invisible CAPTCHA. ML-based client-side challenge that distinguishes humans from bots without showing a puzzle. Two tiers: Basic (free) + Deep Analysis (paid).
- **Effort**: 1 day. Install `@vercel/botid`, wrap the chat API route + the OTP request action with `checkBotId()`, return 403 on bot.
- **Why scheduler-app needs it**: HIGH. Today an attacker can mass-trigger Telnyx SMS sends (3/hr per phone, but nothing limits to-1000-distinct-phones-per-hour). Each SMS costs us $0.004 USD; 100k SMS = $400 in damage with zero customer value. BotID is built precisely for endpoints like `/api/chat` + `/scheduler/submit-phone-name`.
- **PII risk**: low (BotID processes signals server-side; no customer data exposed externally).
- **Recommendation**: ENABLE. Top-priority Phase-2 item.

#### Vercel — Edge Config

- **What**: globally-distributed key-value store with sub-1ms reads. Use cases: feature flags, A/B test config, redirects, shop hours.
- **Effort**: 0.5 day per flag.
- **Why scheduler-app needs it**: medium. Shop hours could move here from DB (avoids the hourly cron pull). Phase-2 multi-shop config: per-shop feature toggles. Phase-2 "kill switch" for individual scheduler flows during incidents.
- **PII risk**: zero.
- **Recommendation**: DEFER for now. Strong tool when Phase-2 multi-shop scaling lands; not needed for single-shop Phase 1.

#### Vercel — Firewall + WAF rules

- **What**: custom WAF rules + DDoS protection + IP/country/asn-based filtering.
- **Effort**: 1 day.
- **Why scheduler-app needs it**: medium. Country block (deny non-US traffic to the OTP send action since we only message US numbers) is a cheap win. ASN block for known bot networks.
- **PII risk**: zero.
- **Recommendation**: ENABLE country-block rule. Defer custom WAF rules until we have a bot incident.

#### Vercel — Speed Insights

- **What**: Real-User-Monitoring for Core Web Vitals (LCP, CLS, INP). Surfaces slow pages by device + region.
- **Effort**: 0.5 day.
- **Why scheduler-app needs it**: customer-facing latency directly affects abandon rate. Currently no Core Web Vitals data; flying blind on mobile perf.
- **PII risk**: low.
- **Recommendation**: ENABLE.

#### Vercel — Log Drains

- **What**: stream Vercel function/edge logs to an external destination (Sentry, Datadog, Logflare).
- **Effort**: 0.5 day.
- **Why scheduler-app needs it**: complements Supabase Log Drain → Sentry (which is plan-gated). Vercel Log Drains can stream `app/api/chat/route.ts` logs to Sentry directly.
- **PII risk**: medium — runtime logs may carry stack traces with values. Today our `scrubEvent` runs in `beforeSend` for Sentry events but raw logs bypass that. Configure Sentry-side data scrubber on the log-ingest destination.
- **Recommendation**: ENABLE once Sentry-side scrubbing rules are verified (OBS-6b deferred item).

### Supabase (Realtime, Vault, Branching, Read Replicas)

#### Supabase — Realtime Broadcast

- **What**: pub/sub channel-based messaging — any client → any other client.
- **Effort**: 1 week for the customer-facing wizard.
- **Why scheduler-app needs it**: LOW today. The wizard is single-user (the customer's own session); push messages don't add value. Could be useful for "advisor types a hand-off note → customer sees it" but that's a Phase-3 feature.
- **PII risk**: medium — channels must be scoped per-session (Realtime Broadcast Authorization, 2026 GA) to prevent cross-tenant leakage.
- **Recommendation**: DEFER.

#### Supabase — Vault (ALREADY USED)

- **What**: encrypted secrets storage inside Postgres. Already used to hold the Tekmetric access token (tekmetric-client.ts:21 reads via `tekmetric_get_secret` RPC).
- **Effort**: 0 (in use).
- **Recommendation**: KEEP. Consider migrating `RESEND_API_KEY`, `TELNYX_API_KEY` into Vault for consistency (currently in Supabase Edge Function env vars, which is also acceptable).

#### Supabase — Branching

- **What**: per-PR DB branches with isolated schema + data. $0.013/branch/hour.
- **Effort**: 0.5 day to enable; ongoing cost.
- **Why scheduler-app needs it**: medium. Schema-change PRs (and there are many in scheduler — see `supabase/migrations/`) would benefit from preview environments. Currently we test migrations against dev project.
- **PII risk**: low (branches copy schema, optionally data).
- **Recommendation**: DEFER. Solo dev with disciplined `supabase db reset` workflow; revisit when contributors join.

#### Supabase — Read Replicas

- **What**: read-only replicas in additional regions. Pro/Enterprise.
- **Effort**: 0.5 day.
- **Why scheduler-app needs it**: not yet. Single-shop, single-region (US East). p95 query latency is fine.
- **Recommendation**: DEFER.

### Anthropic

#### Anthropic — Prompt caching (PARTIALLY ENABLED — measure it)

- **What**: prefix-caching on the system prompt. Up to 90% cost reduction + 85% latency reduction. Currently set to `'auto'` via Gateway (diagnose-concern.ts:868) which auto-inserts `cache_control` markers.
- **Effort**: 0.5 day to instrument. Wire `msg.usage.cache_read_input_tokens` + `msg.usage.cache_creation_input_tokens` into a Sentry tag/measurement so we can dashboard cache-hit-rate.
- **Why scheduler-app needs it**: Stage 1 system prompt rebuilds the FULL category catalog every call (~5-8KB stable text per `buildStage1SystemPrompt`). Stage 2 prompt is per-category (rebuilds for each pick, less stable but still cacheable). Stage 3 is constant per-subcategory. Even modest hit rates (50%) would meaningfully reduce per-classify cost.
- **PII risk**: zero — cache contents are server-side at Anthropic.
- **Recommendation**: MEASURE first, then optimize. The "auto" mode might be sub-optimal; if hit rate is low, switch to manual cache_control with explicit breakpoints.

#### Anthropic — Message Batches API

- **What**: bundle up to 100k requests, get 50% cost reduction, async (return-in-24h SLA).
- **Effort**: 1 day for the eval harness rewrite.
- **Why scheduler-app needs it**: NOT for production (latency-sensitive). DO for the `scripts/eval-diagnose-concern.ts` harness — eval runs ~200-1000 prompts serially today; batching cuts cost in half + serial wall-clock to wall-clock-of-slowest.
- **PII risk**: zero (eval prompts are synthetic).
- **Recommendation**: ENABLE for eval workflows.

#### Anthropic — Memory tool

- **What**: persistent memory across conversations (introduced 2026).
- **Effort**: 1-2 weeks if adopted.
- **Why scheduler-app needs it**: low today (single-session flows; concerns reset per appointment). Worth a look when Phase-2 returning-customer recognition deepens.
- **Recommendation**: DEFER.

#### Anthropic — Citations API

- **What**: when the model references a document, return precise span citations.
- **Effort**: N/A — we don't have a RAG path.
- **Recommendation**: NOT APPLICABLE. (Possibly relevant when service-advisor knowledge-base lookup ships, Phase 3.)

---

## Recommended action list (prioritized)

| # | Item | Integration | Effort | Why |
|---|---|---|---|---|
| 1 | Enable Vercel BotID on chat + OTP endpoints | Vercel | 1d | Prevents SMS-cost-attack |
| 2 | Wire Sentry Cron Monitoring on 4 scheduler crons | Sentry | 1d | Surfaces silently-skipped runs |
| 3 | Telnyx delivery-status webhook | Telnyx | 1.5d | Closes the "Sent but not delivered" gap |
| 4 | Resend `email.bounced` / `email.complained` webhook | Resend | 1d | Detects undelivered transcripts |
| 5 | Instrument Anthropic prompt-cache hit-rate | Anthropic | 0.5d | Measure before optimizing |
| 6 | Tekmetric circuit breaker (Upstash-Redis) | Tekmetric | 2d | Prevents escalation storm on Tekmetric outage |
| 7 | Sentry Seer (suspect-commit) GitHub link | Sentry | 0.5d | Faster triage for solo dev |
| 8 | Telnyx missed-call text-back | Telnyx | 2d | Capturable demand from missed calls |
| 9 | Vercel Speed Insights | Vercel | 0.5d | Mobile-CWV visibility |
| 10 | Sentry AI agent monitoring (gen_ai spans) — OBS-5 | Sentry + AI SDK | 2-3d | Token cost dashboards |
| 11 | Resend suppression-list daily check | Resend | 0.5d | Catches reputation issues |
| 12 | Resend inbound email parsing (advisor replies) | Resend | 2-3d | Closes the staff-reply loop |
| 13 | Sentry-side project Data Scrubbing rules (OBS-6b) | Sentry | 1h dashboard | Defense in depth on PII |
| 14 | Vercel country-block WAF rule | Vercel | 1d | Cheap bot-volume reduction |
| 15 | Anthropic Message Batches for eval harness | Anthropic | 1d | 50% cost cut on evals |

Numbers 1-5 are high value-to-effort and should land in the next 1-2 weeks per Chris's typical sprint cadence. 6-10 are next-quarter. 11-15 are nice-to-have.

---

## Sources cited

### Sentry
- https://docs.sentry.io/platforms/javascript/guides/nextjs/ — Next.js SDK manual setup
- https://docs.sentry.io/platforms/javascript/guides/nextjs/crons/ — Cron monitoring setup
- https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/vercelai/ — Vercel AI integration
- https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/ — AI agent observability
- https://sentry.io/cookbook/monitor-ai-agent-costs-nextjs/ — Token cost dashboards
- https://docs.sentry.io/platforms/javascript/guides/node/ai-agent-monitoring/ — Node SDK AI monitoring
- https://blog.sentry.io/nextjs-supabase-observability/ — Distributed traces Next → Supabase
- https://blog.sentry.io/next-js-observability-gaps-how-to-close-them/ — onRequestError + error.tsx pattern

### Resend
- https://resend.com/docs/dashboard/receiving/introduction — Inbound email
- https://resend.com/blog/webhooks — Webhook events
- https://resend.com/changelog/webhook-event-visibility — Per-recipient event split (2026)
- https://resend.com/changelog/domain-verification-events — Verification status surfacing
- https://resend.com/features/inbound — Inbound feature page
- https://resend.com/docs/dashboard/domains/dmarc — DMARC setup

### Telnyx
- https://developers.telnyx.com/api-reference/messages — Messaging API
- https://developers.telnyx.com/api-reference/callbacks/call-hangup — Call hangup webhook
- https://telnyx.com/resources/what-is-10dlc — 10DLC registration
- https://telnyx.com/products/voice-ai-agents — Voice AI Agents
- https://telnyx.com/release-notes — Release notes
- https://www.getnextphone.com/blog/missed-call-text-back — Industry MCTB benchmark

### Vercel
- https://vercel.com/docs/botid — BotID overview
- https://vercel.com/botid — BotID product page
- https://vercel.com/blog/botid-deep-analysis-catches-a-sophisticated-bot-network-in-real-time — Deep Analysis case study
- https://vercel.com/docs/bot-management — Bot Management
- https://vercel.com/docs/edge-config — Edge Config
- https://vercel.com/blog/vercel-security-roundup-improved-bot-defenses-dos-mitigations-and-insights — 2026 security roundup
- https://vercel.com/ai-gateway — AI Gateway

### Supabase
- https://supabase.com/docs/guides/realtime/broadcast — Realtime Broadcast
- https://supabase.com/features/realtime-presence — Realtime Presence
- https://supabase.com/docs/guides/cron — Supabase Cron
- https://supabase.com/docs/guides/functions/schedule-functions — Scheduling Edge Functions
- https://supabase.com/changelog — Read Replicas + Branching changelog
- https://supabase.com/blog/processing-large-jobs-with-edge-functions — Edge Functions + Cron + Queues

### Anthropic
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching — Prompt caching
- https://platform.claude.com/docs/en/build-with-claude/batch-processing — Message Batches API
- https://www.anthropic.com/news/prompt-caching — 90% cost / 85% latency claim
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching — Tool use + caching
