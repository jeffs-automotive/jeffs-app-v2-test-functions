# tekbridge — as-built

> **What this is.** The as-built record of **tekbridge** — the shared, server-side bridge that performs
> Tekmetric operations the PUBLIC API can't, by replaying Tekmetric's **INTERNAL** web API
> (`https://shop.tekmetric.com/api/...`) with a bot-session JWT in the `x-auth-token` header. Pure
> server-side `fetch` — **not** a runtime browser, no Fly.io, no headless farm.
>
> This document supersedes/complements the plan ([`tekbridge-plan.md`](./tekbridge-plan.md)) with what
> actually shipped. Where the two differ, this doc is authoritative. Endpoint recon that grounds the code:
> [`headless-automation-research.md`](./headless-automation-research.md) §1b.
>
> **Source of truth:** everything below is cited to files in `supabase/functions/_shared/tekbridge/`,
> `supabase/functions/tekbridge/`, `supabase/functions/tekbridge-refresh/`, and
> `supabase/migrations/20260722010000_tekbridge.sql` + `20260722011000_tekbridge_refresh_cron.sql`.
>
> **Status:** shipped + deployed to the sandbox project `itzdasxobllfiuolmbxu` (per
> `.claude/memory/tekmetric-bridge-platform.md`). The `/feature-verify` gate has **not** yet been run
> (see [Open items](#open-items)).

---

## 1. Overview

The public Tekmetric API (`/api/v1`, OAuth client-credentials bearer, handled by
`_shared/tekmetric-client.ts`) is read-mostly: it can't write RO customer concerns and can't edit
labor-line contents. tekbridge closes those gaps by calling Tekmetric's **internal** REST/JSON API — the
same one the Tekmetric web app uses — authenticated by a single header, `x-auth-token: <session JWT>`.

Design shape (all confirmed in the shipped code):

- **One gateway edge function** (`tekbridge`) that authenticates trusted internal callers, dispatches
  `{capability, input}`, wraps every request in a per-request Sentry scope, and audits each invocation.
- **A capability registry** (`getTekbridgeTools()`) of AI-SDK `tool()` definitions — the identical shape
  used by `getSchedulerTools()` / `getOrchestratorTools()`. Adding an ability = add one capability file +
  one registry entry. Nothing in the gateway or the protocol changes.
- **A self-sustaining session**: a second edge function (`tekbridge-refresh`), driven by a 6-hourly
  pg_cron job, mints a fresh ~16h JWT from the current one — so after **one** human bootstrap login the
  chain stays alive server-side, with no browser and no reCAPTCHA. On a broken chain it emails the
  operator (de-duped).
- **Every write is verified** by reading the record back through the PUBLIC API — independent of the bot
  session that performed the write.
- The same registry is merged into `buildMcpToolRegistry`, so the chat **`orchestrator`** edge function
  (and any module using that registry) gets these capabilities for free.

Shipped capabilities: `write_customer_concern`, `delete_customer_concern`, `edit_labor_lines`.

---

## 2. Architecture

```
Consumers → admin-app · scheduler-app · qteklink-app · chat orchestrator
      │  (a) direct:  POST edge fn `tekbridge`  { capability, input }   [SERVICE_ROLE + X-Actor-Email]
      │  (b) via chat: getTekbridgeTools() merged into buildMcpToolRegistry → orchestrator edge fn
      ▼
  supabase/functions/tekbridge/index.ts   ── gateway: authn, dispatch, withSentryScope, audit
      │
  supabase/functions/_shared/tekbridge/
    constants.ts   → internal base url, Vault secret name, timeout, expiry skew
    session.ts     → JWT decode/expiry · Vault get/set · tekbridge_session_state health · mark-stale
    client.ts      → tekbridgeFetch(): x-auth-token + timeout + typed errors (INTERNAL api); 401 → stale
    verify.ts      → read-back via the PUBLIC api (tekmetric-client.ts) to confirm the write landed
    auth.ts        → SERVICE_ROLE bearer + X-Actor-Email (mirrors the orchestrator contract)
    registry.ts    → getTekbridgeTools(): map of tool() defs   ← add a capability = add a file here
    capabilities/write-customer-concern.ts   (create + delete concern)
    capabilities/edit-labor-lines.ts         (fetch estimate → edit labor → repost job)
    refresh.ts     → refreshBotJwt(): GET /api/token/shop/{id} with the live token → fresh 16h token
    alert.ts       → operator email on a broken session, de-duped via last_alert_at
      │
      ▼
  supabase/functions/tekbridge-refresh/index.ts  ── cron-invoked; refresh chain + alert on break
```

### 2.1 Session layer — `_shared/tekbridge/session.ts`

Owns the bot's Tekmetric web-session JWT.

- **JWT decode without signature verification.** `decodeJwtClaims()` base64url-decodes the payload
  segment only (we don't hold Tekmetric's signing key). Claims are never trusted for authz — only `exp`
  (expiry) and non-secret metadata (`shopId`, `employeeId`) for state + audit. `jwtExpiresAt()` returns
  `exp`; `isJwtExpired(jwt, nowSeconds, skew)` treats a token as expired when `now >= exp - skew` (skew =
  `TEKBRIDGE_JWT_EXPIRY_SKEW_SECONDS`, 60s) and treats a token with no usable `exp` as expired.
- **Vault-backed read/write.** `getBotJwt(sb)` reads the JWT from Vault via the existing generic
  `tekmetric_get_secret` RPC (module-scope cached, like `tekmetric-client.ts`); throws
  `TekbridgeSessionError("no_session")` if Vault has none. `setBotJwt(sb, jwt, shopId)` validates the
  value decodes to a JWT with a numeric `exp`, persists it via `tekmetric_set_secret`, clears the cache,
  and upserts an `active` health row. `clearBotJwtCache()` drops the cache (called on resubmit + on 401).
- **Session-health row** (`tekbridge_session_state`, one row per shop). `upsertSessionState()`,
  `markSessionStale()`, and `getSessionHealth()` maintain/read `status ∈ {active, stale, expired}`,
  `expires_at`, `last_refreshed_at`, `last_error`. `markSessionStale()` clears the JWT cache and
  deliberately **swallows-with-log** a failed state write (a health-write failure must not mask the
  original 401). Observability rule 9 is honored everywhere else — every Supabase call checks `error`.
- **Typed failures.** `TekbridgeSessionError` carries a `.code` of `no_session | expired | invalid_jwt`,
  which the gateway maps to a clear, actionable response rather than a generic 500.

> **As-built vs plan:** the plan (§5) left the Vault-RPC choice open ("reuse generic `tekmetric_*_secret`
> or add `tekbridge_*_secret`"). As-built **reuses the generic RPCs** — no tekbridge-specific Vault
> wrappers were added. The Vault secret name is `tekbridge_session_jwt` (`constants.ts`
> `TEKBRIDGE_SESSION_JWT_SECRET`).

### 2.2 Internal-API client — `_shared/tekbridge/client.ts`

`tekbridgeFetch(sb, path, opts)` is the authenticated fetch against the internal API. It:

1. reads the JWT (`getBotJwt`), pre-checks expiry (`isJwtExpired`) so an obviously-dead token never
   leaves the building — on local expiry it marks the session stale and throws
   `TekbridgeSessionError("expired")`;
2. builds the URL from `TEKBRIDGE_INTERNAL_API_BASE` + `path`, attaches `x-auth-token: <jwt>` +
   `accept: application/json` (+ `content-type: application/json` when there's a body), and enforces a
   timeout via `AbortSignal.timeout(opts.timeoutMs ?? TEKBRIDGE_DEFAULT_TIMEOUT_MS)` (15s);
3. on a **401** from Tekmetric, marks the session stale and throws `TekbridgeSessionError("expired")` —
   **it does NOT retry.** This is the deliberate difference from the public client: the public OAuth
   token auto-refreshes on 401, but the bridge JWT is minted by a human/refresh-chain and cannot be
   re-minted inside a request, so hammering Tekmetric would be pointless.

`tekbridgeJson<T>()` wraps it: throws `TekbridgeApiError(status, path, bodySnippet)` (body truncated to
300 chars, matching the public client) on non-2xx; returns `null` for an empty body (e.g. some DELETEs).

`TekbridgeFetchOptions` carries `method`, `body`, `timeoutMs`, a required `shopId` (used to key the
health row on 401/expiry), and an injectable `nowSeconds` (deterministic tests).

### 2.3 Verify-via-public-API — `_shared/tekbridge/verify.ts`

`verifyConcernOnRo(sb, repairOrderId, concernText)` reads the repair order through the **public** API
(`tekmetricGetJson('/repair-orders/{id}')`) and returns true if any `customerConcerns[].concern` matches
`concernText` (trimmed compare). Because the public RO response returns `customerConcerns` inline, one
GET verifies a concern write with no bridge-side read — and it's independent of the bridge session that
did the write, which is what makes an unattended mutator trustworthy.

### 2.4 Gateway auth — `_shared/tekbridge/auth.ts`

The gateway uses the same trusted-internal-caller contract admin-app already uses against the
orchestrator (mirrored from `orchestrator/index.ts`; kept tekbridge-scoped rather than refactoring that
critical OAuth path mid-feature). All must hold:

1. `Authorization: Bearer <token>` where `<token>` matches a project SERVICE_ROLE / SECRET key —
   **constant-time compare** (`timingSafeStringEqual`). `getAllowedServiceRoleBearers()` accepts every
   form of the 2026 multi-key surface: the `SUPABASE_SECRET_KEYS` dict/array, `SUPABASE_SECRET_KEY`, and
   legacy `SUPABASE_SERVICE_ROLE_KEY`.
2. `X-Actor-Email` header present.
3. Email domain matches `@jeffsautomotive.com` (`isAllowedAdminEmail` — length-bounded, header-injection
   safe: rejects `\r \n \t \0`).

`authenticateServiceRole(req)` returns `{ ok: true, actorEmail }` (lowercased audit identity) or a typed
failure reason. `hasValidServiceRoleBearer(req)` is the bearer-only variant (**no** actor required) used
by the system/cron endpoint `tekbridge-refresh`, which is invoked by `scheduler_invoke_edge_function`
sending only the service-role bearer.

### 2.5 Constants — `_shared/tekbridge/constants.ts`

| Constant | Value | Note |
|---|---|---|
| `TEKBRIDGE_INTERNAL_BASE_URL` | `https://shop.tekmetric.com` | **Production** (Jeff's shop 7476 — prod-only per Chris 2026-07-21). Flip to `https://sandbox.tekmetric.com` for sandbox. |
| `TEKBRIDGE_INTERNAL_API_BASE` | `${TEKBRIDGE_INTERNAL_BASE_URL}/api` | Base for internal resource paths. |
| `TEKBRIDGE_SESSION_JWT_SECRET` | `tekbridge_session_jwt` | Vault secret name (generic `tekmetric_*_secret` RPCs). |
| `TEKBRIDGE_DEFAULT_TIMEOUT_MS` | `15_000` | Mirrors the public client's deadline. |
| `TEKBRIDGE_JWT_EXPIRY_SKEW_SECONDS` | `60` | Treat a token as expired slightly before its real `exp`. |

> **As-built vs plan:** the plan wrote `TEKBRIDGE_INTERNAL_BASE = "https://shop.tekmetric.com/api"` (one
> constant). As-built splits it into a base URL + an API base (two constants). Same effective endpoint.

---

## 3. Capabilities

Each capability is a small, independently-testable unit (`.test.ts` alongside each file). It appears in
the app as a registry entry (`registry.ts`) whose `execute` calls the capability function. `shop_id` is
**always resolved server-side** (env `TEKMETRIC_SHOP_ID`, default 7476) — never from the client body.

### 3.1 `write_customer_concern` — `capabilities/write-customer-concern.ts`

Create a customer concern on a repair order — the public API has no concern field.

- **Internal endpoint:** `POST /api/repair-orders/{roId}/customer-concerns` with body
  `{ concern, techComment }`. Response `{ type: "SUCCESS", data: { id, concern, techComment,
  repairOrderId } }`. (`techComment` is the "Finding" field in Tekmetric's UI.)
- **Flow:** POST → require a numeric `data.id` (throws on an unexpected response) → unless
  `verify === false`, read back via `verifyConcernOnRo` (public API). A verification read that **itself
  errors does not fail the call** — the write already succeeded; the result carries `verified: false` +
  `verifyError` so the caller decides.
- **Result:** `{ ok: true, concernId, repairOrderId, verified, verifyError? }`.

### 3.2 `delete_customer_concern` — `capabilities/write-customer-concern.ts`

Delete a concern by id.

- **Internal endpoint:** `DELETE /api/customer-concerns/{concernId}` — note it is **not** nested under
  `repair-orders`.
- **Result:** `{ ok: true, concernId }`.

### 3.3 `edit_labor_lines` — `capabilities/edit-labor-lines.ts`

Edit existing labor lines on a repair-order job — the public API's Update Labor only sets `technicianId`.
Proven live 2026-07-21 (part + fee preserved; multi-line state-inspection summaries land verbatim).

- **Internal endpoints (three-step):**
  1. `GET /api/repair-order/{roId}/estimate` → the job with its full `labor[]` (jobs live on the
     estimate, not the RO object);
  2. modify the target labor line(s) in that object;
  3. `POST /api/shop/{shopId}/job` → repost the **whole** job (upsert).
- **Why repost the whole job:** reposting the full object preserves everything else — other labor, parts,
  fees, discounts, authorization — automatically, with no fragile field-stripping.
- **Per-edit operations** (`LaborEdit`): `name` (replace text entirely), `appendName` (append after
  `name` if both given), `rateCents` (set rate — internal API rate is **in cents**), `hours` (set hours).
  Multi-line text (`\n`) is preserved verbatim.
- **Safety:** validates the job exists and **all** targeted labor ids exist *before* writing — a bad id
  throws rather than silently no-op'ing or corrupting the job (no partial write).
- **Result:** `{ ok: true, jobId, edited: [{ laborId, name, rate, total }] }`, read from the POST
  response (the saved state).
- **Primary consumer:** the state-inspection app — post a multi-line summary onto a labor line, append a
  sticker number, or mark an emissions line exempt and zero its total.

> **As-built vs plan:** the plan scheduled `edit_labor_lines` (and the `buildMcpToolRegistry` merge) for
> **Phase 2**; both shipped in the initial build. The plan's proposed `idempotency.ts` module + job-queue
> worker did **not** ship — the `tekbridge_jobs` table exists as forward-plumbing but is unused
> (see [Open items](#open-items)). No concern-**update** capability shipped (plan Q3 — see below).

---

## 4. Self-sustaining session — refresh + alerting

### 4.1 Refresh — `_shared/tekbridge/refresh.ts` + `tekbridge-refresh/index.ts`

Tekmetric's internal API exposes `GET /api/token/shop/{shopId}` which, given a **still-valid**
`x-auth-token`, returns a **fresh ~16h token** — no password, no reCAPTCHA, no browser (confirmed live
2026-07-21, both in-browser and via pg_net from the Supabase datacenter). So the bot needs a human login
exactly **once** to bootstrap the first token; the cron keeps the chain alive indefinitely, fully
server-side.

`refreshBotJwt(sb, shopId)`:

1. reads the current token (`getBotJwt` → fail fast with typed `no_session`/`expired` if missing/dead)
   and records its `exp`;
2. calls `GET /api/token/shop/{shopId}` **with** the current token (via `tekbridgeJson`);
3. requires a well-formed 3-segment JWT in the response `token` field (throws otherwise);
4. persists it via `setBotJwt` (which validates + updates the `active` health row);
5. returns `{ expiresAt, previousExpiresAt }`.

Lives in its own module (not `session.ts`) to keep the import graph acyclic: `client.ts` imports
`session.ts`; `refresh.ts` imports both.

The **`tekbridge-refresh`** edge function is the cron entrypoint. It requires only the SERVICE_ROLE
bearer (`hasValidServiceRoleBearer` — cron sends no actor). On success it calls `clearBotAlert` (resets
the alert de-dup so a future break notifies at once) and returns `{ ok, expires_at, previous_expires_at }`.
On failure it marks the session stale, emails the operator (de-duped), captures to Sentry with tags
`{ fn, code, emailed }`, and returns 502. `reasonFor(code)` produces the human-readable cause
(`no_session` / `expired` / generic).

### 4.2 Cron — migration `20260722011000_tekbridge_refresh_cron.sql`

- Job `tekbridge-refresh`, schedule `0 */6 * * *` (00:00, 06:00, 12:00, 18:00 UTC) — **4 runs inside the
  ~16h token life**, so a single failed run still leaves ~10h of runway before the chain breaks.
- Body is wrapped `BEGIN … EXCEPTION WHEN OTHERS` → `scheduler_error_log` (observability rule 8), so a
  Vault/pg_net dispatch failure is recorded, not silent. It invokes
  `public.scheduler_invoke_edge_function('tekbridge-refresh', '{}'::jsonb)`.
- Idempotent: unschedules any prior job first, then a `DO` block asserts exactly one row registered.
- Manual invoke: `SELECT public.scheduler_invoke_edge_function('tekbridge-refresh', '{}'::jsonb);`

### 4.3 Operator alert — `_shared/tekbridge/alert.ts`

`sendBotSessionAlert(sb, shopId, { reason, detail })`:

- **De-duped** to at most once per **`ALERT_DEDUP_HOURS` = 12** via
  `tekbridge_session_state.last_alert_at` — a persistently-broken session doesn't email every cron run.
- Sends via the shared Resend transport (`sendResendEmail`), **from** `alerts@jeffsautomotive.com`, **to**
  `TEKBRIDGE_ALERT_EMAIL` (default `chris@jeffsautomotive.com`). Subject: "⚠️ Tekbridge bot session needs
  attention". The HTML tells the operator to log the bot into Tekmetric, open any RO (so the session
  becomes shop-scoped), and resubmit the token.
- **Never throws** — a failed alert must not mask the underlying error (logged + reported via the
  caller's Sentry scope). Returns `{ emailed, reason? }`. On a successful send it stamps `last_alert_at`.
- `clearBotAlert(sb, shopId)` nulls `last_alert_at` after a successful refresh so the next failure
  notifies immediately.

---

## 5. Gateway — `supabase/functions/tekbridge/index.ts`

`FUNCTION_NAME = "tekbridge"`, `SERVER_VERSION = "0.1.0"`. Single service-role Supabase client
(`persistSession: false`, `autoRefreshToken: false`). `SHOP_ID` from env `TEKMETRIC_SHOP_ID` (default
7476). Every request is wrapped in `withSentryScope(req, FUNCTION_NAME, …)` for per-request isolation
(the Deno SDK does not isolate across concurrent requests — observability rule 7).

**Routes** (`stripFunctionPrefix` normalizes the path):

| Method + path | Auth | Behavior |
|---|---|---|
| `GET /` (or `""`) | none (public) | Health: `{ ok, server, version }` — lets a caller verify reachability. |
| `POST /` | SERVICE_ROLE + actor | `handleCapability` — dispatch `{ capability, input }`. |
| `GET /session` | SERVICE_ROLE + actor | `handleSessionHealth` — current `tekbridge_session_state` row. |
| `POST /session` | SERVICE_ROLE + actor | `handleSessionSubmit` — store a bootstrap JWT in Vault. |
| `OPTIONS` | — | 204 + CORS. |

Everything except `GET /` requires `authenticateServiceRole`; a failure returns 401
`unauthorized: <reason>`.

**`handleCapability`:** parses JSON (400 on bad body); requires a non-empty `capability` string; builds
the registry with the **server-resolved** shop id (`getTekbridgeTools({ sb, shopId: SHOP_ID })`); looks
up the capability (400 `unknown_capability` if absent); validates `input` against the capability's Zod
schema (400 `invalid_input` with a flattened issue list on `ZodError`); executes; audits; returns
`{ ok: true, data }`. Error handling:

- `TekbridgeSessionError` → `Sentry.captureMessage(..., "warning")`, audit `outcome: "error"` with the
  code, respond **409** `{ ok: false, code, error, needs_session_refresh: true }`.
- any other throw → `Sentry.captureException`, audit the truncated message, respond **502**.

**`handleSessionSubmit`:** stores a human-bootstrapped JWT via `setBotJwt` (returns 400 with the typed
code on `invalid_jwt`); **never logs the JWT** — only a `Sentry.captureMessage("tekbridge session JWT
submitted", "info")`. Returns `{ ok, expires_at }`.

**Audit** (`recordAudit` → `tekbridge_audit_log`): one row per invocation with `shop_id`, `capability`,
`input_summary` (via `summarizeInput` — string values > 60 chars are replaced with `{ __len }` so full
customer-complaint text isn't duplicated across tables), `actor`, `outcome`, `verified` (extracted from
the result), `tekmetric_ref` (extracts numeric `concernId`/`repairOrderId`/`jobId`/`laborId` from the
result), and `error`. An audit-write failure is logged only — it must not mask the capability result.

---

## 6. Registry exposure to modules — `_shared/mcp-tool-registry.ts`

`getTekbridgeTools({ sb, shopId })` returns a map of AI-SDK `tool()` defs
(`description` / `inputSchema` / `execute`) — the same runtime shape as the other two tool builders. This
is consumed two ways:

1. **Direct** — the `tekbridge` gateway dispatches `{ capability, input }` against this map at runtime.
2. **Chat** — `buildMcpToolRegistry` merges it (block **(c)**, `mcp-tool-registry.ts:143-147`) alongside
   `getOrchestratorTools()` (keytag + manual-review) and `getSchedulerTools()` (wizard reads + admin
   writes). The merge loop enforces Anthropic's tool-name regex `^[a-zA-Z0-9_-]{1,64}$` and **throws on
   any duplicate name** across the three builders. There is currently no collision.

`buildMcpToolRegistry` is consumed by the **`orchestrator`** edge function
(`orchestrator/index.ts:381`), so the chat orchestrator and every module using that registry get
`write_customer_concern` / `delete_customer_concern` / `edit_labor_lines` for free.

> **Naming note (2026-07-23):** the orchestrator edge function was **renamed from `orchestrator-mcp` to
> `orchestrator`**. `tekbridge/auth.ts` and older comments still say "orchestrator-mcp"; they describe the
> same function under its old name.

The three registry `tool()` descriptions are written for the LLM: `write_customer_concern` (record what
the customer is reporting into the RO's Customer Concerns list; `tech_comment` = optional Finding),
`delete_customer_concern` (remove/supersede a concern by id), and `edit_labor_lines` (target a labor line
by `labor_id`; replace/append text, set `rate_cents` or `hours`; reposts the whole job; primary use =
state-inspection summaries/sticker numbers/emissions-exempt). Snake_case input keys
(`repair_order_id` etc.) are mapped to the capability functions' camelCase args in each `execute`.

---

## 7. The bot account

- **Seat:** `tekbridge@jeffsautomotive.com`, **Service-Advisor** role, **2FA off**, **production-only**
  (shop 7476). Least-privilege — deliberately **not** Owner (the recon token was Owner, too broad).
- tekbridge holds **only the session JWT** (in Vault under `tekbridge_session_jwt`). It never handles the
  bot password — a human logs the seat in once to bootstrap the first token, and the refresh chain
  sustains it from there.
- **Bootstrap:** log the bot into `shop.tekmetric.com`, open any repair order so the session becomes
  shop-scoped, read `localStorage.jwt`, and `POST /session { jwt }` to the gateway.

---

## 8. Database schema

Migrations `20260722010000_tekbridge.sql` (three tables) + `20260722011000_tekbridge_refresh_cron.sql`
(the `last_alert_at` column + the cron). Conventions: `shop_id` is the Tekmetric numeric shop id
(**BIGINT**, matching `tekmetric_ro_mirror`); **TEXT** strings; **TIMESTAMPTZ** timestamps. All three
tables are **deny-all RLS** — RLS enabled, **zero policies**, plus `REVOKE ALL … FROM anon,
authenticated` (belt-and-suspenders). The `tekbridge` edge function writes via the service-role key,
which bypasses RLS; anon/authenticated are blocked outright (same pattern as `tekmetric_ro_mirror`).

**`tekbridge_session_state`** — session health, one row per shop.
`shop_id BIGINT PRIMARY KEY`, `status TEXT NOT NULL DEFAULT 'stale' CHECK (active|stale|expired)`,
`expires_at TIMESTAMPTZ`, `last_refreshed_at TIMESTAMPTZ`, `last_error TEXT`, `updated_at TIMESTAMPTZ`,
`last_alert_at TIMESTAMPTZ` (added by the refresh migration; alert de-dup). The JWT itself is **not**
here — it's in Vault.

**`tekbridge_jobs`** — durable async queue for unattended/verified writes.
`id UUID PK`, `shop_id BIGINT`, `capability TEXT`, `input JSONB`, `idempotency_key TEXT NOT NULL UNIQUE`,
`status TEXT DEFAULT 'queued' CHECK (queued|running|done|failed)`, `attempts INT`, `before_snapshot
JSONB`, `after_snapshot JSONB`, `result JSONB`, `error TEXT`, `actor TEXT`, timestamps. Index
`(status, created_at)` for a worker poll. **Created as forward-plumbing — no worker consumes it yet.**

**`tekbridge_audit_log`** — one row per capability invocation.
`id UUID PK`, `shop_id BIGINT`, `capability TEXT`, `input_summary JSONB`, `actor TEXT`, `outcome TEXT
CHECK (ok|error)`, `verified BOOLEAN`, `tekmetric_ref JSONB`, `error TEXT`, `created_at TIMESTAMPTZ`.
Index `(shop_id, created_at DESC)`.

**Tests:** pgTAP `supabase/tests/database/tekbridge.test.sql` (21 assertions — tables, convention column
types, `shop_id` PK, `last_alert_at`, RLS-enabled + zero-policies). Deno unit tests alongside each module
(`session.test.ts`, `client.test.ts`, `auth.test.ts`, `write-customer-concern.test.ts`,
`edit-labor-lines.test.ts`, `refresh.test.ts`, `alert.test.ts`, `registry.test.ts`).

---

## 9. Open items

Verified against the shipped code and `.claude/memory/tekmetric-bridge-platform.md`:

- **Concern in-place UPDATE is role-gated.** Only create + delete shipped. The internal
  `PUT /api/customer-concerns/{id}` (plan Q3) is **not** implemented: the Service-Advisor bot gets **403**
  on the PUT. Options: escalate the bot's role, or delete + create-replace. Until resolved, "editing" a
  concern = delete the old one + `write_customer_concern` a new one.
- **Appointment → concern trigger not wired.** The scheduler appointment-change → enqueue a verified
  concern-sync (plan Phase 2) is not built; it needs a mapping rule (which appointment fields become the
  concern text). `tekbridge_jobs` exists but has **no worker** — the durable/idempotent queue path
  (plan's `idempotency.ts` + worker) did not ship.
- **Reader capabilities not built.** qteklink shop-discounts and clock-hours readers
  (`…/shop-discounts`, `…/employee/{id}/time-card-active`, etc.) are mapped in recon but not implemented —
  they need a data spec.
- **`/feature-verify` gate not yet run.** The fail-closed `/code-review` gate + Claude reviewer sweep
  (security/pattern/regression/supabase-/sentry-compliance) from the plan's §7 has not been executed for
  this feature.
- **Session-state comment residue.** `tekbridge/auth.ts` still references "orchestrator-mcp"; the function
  is now `orchestrator`. Cosmetic only.

---

## Appendix — internal endpoints used (as shipped)

| Capability / action | Method + path (base `https://shop.tekmetric.com/api`) | Auth |
|---|---|---|
| Create concern | `POST /repair-orders/{roId}/customer-concerns` `{concern, techComment}` | `x-auth-token` |
| Delete concern | `DELETE /customer-concerns/{concernId}` | `x-auth-token` |
| Edit labor (read) | `GET /repair-order/{roId}/estimate` | `x-auth-token` |
| Edit labor (write) | `POST /shop/{shopId}/job` (full Job, `rate` in cents) | `x-auth-token` |
| Verify a write | `GET /repair-orders/{id}` via the **PUBLIC** API (`/api/v1`, OAuth bearer) | OAuth |
| Refresh session | `GET /token/shop/{shopId}` with the current token → fresh ~16h token | `x-auth-token` |
