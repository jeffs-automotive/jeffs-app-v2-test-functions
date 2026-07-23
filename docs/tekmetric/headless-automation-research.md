# Tekmetric Bridge — shared automation & data-access platform (research)

> **Status:** research / pre-feature (2026-07-21). No code written. Owner: Chris.
> **What this is:** a **general-purpose, shared backend service** that does the things the Tekmetric
> *public API* can't — both **reads** (data the API doesn't expose) and **writes** (actions the API
> doesn't offer) — by driving Tekmetric's own web app from a server-side automation with a dedicated
> bot session. Multiple apps consume it. New capabilities are meant to be **easy to bolt on later**.
>
> **Build order (Chris, 2026-07-21):** put the **plumbing in place first** (session + worker + capability
> registry + queue + gateway), *then* decide what each capability does. First real capabilities =
> **appointment items**. The future **customer portal** will reuse this so customers can manage their
> own appointments.

---

## 1. Decisions locked (2026-07-21)

| # | Decision |
|---|---|
| Recon | Do it **together** — Chris logged into his own Tekmetric; I inspect the network traffic. I never handle his credentials. |
| Bot account | Create a **dedicated Tekmetric employee seat**, **2FA off**, least-privilege role. |
| Hosting | **Self-host** (not a managed browser SaaS like Browserbase). *Which* self-host depends on the tier recon lands on — see §6. |
| Scope | **Keep it open / general-purpose.** Build the plumbing; wire behaviors incrementally. |

## 1b. RECON RESULTS — CONFIRMED 2026-07-21 (live, on RO #154139)

Captured directly from the logged-in web app via DevTools network inspection. **This changes the
architecture for the better — a runtime browser is NOT needed.**

**Auth model:**
- Internal API base: **`https://shop.tekmetric.com/api/...`** — a clean, same-origin **REST/JSON** API.
- Auth = **`x-auth-token: <JWT>`** header, and it is **required** — the `_app_ctx` cookie alone returns
  **401** (proven). JWT is HS256, **~16 h lifetime** (`iat`→`exp` = 57600 s), stored in
  **`localStorage.jwt`**. Claims include `shopId`, `userId`, `employeeId`, `employeeRole`, `permissions[]`.
- Login is **reCAPTCHA-gated** (loads on submit; invisible), **no Cloudflare wall, no third-party IdP**.
  → login needs a real browser + a human for reCAPTCHA; the resulting **token is reusable for ~16 h**.

**Write contracts (confirmed by creating/deleting on a live RO):**
| Action | Method + path | Body / notes |
|---|---|---|
| **Create concern** | `POST /api/repair-orders/{roId}/customer-concerns` | `{"concern":"…","techComment":"…"}` (techComment = "Finding"). Returns `{type:"SUCCESS",data:{id,…}}` |
| **Delete concern** | `DELETE /api/customer-concerns/{concernId}` | 200. Note: **not** nested under repair-orders |
| **Update concern** | `PUT /api/customer-concerns/{id}` *(to confirm — by symmetry with delete)* | — |
| **Create/edit job + labor** | `POST /api/shop/{shopId}/job` | Full Job object incl. `labor:[{name,hours,rate,autoApplyLaborMatrixId,technician}]`. **Upsert** (client-gen job id). **rate in cents** (17802 = $178.02). Labor matrix auto-applies. |

**Read endpoints mapped (bonus — seed the reader capabilities):** `GET …/customer-concerns` &
`…/technician-concerns`; `GET /api/repair-order/{roId}/estimate`; `…/profit/labor`;
**`GET /api/shop/{shopId}/shop-discounts`** & `…/shop-fees` (qteklink discount-match); **`GET
/api/employee/{empId}/time-card-active`** (clock hours); `…/canned-jobs`; `…/jobs/job-history`;
`GET /api/shop/{shopId}/repair-order/{roId}`.

**→ Architecture impact (major simplification):**
- **Tier A (pure-HTTP replay, NO runtime browser) is CONFIRMED for both reads and writes.** Once tekbridge
  holds a valid JWT, everything is a plain `fetch` with one header. This can run in **Supabase edge or a
  Vercel route — no Chromium, no Fly.io browser worker** for the runtime.
- The **only** browser + human step is the **reCAPTCHA login to mint/refresh the JWT (~once per 16 h)**.
  So the design reduces to: a **session broker** (assisted login → capture `localStorage.jwt` → store in
  Vault → re-auth ~every 16 h with alerting) + a **stateless capability worker** (edge/route) that replays
  API calls with the header and verifies via the public API.
- **Least privilege:** the captured token was an OWNER token — the bot seat must be a restricted role, not Owner.

**Security note:** recon exposed Chris's live OWNER JWT (~16 h). It was **not stored** anywhere; log out of
the automated browser to invalidate early.

## 2. Why a platform, not a feature — the capability backlog

A lot of our app data comes from Tekmetric, but not all of it is API-reachable, and some actions have no
API at all. This service is the single place we close those gaps for every app.

**Principle: API-first, bridge-for-gaps.** Every capability first checks whether the *public API* can do
it (cheaper, robust, ToS-clean). The bridge only handles what the API genuinely can't. Consumers call one
capability and don't care which path backs it.

| Capability (candidate) | Consumer | API can do it? | Bridge role |
|---|---|---|---|
| **Write/update RO customer concerns** | scheduler-app, customer portal | ❌ No endpoint | **Write** (primary driver) |
| **Appointment management** (concern-linked, RO-open cases) | scheduler-app, customer portal | Partly — appt fields yes; concerns no; desc doesn't propagate once RO open | Write, API-first for the fields it can |
| **Edit labor lines** (rate/hours/name, add/remove) | future inspection app, service-advisor tooling | ❌ only `technicianId` | Write |
| **Post inspection summary onto a labor line** | future state-inspection app | ❌ | Write |
| **Post LLM service-advisor recommendations onto the RO** (from vehicle history / Carfax) | future SA-automation | ❌ | Write |
| **Pull employee clock hours** | payroll / qteklink | Partial (`job-clock`, `loggedHours`) — full punch data TBD | Read (verify API coverage first) |
| **Pull exact discount detail** so QBO ↔ Tekmetric match | qteklink-app | Partial (discount line items exist) — confirm it's the exact number we need | Read (verify API coverage first) |

> Clock-hours and discounts may be *partly* API-serviceable — recon checks the API first for each before
> assuming the bridge is needed. Never guess; confirm coverage.

## 3. Why the API can't do the core writes (confirmed against `TEKMETRIC_API_DOCS.md`)

| Target | API reality | Verdict |
|---|---|---|
| **RO customer concerns** (`customerConcerns[]`) | Read-only. `PATCH /repair-orders/{id}` writes only `keyTag`, `milesIn/Out`, `technicianId`, `serviceWriterId`, `customerTimeOut`. No concern create/update/delete endpoint. | Bridge only |
| **Labor line contents** | `PATCH /labor/{id}` writes **only `technicianId`**. `PATCH /jobs/{id}` only `completed/name/note/technicianId/loggedHours`. | Bridge only |
| Appointment `description` shortcut | API-writable, **but** once the RO is open, edits don't propagate to the RO (Chris confirmed). | Dead end |

## 4. Architecture — layered, registry-driven (mirrors our `orchestrator-mcp`)

This is deliberately the **same shape as `_shared/mcp-tool-registry.ts`**: a deterministic registry of
typed actions consumed by multiple surfaces. That's what makes "add a feature later" a drop-in.

```
 Consumers:  scheduler-app │ admin-app │ qteklink-app │ future inspection app │ customer portal
                    └──────────────┴───────────┴─────────────┬──────────────────────┘
                                                             ▼
   ┌──────────────────────────  Tekmetric Bridge  ──────────────────────────┐
   │  (A) Gateway/API      stable internal endpoint; service-role + actor    │
   │                       identity auth (like orchestrator-mcp's admin      │
   │                       branch); shop-scoped (shop-agnostic rule)         │
   │                                                                          │
   │  (B) Invocation       • SYNC request/response  → readers apps await     │
   │       modes           • ASYNC durable job      → writes/unattended,     │
   │                         tekmetric_ui_jobs: payload, idempotency_key,     │
   │                         status, attempts, before/after snapshot, audit  │
   │                                                                          │
   │  (C) Capability       each capability = a module:                        │
   │       registry          { name, inputSchema(zod), mode:read|write,      │
   │                           backing:api|bridge, run(session,input),       │
   │                           verify?(session,input,result) }               │
   │                         → adding a feature = register a new module       │
   │                                                                          │
   │  (D) Session layer    owns the bot's Tekmetric WEB session: login (2FA   │
   │                       off/TOTP), persist storageState, refresh, health,  │
   │                       single-flight. Shared by all capabilities.         │
   │                                                                          │
   │  (E) Observability    Sentry, audit table, verify loop, Pattern-B        │
   │                       manual-review email fallback                       │
   └──────────────────────────────────────────────────────────────────────────┘
                                        │ writes verified by reading back via the PUBLIC API
                                        ▼
                                    Tekmetric
```

The public-API bearer token we already have (`_shared/tekmetric-client.ts`, Vault) stays the **read/verify**
channel; the bot **web session** is the new thing the bridge owns.

## 5. How a write is performed — three tiers, lightest-first (recon picks)

1. **Tier A — pure-HTTP internal-endpoint replay (no browser).** Script login → replay the exact XHR the
   SPA fires to save a concern/labor line. If login has no captcha and 2FA is off, this can run with just
   `fetch` — even in Supabase edge / a Vercel route. Fastest, most robust, smallest footprint.
2. **Tier B — headless browser holds the session, replays endpoints** for the writes.
3. **Tier C — headless browser + DOM automation** (type + click Save). Fallback; flakiest.

Design the write step as a **swappable strategy** so a capability can start on DOM and move to replay.

## 6. Hosting — answering "can we use Supabase or Vercel?"

Short answer: **it depends on the tier, and neither is a good home for a persistent browser session.**

| Runtime | Runs a browser? | Holds a persistent logged-in session? | Verdict |
|---|---|---|---|
| **Supabase Edge (Deno)** | ❌ No Chromium; restricted Deno subset; hard wall-clock limit | ❌ ephemeral | Fine for **Tier A** pure-HTTP only |
| **Vercel function** | ⚠️ Yes via `puppeteer-core` + `@sparticuz/chromium` within ~50 MB/250 MB, but 4–8× slow, cold-start heavy, read-only FS | ❌ stateless per invocation — relaunches Chromium each call | Fine for **Tier A**; poor for a session-holding worker |
| **Small always-on container** (Fly.io / Railway / a tiny VM) | ✅ | ✅ holds session in memory + persists storageState; **dedicated static IP** available | **Right home if a browser is needed** |

So:
- **If recon lands on Tier A** → we can host in **Supabase edge or a Vercel route** we already pay for — *zero new infra*. Best case.
- **If a browser is required (Tier B/C)** → a **single small Fly.io machine** is the true self-host: cheap, always-on, and it gives us a **stable egress IP** (critical — see §7). Supabase/Vercel can't hold the session.

The static-IP point matters regardless: Tekmetric logs **IP + user-agent** on every login, so the bot must
present a **stable identity**, which a Fly dedicated IP (or the shop's static IP) provides and rotating
serverless egress does not.

## 7. Recon — the immediate next step (gates tier + hosting; ~20 min, together)

With Chris logged into his own Tekmetric, using dev-tools / the chrome-devtools MCP against his live
session, capture:

1. **Login flow** — plain email+password POST? captcha/Cloudflare wall? session = cookie or JWT, lifetime,
   "remember device"? → Tier A vs B.
2. **2FA mechanism** for the bot seat type (off / TOTP / SMS) → confirms headless viability.
3. **Add/edit an RO concern** and **edit a labor line** while watching Network → capture internal endpoint
   (method, URL, headers incl. CSRF, JSON body) → confirms replay.
4. **Sandbox web UI** — does `sandbox.tekmetric.com` allow a bot-seat login + these actions, so we test end
   to end before touching production ROs?
5. Spot-check the API for **clock hours** and **discount detail** to see how much is API-first vs bridge.

## 8. Reliability & safety (reuse existing patterns)

- **Idempotency:** job key = hash(RO id + capability + normalized input), like `webhook_events` +
  Pattern-A `scope_hash`. Retries never double-write.
- **Guardrails:** never mutate `POSTED`/`AR`/locked ROs; skip no-op writes; per-day cap; single-flight per RO.
- **Closed-loop verify:** read-before / write / read-after / diff via the public API; abort on unexpected state.
- **Human-paced + backoff** (ToS "no disproportionate load").
- **Observability (our 15 rules):** Sentry per failure, structured logs, audit table, **Pattern-B
  manual-review email** when the bot bails.
- **Canary:** daily sandbox read + test write to detect Tekmetric UI/endpoint changes before real jobs break.

## 9. Honest risks

- **Account/API revocation** if unattended traffic is flagged → mitigated by stable identity + low volume,
  not eliminated (accepted-risk call is Chris's).
- **Fragility** on UI/endpoint changes → canary + fallback + alerting mandatory.
- **Session death / password rotation** → robust re-login + alert.
- **Powerful bot creds** → least-privilege seat, Vault storage, IP allowlist if Tekmetric offers one.

## 10. Plumbing-first build plan

- **Phase 0 — Recon (§7).** No code. Decide tier + hosting. *← next.*
- **Phase 1 — Session layer.** Bot login (2FA off) + persist/refresh session + health check + audit, on **sandbox**.
- **Phase 2 — Registry + gateway skeleton.** Capability interface + registration + ONE trivial read
  capability (e.g. session-health / fetch-RO-via-bridge) + the `tekmetric_ui_jobs` table + sync entrypoint
  + service-role/actor auth + Sentry. Proves the seam end-to-end.
- **Phase 3 — First real capabilities: appointment items** (concern write, verified) + the scheduler
  trigger to enqueue on appointment change.
- **Phase 4+ — Incremental capabilities:** labor-line edit, clock-hours read, discount read (qteklink),
  inspection-summary write, LLM SA recommendations. Each is a new registry module.
- **Later:** customer portal consumes the same gateway for self-service appointment management.

## 11. Open questions for Chris

1. **Recon session:** when? (You logged in, I inspect via chrome-devtools.)
2. **Name:** `tekmetric-bridge`? `tekmetric-ops`? something else?
3. **Egress IP:** is there a shop/VPN static IP the worker can use, or do we provision a dedicated Fly IP?
4. After recon, kick off the feature workflow (`/feature-start tekmetric-bridge`) to plan + build the skeleton?
