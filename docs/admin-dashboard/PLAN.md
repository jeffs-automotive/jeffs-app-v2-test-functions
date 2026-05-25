# Admin dashboard — implementation plan

> **Status:** APPROVED 2026-05-25. Ready to start Phase A.
> **Owner:** Chris (decisions) + Claude (build).
> **Scope:** new internal Next.js dashboard at `admin.jeffsautomotive.com` with Microsoft SSO (Entra ID), two pages (scheduler config + keytag ops). Replaces what Claude Desktop currently does for these two domains.
>
> **Refresh this file** at the end of every session that does admin-dashboard work. Move phase rows from "Remaining" to "Completed" with commit SHA. Bump "Last updated."
>
> **Last updated:** 2026-05-25 (plan approved, no code written yet).

---

## 1. Why this dashboard exists

Today, both the scheduler config (8 edit surfaces — testing-services, routine-services, concerns, subcategory-descriptions, subcategory-service-map, question-required-facts, appointment-default-limits, closed-dates) and keytag operations (10 tools — assign / release / revert / markPosted / bulkReconcile / lookupReview / resolveReview / listWip / whoIsOnTag / auditHistory) are driven through Claude Desktop with MD instruction files. That's fine for Chris, but:

- Brittle: any change to instruction files needs MD-aware editing
- Single-operator: only Chris uses Claude Desktop
- No audit trail for "I clicked this button" — only Claude's API logs
- Can't be used from a phone or by a tech with no Claude install

The dashboard replaces the Claude Desktop UX with web forms that call the SAME orchestrator MCP tools. No backend rewrite. Just a frontend with auth.

---

## 2. Locked decisions (from 2026-05-25 design discussion)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Same git repo, sibling folder `admin-app/`** (NOT a new repo, NOT routes inside scheduler-app) | Clean security boundary (customer-facing wizard vs employee-facing admin) + single repo to maintain |
| D2 | **Subdomain `admin.jeffsautomotive.com`** | Cleanest auth scope. Cookie isolation from `appointments.jeffsautomotive.com` |
| D3 | **Microsoft Entra ID OAuth (NOT enterprise SAML SSO)** | FREE on all Supabase tiers. Tenant restriction via tenant URL gives the same lockdown as SAML for our ~5-15 user case |
| D4 | **Web forms call existing typed orchestrator tools directly** | No backend rewrite. The MD files keep working as bulk-upload templates. Single-field edits go through `patch_*` / `upsert_*` tools that already exist |
| D5 | **v1 scope: ALL 18 surfaces** (8 scheduler + 10 keytag) | Tools already exist; the marginal cost per surface is just a form UI |
| D6 | **Single role — everyone with @jeffsautomotive.com gets full access** | Microsoft tenant restriction IS the gate. Audit log captures who-did-what. Add RBAC later if needed |
| D7 | **Copy UI primitives (Button/Card/Field/etc.) into admin-app for v1** | Faster than extracting to `packages/ui` workspace. Extract later when drift cost > extraction cost |
| D8 | **Tenant ID walk-through in Phase A** | Chris will grab tenant ID from Entra admin center when Phase A reaches the auth wiring step |

---

## 3. Architecture

```
Internet
   │
   ├─→ admin.jeffsautomotive.com (NEW Vercel project)
   │     │
   │     ├── Next.js 15 + React 19 + Tailwind (matches scheduler-app stack)
   │     ├── @supabase/ssr (same auth client)
   │     │
   │     └── Server Action ──→ orchestrator MCP edge fn (existing)
   │                            │
   │                            └── Uses SUPABASE_SERVICE_ROLE_KEY (server-side only)
   │                                + passes session.user.email as audit identity
   │
   └─→ appointments.jeffsautomotive.com (existing scheduler-app — unchanged)

Microsoft Entra ID (single tenant: jeffsautomotive.com)
   │
   └─→ Supabase Auth (Azure provider) ─→ admin-app session cookies
```

---

## 4. Folder layout

