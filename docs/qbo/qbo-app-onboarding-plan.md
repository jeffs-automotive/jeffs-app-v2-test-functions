# QBO App Onboarding — Plan (feature: qbo-app-onboarding)

> Phase: plan · 2026-05-30 · Research: `docs/qbo/qbo-app-onboarding-research.md`

## Why

To get **production** QuickBooks Online API keys for our own Intuit app, Intuit requires a
registered **redirect URI**, a public **EULA URL**, a public **Privacy Policy URL**, and a
completed app questionnaire. This feature produces those 3 URLs (and the one-time OAuth
handshake helper behind the redirect URI) so Chris can finish the Intuit app profile +
questionnaire and obtain production keys — which then feed the local QuickBooks MCP server
(`@qboapi/qbo-mcp-server`) a production `refresh_token` + `realmId`.

## Locked decisions

1. **Real production data** — connect to the real Jeff's Automotive QBO company.
2. **Supabase-hosted redirect URI** (no ngrok): a `qbo-oauth-callback` edge function on the test
   project `itzdasxobllfiuolmbxu`.
3. **Legal pages on the admin app** at `admin.jeffsautomotive.com` (verified live), served as
   **static files** under `admin-app/public/legal/` (publicly readable — admin middleware does not
   gate static assets; no `requireAdmin()` on static files).
4. **`jeffs-app` (v1) is reference-only** — concepts adapted, **no code copied**.
5. **Scope = only the 3 URLs + handshake helper.** Full QBO sync integration (`qbo-sync`,
   `qbo-webhook`, `qbo_connections`) is a separate later feature.
6. Self-contained handshake: the edge function does **both** authorize-start and callback, so it
   does not depend on the local server's `npm run auth` local-callback flow.
7. **Stateless HMAC-signed `state`** (short TTL) — no new DB table/migration for a one-time flow.

## File-by-file change list

### New: `supabase/functions/qbo-oauth-callback/index.ts`  (GATED — implement phase)
Single `Deno.serve` handler, `verify_jwt: false`. Two GET modes on the same registered path:
- **start** (`?start=1`, no `code`): build the Intuit authorize URL —
  `https://appcenter.intuit.com/connect/oauth2?client_id=<QBO_CLIENT_ID>&scope=com.intuit.quickbooks.accounting&redirect_uri=<this fn URL>&response_type=code&state=<signed>` — and 302 to it.
- **callback** (`?code&state&realmId`): verify `state` (HMAC + TTL), POST the code to
  `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` (`Authorization: Basic base64(id:secret)`,
  `grant_type=authorization_code`, `code`, `redirect_uri`), then render a plain HTML page showing
  **`refresh_token`** + **`realmId`** (with copy-paste instructions for the MCP `.env`/env vars).
- Reads secrets via `Deno.env.get`: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_STATE_SECRET`
  (HMAC key), `QBO_ENVIRONMENT` (default `production`). Helpers reused from `_shared/oauth.ts`
  (`randomToken`, `base64UrlEncode`, `sha256Base64Url`); Sentry via `_shared/sentry-edge.ts`.
- Fresh code; adapts the *concept* from v1's callback (no copy), minus the `qbo_connections`
  storage / dashboard redirect.

### Modify: `supabase/config.toml`  (implement phase)
Add:
```toml
[functions.qbo-oauth-callback]
verify_jwt = false
```

### New: `admin-app/public/legal/eula.html`  (static, public)
Fresh End-User License Agreement for "Jeff's Automotive — QuickBooks integration app", covering:
permitted use, that it's an internal business-operations tool, no warranty, limitation of
liability, Intuit/QBO trademark acknowledgment, contact. **Draft for Chris/counsel review.**

### New: `admin-app/public/legal/privacy.html`  (static, public)
Fresh Privacy Policy covering: what data the app accesses (QBO accounting data via API —
customers, invoices, items, reports; plus our customer/vehicle/RO + Tekmetric data), how it's
used (internal shop operations + AI assistance), storage (Supabase, encrypted at rest), no sale of
data, third parties (Intuit, Supabase, Anthropic, Tekmetric), retention, contact, effective date.
**Draft for Chris/counsel review.**

> Note: `admin-app/public/**` is NOT a hook-gated path, but per workflow these are written in the
> implement phase with everything else.

## Phasing (commits)

- **C1 — Legal pages:** add the two static HTML files → `git push` (Vercel auto-deploys admin-app).
  Verify both URLs return 200 publicly.
- **C2 — Edge function:** add the function + `config.toml` entry → `supabase functions deploy
  qbo-oauth-callback --project-ref itzdasxobllfiuolmbxu`. Verify the URL resolves.
- Both committed to the app repo (`jeffs-app-v2-test-functions`). No dotfiles changes.

## What Chris does after this feature ships (handoff, not part of build)

1. Create the separate Intuit app → enter the 3 URLs (redirect + EULA + privacy) → complete the
   questionnaire → obtain **production** Client ID/Secret.
2. `supabase secrets set QBO_CLIENT_ID=… QBO_CLIENT_SECRET=… QBO_STATE_SECRET=<random>` (test project).
3. Visit `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/qbo-oauth-callback?start=1` →
   authorize the real Jeff's Automotive company → copy the displayed `refresh_token` + `realmId`.
4. `setx` the MCP env vars (`QBO_MCP_SERVER_PATH`, `QUICKBOOKS_CLIENT_ID/_SECRET/_REFRESH_TOKEN/
   _REALM_ID`, `QUICKBOOKS_ENVIRONMENT=production`) → restart VS Code → `/mcp` shows quickbooks connected.
   (Detailed in `QUICKBOOKS-MCP-SETUP.md` in the dotfiles repo.)

## Verification (verify phase)

- `curl -I https://admin.jeffsautomotive.com/legal/eula.html` → **200**, `content-type: text/html`,
  **no** redirect to `/login` (proves public). Same for `privacy.html`.
- `supabase functions list` shows `qbo-oauth-callback` deployed; `curl -I '…/qbo-oauth-callback'`
  resolves (200/302/400 — not 404).
- `deno check supabase/functions/qbo-oauth-callback/index.ts` passes (no type errors).
- admin-app `npm run build` still PASS (static files don't affect the build; sanity check).
- Full OAuth round-trip is **deferred** — it needs Chris's production keys + Intuit app (handoff above).

## Open questions

- **Legal wording:** I'll draft; Chris/counsel approves before we treat them as the official policy.
  Acceptable to deploy drafts now so Intuit has live URLs, then refine wording in place?
- **`QBO_STATE_SECRET`:** new random secret (recommended) vs reuse an existing one — I'll generate a
  fresh one and have Chris `supabase secrets set` it.
- **EULA vs "Terms of Service":** Intuit's field is "EULA / End User License Agreement URL" — I'll
  title the page accordingly. Confirm if you'd rather call it Terms of Service.
