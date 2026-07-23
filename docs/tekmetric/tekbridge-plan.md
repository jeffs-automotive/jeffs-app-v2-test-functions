# tekbridge — implementation plan

> **Feature:** `tekbridge` — a shared, extensible backend service that performs Tekmetric actions the
> public API can't, by replaying Tekmetric's **internal** REST API with a bot session JWT. Consumed by
> multiple modules; new abilities are drop-in.
> **Phase:** plan (2026-07-21). Research + live recon complete — see
> [headless-automation-research.md](./headless-automation-research.md) (esp. §1b RECON RESULTS).
> **Effort policy:** plan on Opus 4.8 @ `max`; implement on ultracode. Backend-only for Phase 1–2 → **no
> UI, no design spec** (the admin health screen is Phase 3 and will get a spec then).

---

## 1. Why

A lot of our app data lives in Tekmetric, but the **public API is read-mostly** — it can't write RO
customer concerns, can't edit labor-line contents, etc. (proven in research). Recon proved Tekmetric's
**internal API** is a clean same-origin REST/JSON service authed by one header (`x-auth-token: <JWT>`),
so once we hold a bot JWT we can do these actions with plain server-side `fetch` — **no runtime browser**.
tekbridge is the one place we close every such gap, for every app, with **API-first / bridge-for-gaps**
capabilities that are easy to add.

## 2. Locked decisions (Chris)

- **Name:** `tekbridge`. **Self-host**, **bot Tekmetric seat with 2FA off**, **plumbing-first**, keep it
  general. First real capability = **appointment items (concern write)**. Recon done together.
- **Tier A confirmed:** pure-HTTP replay, no runtime browser. Runs as a **Supabase edge function** (no
  Fly.io browser worker).
- **Reuse the registry pattern:** capabilities are AI-SDK `tool()` defs (`name/description/inputSchema/
  execute`), same shape as `getSchedulerTools()`/`getOrchestratorTools()`, so they merge into
  `buildMcpToolRegistry` **and** are callable directly. Adding an ability = add one capability file.
- **Least privilege:** the bot seat must NOT be Owner (recon token was Owner — too broad).
- **Verify every write** by reading back through the **public** API (the token we already have).

## 3. Confirmed API contracts (from recon)

- Base `https://shop.tekmetric.com/api` · auth `x-auth-token: <JWT>` (HS256, ~16h, `localStorage.jwt`;
  cookie alone → 401).
- Create concern `POST /api/repair-orders/{roId}/customer-concerns` `{concern, techComment}`.
- Delete concern `DELETE /api/customer-concerns/{id}`. Update concern *(assumed `PUT /api/customer-concerns/{id}` — confirm)*.
- Job+labor upsert `POST /api/shop/{shopId}/job` (full Job incl. `labor[]`, **rate in cents**).
- Readers: `…/shop-discounts`, `…/shop-fees`, `…/employee/{id}/time-card-active`, `…/repair-order/{roId}/estimate`, etc.

## 4. Architecture

```
 Consumers → scheduler-app · admin-app · qteklink-app · future apps · chat orchestrator
                                   │  (a) direct: POST edge fn `tekbridge` {capability,input}  [SERVICE_ROLE + X-Actor-Email]
                                   │  (b) via chat: getTekbridgeTools() merged into buildMcpToolRegistry
                                   ▼
   supabase/functions/tekbridge/index.ts   ── gateway: authn, dispatch capability, Sentry.withScope
                                   │
   supabase/functions/_shared/tekbridge/
     session.ts   → bot JWT: get/set (Vault) + expiry decode + health; 401 → mark stale + Sentry
     client.ts    → tekbridgeFetch(): base + x-auth-token + timeout + typed errors  (INTERNAL api)
     registry.ts  → getTekbridgeTools(): map of tool() defs   ← add a capability = add a file here
     capabilities/write-customer-concern.ts   (Phase 1)
     verify.ts    → read-back via PUBLIC api (tekmetric-client.ts) to confirm the write landed
     constants.ts → INTERNAL base url, Vault names, bot ids
                                   │  writes verified by reading back via the PUBLIC API
                                   ▼                       durable/unattended writes → tekbridge_jobs (queue)
                               Tekmetric internal API
```

**Session acquisition (the one human touchpoint).** reCAPTCHA guards login only. Phase-1 flow: a human
logs in as the bot (passes reCAPTCHA once), then submits the JWT to tekbridge via a tiny authenticated
**session-submit** endpoint (a one-line console snippet / bookmarklet reads `localStorage.jwt` → POST).
Stored in Vault. **Refresh is an open question** (§8 Q1) — resolve at first sandbox login.

## 5. File-by-file change list

**New — migration** `supabase/migrations/<ts>_tekbridge.sql`
- `tekbridge_session_state` (non-secret): `shop_id`, `status` (active|stale|expired), `expires_at TIMESTAMPTZ`, `last_refreshed_at`, `last_error TEXT`, updated_at. (The JWT itself → Vault, not a table.)
- `tekbridge_jobs` (durable async queue): `id UUID pk`, `shop_id`, `capability TEXT`, `input JSONB`, `idempotency_key TEXT UNIQUE`, `status` (queued|running|done|failed), `attempts INT`, `before_snapshot JSONB`, `after_snapshot JSONB`, `result JSONB`, `error TEXT`, `actor TEXT`, timestamps.
- `tekbridge_audit_log`: `id`, `shop_id`, `capability`, `input_summary JSONB`, `actor`, `outcome` (ok|error), `verified BOOLEAN`, `tekmetric_ref JSONB` (e.g. concern id), `created_at`.
- Vault RPCs: reuse/clone `tekmetric_get_secret`/`set_secret` as `tekbridge_get_secret`/`set_secret` for `tekbridge_session_jwt` (or reuse the existing generic ones — decide in implement).
- RLS: service-role only; `shop_id` scoped. pgTAP asserts row counts.