```
jeffs-app-v2-test-functions/    (existing repo)
├── scheduler-app/               ← existing, unchanged
├── admin-app/                   ← NEW
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── vercel.json
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx       ← nav + requireAdmin shell
│   │   │   ├── page.tsx         ← landing (cards for Scheduler / Keytags)
│   │   │   ├── login/page.tsx   ← "Sign in with Microsoft" button
│   │   │   ├── auth/callback/   ← Supabase Auth callback handler
│   │   │   ├── schedulerconfig/
│   │   │   │   ├── page.tsx     ← index (links to the 8 surfaces)
│   │   │   │   ├── testing-services/page.tsx
│   │   │   │   ├── routine-services/page.tsx
│   │   │   │   ├── concerns/page.tsx
│   │   │   │   ├── subcategory-descriptions/page.tsx
│   │   │   │   ├── subcategory-service-map/page.tsx
│   │   │   │   ├── question-required-facts/page.tsx
│   │   │   │   ├── appointment-default-limits/page.tsx
│   │   │   │   └── closed-dates/page.tsx
│   │   │   └── keytags/
│   │   │       └── page.tsx     ← single page with tabs
│   │   ├── lib/
│   │   │   ├── auth.ts          ← requireAdmin() server helper
│   │   │   ├── supabase/        ← server + client Supabase factories
│   │   │   ├── orchestrator.ts  ← typed wrapper for orchestrator MCP calls
│   │   │   └── ui/              ← copies of Button/Card/Field/Table/Modal
│   │   ├── actions/             ← Server Actions (one file per orchestrator tool group)
│   │   │   ├── scheduler-testing-services.ts
│   │   │   ├── scheduler-routine-services.ts
│   │   │   ├── ... (one per surface)
│   │   │   └── keytags.ts
│   │   └── components/
│   │       ├── nav/
│   │       ├── scheduler/
│   │       └── keytags/
│   └── e2e/                     ← Playwright smoke tests
├── supabase/                    ← existing, unchanged
├── docs/
│   ├── admin-dashboard/
│   │   └── PLAN.md              ← THIS FILE
│   └── scheduler/               ← existing
└── .claude/                     ← existing
```

---

## 5. Phased build

Each phase ends with a working deploy + commit. Stop points for Chris to check in between phases.

### Phase A — scaffold + auth (1-2 days)

1. Create `admin-app/` folder + `package.json` + Next.js config + tsconfig + tailwind
2. Set up `@supabase/ssr` server + client factories (copy pattern from scheduler-app)
3. Create login page with "Sign in with Microsoft" button → `signInWithOAuth({ provider: 'azure' })`
4. Create `/auth/callback/` route handler that completes the OAuth flow
5. Create `lib/auth.ts` → `requireAdmin()` helper checking session + email suffix
6. Create root layout with nav + requireAdmin guard
7. Create landing page (`/`) with cards: Scheduler config + Keytags
8. **Manual steps (Chris):**
   - Microsoft Entra: register app, capture tenant ID + client ID + client secret
   - Supabase Dashboard: enable Azure provider, paste credentials + tenant URL
   - Vercel: create new project rooted at `admin-app/`, set env vars
   - DNS: add `admin.jeffsautomotive.com` CNAME pointing at the new Vercel project
9. Smoke test: deploy → sign in → land on dashboard. PR + merge.

### Phase B — shared UI primitives copied + base layout polish (0.5 day)

1. Copy `Button`, `Card`, `Field` from scheduler-app into `admin-app/src/lib/ui/`
2. Add `Table` (for read views) + `Modal` (for confirmation dialogs) + `Tabs` (for keytag page)
3. Tailwind config matched to scheduler-app's brand (burgundy `#96003C` + gold `#D2B487`)
4. Smoke test deploy.

### Phase C — keytag page (2-3 days)

1. `lib/orchestrator.ts` typed wrapper — adds callOrchestratorTool(toolName, args, { auditEmail })
2. `actions/keytags.ts` — 10 Server Actions wrapping the 10 keytag tools
3. `/keytags/page.tsx` — 5 tabs:
   - Tab 1 (Live state) — list + lookup
   - Tab 2 (Assign / release) — form + Pattern A confirmation modal
   - Tab 3 (Posted / revert) — form + Pattern A confirmation modal
   - Tab 4 (Reconcile) — single button + confirmation
   - Tab 5 (Manual reviews) — lookup + resolve forms
   - Tab 6 (Audit history) — filter form + paginated table
4. Sentry tagging on every Server Action (`shop_id`, `actor_email`, `tool_name`)
5. PR + merge.

### Phase D — top-3 scheduler pages (2-3 days)

The three you edit most:
1. `/schedulerconfig/closed-dates` — calendar picker + reason field + add/remove
2. `/schedulerconfig/appointment-default-limits` — limit per appointment-type form
3. `/schedulerconfig/routine-services` — list + reorder + add/edit/deactivate forms

Each page: read view (table) + edit form + "Save" calls existing tool. PR + merge.

### Phase E — remaining 5 scheduler pages (3-4 days)

1. `/schedulerconfig/testing-services`
2. `/schedulerconfig/concerns`
3. `/schedulerconfig/subcategory-descriptions`
4. `/schedulerconfig/subcategory-service-map`
5. `/schedulerconfig/question-required-facts`

Same shape as Phase D. PR + merge.

### Phase F — bulk MD-upload sections (1 day)

