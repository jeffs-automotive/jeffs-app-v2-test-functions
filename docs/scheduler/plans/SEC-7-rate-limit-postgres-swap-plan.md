# SEC-7 — Rate-limit swap: Upstash → Vercel Firewall (per-IP) + Supabase Postgres RPC (per-phone)

> Feature: `sec7-rate-limit-swap` · Phase: plan (awaiting Chris approval) · 2026-06-02
> Source of truth: `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` SEC-7 (rate-limit half, item 3).
> Parent: `docs/scheduler/plans/PLAN-03-security-hardening.md` Phase 1B.

---

## Why

The OTP-sending wizard actions are protected against SMS-pumping by a two-layer rate limit
(`5/IP/min` + `3/phone-hash/hour`) currently backed by **Upstash** (`@upstash/ratelimit` +
`@upstash/redis`). Upstash was never provisioned, so the limiter **fails open** and emits a
recurring Sentry warning (`rate_limit_init` / `misconfiguration=upstash_missing`, seen in prod
issue `JEFFS-APP-V2-TEST-FUNCTIONS-Q`). Per the 2026-05-23 design pivot, we replace Upstash with
infra we already own:

- **Per-IP → Vercel Firewall** custom rate-limit rule (edge layer; rejects IP-spray *before* it
  reaches our compute; free on Pro).
- **Per-phone-hash → Supabase Postgres RPC** (`check_and_increment_rate_limit`) + a
  `rate_limit_buckets` table + nightly pruner cron. The phone is encrypted in the POST body so the
  edge can't see it — per-phone shaping must stay app-layer, but needs **no new vendor**.
- **Drop** `@upstash/ratelimit` + `@upstash/redis` (~50 KB).

Net: one fewer external vendor, edge-level IP protection, the recurring Sentry warning stops.

## Locked decisions (from the SEC-7 spec) + one decision for Chris

| # | Decision | Source / status |
|---|---|---|
| D1 | Per-phone limit lives in **Postgres RPC** (not a new vendor) | SEC-7 spec — **locked** |
| D2 | Per-IP limit moves to **Vercel Firewall** (app drops its per-IP gate) | SEC-7 spec — **locked** |
| D3 | Keep the same per-phone budget: **3 sends / phone-hash / hour** | matches current Upstash config |
| D4 | Phone is SHA-256-hashed (16-hex) before use as the key (PII minimization) | preserve current `hashPhone()` |
| D5 | **Fail-OPEN** on RPC/DB error by default (DB-level `otp_codes` 3/hr remains the backstop); `SCHEDULER_REQUIRE_RATE_LIMIT=true` flips to fail-CLOSED | preserve current strict-mode semantics |
| **D6** | **Per-phone backend: Postgres RPC (recommended) vs `@vercel/firewall` `checkRateLimit({rateLimitKey})`** | **NEEDS CHRIS** — see below |

### D6 — the one open design choice
Research surfaced a Vercel-native alternative the original spec predates: `@vercel/firewall`'s
programmatic `checkRateLimit('otp-phone', { request, rateLimitKey: phoneHash })` — a dashboard-defined
WAF rate limit invoked in the Server Action with a custom key. It's *less code* (no table/RPC/cron).
**Recommendation: stick with the spec's Postgres RPC** because it is (a) unit- + pgTAP-testable with
no Vercel mocking, (b) self-contained + queryable in our own DB, (c) free of any per-OTP dependency on
Vercel WAF availability/plan, and (d) what the approved pivot specified. I'll proceed with Postgres
unless you prefer the Vercel-native path.

---

## What SEC-7 needs (4 items) and who does each

1. **Vercel Firewall per-IP rule** — *Chris (or me via CLI, with your OK)*. Not app code. See "Item 1" below.
2. **BotID dashboard toggle** — **already resolved 2026-05-25** (per SEC-7 entry). No action.
3. **Upstash → Postgres code swap** — **this plan's code work** (migration + app refactor + tests + dep drop).
4. **Sentry alert hygiene** — *verification step*: confirm `upstash_missing` warning stops after ship.

---

## File-by-file change list (item 3 — the code work)

### NEW — `supabase/migrations/20260602xxxxxx_scheduler_rate_limit_buckets.sql`
Wrapped in `BEGIN; … COMMIT;`, idempotent (`create or replace`, `cron_unschedule_if_exists`). Contains:

