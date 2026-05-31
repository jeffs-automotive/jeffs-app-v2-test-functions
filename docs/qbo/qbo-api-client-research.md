# QBO API Client — Research (feature: qbo-api-client)

> Phase: research · 2026-05-30 · Predecessor: `qbo-app-onboarding` (DONE — redirect URI,
> EULA/Privacy, connect pages, webhook receiver all shipped + verified).
> Source of truth for QBO facts: `.claude/skills/quickbooks/references/api-*.md` (SDK-sourced,
> cited). This doc does NOT re-research what the skill already verified — it grounds the
> *client* design in those facts and surfaces the open architecture decision.

## Why this feature exists

During the Intuit production-app questionnaire (predecessor feature) we attested to specific
runtime behaviors: automatic token refresh, bounded retry on throttling/transient errors,
structured error handling, `intuit_tid` capture for support escalation, and graceful behavior
on a lower QBO subscription tier. Those attestations must become **true in our own code** — not
merely true of the third-party MCP server we currently lean on. This feature builds the QBO API
client that backs those attestations.

## Current state (audit — what exists today)

| Thing | State | Path |
|---|---|---|
| OAuth handshake helper | Shipped. Exchanges `code`→tokens, **prints** `refresh_token`+`realmId`. Stateless, no DB. | `supabase/functions/qbo-oauth-callback/index.ts` |
| Webhook receiver | Shipped. `intuit-signature` HMAC verify; on-demand log+ack (no mirror/CDC). | `supabase/functions/qbo-webhook/index.ts` |
| Token storage (server-side) | **DOES NOT EXIST.** No `qbo_connections` table, no qbo migration. | — |
| Production QBO consumption | Via Intuit's **third-party local MCP server** (`@qboapi/qbo-mcp-server`) holding the refresh token in its `.env` on Chris's machine. That server does its own refresh + calls. | `~/quickbooks-online-mcp-server/` |
| In-session QBO tools | ~50 `qbo_*` MCP tools available (Intuit's official MCP server) — used interactively, mutate the REAL books. | deferred MCP tools |
| Established integration-client pattern | `tekmetric-client.ts` — lazy+cached Vault token, single 401-refresh-retry, `getJson` throws-with-truncated-body, typed page envelope. **This is the model to mirror.** | `supabase/functions/_shared/tekmetric-client.ts` |
| admin-app integration layout | `src/lib/{scheduler,orchestrator,supabase}/` (DAL-style `client.ts` + `types.ts`), `src/actions/{scheduler,keytag}/` (thin Server Actions). | `admin-app/src/` |

**Key gap:** there is no server-side, autonomously-refreshing QBO credential today. Any client *we*
own needs a token source (storage + refresh) that is independent of the local MCP server's `.env`.

## Attestation → required code behavior → cited basis

All facts below are from `.claude/skills/quickbooks/references/api-auth-fundamentals.md` and
`api-request-mechanics.md` (themselves cited to Intuit SDK source + docs).

1. **Automatic token refresh.**
   - Access token lifetime `expires_in = 3600` (1 hr). Refresh token `x_refresh_token_expires_in
     = 8726400` (~101 days, **rolling**). Refresh **rotates** — must persist the *latest* refresh
     token each time. Prior refresh token stays valid only **24 h** after a new one is issued.
   - Token endpoint `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`,
     `grant_type=refresh_token`, `Authorization: Basic base64(client_id:client_secret)`.
   - ⇒ Client refreshes on-demand when the access token is near/at expiry (or on a 401), and
     **writes back the rotated refresh token** atomically.

2. **Bounded retry.**
   - Throttling: **500 req/min per realm, max 10 concurrent**, over →
     **HTTP 429** `message=ThrottleExceeded errorCode=003001`. Best practice = single-threaded
     per realm + batch. Java SDK ships fixed/incremental/exponential backoff retry strategies.
   - ⇒ Retry 429 + 5xx with exponential backoff, capped attempts (≤3), honor `Retry-After` if
     present. Do NOT retry 400/401 (those are fix-the-request / refresh paths).

3. **Idempotency for safe retries.**
   - `requestid` is a **URL query parameter**; resending the same `requestid` after a 429/5xx/
     timeout returns the original result instead of duplicating. Batch endpoint already takes
     `?requestid=`.
   - ⇒ Write/mutation calls carry a stable `requestid` so a retry can't double-post.

4. **Structured error handling.**
   - Errors wrap in `Fault { Error[]{ Message, code, Detail, element }, type }` on the
     `IPPIntuitResponse` envelope (`time`, `requestId`, `status`). 400 = validation (e.g. code
     6000) / not-found (610); 401 = auth (100/120); 429 = throttle.
   - ⇒ Parse `Fault`, branch on `type`/`code`: 401→refresh+retry-once then surface; 400→log+skip+
     surface (don't retry); `invalid_grant` on refresh→needs reconnect (re-run handshake).

5. **`intuit_tid` capture.** *(NOT verbatim-confirmable from current refs — confirm at plan time.)*
   - QBO returns an `intuit_tid` response header that Intuit support uses to trace a request.
     The skill refs confirm the response envelope's `requestId`/`time` but do not quote the
     `intuit_tid` header. ⇒ Capture both the response `intuit_tid` header (if present) and the
     body `Fault.requestId`/`time` into structured logs on every call. **Confirm header name via
     WebSearch (`allowed_domains:["developer.intuit.com"]`) or a live response during implement.**

6. **`minorversion` pinning.**
   - Passed as `?minorversion=NN`. SDK lower bounds: PHP default `75`, JS example `59`. Latest is
     authoritative only on Intuit's minor-versions page. ⇒ Pin an explicit, current `minorversion`
     constant (confirm the value at implement time; don't inherit silently).

7. **Tier-graceful entity handling.** *(NOT verbatim-confirmable from current refs — confirm.)*
   - Jeff's company is on **Essentials** (per questionnaire context). Some entities/preferences
     are Plus/Advanced-only (commonly: Class, Department/Location tracking, Budget, inventory
     `AdvancedInventoryPrefs`). The refs confirm entity *shapes* but not a tier-availability
     matrix. ⇒ Client must degrade gracefully when an entity/feature isn't enabled for the
     company (treat the resulting fault as "not-available," not a hard error). **Confirm the exact
     Essentials-excluded entity set at plan time** (WebSearch + the company's `Preferences`/
     `CompanyInfo` which expose enabled features).

8. **Discovery document.**
   - Prod `https://developer.intuit.com/.well-known/openid_configuration/` returns
     `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `issuer`, `jwks_uri`,
     `userinfo_endpoint`. ⇒ Optionally resolve endpoints from discovery at startup rather than
     hard-coding (the questionnaire asked about this). Low priority — hard-coded constants are
     SDK-confirmed and stable; discovery is the "we follow the documented mechanism" attestation.

## Request shape (confirmed)

- Base: prod `https://quickbooks.api.intuit.com`, sandbox `https://sandbox-quickbooks.api.intuit.com`.
- Path: `{base}/v3/company/{realmId}/{resource}?minorversion=NN`.
- Query language: `SELECT * FROM Entity WHERE … ORDERBY … STARTPOSITION n MAXRESULTS m` to
  `POST company/{realmId}/query` (body `application/text` for QBO; GET if <200 chars). No JOINs,
  no `OR` in WHERE, `LIKE` only `%`. Page max **1000**, default **100**, `STARTPOSITION` 1-based.
- Updates need `Id` + current `SyncToken` (optimistic lock); `sparse:true` for partial update
  (omitted fields preserved) vs full update (omitted fields **cleared**).
- Batch: `POST company/{realmId}/batch?requestid=…`, **max 25 items**.

## Open architecture decision (REQUIRES CHRIS — see plan gate)

The mechanics are settled; the **shape/placement** of the client is not, and it's genuinely
Chris's call (per never-guess + audit-before-changes):

- **Where does the client live + who consumes it?** (a) shared edge module
  `_shared/qbo-client.ts` mirroring `tekmetric-client.ts`, consumed by edge functions /
  orchestrator tools; (b) admin-app DAL `admin-app/src/lib/qbo/` consumed by Server Actions
  ("QBO integration is part of admin-app" — Chris's earlier statement); (c) both (shared core +
  thin app wrapper).
- **Token storage + refresh ownership.** Building our own refreshing client means storing the
  rotating `refresh_token` server-side (Supabase Vault like Tekmetric, or a `qbo_connections`
  table). That's a **new migration** (human-gated apply) + decisions on encryption. Alternatively
  the client stays read-only/interactive and we keep relying on the MCP server's `.env` — which
  would make several attestations describe the MCP server, not our code.
- **Read-only vs read+write, and which entities.** On-demand reads only? Or writes (invoice/
  customer create)? This bounds the retry/idempotency/SyncToken surface we must build + test.
- **Runtime.** Deno edge (Web Crypto, `fetch`) vs Node (admin-app) — affects `intuit-oauth`
  usability (the official Node SDK won't run in Deno edge; edge needs a hand-rolled fetch client
  like `tekmetric-client.ts`).

## Confirmed-unknowns to resolve before/at implement (cite-or-omit honesty)

- Exact `intuit_tid` response-header name + presence (attestation #5).
- Current authoritative `minorversion` value (attestation #6).
- Essentials-excluded entity/preference set (attestation #7).
- Whether the existing Intuit app's keys are sandbox or production at the time we wire the client.

## Sources

- `.claude/skills/quickbooks/references/api-auth-fundamentals.md` (token lifetimes/rotation,
  endpoints, scopes, discovery doc, env base URLs — each cited to Intuit SDK source/docs).
- `.claude/skills/quickbooks/references/api-request-mechanics.md` (error/Fault shape, throttling
  500/min + 10-concurrent + 429, idempotency `requestid`, minorversion, query/pagination, batch
  25, sparse/SyncToken — each cited).
- `.claude/skills/quickbooks/references/api-webhooks-events.md` (webhook entity set, already built).
- `supabase/functions/_shared/tekmetric-client.ts` (in-repo client pattern to mirror).
- `.claude/memory/general/project_stack.md` (`intuit-oauth`, OAuth 2.0, 100-day refresh rotation).
- `docs/qbo/qbo-app-onboarding-plan.md` (predecessor scope; "full sync is a separate later feature").