Each scheduler page gets a collapsible "Bulk upload from MD template" section at the bottom:
- Source branch dropdown (default `main`)
- "Preview diff" button → calls `upload_*_md({ dry_run: true })` → renders diff
- "Apply" button → calls `upload_*_md({ dry_run: false, expected_confirm_token: ... })`
- Same flow you use through Claude Desktop today, but with a click instead of a chat turn.

PR + merge.

### Phase G — observability + tests (1 day)

1. Sentry source-map upload wired in `next.config.ts` (copy from scheduler-app)
2. Audit log row written per Server Action (separate from orchestrator's internal logs — captures the dashboard-level intent)
3. Playwright smoke tests:
   - Sign in flow (mocked OAuth)
   - One read action per page
   - One write action per page (with confirmation)
4. PR + merge.

**Estimated total: 10-15 working days.** Phases A+C alone (~5 days) gets keytag dashboard live.

---

## 6. Auth flow detail (for Phase A reference)

```
1. User visits admin.jeffsautomotive.com
   → Server checks Supabase session cookie
   → No session → redirect to /login

2. User clicks "Sign in with Microsoft" on /login
   → supabase.auth.signInWithOAuth({
       provider: 'azure',
       options: { redirectTo: 'https://admin.jeffsautomotive.com/auth/callback' }
     })
   → Browser redirects to login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize?...
   → User signs in with their @jeffsautomotive.com Microsoft account
   → Microsoft tenant check: only this tenant's users allowed (config in Supabase + Entra)

3. Microsoft redirects back to https://itzdasxobllfiuolmbxu.supabase.co/auth/v1/callback
   → Supabase validates the code
   → Supabase issues session JWT
   → Supabase redirects to admin.jeffsautomotive.com/auth/callback

4. /auth/callback route handler in admin-app
   → Exchanges code for session
   → Sets session cookie
   → Redirects to /

5. Subsequent requests
   → Server checks session via @supabase/ssr
   → requireAdmin() verifies email ends with @jeffsautomotive.com
   → Pass → render protected page

6. Server Action calls orchestrator
   → Reads session.user.email server-side
   → Calls orchestrator edge fn with SERVICE_ROLE_KEY (env var, NEVER NEXT_PUBLIC_)
   → Passes user email as the actor identity arg
   → Orchestrator's audit log captures who-did-what
```

---

## 7. Env vars (admin-app Vercel project)

| Name | Where it lives | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + .env.local | Supabase project URL (same as scheduler-app) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + .env.local | Supabase anon key (same as scheduler-app) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel ONLY (NEVER .env.local committed) | Server-side calls to orchestrator MCP |
| `ORCHESTRATOR_MCP_URL` | Vercel | URL of the orchestrator edge function |
| `SENTRY_DSN` | Vercel | Same Sentry project as scheduler-app or separate? (open Q) |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel | Same |

**Setup gotcha (from feedback_vercel_cli_env_bug.md):** Set these via Vercel Dashboard UI, NOT CLI. Vercel CLI 51.x silently stores empty strings (vercel/vercel#16160).

---

## 8. Open items (defer / decide as we go)

| # | Item | Notes |
|---|---|---|
| O1 | Sentry: separate project or share `jeffs-app-v2-vercel` with scheduler-app? | Recommendation: SHARE — admin-app errors get tagged `surface=admin` so they filter cleanly |
| O2 | BotID: needed on admin-app? | No — authenticated app, no SMS-sending surfaces. Skip the BotID dependency entirely |
| O3 | Rate limiting: needed on admin-app? | Probably not for v1 — authenticated employees only. Re-evaluate at first abuse |
| O4 | Visual design beyond brand colors: just lift scheduler-app's look? | Yes for v1. "Same web page design as scheduler" per Chris |
| O5 | RBAC if needed later: how to add? | Future. Add a `dashboard_user_roles` table keyed by email; check role in `requireAdmin()`. Not in v1 scope |
| O6 | Mobile responsive: required for v1? | Bench it — dashboard is primarily for laptops/desktop in shop office. Make it not-broken on phones but don't optimize for phone-first |
| O7 | "Edit history" / "undo" surface: per-row audit view? | Phase G could add this if helpful. Otherwise `getKeytagAuditHistory` covers the keytag side and the scheduler tools' built-in audit log covers the rest |

---

## 9. Self-update protocol

After each phase commit:
1. Move the phase row above from "Phases" to "Completed phases" section (create as needed) with commit SHA + ISO date
2. Bump "Last updated" at top
3. Add new open items to §8 if any surface mid-build
4. Update `NEXT-SESSION-KICKOFF.md` "Today's headline" if the phase landed in a fresh session