- **Table** `public.rate_limit_buckets` — append-heavy ephemeral counter, **no `shop_id`** (this is
  global platform abuse-prevention infra, not shop-scoped data — like `webhook_events`):
  ```sql
  create table public.rate_limit_buckets (
    id          bigint generated always as identity primary key,  -- BIGINT id (matches keytag attempts tables; high-churn, pruned)
    key         text        not null,                             -- e.g. 'otp_phone:<sha256-16>'
    occurred_at timestamptz not null default now()
  );
  create index rate_limit_buckets_key_time_idx on public.rate_limit_buckets (key, occurred_at desc);
  alter table public.rate_limit_buckets enable row level security;  -- no policies → service_role-only (bypasses RLS)
  ```
  > Deviation from the spec's `(key, occurred_at, window_id)`: `window_id` is dropped — it's a
  > fixed-window artifact; we use a **sliding-window log** (more accurate), which only needs timestamps.

- **RPC** `public.check_and_increment_rate_limit(p_key text, p_window_seconds int, p_max int)
  returns table(allowed boolean, retry_after_seconds int)` — `LANGUAGE plpgsql SECURITY DEFINER SET
  search_path = ''`, fully-qualified `public.` refs. Algorithm (sliding-window log, atomic per-key):
  ```
  perform pg_advisory_xact_lock(hashtext(p_key));         -- serialize concurrent calls for this key
  count rows where key=p_key AND occurred_at > now() - p_window_seconds  (also capture min occurred_at)
  if count >= p_max → allowed=false, retry_after = ceil((oldest + window) - now())   -- no insert
  else → insert one row(key), allowed=true, retry_after=0
  ```
  `pg_advisory_xact_lock` gives atomic count-then-insert without SERIALIZABLE (the proven pattern;
  cf. WebSearch — atomicity is the one must-have for a correct limiter). Lockdown:
  `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`

- **Pruner** `public.run_rate_limit_buckets_prune()` (`SECURITY DEFINER SET search_path=''`) — deletes
  rows older than 24h, `EXCEPTION WHEN OTHERS → INSERT scheduler_error_log + RAISE` (observability rule 8).
  Scheduled via `cron.schedule('rate-limit-buckets-prune', '15 4 * * *', 'select public.run_rate_limit_buckets_prune();')`
  after `cron_unschedule_if_exists`. Grants: `service_role`, `postgres`.

### EDIT — `scheduler-app/src/lib/security/rate-limit.ts`  *(gated)*
- Remove `@upstash/ratelimit` + `@upstash/redis` imports, the lazy `getRateLimiters()` Upstash init,
  the `disabled`/`upstash_missing` state, and the one-time `captureMessage`.
- Remove **`checkIpRateLimit`** entirely (per-IP → Vercel Firewall).
- Keep `hashPhone()` unchanged. Keep `isRateLimitStrictMode()`.
- Rewrite **`checkPhoneRateLimit(phoneE164)`** to call the RPC via `createSupabaseAdminClient()`
  (`@/lib/supabase/admin`, the service-role client already used by the callers):
  `key = 'otp_phone:' + hashPhone(phoneE164)`, `p_window_seconds=3600`, `p_max=3`.
  - RPC `error` → `Sentry.captureException` (surface `check_phone_rate_limit`), then fail-OPEN
    (`{allowed:true}`) — or fail-CLOSED (`{allowed:false, reason:'rate_limit_unavailable'}`) in strict mode.
  - `allowed=false` → `{allowed:false, reason:'rate_limited_phone'}`.
- `RateLimitOutcome.reason` union: drop `'rate_limited_ip'` (unused now); keep `'rate_limited_phone'` + `'rate_limit_unavailable'`.

### EDIT — the 3 caller actions  *(gated)*
`scheduler-app/src/lib/scheduler/wizard/actions/{submit-phone-name,resend-otp,submit-multi-account-choice}.ts`
- Remove the per-IP block (`const ip = await getRequestIp(); const ipCheck = await checkIpRateLimit(ip); if (!ipCheck.allowed) {…}`)
  and the now-unused `checkIpRateLimit` / `getRequestIp` imports.
- **Keep** the `checkBotForSensitiveAction()` gate and the `checkPhoneRateLimit()` gate unchanged.
- *(Spec said "callers don't change" — inaccurate; they each call `checkIpRateLimit` today, so the IP block must be removed.)*

