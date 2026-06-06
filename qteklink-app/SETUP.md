# qteklink-app — first-time setup

QTekLink (`qteklink.jeffsautomotive.com`) — the Tekmetric → QuickBooks Online sync.
The code is built + green; these are the browser/dashboard steps to make it live.

---

## 0. Key fact: REUSE the existing Entra app — do NOT register a new one

QTekLink shares the **same Supabase project** (`itzdasxobllfiuolmbxu`) as admin-app, and
Supabase supports **one Azure (Entra) provider per project**. So QTekLink authenticates
through the **same Azure app registration** ("Jeff's Automotive Admin Dashboard") that
admin-app already uses. **Authentication is shared; QTekLink is restricted by the in-app
`qteklink_allowed_users` allowlist**, not a separate Azure identity.

> If you ever wanted fully-isolated Entra for QTekLink (its own client id/secret + consent
> screen), that would require a **separate Supabase project** — which is not this design.
> The allowlist gives you the access control without that overhead.

### The one REQUIRED auth change

Add QTekLink's callback to the Supabase **Redirect URLs** allowlist:

1. Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs**
2. Add the **exact** callback, **with the `https://` scheme**:
   `https://qteklink.jeffsautomotive.com/auth/callback`
3. (Optional, Vercel preview deploys only) `https://jeffs-app-v2-test-qteklink-*.vercel.app/**`

> ⚠️ **Use the exact URL + scheme — or you land on the scheduler app.** This Supabase
> project is shared by 3 apps but has ONE **Site URL** (the scheduler). After OAuth,
> Supabase redirects to your `redirect_to` **only if it matches an allow-list entry** —
> otherwise it **falls back to the Site URL** (→ scheduler). Matching is a literal glob on
> the FULL url, and `.`/`/` are separators (`*` won't cross them, `**` will). So a
> scheme-less entry like `qteklink.jeffsautomotive.com/**` does **not** match
> `https://qteklink.jeffsautomotive.com/auth/callback` → wrong app. Use the **exact path
> with `https://`** (Supabase's own production recommendation; the app sends exactly
> `${origin}/auth/callback`). Keep each app's exact callback in the list
> (`https://admin.jeffsautomotive.com/auth/callback`,
> `https://qteklink.jeffsautomotive.com/auth/callback`), and avoid broad patterns like
> `https://*.jeffsautomotive.com/**`. — source: https://supabase.com/docs/guides/auth/redirect-urls

That's the whole auth change. Azure already redirects to the shared
`https://itzdasxobllfiuolmbxu.supabase.co/auth/v1/callback`; the app's `/auth/callback` is a
**Supabase** redirect governed by the allowlist above — so it does **not** need to be added to
Azure's redirect URIs. (admin-app's SETUP added it to Azure too; that's harmless but not
required for this PKCE flow.)

---

## 1. Vercel project (~10 min)

1. Vercel → **Add New → Project** → import `jeffs-app-v2-test-functions` (multiple projects from
   one repo is fine).
2. **Project Name:** `jeffs-app-v2-test-qteklink`
3. **Root Directory: `qteklink-app`** ← critical (otherwise it builds from the repo root).
4. Framework preset: Next.js (auto-detected). Leave build settings default.
5. **Don't deploy yet** — set env vars first (next two sections).

---

## 2. Supabase env vars (Vercel)

Use the **Supabase Vercel integration** (preferred — auto-managed):

- New project → **Storage → Connect Store → Supabase** → choose the existing
  `itzdasxobllfiuolmbxu` (do NOT create a new one).
- It injects `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`, plus the JSON-dict forms. `qteklink-app`'s `resolve-keys.ts` handles
  every variant.
- The **service-role key (`SUPABASE_SECRET_KEY`) is required** — `requireQtekUser()` does the
  allowlist lookup through the service-role admin client (the allowlist is service_role-only).

---

## 3. Sentry (Vercel)

QTekLink is **already code-wired for Sentry** — same setup as admin-app + scheduler-app:
`instrumentation.ts` / `instrumentation-client.ts` / `sentry.server.config.ts` /
`sentry.edge.config.ts`, the PII scrubber, and both error boundaries. The `surface` tag is
`qteklink-app` (vs `admin-app`). You only need the DSN env:

- **Required:** `NEXT_PUBLIC_SENTRY_DSN`
- **Optional (source-map upload):** `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`

Pick one:
- **(Recommended)** Install the **Sentry Vercel integration** on this project; choose a **new
  Sentry project** ("qteklink") for cleaner error separation, OR reuse the existing one (errors
  are still distinguishable by the `surface=qteklink-app` tag).
- **Manual:** copy `NEXT_PUBLIC_SENTRY_DSN` from another project's Vercel env.

Then **Deploy**.

---

## 4. Domain (~10 min)

1. Vercel project → **Settings → Domains → Add** `qteklink.jeffsautomotive.com`
2. Create the CNAME Vercel shows you at your DNS provider (`qteklink` → `cname.vercel-dns.com`).
3. Wait for DNS + auto SSL; refresh until green.

---

## 5. Allowlist (who can log in)

Access is gated by `public.qteklink_allowed_users` (Entra-`oid`-keyed, `role` ∈
viewer/approver/admin, `active`). **chris@jeffsautomotive.com is seeded as `admin`.** The other
tenant members (mike, zane, james) can be added with a role when you want — the in-app
allowed-users management UI lands in a later phase. Until someone is on the list (and `active`),
a real Microsoft login lands on `/login?error=not_allowed` (fail-closed, by design).

---

## 6. Smoke test (~3 min)

1. Incognito → `https://qteklink.jeffsautomotive.com` → should land on `/login`.
2. **Sign in with Microsoft** → sign in as `chris@jeffsautomotive.com`.
3. Bounced through `supabase.co/auth/v1/callback` → `qteklink.../auth/callback` → `/dashboard`,
   showing your email + `admin · shop 7476`.
4. **Sign out** → back to `/login`.
5. (Optional) sign in as a NON-allowlisted Microsoft user → `/login?error=not_allowed`.

---

## Reference

- Entra: https://learn.microsoft.com/en-us/entra/identity-platform/
- Supabase Azure provider: https://supabase.com/docs/guides/auth/social-login/auth-azure
- Vercel monorepo: https://vercel.com/docs/monorepos
- Plan: `docs/qteklink/qteklink-plan.md`. Auth model: §14. App shell + this setup: C0.
