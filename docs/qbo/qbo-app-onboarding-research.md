# QBO App Onboarding — Research (feature: qbo-app-onboarding)

> Phase: research · Started 2026-05-30 · Feature marker: `.claude/work/current-feature.json`
>
> **Goal (this feature):** produce the 3 things Intuit requires to issue **production**
> QuickBooks Online keys for our own app, so Chris can complete the Intuit app profile +
> questionnaire:
> 1. **Redirect URI** — a stable Supabase-hosted OAuth callback (NOT ngrok).
> 2. **EULA / End-User URL** — public, hosted on the admin app.
> 3. **Privacy Policy URL** — public, hosted on the admin app.
>
> Downstream consumer: the local Intuit MCP server (`@qboapi/qbo-mcp-server` at
> `~/quickbooks-online-mcp-server`) needs a production `refresh_token` + `realmId`. The
> Supabase callback performs the one-time OAuth handshake and surfaces those values.

## Standing decisions (from Chris, this session)

- **Treat `jeffs-app-v2-test-data` as production** — real Jeff's Automotive QBO data, not sandbox.
- **Supabase-hosted redirect URI**, mirroring what the v1 prod app did. No ngrok.
- **`jeffs-app` (v1) is REFERENCE ONLY — copying code is forbidden.** Read to understand; adapt fresh.
- **Legal pages host: the admin app at `admin.jeffsautomotive.com`** (verified live, see below).
- **Scope of THIS feature:** only the 3 URLs + the one-time handshake helper. The full QBO sync
  integration (v1 had `qbo-sync` / `qbo-webhook` / `qbo_connections`) is a separate later feature.

## Intuit OAuth 2.0 facts (verified)

| Item | Value | Source |
|---|---|---|
| Authorization endpoint | `https://appcenter.intuit.com/connect/oauth2` | [Intuit OAuth 2.0 docs](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0); v1 `qbo/client.ts` `QBO_AUTH_URL` |
| Token endpoint | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` | same |
| Revoke endpoint | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` | v1 `qbo/client.ts` |
| Accounting scope | `com.intuit.quickbooks.accounting` | Intuit docs (full read/write QBO accounting) |
| Auth flow | Authorization Code: redirect with `client_id, scope, redirect_uri, response_type=code, state` → returns `code` + `state` + `realmId` | Intuit docs |
| Token exchange | `POST` form-urlencoded, `Authorization: Basic base64(client_id:client_secret)`, `grant_type=authorization_code` + `code` + `redirect_uri`; refresh via `grant_type=refresh_token` | v1 `qbo/client.ts` (reference) |
| Redirect URI rule | Must **exactly match** a URI registered on the app; production **rejects `http://localhost`** (must be public HTTPS) | Intuit docs + Intuit local-server README |

## Production app requirements (per Chris + Intuit app profile)

Intuit treats every app as potentially public, so production keys require:
- A registered **redirect URI** (HTTPS).
- An **EULA / End-User License Agreement** URL (public).
- A **Privacy Policy** URL (public).
- Completing the app **questionnaire / assessment** (Chris does this once we supply the 3 URLs).
- Likely also a **host domain** / launch URL in the profile (jeffsautomotive.com).

## Our edge-function conventions (own repo — safe to adapt)

- `supabase/functions/mcp-auth/index.ts` is the canonical pattern: a single `Deno.serve`
  function that routes by stripping `/functions/v1/<name>`, returns HTML/redirects, and uses
  `_shared/oauth.ts` helpers. `verify_jwt: false` is used for browser-hit endpoints (Intuit's
  redirect is an unauthenticated browser GET — same as v1's callback comment).
- `_shared/oauth.ts` provides `randomToken()` (CSRF/state), `sha256Base64Url()`, base64url utils.
- Secrets read via `Deno.env.get("...")`. Set with `supabase secrets set` (CLI). Functions deploy
  via `supabase functions deploy <name> --project-ref itzdasxobllfiuolmbxu` (CLI; MCP deploy denied).
- Sentry wrap available via `_shared/sentry-edge.ts` (`withSentryScope`).

## Hosting facts (verified)

- **`admin.jeffsautomotive.com` is LIVE** — DNS CNAME → Vercel (`vercel-dns`), serving the admin-app
  (root `/` → 307 `/login`). Verified via `curl -I` 2026-05-30.
- The admin-app **`middleware.ts` does NOT enforce auth** — it only refreshes the Supabase session
  cookie; auth is enforced per-page via `requireAdmin()`. Therefore **static files in
  `admin-app/public/legal/` are publicly served with no auth gate** (no page component → no
  `requireAdmin()` → no redirect). This mirrors v1's `web/public/legal/` approach.
- Resulting public URLs: `https://admin.jeffsautomotive.com/legal/eula.html` + `/legal/privacy.html`.

## v1 reference (read for understanding — NOT copied)

- `supabase/functions/qbo-oauth-callback/index.ts` — full integration callback: CSRF state table
  (`qbo_oauth_states`), code→token exchange, stores in `qbo_connections`, 302 back to a dashboard.
  **Heavier than we need.** Our handshake helper only needs to exchange + display the
  `refresh_token`/`realmId` (no connections table, no dashboard redirect) for this feature.
- `web/public/legal/eula.html` (~3.5 KB) + `privacy.html` (~4 KB) — confirm static-file hosting is
  the established pattern. Our content will be written fresh for Jeff's Automotive + this app.

## Proposed design (to be detailed in the PLAN)

1. **Edge function `qbo-oauth-callback`** (`verify_jwt: false`), two GET modes:
   - **start** (no `code`): build the authorize URL (client_id, scope, this function's URL as
     `redirect_uri`, `response_type=code`, random `state`) → 302 to `appcenter.intuit.com`.
   - **callback** (`?code&state&realmId`): validate `state`, exchange `code`→tokens (Basic auth,
     `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` from `Deno.env`), render an HTML page that displays
     `refresh_token` + `realmId` for Chris to put into the MCP server `.env` + env vars.
   - Registered redirect URI = `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/qbo-oauth-callback`.
2. **Legal pages** — fresh `admin-app/public/legal/eula.html` + `privacy.html`, content tailored
   to Jeff's Automotive + this app's real data use (QBO accounting read/write, customer/vehicle/RO,
   Tekmetric). **Drafts for Chris's review before deploy.**

## Open questions / risks (resolve in PLAN)

- **State validation:** stateless signed state vs a small `qbo_oauth_states` table. Leaning
  stateless (HMAC-signed, short TTL) to avoid a migration for a one-time handshake.
- **Production keys gate:** Intuit may require the app's production profile (host domain, EULA,
  privacy, questionnaire) completed before issuing production keys — chicken/egg is fine because we
  supply the URLs first, then Chris submits.
- **Legal content ownership:** Chris/counsel approves final wording. Drafts only.
- **Where `QBO_CLIENT_ID/SECRET` live:** Supabase function secrets (production keys), never committed.

## Next

Transition to **plan** (`/feature-plan`) and write `docs/qbo/qbo-app-onboarding-plan.md`.