### EDIT — `scheduler-app/tests/unit/rate-limit.test.ts`  *(not gated — tests/)*
- Drop the Upstash mocks. Mock `@/lib/supabase/admin`'s `createSupabaseAdminClient` → `{ rpc: vi.fn() }`.
- Cover: allowed path (`rpc` → `[{allowed:true, retry_after_seconds:0}]`), denied path (`rate_limited_phone`),
  RPC-error fail-OPEN (+ Sentry) and fail-CLOSED under strict mode, and `hashPhone` is used as the key (not raw phone).
- Remove `checkIpRateLimit` tests.

### NEW — `supabase/tests/database/rate_limit_buckets_test.sql` (pgTAP)  *(not gated)*
Per cross-module-anchors §E (every architectural claim gets a test): assert the RPC allows exactly
`p_max` calls in the window then denies the next, `retry_after_seconds > 0` on denial, and a fresh
key/window resets. (Assert return values, not exceptions.)

### EDIT — `scheduler-app/package.json` (+ regen `package-lock.json`)  *(not gated)*
- Remove `@upstash/ratelimit` + `@upstash/redis`. Regenerate lockfile (`npm install`), verify `npm ci`.

### VERIFY/REMOVE — `scheduler-app/src/lib/security/get-request-ip.ts` (+ its test)  *(gated)*
- After the per-IP removal, `getRequestIp` may be dead. **Implement step:** grep all usages; if only
  the rate-limit callers used it → delete it + `get-request-ip.test.ts`; if used elsewhere → keep.

---

## Item 1 — Vercel Firewall per-IP rule (Chris's step; CLI-scriptable)
The pivot's per-IP budget is **30 requests / 60s per IP**, deny 60s on breach, on `POST /` (+ optionally
`/book`, `/book-v2`). Vercel supports this as a **custom Firewall rule via CLI** (fits our "CLI for
writes" rule), e.g.:
```bash
vercel firewall rules add "SEC-7 OTP per-IP" \
  --condition '{"type":"path","op":"eq","value":"/"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 30 \
  --rate-limit-keys ip --rate-limit-action deny --yes
# inspect: vercel firewall rules list --expand   (rules may stage as a draft until published)
```
*(Vercel WAF rate-limit `algo` is `fixed_window`.)* **Decision for Chris:** do you want me to run this
CLI (on the `scheduler-app` Vercel project), or will you set it in the dashboard? And cover `/book*` too?

---

## Phasing & deploy ordering (ordering matters)
1. **Migration first** — `supabase db push` the new migration so the RPC exists *before* any app code calls it. (CLI per deployment.md; verify with `mcp__supabase__list_migrations` + `get_advisors`.)
2. **Vercel Firewall per-IP rule** — stand up item 1 *before* the app drops its per-IP gate, so per-IP coverage is never zero.
3. **App refactor** — `git push origin main` → Vercel deploys (rate-limit.ts + 3 callers + tests + dep drop).
4. **Verify** — Sentry `upstash_missing` stops; OTP 4th-in-hour blocked.

## Verification
- `npm run typecheck` (scheduler-app) clean.
- `npm run test` (scheduler-app vitest) — rewritten rate-limit tests + the 3 callers' tests green.
- `supabase test db` — the new pgTAP RPC test passes.
- `npm run build` clean (confirms Upstash fully removed; no dangling imports).
- `/code-review` gate (security/pattern/regression) on the changed files.
- Manual smoke: trigger 4 OTP sends for one phone within an hour → 4th returns `rate_limited_phone`;
  confirm prod Sentry `…-Q` (`upstash_missing`) stops firing.

## Open questions for Chris
- **D6** — Postgres RPC (recommended) vs `@vercel/firewall checkRateLimit`?
- **Item 1** — I run the `vercel firewall` CLI, or you do it in the dashboard? Cover `/book` + `/book-v2` too?
- **D5** — keep fail-OPEN on DB error (recommended; OTP-codes table is the backstop), or fail-CLOSED for per-phone now that the backend is our own reliable DB?
- Surface `retry_after_seconds` to the customer ("try again in N min")? *Out of scope for SEC-7; noted as a future UX nicety (callers' error strings unchanged).*