**New — shared module** `supabase/functions/_shared/tekbridge/`
- `constants.ts` — `TEKBRIDGE_INTERNAL_BASE = "https://shop.tekmetric.com/api"` (sandbox switch), Vault name `tekbridge_session_jwt`, bot employee id env name.
- `session.ts` — `getBotJwt(sb)`, `setBotJwt(sb, jwt)`, `decodeExp(jwt)`, `getSessionHealth(sb)`; on 401 mark `tekbridge_session_state.status='stale'` + `Sentry.captureMessage`.
- `client.ts` — `tekbridgeFetch(sb, path, {method, body, timeoutMs})` + `tekbridgeJson<T>()`; attaches `x-auth-token`; **never** `NEXT_PUBLIC`; typed errors; single-flight not needed (stateless).
- `registry.ts` — `getTekbridgeTools({sb, shopId, actor, supabaseUrl, serviceRoleKey})` → `Record<string, tool()>`.
- `capabilities/write-customer-concern.ts` — `writeCustomerConcern` (create), `deleteCustomerConcern`; zod input; calls client; calls verify.
- `verify.ts` — `verifyConcernPresent(publicApi, roId, text)` via `tekmetric-client.ts` (public API GET).
- `idempotency.ts` — `jobKey(shopId, capability, normalizedInput)` sha256 (mirrors webhook_events / Pattern-A).

**New — edge fn** `supabase/functions/tekbridge/index.ts` (+ `deno.json`)
- Auth: SERVICE_ROLE + `X-Actor-Email` (mirror orchestrator-mcp admin branch). 
- Routes: `POST /` `{capability, input, shop_id?}` → validate vs capability zod → execute → `{ok,data|error}`; `POST /session` (submit JWT); `GET /session` (health).
- `Sentry.withScope` wrap (observability rule 7); tags `shop_id`, `actor`, `capability`.

**Modified**
- `supabase/functions/_shared/mcp-tool-registry.ts` — merge `getTekbridgeTools(...)` into `buildMcpToolRegistry` (Phase 2), with the same name-collision guard.
- `supabase/functions/_shared/tekmetric.ts` — add internal-API base constant if we co-locate it (or keep in tekbridge/constants.ts).

**Tests (TDD — written with each unit)**
- `_shared/tekbridge/*.test.ts` (Deno) — session expiry decode, client header/error/401 path, concern capability happy + failure + verify-loop (mocked fetch), idempotency key stability.
- `supabase/tests/database/tekbridge.test.sql` (pgTAP) — tables, UNIQUE(idempotency_key), RLS row-count assertions.

## 6. Phasing

- **Phase 0 — Chris's prerequisites (no code):** create the bot Tekmetric employee (least-privilege role, **2FA off**); confirm `sandbox.tekmetric.com` lets that bot log in + add a concern; get its JWT once for the first live test.
- **Phase 1 — skeleton + session + concern write (this build):** migration + `_shared/tekbridge/` + `tekbridge` edge fn + tests. **Acceptance = the key risk test:** a **server-side** `fetch` (edge fn, not a browser) with only `x-auth-token` **succeeds** against sandbox → create concern → verify via public API → delete. Proves Tier A works outside the browser.
- **Phase 2 — multi-module + more abilities:** merge into `buildMcpToolRegistry`; add `edit-labor-line`, `read-discounts` (qteklink), `read-clock-hours`; wire scheduler appointment-change → enqueue `tekbridge_jobs` concern-sync (idempotent + verified).
- **Phase 3 — session automation + admin UI:** auto-refresh per §8 Q1 (or a persistent-session agent reusing the document-intake scan-agent Windows-service pattern); admin-app **Tekbridge health/session** screen → **design spec then**.

## 7. Verification

- `deno test` green for all `_shared/tekbridge/*.test.ts`; `deno check` clean.
- `supabase test db` — `tekbridge.test.sql` pgTAP green.
- Full fn sweep + typecheck + `/code-review` gate (fail-closed) + Claude reviewers (security/pattern/regression/supabase-compliance/sentry-compliance).
- **Live Phase-1 acceptance** against **sandbox** (above).

## 8. Open questions

1. **Server-side JWT refresh?** Investigate `GET /api/token/shop/{shopId}` (+ any refresh route) at the first sandbox login — if it re-mints a JWT from the current one, tekbridge self-refreshes (no browser ever after first login). If not, Phase-3 persistent-session agent.
2. **Does non-browser origin matter?** Confirm Tekmetric accepts the header-only request server-side (no Origin/Referer/`recaptcha-challenge`-cookie requirement). **Tested first thing in Phase 1** — it's the load-bearing assumption.
3. **Concern update** verb/path (`PUT /api/customer-concerns/{id}`?) — confirm on sandbox.
4. **Internal API rate limits** (public is 300/min sandbox / 600/min prod; internal unknown) — pace + backoff.
5. **Vault RPCs:** reuse generic `tekmetric_*_secret` or add `tekbridge_*_secret`? (implement-time call.)

## 9. What this is NOT (Phase 1)

No runtime browser, no Fly.io, no headless farm, no admin UI, no unattended triggers yet (that's Phase 2's
job queue). Phase 1 is the plumbing + one verified capability, proven server-side on sandbox.
