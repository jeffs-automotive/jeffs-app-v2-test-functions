# QBO API Client — Plan (feature: qbo-api-client)

> Phase: plan · 2026-05-30 · Research: `docs/qbo/qbo-api-client-research.md`
> Predecessor (DONE): `qbo-app-onboarding` (redirect URI, EULA/Privacy, connect pages, webhook).

## Why

We attested to specific runtime behaviors on the Intuit production-app questionnaire — automatic
token refresh, bounded retry on throttling/transient failures, structured error handling,
`intuit_tid` capture, and graceful behavior on a lower QBO subscription tier. This feature makes
those attestations **true in our own code** by building a real, server-side QBO Accounting API
client in the admin-app, backed by autonomously-refreshing stored credentials.

## Locked decisions (from Chris, 2026-05-30)

1. **Placement:** admin-app DAL — `admin-app/src/lib/qbo/`, **Node runtime** (Server Actions, not
   edge). May use the official `intuit-oauth` Node SDK.
2. **Token source:** **server-side storage + autonomous refresh.** A new `qbo_connections` table
   stores the rotating credential; the client refreshes on its own. Migration apply is a **human
   gate** (per `.claude/rules/deployment.md` — CLI `supabase db push`, Chris approves).
3. **Scope:** **read + write now** — query/get + create/update (Invoice, Customer to start) with
   `SyncToken` optimistic locking + `requestid` idempotency on writes.
4. **Dependency:** `intuit-oauth@4.2.3` (current latest, engines `node>=10`) for the OAuth/token
   lifecycle (refresh + rotation). A thin hand-rolled typed fetch layer handles v3 data calls so we
   control retry / idempotency / `intuit_tid` / `Fault` parsing precisely (mirrors
   `_shared/tekmetric-client.ts`). Rationale: `intuit-oauth`'s `makeApiCall` doesn't give us the
   retry/backoff + structured-Fault hooks the attestations require; using the SDK only for tokens
   keeps us on official code for the security-sensitive part while owning the call path.
5. **Environment:** **production** keys — `https://quickbooks.api.intuit.com` against the real
   Jeff's Automotive company. (`config.ts` keeps a sandbox toggle but prod is the build target.)
   Requires the production Client ID/Secret + a token row seeded from the `qbo-oauth-callback`
   handshake before any live call.
6. **Live-write safety:** writes run against the **real books**, but **every first live write is a
   human gate** — the create-invoice path pauses for Chris's explicit go-ahead before mutating live
   accounting data. (Unit/MSW tests need no gate; they never touch QBO.)
