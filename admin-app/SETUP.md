# admin-app — first-time setup

This guide walks Chris through the manual steps required to make admin-app actually work. The code is already pushed; these are the configuration steps that can ONLY be done in browser consoles.

**Estimated time:** 30-45 minutes total.

---

## Step 1 — Microsoft Entra app registration (~10 min)

1. Open **[Microsoft Entra admin center](https://entra.microsoft.com)** (sign in with your @jeffsautomotive.com Microsoft 365 account).

2. **Identity → Applications → App registrations → New registration**

3. Fill in:
   - **Name:** `Jeff's Automotive Admin Dashboard`
   - **Supported account types:** **Accounts in this organizational directory only (Default Directory only — Single tenant)** ← critical for the tenant lockdown
   - **Redirect URI:**
     - Platform: **Web**
     - URI: `https://itzdasxobllfiuolmbxu.supabase.co/auth/v1/callback`
   - Click **Register**

4. On the overview page, **copy three values** (paste them into a temporary scratchpad):
   - **Application (client) ID** — looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - **Directory (tenant) ID** — looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - We'll generate the client secret in step 5

5. **Certificates & secrets → Client secrets → New client secret**
   - Description: `Supabase Auth — admin-app`
   - Expires: **24 months** (Microsoft's max non-custom expiry)
   - Click **Add**
   - **COPY THE VALUE COLUMN IMMEDIATELY** (not the Secret ID column). You can never see this value again — if you lose it, you'll have to generate a new one.

6. (Optional — recommended for production) **API permissions → Add a permission → Microsoft Graph → Delegated permissions** — confirm `User.Read` is present (it's added by default). No admin consent needed for this scope.

You should now have:
- Client ID (tenant ID will also be used for the Supabase config)
- Tenant ID
- Client Secret value

---

## Step 2 — Supabase Auth Azure provider config (~5 min)

1. Open **[Supabase Dashboard](https://supabase.com/dashboard/project/itzdasxobllfiuolmbxu/auth/providers)** for the test project (`itzdasxobllfiuolmbxu`).

2. **Authentication → Providers → Azure** (toggle it on)

3. Fill in:
   - **Azure Client ID:** *(paste the Application (client) ID from Step 1.4)*
   - **Azure Secret:** *(paste the Client Secret VALUE from Step 1.5)*
   - **Azure Tenant URL:** `https://login.microsoftonline.com/<TENANT-ID>` ← paste the Tenant ID from Step 1.4 into the `<TENANT-ID>` slot. THIS IS THE LOCKDOWN — without it, anyone with any Microsoft account could log in.
   - **Skip nonce check:** leave OFF (default)

4. Click **Save**

5. **Verify the callback URL** at the top of the Azure section matches what you put in Microsoft (Step 1.3). Should be `https://itzdasxobllfiuolmbxu.supabase.co/auth/v1/callback`.

---

## Step 3 — Create the Vercel project for admin-app (~10 min)

1. Open **[Vercel Dashboard](https://vercel.com/jeff-s-automotive)** → **Add New → Project**

2. Import the existing repo **`jeffs-app-v2-test-functions`** (you'll have to click `Import` next to it — Vercel allows multiple projects from the same repo).

3. **Configure Project:**
   - **Project Name:** `jeffs-app-v2-test-admin`
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** click **Edit → admin-app** ← critical, otherwise it'll try to build from repo root
   - **Build & Output Settings:** leave defaults (next build → .next)

4. **Environment Variables** — paste these IN THE DASHBOARD UI (NOT via CLI per `feedback_vercel_cli_env_bug.md`):

   | Name | Value | Environments |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://itzdasxobllfiuolmbxu.supabase.co` | All |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | *(copy from scheduler-app Vercel project)* | All |
   | `SUPABASE_SECRET_KEY` | *(copy from scheduler-app Vercel project)* | Production |
   | `SENTRY_DSN` | *(copy from scheduler-app Vercel project)* | All |
   | `NEXT_PUBLIC_SENTRY_DSN` | *(copy from scheduler-app Vercel project)* | All |
   | `SENTRY_ORG` | *(copy from scheduler-app)* | All |
   | `SENTRY_PROJECT` | `jeffs-app-v2-vercel` or new admin-specific project | All |
   | `SENTRY_AUTH_TOKEN` | *(copy from scheduler-app)* | All |

   To copy from scheduler-app: open `jeffs-app-v2-test-functions` project → Settings → Environment Variables, click each one's "•••" → "Edit" to see the value, then paste into the new admin project.

5. Click **Deploy**. First build takes ~2-3 minutes.

---

## Step 4 — Connect the subdomain admin.jeffsautomotive.com (~10 min)

1. In the new Vercel admin project: **Settings → Domains → Add Domain**

2. Enter: `admin.jeffsautomotive.com` → Add

3. Vercel will show you DNS records to create. Most likely:
   - **Type:** CNAME
   - **Name:** `admin`
   - **Value:** `cname.vercel-dns.com`

4. Go to your DNS provider (wherever jeffsautomotive.com is hosted — Cloudflare? GoDaddy? Squarespace?). Add the CNAME record exactly as Vercel specified.

5. Wait ~5-30 minutes for DNS propagation. Vercel will auto-issue a Let's Encrypt SSL cert once it sees the CNAME.

6. **Refresh** the Domains page until you see a green checkmark on `admin.jeffsautomotive.com`.

---

## Step 5 — Update Microsoft Entra redirect URI (~2 min)

Microsoft is currently configured to redirect ONLY to the Supabase callback (which is correct for the OAuth flow). But we also need to allow the final post-callback redirect URL Supabase generates back to admin.jeffsautomotive.com.

1. Back in **Microsoft Entra → App registrations → Jeff's Automotive Admin Dashboard → Authentication**

2. Under **Web → Redirect URIs**, add:
   - `https://admin.jeffsautomotive.com/auth/callback`

3. **Save**

(Why two URIs? The first — `supabase.co/auth/v1/callback` — is where Microsoft drops the user after sign-in. Supabase then redirects to the second — `admin.jeffsautomotive.com/auth/callback` — which is our app's code-exchange handler.)

---

## Step 6 — Smoke test (~5 min)

1. Open `https://admin.jeffsautomotive.com` in an incognito window
2. You should land on `/login`
3. Click **Sign in with Microsoft**
4. You should be bounced to `login.microsoftonline.com` with a Microsoft sign-in prompt
5. Sign in with your @jeffsautomotive.com account
6. You should be bounced through `supabase.co/auth/v1/callback` → `admin.jeffsautomotive.com/auth/callback` → `/`
7. The landing page should show your email in the top right + two cards (Scheduler / Keytags) labeled "Coming soon"
8. Click **Sign out** in the top right. You should land back at `/login`.

**If sign-in fails:**
- "AADSTS50194: Application '...' is not configured as a multi-tenant application" → check Step 1.3, you may have selected "Single tenant" instead of "Accounts in this organizational directory only" (those are the same thing in modern UI; verify by reloading)
- "AADSTS650056: Misconfigured application" → the redirect URI in Microsoft doesn't match the one Supabase is sending. Double-check Step 5.
- "AADSTS500011: The resource principal named ... was not found" → tenant ID in the Supabase Azure Tenant URL field is wrong. Re-check Step 2.3.
- Lands at `/login?error=unauthorized_domain` → your email's domain isn't @jeffsautomotive.com (it might be a personal MS account if you accidentally selected the wrong one at the Microsoft sign-in screen). Sign out from Microsoft entirely and retry.

---

## What's next after Phase A smoke test

Phase A is done when the smoke test above passes. Then:

- **Phase B** (0.5 day): UI primitives polish (already done in this code drop, just need to verify they look right against the landing page)
- **Phase C** (2-3 days): Build the Keytags page — single page with 5 tabs (live state, assign/release, posted/revert, reconcile, manual reviews, audit history). All 10 keytag tools wired.
- **Phase D** (2-3 days): The 3 most-used scheduler edit surfaces — closed-dates, appointment-default-limits, routine-services.
- **Phase E** (3-4 days): Remaining 5 scheduler edit surfaces.
- **Phase F** (1 day): Bulk MD upload sections.
- **Phase G** (1 day): Playwright smoke tests + observability polish.

See `docs/admin-dashboard/PLAN.md` for the full phase breakdown.

---

## Reference

- Microsoft Entra docs: https://learn.microsoft.com/en-us/entra/identity-platform/
- Supabase Azure provider: https://supabase.com/docs/guides/auth/social-login/auth-azure
- Vercel monorepo: https://vercel.com/docs/monorepos
- DON'T use `vercel env add` for setting env vars — see `feedback_vercel_cli_env_bug.md`
