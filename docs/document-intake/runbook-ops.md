# document-intake — ops runbook

> One-time setup + go-live steps. §1 (Microsoft 365) is complete and verified against current docs
> (2026-07-21); later sections get expanded during implement. Plan: `document-intake-plan.md`.

---

## §1 Microsoft 365 setup (the email channel)

**Who can run this:** an account with **Exchange admin** (mailboxes, groups, Exchange RBAC) + at least
**Application Developer** in Entra (app registration). Your global-admin account covers all of it.
**Time:** ~20 minutes of clicking/pasting + up to ~2h of Microsoft-side permission-cache wait before
the final test (documented cache: 30 min–2 h).

Sources (all fetched 2026-07-21): [Create a shared mailbox](https://learn.microsoft.com/en-us/microsoft-365/admin/email/create-a-shared-mailbox)
(doc dated 2026-02, updated 2026-05) · [Register an app in Entra](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
(updated 2026-06) · [RBAC for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
(updated 2026-03).

### 1a. Create the two shared mailboxes (free, no licenses)

1. Go to **admin.microsoft.com** → left nav **Teams & Groups → Shared mailboxes** (click *Show all* if
   you don't see Teams & Groups).
2. **+ Add a shared mailbox** → Name: `Inspection Documents`, email: **inspection@jeffsautomotive.com**
   → Save.
3. Repeat: `Loaner Documents` / **loaner@jeffsautomotive.com**.
4. Members: none required (the app reads them via Graph). *Optional:* add yourself as a member so both
   mailboxes appear in your Outlook for eyeballing what customers send.
5. Leave everything else default. Note: **sign-in is blocked by default** on shared-mailbox accounts —
   that's correct and good; leave it blocked. License-free as long as each stays under 50 GB (no
   archive/litigation hold).

### 1b. Create the mail-enabled security group (the RBAC scope boundary)

This group defines EXACTLY which mailboxes the app may read. Managed in the **Exchange** admin center
(not the M365 Groups page).

1. Go to **admin.exchange.microsoft.com** → **Recipients → Groups → Mail-enabled security** tab →
   **Add a group**.
2. Name: `Document Intake Mailboxes`; email e.g. `docintake-scope@jeffsautomotive.com` (never used for
   mail — it's a scope marker; you can hide it from the address book in its settings).
3. **Members: add exactly `inspection@` and `loaner@`** — nothing else, ever. Adding a mailbox to this
   group = granting the app read access to it (treat membership changes like a permission change).

PowerShell equivalent:
```powershell
New-DistributionGroup -Name "Document Intake Mailboxes" -Alias docintake-scope -Type Security
Add-DistributionGroupMember -Identity docintake-scope -Member inspection@jeffsautomotive.com
Add-DistributionGroupMember -Identity docintake-scope -Member loaner@jeffsautomotive.com
```

### 1c. Register the Entra app (the identity our edge functions use)

1. Go to **entra.microsoft.com** → **Entra ID → App registrations → New registration**.
2. Name: `jeffs-document-intake`. Supported account types: **Single tenant only**. No redirect URI.
   → **Register**.
3. On Overview, copy **Application (client) ID** and **Directory (tenant) ID** → these become
   `GRAPH_CLIENT_ID` / `GRAPH_TENANT_ID`.
4. **Certificates & secrets → New client secret** → description `document-intake`, expiry **24 months**
   (the max). Copy the **Value** immediately (shown once) → becomes `GRAPH_CLIENT_SECRET`.
   **Set a calendar reminder for ~22 months out** — when it expires the email channel stops (loudly:
   the D13 watchdog alerts on auth failures, but don't wait for that).
5. **API permissions: change NOTHING.** Do NOT add Mail.Read here. A permission added on this page is
   tenant-wide (every mailbox); our access comes from the Exchange-scoped grant in 1d. (The default
   delegated `User.Read` line is harmless — ignore it.)
6. You need two IDs from the **Enterprise applications** page (NOT App registrations — the Object IDs
   differ!): Entra ID → **Enterprise apps** → `jeffs-document-intake` → copy **Application ID** and
   **Object ID** for step 1d.

### 1d. Grant scoped mail access (Exchange RBAC for Applications)

In PowerShell (as Exchange admin):

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # once per machine
Connect-ExchangeOnline

# Pointer to the Entra service principal — IDs from step 1c-6 (Enterprise apps page!)
New-ServicePrincipal -AppId <Application ID> -ObjectId <Object ID> -DisplayName "jeffs-document-intake"

# Scope = members of the group from 1b (direct members only; nested groups don't count)
$dn = (Get-Group "Document Intake Mailboxes").DistinguishedName
New-ManagementScope -Name "DocumentIntakeScope" -RecipientRestrictionFilter "MemberOfGroup -eq '$dn'"

# The grant: Mail.Read over ONLY that scope
New-ManagementRoleAssignment -App <Object ID> -Role "Application Mail.Read" -CustomResourceScope "DocumentIntakeScope"

# Proof — run all three:
Test-ServicePrincipalAuthorization -Identity "jeffs-document-intake" -Resource inspection@jeffsautomotive.com | Format-Table  # InScope must be True
Test-ServicePrincipalAuthorization -Identity "jeffs-document-intake" -Resource loaner@jeffsautomotive.com     | Format-Table  # InScope must be True
Test-ServicePrincipalAuthorization -Identity "jeffs-document-intake" -Resource chris@jeffsautomotive.com      | Format-Table  # InScope must be False
```

**Wait up to ~2 hours** (Microsoft's documented permission cache) before the end-to-end test below.

### 1e. End-to-end Graph proof (I run this once secrets are set)

The Exchange cmdlet proves the assignment; this proves the actual Graph calls with the actual token:
1. Client-credentials token for the app → `GET /v1.0/users/inspection@…/mailFolders('inbox')/messages?$top=1`
   → **200**; same against `chris@…` → **403**.
2. `POST /v1.0/subscriptions` on the inspection Inbox → succeeds (this is what the edge fn's bootstrap
   does for real). **Documented fallback if the subscription POST 403s under a pure-RBAC grant** (the
   RBAC docs cover mailbox reads; subscription creation under RBAC-only is the one spot the docs don't
   explicitly promise): add tenant-wide `Mail.Read` **application** permission in Entra (admin consent)
   AND immediately constrain it with `New-ApplicationAccessPolicy -PolicyScopeGroupId
   docintake-scope@jeffsautomotive.com -AccessRight RestrictAccess -AppId <Application ID>` — the
   legacy-but-supported scoping mechanism. Net access is identical (those two mailboxes only); we
   simply prefer the RBAC path and only fall back if Graph demands the Entra grant.

### 1f. Hand-off values

Send me / set as Supabase secrets: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`
(`supabase secrets set … --project-ref itzdasxobllfiuolmbxu`). Everything else (subscriptions,
clientState, cron) is created by the edge function bootstrap — no manual Graph work.

---

## §2 Supabase — ✅ DONE 2026-07-21 (as-built)

- Migrations `20260721180000/180500/181000/181500/190000/200000` applied to `itzdasxobllfiuolmbxu`
  via `supabase db push`. **Standing gotcha:** the held kb-retraining migration
  `20260719130000_kb_retrain_enrichment.sql` (untracked, fails on its own data) must be MOVED OUT
  of `supabase/migrations/` before any `db push`/`migration up` and restored after — it belongs to
  the paused kb-retraining feature.
- Functions `document-intake-email` + `document-intake-agent` deployed, ACTIVE.
- Edge-fn secrets set by Chris: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`
  (expires ~2028-07 — rotation reminder), `AGENT_TOKEN` (Chris holds the value for the shop-PC `.env`).
  Vault: nothing new (the cron reuses the existing `service_role_key` entry).
- Bootstrap: `select public.scheduler_invoke_edge_function('document-intake-email','{"mode":"bootstrap"}'::jsonb)`
  → report `recreated: 2`, zero errors. Both subscriptions live (exp 2026-07-24; daily 10:10 UTC
  cron renews). One orphan Graph subscription for inspection@ from the first (failed) bootstrap
  self-expires ~2026-07-24; its deliveries are rejected+sampled — harmless.
- §1e proof: Exchange RBAC-only grant SUFFICES for subscription creation (no Entra fallback needed);
  `Test-ServicePrincipalAuthorization` chris@ = InScope **False** confirmed by Chris.

## §3 Sentry alert rule — ⏳ DEFERRED (task list)

Dashboard walk-through was skipped 2026-07-21 (guided steps didn't match the current UI). Do it via
the Internal Integration REST API instead (idempotent provisioning per
`.claude/memory/general/sentry_api_and_cli.md`): rule on `jeffs-app-v2-supabase` matching tag
`module=document-intake` → email Chris; then the forced-failure proof (one unauthenticated
`{"mode":"cron"}` POST at the fn → sampled warning → alert email arrives). **Until then, module
failures land in Sentry but email no one** — including the watchdog's "no documents in >4 days"
flag, which will start firing once intake goes quiet (expected while the scan channel is pending).

## §4 Shop-PC scan agent install — ⏳ DEFERRED (task list; full steps in `scan-agent/README.md`)
## §5 Scanner profiles — ⏳ DEFERRED (task list; ScanSnap Home → two network-folder profiles)

## §6 E2E acceptance — email channel ✅ PROVEN 2026-07-21 / scan channel ⏳ with §4-5

Chris emailed a real insurance-card photo to BOTH addresses: processed first-pass (attempts 0,
sub-minute, webhook path), routed to the right profiles, signature logo skipped as `inline_image`,
magic-byte-validated jpeg, `ready` rows with opaque paths + sender captured. Remaining acceptance
when §4-5 land: scan per profile → ready rows; agent heartbeat visible; forced-failure alert email
(§3); unrouted + junk-folder sweep cases as desired.
