---
agent: audit-observability-secrets
timestamp: 2026-05-22T03:00:00Z
scope: scheduler-app + supabase/functions + migrations + .env / .gitignore + secrets
---

# Observability + secrets audit

## Executive summary

**Audit A — observability:** Strong baseline. Every Server Action (27/27) is wrapped via the canonical `wrapAction` helper; Sentry Next.js init is thorough (client + server + edge configs, `instrumentation.ts`, `onRequestError`); `error.tsx` + `global-error.tsx` both `captureException` and render `error.digest`; structural `beforeSend` PII scrubber present on both Next.js + Deno surfaces; all currently-effective `cron.schedule` bodies wrap in `BEGIN ... EXCEPTION ... END`; `eslint.config.mjs` has the required rules (`no-empty allowEmptyCatch:false`, `no-floating-promises`, `no-misused-promises`).

**Audit A — gaps:**
1. **13 of 17 Deno edge functions skip `withSentryScope`** — only 4 high-value scheduler-relevant fns (appointments-sync, transcript-dispatcher, keytag-bulk-reconcile, keytag-daily-report) are wrapped per OBS-3. The 13 unwrapped fns include the 3 direct scheduler fns (otp / step2 / booking), 2 webhook receivers (tekmetric-webhook + keytag-tekmetric-webhook), 2 OAuth + MCP fns (mcp-auth + orchestrator-mcp), and 6 tekmetric/keytag utility fns. Tracked in `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` OBS-3 as known partial-resolution.
2. **2 webhook receivers silently 401 on token-mismatch** without `Sentry.captureMessage('warning', ...)` — `tekmetric-webhook` (line 153) and `keytag-tekmetric-webhook` (line 297). Both extract the IP/headers and have them in scope; rule 5 of observability.md calls for explicit alerting.
3. **`next.config.ts` disables ESLint at build time** (`eslint.ignoreDuringBuilds: true`, line 35) and there are no `.github/workflows/*.yml` CI files. The empty-catch + floating-promise + console rules are advisory unless `npx eslint .` runs in CI or pre-commit. No Semgrep config at the project root either (`.semgrep.yml` absent).
4. **6 edge-fn sites use `console.error("...:", error.message)` without paired Sentry capture** — these run in fns where `@sentry/deno` is not initialized (the 13 unwrapped fns), so the structured log goes to Supabase Edge Function logs only. With Log Drain gated by Supabase Team plan (org is on Pro), these errors are not surfacing to Sentry.

**Audit A — non-issues / well-covered:** no Realtime channel subscriptions exist (so the `CHANNEL_ERROR` / `TIMED_OUT` rule has no applicable surfaces); zero `} catch {}` truly-empty catches found — every catch has a body or a justifying inline comment; no `console.log(error)` anti-patterns; no `.catch(() => null)` outside acceptable "best-effort beacon" sites.

**Audit B — secrets:** Clean. Zero hardcoded JWTs, API keys, OAuth secrets, bearer tokens, AWS/GitHub PATs, or Stripe-style tokens found across all `.ts/.tsx/.js/.mjs/.sql/.md` files. `.env*` patterns correctly ignored by both root and scheduler-app `.gitignore`; no `.env` files in git history. All `NEXT_PUBLIC_*` env vars are appropriately public (Sentry public DSN, Supabase URL, anon/publishable key). Server-only secrets (SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ANTHROPIC_API_KEY, AI_GATEWAY_API_KEY, TEKMETRIC_WEBHOOK_TOKEN, TELNYX_API_KEY, etc.) are never `NEXT_PUBLIC_`-prefixed.

**Audit B — gap:** `.env.example` exists in the repo but is **also gitignored** (per `.gitignore` line 19-20, `.env.*` blanket-ignores it; the prior `!.env.example` exception was removed 2026-05-11 because the local file had been populated with live secrets). The file is therefore a local-only reference and untracked. There is no committed `.env.template` with placeholder values, so a fresh clone has no documentation of required env vars beyond the names used in code + the `scheduler-app/scripts/env-check.mjs` check list.

---

## Audit A — Observability coverage

### A.1 — Server Actions Sentry wrap

**Pattern enforced via `wrapAction(name, impl)` in `scheduler-app/src/lib/scheduler/wizard/instrument-action.ts:35-70`.** This helper wraps `Sentry.withServerActionInstrumentation(name, {recordResponse: false}, ...)` and auto-tags `wizard_action` + `chat_id` on the active scope.

27 of 27 `'use server'`-marked files use `wrapAction`. Verified by cross-referencing the two file lists below:

| Action file | `wrapAction` export | Status |
|---|---|---|
| `scheduler-app/src/lib/scheduler/wizard/actions/dismiss-escalation.ts:153` | `dismissEscalationV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/resend-otp.ts:124` | `resendOtpV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.ts:579` | `runDiagnosticsV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-appointment-type.ts:78` | `submitAppointmentTypeV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-back.ts:137` | `submitBackV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-clarification-answer.ts:348` | `submitClarificationAnswerV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-info-edit.ts:216` | `submitCustomerInfoEditV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-notes.ts:130` | `submitCustomerNotesV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-question.ts:143` | `submitCustomerQuestionV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-date.ts:209` | `submitDateV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-escalate.ts:143` | `submitEscalateV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-explanation.ts:206` | `submitExplanationV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-greeting.ts:82` | `submitGreetingV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-multi-account-choice.ts:162` | `submitMultiAccountChoiceV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-new-customer-info.ts:285` | `submitNewCustomerInfoV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-new-vehicle.ts:211` | `submitNewVehicleV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-no-match-choice.ts:93` | `submitNoMatchChoiceV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-otp.ts:206` | `submitOtpV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-partial-verification-choice.ts:129` | `submitPartialVerificationChoiceV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-phone-name.ts:298` | `submitPhoneNameV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-second-routine-pass.ts:156` | `submitSecondRoutinePassV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-service-and-concern-picker.ts:229` | `submitServiceAndConcernPickerV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-start-over.ts:183` | `submitStartOverV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts:112` | `submitSummaryV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-testing-service-approval.ts:129` | `submitTestingServiceApprovalV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-vehicle-pick.ts:160` | `submitVehiclePickV2` | wrapped |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-waiter-time.ts:150` | `submitWaiterTimeV2` | wrapped |

**Internal helpers that import Sentry but are NOT `'use server'` (acceptable):**
- `scheduler-app/src/lib/scheduler/wizard/actions/fire-transcript-dispatch.ts:42` — exported as a plain async function `fireTranscriptDispatch`, invoked from `submit-escalate.ts:122` + `submit-customer-question.ts:122` inside already-wrapped Server Actions. No top-level wrap needed; tracing context inherits from caller. Has its own internal `Sentry.captureException` on insert-failure (L56) + POST-failure (L133).
- `scheduler-app/src/lib/scheduler/wizard/route-after-diagnostics.ts` — pure sync function, no IO, no Sentry needed.

No `'use server'` files exist in `scheduler-app/app/**` or elsewhere — searched `^['"]use server['"]` across `scheduler-app/src/` + `scheduler-app/app/`.

### A.2 — Edge fn Sentry wrap (`withSentryScope`)

| Edge fn | Wrapped via `withSentryScope`? | Notes |
|---|---|---|
| `supabase/functions/appointments-sync/index.ts:420` | **YES** | `withSentryScope(req, "appointments-sync", ...)` |
| `supabase/functions/transcript-dispatcher/index.ts:885` | **YES** | `withSentryScope(req, "transcript-dispatcher", ...)` |
| `supabase/functions/keytag-bulk-reconcile/index.ts:1216` | **YES** | `withSentryScope(req, "keytag-bulk-reconcile", ...)` |
| `supabase/functions/keytag-daily-report/index.ts:431` | **YES** | `withSentryScope(req, "keytag-daily-report", ...)` |
| `supabase/functions/scheduler-otp-direct/index.ts:389` | NO | `Deno.serve(handleRequest)` plain. Catches inside `handleRequest` (L362-386) push to `logEdgeError`, which forwards to Sentry **only if `Sentry.init` ran** in this isolate — which it didn't since this fn never imports `_shared/sentry-edge.ts`. Net: no Sentry coverage. |
| `supabase/functions/scheduler-step2-direct/index.ts:509` | NO | Same shape as otp-direct — `Deno.serve(handleRequest)`; logEdgeError in catch only. |
| `supabase/functions/scheduler-booking-direct/index.ts:939` | NO | Same shape — `Deno.serve(handleRequest)`; logEdgeError in catch only (L907-936). |
| `supabase/functions/tekmetric-webhook/index.ts:135` | NO | Webhook receiver; no Sentry init in this isolate. |
| `supabase/functions/keytag-tekmetric-webhook/index.ts:289` | NO | Webhook receiver; no Sentry init in this isolate. |
| `supabase/functions/mcp-auth/index.ts:564` | NO | OAuth endpoint — issues access tokens. |
| `supabase/functions/orchestrator-mcp/index.ts:357` | NO | MCP RPC dispatcher. `console.error("orchestrator-mcp internal error:", msg)` at L444 for the catch-all — no Sentry. |
| `supabase/functions/llm-testing/index.ts:1761` | NO | LLM smoke / scoring harness — internal dev surface. |
| `supabase/functions/keytag-seed-from-tekmetric/index.ts:107` | NO | One-shot backfill — manually invoked. |
| `supabase/functions/tekmetric-list-wip-keytags/index.ts:23` | NO | Internal probe. |
| `supabase/functions/tekmetric-find-ro-by-keytag/index.ts:51` | NO | Orchestrator tool wrapper. |
| `supabase/functions/tekmetric-bootstrap/index.ts:54` | NO | One-shot OAuth bootstrap (sensitive — writes to Vault). |
| `supabase/functions/tekmetric-api-testing/index.ts:949` | NO | Dev probe sandbox. |

`_shared/sentry-edge.ts:87-113` provides the helper. The 13 unwrapped fns are tracked at `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` OBS-3 ("Additional edge functions get wired piecemeal as they're touched"). Sensitive ones (3 direct scheduler fns + 2 webhook receivers + mcp-auth) deserve prioritization since they're customer-facing or auth-touching.

### A.3 — Cron exception handler

| Cron job | Where registered | Body wraps `BEGIN ... EXCEPTION ... END`? |
|---|---|---|
| `scheduler-appointments-sync` | originally `20260510210117_scheduler_cron_setup.sql:162` → **re-registered** at `20260516200000_scheduler_cron_exception_wraps.sql:33` | **YES** (in re-registration) |
| `scheduler-transcript-dispatcher` | originally `20260510210117_scheduler_cron_setup.sql:184` → **re-registered** at `20260516200000_scheduler_cron_exception_wraps.sql:63` | **YES** (in re-registration) |
| `keytag-daily-report` | originally `20260511132525_keytag_daily_report_cron.sql:33` → **re-registered** at `20260516200000_scheduler_cron_exception_wraps.sql:93` | **YES** (in re-registration) |
| `keytag-bulk-reconcile` | originally `20260511144500_keytag_nightly_reconcile_cron.sql:33` → **re-registered** at `20260516200000_scheduler_cron_exception_wraps.sql:123` | **YES** (in re-registration) |
| `scheduler-hold-reaper` | `20260516190000_scheduler_cron_reapers.sql:53` | **YES** (lines 82-93) |
| `scheduler-error-log-prune` | `20260516190000_scheduler_cron_reapers.sql:112` | **YES** (lines 137-148) |
| `scheduler-admin-snapshot-prune` | `20260519140000_scheduler_md_edit_v2_schema.sql:54` | **YES** (lines 65-77) |

All 7 currently-effective crons wrap in `BEGIN ... EXCEPTION WHEN OTHERS THEN INSERT INTO public.scheduler_error_log ...`. The 2 originally-unwrapped registrations (in migration timestamps `20260511132525` + `20260511144500`) are superseded by the 2026-05-16 re-registration migration.

### A.4 — Webhook signature alert

| Webhook | Sig-fail path | Calls `Sentry.captureMessage('warning', ...)`? |
|---|---|---|
| `supabase/functions/tekmetric-webhook/index.ts` (lines 144-158) | Returns `JSON.stringify({error: "Unauthorized"})` 401 on token mismatch (L153-157), or 500 on missing `TEKMETRIC_WEBHOOK_TOKEN` env var with bare `console.error` (L145-149) | **NO** — silently 401. No `Sentry.captureMessage`, no `logEdgeError`. Sentry is not even initialized in this isolate (no `withSentryScope`). |
| `supabase/functions/keytag-tekmetric-webhook/index.ts` (lines 290-299) | Same shape — 401 on token mismatch (L297-298), 500 on missing token env var with bare `console.error` (L292-293) | **NO** — silently 401. Same root cause as above. |

Both webhooks are token-in-URL auth (Tekmetric doesn't support custom headers), so a token mismatch could be:
- a misconfigured Tekmetric subscription
- a token rotation that didn't propagate
- a spray attack from a third party who learned the URL

None of these surface anywhere observable. The keytag-tekmetric-webhook is especially load-bearing (5 production subscriptions — see file header L6-12).

### A.5 — Realtime channel error

Searched both `\.channel\(.+\)` and `\.subscribe\s*\(` across the entire repo. **No Realtime subscriptions exist.** The only `.subscribe(` matches in the codebase are not Supabase Realtime — they're inside the wizard's UI components that use TanStack Query / React state, not Realtime channels. Rule not applicable to current code.

### A.6 — `error.tsx` + `global-error.tsx`

| File | `Sentry.captureException(error)` in `useEffect`? | Renders `error.digest` (not `error.message`)? | Verdict |
|---|---|---|---|
| `scheduler-app/app/error.tsx` | **YES** — L28-32 `useEffect(() => { Sentry.captureException(error, { tags: { boundary: "app-error" } }); }, [error])` | **YES** — renders `error.digest` on L64-74 wrapped in `<code>`; never renders `error.message`. Friendly Jeff-voice copy. | **PASS** |
| `scheduler-app/app/global-error.tsx` | **YES** — L26-30 `useEffect(() => { Sentry.captureException(error, { tags: { boundary: "global-error" } }); }, [error])` | N/A — uses `NextError` component for body; `error.digest` not rendered, but `error.message` also not rendered (Next.js's `NextError` shows a generic message + statusCode). | **PASS** |

Includes `<html>` + `<body>` per Next.js requirement (L33-41).

### A.7 — `instrumentation.ts`

`scheduler-app/instrumentation.ts:36`:

```ts
export const onRequestError = Sentry.captureRequestError;
```

Plus dynamic imports of `sentry.server.config` (L25-27) for `NEXT_RUNTIME=nodejs` and `sentry.edge.config` (L29-31) for `NEXT_RUNTIME=edge`. **PASS** — fully compliant with observability.md rule 4.

Companion file `scheduler-app/instrumentation-client.ts:51` exports `onRouterTransitionStart = Sentry.captureRouterTransitionStart` for App Router navigation tracing.

### A.8 — `beforeSend` redaction

Both Sentry init files have structural object-walker scrubbing, not just regex-on-stringified-payload:

| File | `beforeSend` present? | Structural walker? | PII key blocklist | String regex |
|---|---|---|---|---|
| `scheduler-app/sentry.server.config.ts:81-87` | YES | YES — `scrubValue()` recursively walks objects + arrays (L142-159), `scrubEvent()` covers `event.user`, `event.message`, `event.exception.values[].value`, `event.contexts`, `event.extra`, `event.breadcrumbs[].data + .message`, `event.request.{data,headers,query_string}` (L161-218) | 32-entry `PII_KEY_BLOCKLIST` set (L95-128): email, phone, name variants, address fields, plus `tekmetric_error_text` wholesale | EMAIL_RE, PHONE_E164_RE (preserves last 4), OTP_NEAR_KEY_RE |
| `supabase/functions/_shared/sentry-edge.ts:76-82` | YES | YES — `scrubValue()` mirror (L166-182), `scrubEvent()` mirror (L185-215) | Identical 32-entry blocklist (L121-152) | Identical 3 regexes (L154-156) |
| `scheduler-app/instrumentation-client.ts` | **NO** | N/A | N/A — client uses `replayIntegration` with `maskAllText: true` + `maskAllInputs: true` (L31-32) instead of beforeSend. Session Replay is the main client-side surface. |

The client config has no `beforeSend`. This is defensible because:
- Replay masks all text + inputs, so the PII surface on the client side is the URL bar + cookies + form values (all masked in Replay)
- Client errors that DO trip `app/error.tsx` route through server-side Sentry too (the `Sentry.captureException` in the boundary fires during a server-side hydration check)

But strictly per rule 13, a parallel `beforeSend` on the client config (covering `event.breadcrumbs[].data` for any non-Replay breadcrumbs like custom-tracked fetch URLs) would tighten this surface.

Fail-closed behavior on both server + edge: if `scrubEvent` throws, returns `null` to drop the event entirely (better silent drop than silent leak — server config L82-86, edge config L77-81).

### A.9 — Empty catches / anti-patterns

**Truly empty `} catch {} ` (no body, no comment justification):** zero.

**Truly empty `catch (e) {}`:** zero.

**`.catch(() => null)` / `.catch(() => {})`:** zero in production paths. Two occurrences both with explicit context (best-effort beacon, transcript-dispatcher non-blocking request body parse):
- `supabase/functions/transcript-dispatcher/index.ts:906` — `(await req.json().catch(() => null))` — request body parse in a backstop-mode handler. Acceptable per file's documented "best effort" contract.
- `scheduler-app/app/api/scheduler/mark-abandoned/route.ts:51` — `(await req.json().catch(() => null))` — beacon endpoint, same shape.

**`console.log(error)` in production code:** zero.

**`console.error("...:", error.message)` without paired `Sentry.captureException`:** 6 sites, all in edge fns that have no `withSentryScope` wrap (i.e., Sentry not initialized in that isolate):

| file:line | Code | Severity |
|---|---|---|
| `supabase/functions/keytag-tekmetric-webhook/index.ts:194` | `console.error("keytags lookup failed:", error.message)` | IMPORTANT — DB query failure on hot webhook path, returns null to caller silently |
| `supabase/functions/orchestrator-mcp/index.ts:163` | `console.error("oauth_validate_access_token RPC failed:", error.message)` | IMPORTANT — auth RPC failure on every MCP request |
| `supabase/functions/orchestrator-mcp/index.ts:444` | `console.error("orchestrator-mcp internal error:", msg)` | IMPORTANT — catch-all for JSON-RPC dispatch failures |
| `supabase/functions/mcp-auth/index.ts:162` | `console.error("oauth_clients insert failed:", error.message)` | IMPORTANT — OAuth client registration failure |
| `supabase/functions/_shared/orchestrator-tools.ts:70` | `console.error("tool_calls insert failed:", error.message)` | NICE-TO-HAVE — non-blocking audit log insert failure |
| `supabase/functions/_shared/tools/manual-review-tools.ts:708` | `console.error("writeAuditLog failed:", error?.message)` | NICE-TO-HAVE — audit log insert failure (non-blocking by design) |

Note: `scheduler-app/src/components/scheduler/wizard/WizardSurface.tsx:629` does `console.error(...)` BUT pairs it with `Sentry.captureMessage` on the prior line — acceptable per observability rule 14 ("Use Sentry.captureException ... debugging prints removed before PR are fine"). The console.error here is intentional for dev-tool visibility alongside the Sentry alert.

**`} catch {` with body or justifying comment:** 38 sites, all reviewed. Vast majority are: (a) JSON-parse fallbacks returning a typed error response, (b) date-format fallbacks returning the raw ISO string, (c) lookup-fallback returning null where null is a valid domain value, (d) Sentry-capture try blocks themselves (`sentry-edge.ts:79-81`, `sentry.server.config.ts:84-86`), (e) deliberate best-effort writes (logEdgeError row insert, beacon delivery). None silently swallow domain errors without an inline comment justifying the swallow.

**Notable closely-reviewed instances:**
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-info-edit.ts:230-232` — returns `false` from a helper on catch; OK because the caller path is "treat as no-op for this branch."
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts:906-908` + `summarize-concern.ts:220-222` — "Sentry unavailable" fallback in LLM error breadcrumb capture; defensive, OK.
- `supabase/functions/_shared/log-edge-error.ts:109-112` — Sentry capture failure swallowed because `scheduler_error_log` row already wrote — by design, documented inline.

---

## Audit B — Secrets + env vars

### B.1 — Env-var inventory

**Server-side (Next.js / Node):**

| Env var | Files referenced | NEXT_PUBLIC_? | Documented in env-check? | Risk |
|---|---|---|---|---|
| `SENTRY_DSN` | `sentry.server.config.ts:21`, `sentry.edge.config.ts:18` | No | Yes (script comment) | OK — server DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | `instrumentation-client.ts:20`, `sentry.server.config.ts:21` (fallback), `sentry.edge.config.ts:18` (fallback) | **YES — appropriate** | Yes | OK — Sentry public DSN is designed to be browser-exposed |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | `next.config.ts:57-58` (source-map upload at build) | No | Yes | OK — build-time only |
| `NODE_ENV` | multiple — sample-rate selection | No | N/A (built-in) | OK |
| `NEXT_RUNTIME` | `instrumentation.ts:25,29` | No | N/A (built-in) | OK |
| `CI`, `VERCEL` | `next.config.ts:61` (silent build flag) | No | N/A (built-in) | OK |
| `ORCHESTRATOR_URL` | `src/lib/scheduler/booking-direct-client.ts:270`, `otp-direct-client.ts:80`, `step2-direct-client.ts:60`, `wizard/actions/fire-transcript-dispatch.ts:32` | No | Yes (env-check.mjs) | OK — non-secret base URL |
| `RESEND_API_KEY` | `src/lib/scheduler/wizard/staff-notification.ts:48` | No | Yes | OK — server-only secret |
| `SCHEDULER_STAFF_EMAIL_TO`, `SCHEDULER_STAFF_EMAIL_FROM` | `wizard/staff-notification.ts:49,51` | No | Yes | OK — config, not secret |
| `DIAGNOSE_CONCERN_STAGE1_MODEL`, `_STAGE2_MODEL`, `_STAGE3_MODEL`, `DIAGNOSE_CONCERN_MODEL`, `SUMMARIZE_CONCERN_MODEL`, `PARSE_CUSTOMER_NOTE_MODEL` | `wizard/llm/diagnose-concern.ts:133-150`, `summarize-concern.ts:152`, `parse-customer-note.ts:133` | No | Yes | OK — model-name config |
| `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN` | `wizard/llm/diagnose-concern.ts:158` | No | Yes | OK — server-only |
| `SUPABASE_URL` | `tests/unit/supabase-admin.test.ts:23+`, indirectly via `resolve-keys.ts:126` | No | Yes | OK |
| `NEXT_PUBLIC_SUPABASE_URL` | `resolve-keys.ts:127`, `server.ts:42`, `tests/unit/supabase-admin.test.ts:24` | **YES — appropriate** | Yes (env-check.mjs L5) | OK — publishable URL |
| `SUPABASE_SECRET_KEYS` (JSON dict — canonical 2026) | `resolve-keys.ts:81` | No | Yes | OK — server-only secret |
| `SUPABASE_SECRET_KEY` (singular, transition) | `resolve-keys.ts:83` | No | Yes | OK — server-only secret |
| `SUPABASE_SERVICE_ROLE_KEY` (legacy) | `resolve-keys.ts:85`, `tests/unit/supabase-admin.test.ts:27,62,75` | No | Yes | OK — server-only secret |
| `SUPABASE_PUBLISHABLE_KEYS` | `resolve-keys.ts:105` | No | Yes (env-check.mjs L12 lists `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | OK — public-safe |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `resolve-keys.ts:107`, `server.ts:43`, `env-check.mjs:12` | **YES — appropriate** | Yes | OK — publishable key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy) | `resolve-keys.ts:109`, `server.ts:44`, `env-check.mjs:15`, `run-llm-test-batch.mjs:98`, `tests/unit/supabase-admin.test.ts` | **YES — appropriate** | Yes | OK — anon key |
| `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` (non-public fallbacks) | `resolve-keys.ts:111,113` | No | Implied | OK — same values, different name |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | `scripts/anthropic-sdk-smoke.mjs:31-33`, `scripts/eval-diagnose-concern.ts:104,129` | No | N/A (dev script only) | OK — server-only |
| `EVAL_DIAGNOSE_VERBOSE` | `scripts/eval-diagnose-concern.ts:86+` | No | N/A | OK — dev flag |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `scripts/gemini-audit-scheduler-app.mjs:45` | No | N/A (audit script) | OK — server-only |
| `OPENAI_API_KEY` | `scripts/gpt-audit-scheduler-app.mjs:54` | No | N/A (audit script) | OK — server-only |
| `SHOP_ID`, `SEED_USER_NAME`, `SEED_USER_OAUTH_ID` | `scripts/seed-concern-docs.mjs:46-49` | No | N/A (seed script) | OK — config |

**Deno edge-function runtime:**

| Env var | Files referenced | Risk |
|---|---|---|
| `SUPABASE_URL` | 15 edge fns + `_shared/oauth.ts`, `_shared/orchestrator.ts` | OK — built-in |
| `SUPABASE_SERVICE_ROLE_KEY` | 11 edge fns + `_shared/scheduler-auth.ts:35`, `_shared/orchestrator.ts`, `seed-concern-docs.mjs` | OK — server-only; built-in env |
| `SUPABASE_SECRET_KEY` | `_shared/scheduler-auth.ts:36`, `_shared/orchestrator.ts:388,419`, `llm-testing/index.ts:49` | OK — server-only |
| `SUPABASE_SECRET_KEYS` (raw JSON dict) | `_shared/scheduler-auth.ts:37` | OK — server-only |
| `TEKMETRIC_SHOP_ID` (via `ENV_NAMES`) | 10+ edge fns | OK — non-secret config |
| `TEKMETRIC_WEBHOOK_TOKEN` | `tekmetric-webhook/index.ts:31`, `keytag-tekmetric-webhook/index.ts:126` (via `ENV_NAMES.WEBHOOK_TOKEN`) | OK — server-only secret |
| `RESEND_API_KEY` | `keytag-daily-report/index.ts:43`, `keytag-bulk-reconcile/index.ts:1104`, `transcript-dispatcher/index.ts:48`, `_shared/manual-review-email.ts:18` | OK — server-only |
| `KEYTAG_REPORT_TO_EMAIL`, `KEYTAG_REPORT_FROM_EMAIL` | `keytag-daily-report`, `keytag-bulk-reconcile`, `_shared/manual-review-email.ts` | OK — config |
| `SERVICE_TEAM_EMAIL`, `TRANSCRIPT_FROM_EMAIL` | `transcript-dispatcher/index.ts:50,52` | OK — config |
| `DIAGNOSE_CONCERN_*_MODEL`, `ORCHESTRATOR_ROUTER_MODEL`, `SCHEDULER_SPECIALIST_MODEL`, `SCHEDULER_ORCHESTRATOR_MODEL`, `KEYTAG_SPECIALIST_MODEL`, `ORCHESTRATOR_MODEL`, `DIAGNOSTIC_SPECIALIST_MODEL` | LLM specialist + orchestrator-router files | OK — model-name config |
| `AI_GATEWAY_API_KEY` | `llm-testing/index.ts:50` | OK — server-only |
| `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, `TELNYX_MESSAGING_PROFILE_ID`, `SMS_PROVIDER` | `_shared/tools/scheduler-otp.ts:123-125,223-224` | OK — server-only / config |
| `SCHEDULER_TEST_PHONE_E164`, `SCHEDULER_TEST_OTP_CODE` | `_shared/tools/scheduler-otp.ts:285-286` | OK — test config |
| `EDGE_FN_SENTRY_DSN` | `_shared/sentry-edge.ts:50` | OK — server-only Sentry DSN for edge surface |

**Findings:** Zero env vars with secret content are `NEXT_PUBLIC_*`-prefixed. All `NEXT_PUBLIC_*` references are appropriately public values (Sentry public DSN, Supabase URL, anon/publishable keys). The Supabase publishable / anon key naming is documented in `resolve-keys.ts` as deliberately accepting both new (`SUPABASE_PUBLISHABLE_KEYS`) and legacy (`SUPABASE_ANON_KEY`) forms.

### B.2 — Hardcoded secret scan

Patterns searched: `eyJ[A-Za-z0-9_-]{20,}` (JWT), `sk-[A-Za-z0-9_-]{15,}` (OpenAI / Anthropic / Stripe-secret), `re_[A-Za-z0-9]{15,}` (Resend), `tnly_[A-Za-z0-9]{15,}` (Telnyx), `sb_secret_[A-Za-z0-9_-]+` (Supabase secret), `sbp_[A-Za-z0-9_-]{20,}` (Supabase access token), `AKIA[A-Z0-9]{16}` (AWS), `ghp_[A-Za-z0-9]{36}` (GitHub PAT), `github_pat_[A-Za-z0-9_]{20,}`, `(?i)bearer\s+[A-Za-z0-9._-]{20,}` (raw bearer tokens), `(?i)api[_-]?key\s*[=:]\s*['"][A-Za-z0-9_-]{15,}['"]` (api_key="..." literals).

**Findings:**

| Pattern | File | Match | Verdict |
|---|---|---|---|
| `eyJ...` JWT prefix | `scheduler-app/package-lock.json:8591` | `"integrity": "sha512-V7Qr52IhZmdKPVr+Vtw8o+WLsQJYCTd8loIfpDaMRWGUZfBOYEJeyJIkqGIDMZPwPx24pUMfwSxxI8phr/MbOA=="` | **False positive** — this is an npm package integrity hash (sha512 base64), not a JWT. The substring `IkqGIDMZ` happens to look like an `eyJ` payload but is preceded by `BOYEJ` which is part of a base64-encoded digest. |
| `sb_secret_...` | `scheduler-app/tests/unit/supabase-admin.test.ts:29` | `process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key"` | **False positive** — test placeholder string; not a real secret. |
| `sb_secret_...` | `scheduler-app/tests/unit/supabase-admin.test.ts:53` | `service_role: "sb_secret_FROM_DICT"` | **False positive** — test placeholder string in a test JSON fixture. |

No real JWTs, OpenAI/Anthropic/Resend/Telnyx keys, Supabase tokens, AWS keys, GitHub PATs, raw bearer tokens, or `api_key="..."` literals found in tracked source.

### B.3 — Gitignore + .env.example status

**Root `.gitignore`** (`C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/.gitignore`):

- `.env` and `.env.*` blanket-ignored (lines 19-20). **No exception for `.env.example` or `.env.template`.** Comment (L15-18) explains why: "the local .env.example was found to contain LIVE secrets — convention violated, so the exception was removed 2026-05-11."
- `.tmp/` ignored (sub-agent staging area).
- `.vercel`, `node_modules/`, `*.log`, OS noise — all standard.
- `.claude/` ignored — the directory is a junction to the dotfiles repo.

**Scheduler-app `.gitignore`** (`scheduler-app/.gitignore`):

- `.env*.local` and `.env.production` ignored (L18-19, L44).
- `.next`, `out`, `build`, `coverage`, `playwright-report`, `test-results` — standard.

**`.env` files present (untracked):**

| File | Tracked? | Risk |
|---|---|---|
| `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/.env.example` | NO (ignored by root `.gitignore` line 20 `.env.*`) | OK — local-only reference. **Sub-agent Read was denied** by the project permission layer, which is consistent with the "contains live secrets" note in the gitignore comment. |
| `scheduler-app/.env.local` | NO (ignored by scheduler-app `.gitignore` line 18 `.env*.local`) | OK — local dev secrets. |
| `scheduler-app/.env.local.bak-1779116875` | NO (covered by same pattern) | OK — local backup file. **Consider deleting** to reduce on-disk secret exposure. |

**git ls-files verification:** zero env files tracked. `git check-ignore -v` confirms `.env.example` and `scheduler-app/.env.local` are both ignored by their respective `.gitignore` patterns.

**git log verification:** `git log --all --diff-filter=A --follow -- .env.example` returns empty — `.env.example` was never committed.

**Gap:** there is **no committed `.env.template`** with placeholder values, so a fresh developer cloning the repo cannot easily see what env vars they need to populate without reading code. `scheduler-app/scripts/env-check.mjs` lists 3 Supabase env var names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) but does not document the broader env surface (Sentry DSN, Resend, Tekmetric, Anthropic, Telnyx, ORCHESTRATOR_URL, KEYTAG_REPORT_*, DIAGNOSE_CONCERN_*, etc.).

### B.4 — CLAUDE.md / settings / config reference scan

Scanned `scheduler-app/CLAUDE.md` (the only CLAUDE.md in the project — points to architecture doc), and the project root has no committed `settings.json` with secrets. `dotfiles-v2/jeffs-app-v2/.claude/...` rules files are scope-restricted and don't reference real secrets.

`next.config.ts` references env-var **names** (SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN, CI, VERCEL) without values — safe.

---

## Findings

### BLOCKER

None.

### IMPORTANT

1. **13 of 17 Deno edge functions lack `withSentryScope`** — including 3 customer-facing direct fns (scheduler-otp-direct, scheduler-step2-direct, scheduler-booking-direct), 2 webhook receivers (tekmetric-webhook, keytag-tekmetric-webhook), and 2 auth/OAuth fns (mcp-auth, orchestrator-mcp). Failures inside these fns only surface to Supabase Edge Function logs (which require Team plan for Log Drain → Sentry). The catch paths in the 3 scheduler-direct fns call `logEdgeError`, but that helper's Sentry-capture fallback (`log-edge-error.ts:93-112`) silently no-ops when Sentry isn't initialized in the isolate (no DSN). Tracked in `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` OBS-3 as known partial. **Priority order to wire next:** scheduler-otp-direct, scheduler-step2-direct, scheduler-booking-direct (customer-facing), then the 2 webhook receivers (auth-sensitive), then mcp-auth + orchestrator-mcp.

2. **Webhook token-mismatch silently 401 without Sentry alerting** — `supabase/functions/tekmetric-webhook/index.ts:153-157` and `supabase/functions/keytag-tekmetric-webhook/index.ts:297-298` return `JSON.stringify({error: "Unauthorized"})` 401 on token-param mismatch with no `Sentry.captureMessage(..., 'warning')`. Per observability.md rule 5, sig-verification failures should alert. This is also the natural-fit fix once these fns are wrapped per finding #1 above.

3. **Webhook missing-`WEBHOOK_TOKEN`-env-var path uses bare `console.error`** — `tekmetric-webhook/index.ts:145` and `keytag-tekmetric-webhook/index.ts:292` both `console.error("...token not set")` and return 500. This is a deployment-misconfiguration signal that should be a Sentry FATAL. Same fix-with: wrap + replace console.error with `Sentry.captureMessage('warning', ...)`.

4. **ESLint not enforced at build/CI time** — `next.config.ts:34-36` sets `eslint.ignoreDuringBuilds: true` (with documented rationale: `eslint-config-next` 15.x bundles `@rushstack/eslint-patch` which fails on Node 20+). The 3 observability ESLint rules (`no-empty allowEmptyCatch:false`, `no-floating-promises`, `no-misused-promises`) plus the `no-console` rule are configured in `eslint.config.mjs:13-29` but only fire when `npx eslint .` is invoked manually. There are no `.github/workflows/*.yml` files and no committed pre-commit hooks in the repo. Recommend: add an `npm run lint` script that calls `npx eslint . --max-warnings 0` and a CI workflow (or Vercel build-time step) that fails the build on lint errors. Alternatively migrate to `eslint-config-next@^16` paired with the `next-lint` CLI now that Next.js 16 is on the dependency-decision table.

5. **6 edge-fn sites have `console.error("...", error.message)` without paired Sentry capture** — all in fns where Sentry isn't initialized (no `withSentryScope`):
   - `supabase/functions/keytag-tekmetric-webhook/index.ts:194` (keytags lookup failed)
   - `supabase/functions/orchestrator-mcp/index.ts:163` (oauth_validate_access_token RPC failed)
   - `supabase/functions/orchestrator-mcp/index.ts:444` (catch-all internal error)
   - `supabase/functions/mcp-auth/index.ts:162` (oauth_clients insert failed)
   - `supabase/functions/_shared/orchestrator-tools.ts:70` (tool_calls insert — non-blocking, lower priority)
   - `supabase/functions/_shared/tools/manual-review-tools.ts:708` (writeAuditLog — non-blocking, lower priority)
   Resolution path: same as IMPORTANT #1 — wrapping the parent fns with `withSentryScope` and importing `Sentry` from `_shared/sentry-edge.ts` lets these console.errors be paired with `Sentry.captureException` calls.

6. **Stale `.env.local.bak-*` backup file at `scheduler-app/.env.local.bak-1779116875`** — covered by gitignore so won't leak via git, but a 3,630-byte secrets file sitting on disk is unnecessary attack surface (Windows file recovery / unintended sync to OneDrive / future repo move). Recommend: delete after confirming `scheduler-app/.env.local` is correct.

### NICE-TO-HAVE

7. **No `beforeSend` in `instrumentation-client.ts`** — client-side relies on Replay's `maskAllText`/`maskAllInputs` for PII coverage. Adding a structural `beforeSend` mirror of the server config would defend custom breadcrumbs (fetch URLs, custom tags) that bypass Replay masking. Server-side errors already pass through the server `beforeSend`; this is a defense-in-depth for browser-side `Sentry.captureException` calls.

8. **No committed `.env.template`** — fresh-clone developers must read code to discover required env vars. Add a `.env.template` with placeholder values only (no live secrets) and add `!.env.template` to root `.gitignore` as an exception. Should list: SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEYS, SUPABASE_PUBLISHABLE_KEYS (or legacy SERVICE_ROLE_KEY / ANON_KEY), ORCHESTRATOR_URL, RESEND_API_KEY, SCHEDULER_STAFF_EMAIL_TO/FROM, AI_GATEWAY_API_KEY, DIAGNOSE_CONCERN_MODEL family, TEKMETRIC_WEBHOOK_TOKEN, TELNYX_*, KEYTAG_REPORT_*, EDGE_FN_SENTRY_DSN.

9. **No `.semgrep.yml` at the project root** — observability.md rule 15 references a custom Semgrep rule for "Supabase `.from(...).select()` where return is destructured without `error`". This rule isn't materialized in any tracked file. If Semgrep is intended as a CI safety net (per rule 15 list), the rule file is missing.

10. **`tekmetric-bootstrap` is unwrapped despite touching the Vault** — `supabase/functions/tekmetric-bootstrap/index.ts:54` writes the long-lived Tekmetric access token to Vault. A failure here is operationally serious (Tekmetric API access broken for the entire shop). Move into the priority list for `withSentryScope` wrapping despite being a manually-invoked one-shot — the manual-invocation pattern doesn't change the severity of a silent failure.

11. **`scheduler-app/.env.local.bak-1779116875` lingering on disk** (also listed at IMPORTANT #6 from a security angle; same suggested action).