7. **Cross-verification approach:** NOT the built-in `/feature-cross-verify` for this plan. Instead,
   verification will use a forthcoming layer of **specialized agents** (built from the
   `.claude/skills/quickbooks/` skill + this feature's research) plus **generalized GPT / Gemini /
   Claude check agents**. Building that agent layer is a separate effort (see decision fork below).
8. **Patterns to mirror (in-repo, NOT prod jeffs-app):**
   - Thin Server Action: `"use server"` + `zod` + `requireAdmin()` FIRST + `wrapAdminAction(name,
     inner, {actorEmail})` (`@/lib/instrument-action`). admin-app uses **no** `next-safe-action`.
   - Fat lib client: typed class + dedicated `QboClientError` (cf. `OrchestratorClientError`),
     fail-closed config validation, timeouts, `@/lib/supabase/*` server client for token reads.
   - Tests: port scheduler-app's Vitest 4 + `@vitest/coverage-v8` + MSW config into admin-app
     (admin-app currently has no test runner).

## Architecture

```
admin-app/src/actions/qbo/*.ts        thin "use server" actions (requireAdmin + wrapAdminAction + zod)
        │  delegates to
admin-app/src/lib/qbo/
  ├── client.ts        QboClient: getAccessToken() (refresh-on-expiry), request() (retry+idempotency+tid), query()
  ├── tokens.ts        load/persist connection; single-flight refresh via Postgres RPC (FOR UPDATE)
  ├── errors.ts        QboClientError + Fault parsing (type/code → category)
  ├── entities.ts      Zod schemas + types for Invoice, Customer (+ Fault envelope)
  └── config.ts        base URL (env), minorversion pin, timeouts, retry caps
        │  reads/writes tokens via
supabase/migrations/<ts>_qbo_connections.sql   qbo_connections table + get/set RPCs (HUMAN-GATED apply)
```

### Token lifecycle (attestation #1)
- `qbo_connections` row holds: `realm_id`, `environment`, `access_token`, `refresh_token`,
  `access_token_expires_at`, `refresh_token_expires_at`, `updated_at`. Secrets stored encrypted
  (pgcrypto `_enc` per `pattern-compliance.md` PII/secret convention) — **confirm** encryption
  approach at implement (pgcrypto vs Supabase Vault RPC like Tekmetric).
- `getAccessToken()`: if `access_token_expires_at` is within a 5-min skew → refresh via
  `intuit-oauth` `refreshUsingToken(latest)`, **persist the rotated refresh_token + new expiries
  atomically**, return fresh access token. Refresh-token rotation: always write back the newest.
- **Single-flight refresh:** refresh runs inside a Postgres RPC that `SELECT … FOR UPDATE`s the row,
  so concurrent Server Actions don't race two rotations (prior refresh token only lives 24 h).
- `invalid_grant` on refresh → `QboClientError(kind:"reconnect_required")`; surfaced to the admin UI
  as "reconnect QuickBooks" (re-run the `qbo-oauth-callback` handshake). No silent failure.

### Request path (attestations #2, #3, #4, #5, #6)
- `request(method, resource, {body, query, idempotent})`:
  - URL `{base}/v3/company/{realmId}/{resource}?minorversion=NN[&requestid=…]`. `requestid` (a UUID)
    added for **writes** (idempotent retry-safe). **Computed ONCE per logical write and held constant
    across every retry of that write** — a fresh UUID per attempt would defeat idempotency and
    double-post on a 5xx-then-success. (Review finding, quickbooks-compliance 2026-05-30, anchored to
    `api-request-mechanics.md` §Idempotency.) Architecture-claim test asserts the retried request
    carries the same `requestid`.
  - `Authorization: Bearer <access>`, `Accept: application/json`.
  - **Retry** (≤3) on **429 + 5xx** with exponential backoff (250ms→1s→2s) honoring `Retry-After`.
    **No retry** on 400/401 (401 → one refresh+retry, then surface).
  - **`intuit_tid`**: capture the `intuit_tid` response header (name **to confirm** at implement via
    WebSearch `developer.intuit.com` / live response) + body `Fault.requestId`/`time` into structured
    logs (`console.log(JSON.stringify({level,surface:"qbo-client",intuit_tid,…}))`) and Sentry tags
    on error. Every error surfaces (observability.md rule 14/15). **On the FIRST live smoke read, log
    ALL response headers** so the exact `intuit_tid` header name is observed empirically, not guessed
    (closes the research unknown). (Review nice-to-have.)
  - **Fault parsing:** non-2xx → parse `Fault{Error[]{Message,code,Detail,element},type}`; **branch
    primarily on the numeric `Error[].code`** (`6000` validation, `610` not_found, `100`/`120` auth,
    `003001` throttle), using `Fault.type` (`ValidationFault`/`AuthenticationFault`/…) only as a
    coarse fallback — `type` is the category, `code` is the stable per-error key. Map →
    `QboClientError.kind` (`validation`, `not_found`, `auth`, `throttle`, `reconnect_required` for
    `invalid_grant`). (Review finding — anchored to `api-request-mechanics.md` §Fault/§Error.)
- `query(sql)`: POST to `company/{realmId}/query` (`application/text` body), pagination via
  `STARTPOSITION`/`MAXRESULTS` (cap 1000, default 100). No JOIN / no OR / LIKE `%` only. **Deliberate
  always-POST** (matches the PHP SDK, which always POSTs queries for QBO) — we do NOT implement the
  Java SDK's ≤200-char GET / >200-char POST switch; documented here so the choice is explicit.
  (Review finding — anchored to `api-request-mechanics.md` §"How a query is sent".)

### Writes (attestation: read+write scope)
- Create: POST `company/{realmId}/{entity}` with a `requestid`.
- Update: requires current `Id` + `SyncToken`; default to **sparse update** (`sparse:true`) to avoid
  clearing omitted fields. Client fetches latest `SyncToken` before update unless caller supplies it.

### Tier-graceful handling (attestation #7)
- A `Fault` indicating a feature/entity isn't enabled for the company is mapped to
  `QboClientError(kind:"not_available")` rather than a hard throw, so callers degrade gracefully.
  **Confirm the exact Essentials-excluded entity/preference set** at implement (WebSearch +
  read the company `Preferences`/`CompanyInfo`). Start with Invoice + Customer (available on
  Essentials) so v1 isn't blocked on this. **No dedicated tier-unavailability Fault code is confirmed
  in the references** — before asserting a `not_available` branch, confirm the ACTUAL Fault shape a
  disabled feature returns against a live `Preferences`/`CompanyInfo` read; don't assume a clean code
  exists. (Review finding — anchored to research §Confirmed-unknowns.)

### Discovery document (attestation #8)
- The **`intuit-oauth` SDK owns the token endpoint** (decision #4 uses it for refresh), so the prod
  discovery doc (`https://developer.intuit.com/.well-known/openid_configuration/`) is **attestation /
  documentation only** by default — we follow the documented mechanism but the SDK's pinned endpoint
  is authoritative. **Do NOT add a dead optional fetch** whose result goes unused. If we ever resolve
  endpoints from discovery, the resolved `token_endpoint` MUST be threaded into the `intuit-oauth`
  client config or it's inert. (Review finding — anchored to `api-auth-fundamentals.md` §"OpenID
  discovery documents".)

## File-by-file change list (all GATED — implement phase)

**New — admin-app lib (Node, server-only):**
- `admin-app/src/lib/qbo/config.ts` — env base URL, `MINORVERSION` const, retry caps, timeouts.
  Default `MINORVERSION` to the **SDK-confirmed floor `75`** (current PHP SDK default — cited), NOT
  `59`; treat Intuit's minor-versions page as the authority for bumping it. (Review nice-to-have.)
- `admin-app/src/lib/qbo/errors.ts` — `QboClientError` + `parseFault()`.
- `admin-app/src/lib/qbo/entities.ts` — Zod schemas/types: Invoice, Customer, Fault envelope.
- `admin-app/src/lib/qbo/tokens.ts` — load connection, single-flight refresh, persist rotation.
- `admin-app/src/lib/qbo/client.ts` — `QboClient` (getAccessToken, request, query, create, sparseUpdate).

**New — admin-app actions (thin):**
- `admin-app/src/actions/qbo/get-company-info.ts` — read smoke (CompanyInfo) to prove the loop.
- `admin-app/src/actions/qbo/find-customer.ts` — query example (read).
- `admin-app/src/actions/qbo/create-invoice.ts` — write example (idempotent, SyncToken-aware).
  (Exact first write entity confirmable with Chris; Invoice chosen as the canonical AR write.)

**New — DB migration (HUMAN-GATED apply):**
- `supabase/migrations/<ts>_qbo_connections.sql` — `qbo_connections` table (RLS: service_role only;
  no `authenticated` access — tokens never reach the browser) + `qbo_get_connection` /
  `qbo_persist_tokens` RPCs (`SECURITY DEFINER`, `SET search_path=public`, `FOR UPDATE` single-flight).

**New — tests (TDD; admin-app gets a test runner):**
- `admin-app/vitest.config.ts` + `admin-app/tests/setup.ts` (port from scheduler-app; MSW for QBO).
- `admin-app/src/lib/qbo/__tests__/{client,tokens,errors}.test.ts` — refresh-on-expiry + rotation
  persistence, retry/backoff on 429/5xx + no-retry on 400, `Fault`→`kind` mapping, `requestid` on
  writes, sparse-update body shape, reconnect_required on invalid_grant, intuit_tid captured.

**Modify:**
- `admin-app/package.json` — add `intuit-oauth@4.2.3` (dep) + dev: `vitest@^4`,
  `@vitest/coverage-v8@^4`, `msw@^2`, `@vitejs/plugin-react` + `test`/`test:coverage` scripts.
- `admin-app/src/lib/supabase/*` — only if a service-role server client helper is needed for token
  reads (reuse existing `resolveServiceRoleKey` if present; no new pattern).

## TDD order (write tests first per stage)

1. `errors.ts` + Fault fixtures → tests → impl.
2. `tokens.ts` (refresh/rotation/single-flight) → tests (mock intuit-oauth + supabase) → impl.
3. `client.ts` request/retry/idempotency/tid + query → MSW tests → impl.
4. Migration + RPCs (pgTAP optional; at minimum a deployed smoke read).
5. Thin actions → tests (mock the client) → impl.

## Phasing (commits)

- **C1 — Test harness:** add Vitest/MSW config to admin-app (no app code). Verify `npm run test` runs.
- **C2 — lib core:** `config/errors/entities/tokens/client.ts` + unit tests (TDD). `npm run test` + `typecheck` green.
- **C3 — migration:** `qbo_connections` + RPCs. **HUMAN GATE:** Chris `supabase db push`. Then `supabase gen types` if admin-app consumes DB types.
- **C4 — actions + read smoke:** thin actions; deployed read (CompanyInfo) against real Jeff's QBO (needs the handshake-produced token row seeded).
- **C5 — write path:** create-invoice with idempotency + SyncToken; guarded smoke (or sandbox) before touching real books.

## Verification (verify phase)

- `cd admin-app && npm run typecheck` → PASS.
- `cd admin-app && npm run test` (+ `test:coverage`) → PASS; ≥80% lines on `src/lib/qbo/**`.
- `cd admin-app && npm run build` → PASS.
- Architecture-claim tests pass: refresh-on-expiry rotates+persists; 429→backoff-retry; 400→no-retry;
  invalid_grant→reconnect_required; write carries requestid; sparse update preserves omitted fields.
- Deployed read smoke (CompanyInfo) returns real data + logs an `intuit_tid` (post-migration + token seed).
- Write smoke gated: verify on sandbox or with explicit Chris approval before mutating real books.
- Migration verified via `mcp__supabase__list_migrations` + `get_advisors` (per deployment.md "reads+verify").

## Open questions (resolve before/at implement)

1. **Secret-at-rest mechanism:** pgcrypto `_enc` columns vs Supabase Vault RPC (Tekmetric uses Vault).
   Recommend Vault for parity; confirm at implement.
2. **`intuit_tid` exact header name** + **current `minorversion`** + **Essentials-excluded entity set** —
   the three cite-or-omit unknowns from research; confirm via WebSearch/live response at implement.
3. **First write entity:** Invoice assumed (canonical AR write). Confirm vs Customer-first.

### Resolved (Chris, 2026-05-30)
4. **Write smoke safety:** RESOLVED → real books, but **every first live write is a human gate**
   (decision #6 above).
5. **Keys:** RESOLVED → **production** (decision #5 above).
6. **Cross-verify:** RESOLVED → not the built-in command; a future specialized + generalized
   (GPT/Gemini/Claude) check-agent layer (decision #7 above).
