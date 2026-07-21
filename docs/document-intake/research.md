# document-intake — research notes (2026-07-21)

> Feature: scan + email ingestion of documents (first: insurance cards + registration cards) into
> Supabase Storage buckets, with per-profile routing shared by BOTH channels. Consumers: the
> upcoming state-inspection record-keeping app (insurance + registration) and loaner-vehicle app
> (insurance). Session context: Chris bought a Ricoh ScanSnap iX2500; PC-free network-folder mode
> (firmware ≥0J00, searchable-PDF since the 2026-03 update) writes to an SMB share; a Windows
> agent on the shop PC uploads to Supabase. Email channel: originally scoped as Resend inbound on a
> receiving subdomain (see the Resend facts below), **superseded 2026-07-21 by Microsoft Graph on the
> root-domain mailboxes — see the Addendum**; Resend remains send-only. This doc records what was
> verified before planning.

## Decision context carried in from the consulting phase (this session)

- iX2500 network-folder mode is fully local (on-device OCR, no Ricoh cloud, no OAuth). Caveats:
  needs NTP egress; no auto file naming in that mode; changing a profile's display-users setting
  resets its stored SMB credentials. Sources: pfu.ricoh.com news20251015-1 + news20260303.
- Chris accepts a PC hosting the share + agent. Requirement: **works with nobody logged in,
  any time the PC is on** → Windows Service (or Task Scheduler "whether user is logged on or
  not"), plus never-sleep power config. A sleeping PC cannot serve SMB — that's physics, noted
  in the runbook.
- ScanSnap Mail (300/mo cap) and OneDrive paths were considered and dropped in favor of
  scan→SMB→agent; email channel is Resend inbound (no vendor cloud caps that matter here).

## Repo facts (verified by reading)

| Fact | Evidence |
|---|---|
| **No Supabase Storage usage exists anywhere in the repo** — no `storage.from(` hits; `storage.buckets` in the live test project is EMPTY. | Grep + `execute_sql` 2026-07-21 |
| Storage + **S3 protocol already enabled** in local config (`[storage.s3_protocol] enabled = true`, `file_size_limit = "50MiB"`). | `supabase/config.toml:111-125` |
| Edge-fn auth convention: `verify_jwt = false` + in-handler auth (Pattern A bearer, `?token=`, or vendor signature). Every function has a rationale comment in config.toml. | `supabase/config.toml` (all `[functions.*]` blocks) |
| Webhook receiver contract: **store, THEN 200**; duplicate = 200 `{ok:true, duplicate:true}`; 5xx only when we genuinely can't store. Layered auth: `?token=` constant-time + signature verify-if-present. | `supabase/functions/telnyx-webhook/index.ts:1-40` |
| DB idempotency pattern: per-provider `*_webhook_events` table + generated `event_hash` + partial UNIQUE; receivers upsert `{onConflict, ignoreDuplicates}`. | `supabase/migrations/20260522191500_webhook_event_idempotency.sql` |
| Recent module convention (back-office, 2026-07-17): `shop_id integer NOT NULL` (Tekmetric id; Jeff's = 7476), kind/status CHECK constraints, `context jsonb`, deny-all RLS (service-role only), writes via SECURITY DEFINER RPCs, BIGINT cents, TIMESTAMPTZ, uuid PKs. | `supabase/migrations/20260717170000_back_office_issues.sql` |
| Sentry: every edge fn wraps handler in `withSentryScope(req, surface, fn)` (isolation scope + flush + PII scrub incl. `?token=` query secrets). | `supabase/functions/_shared/sentry-edge.ts` |
| Resend send transport already shared: `_shared/resend-client.ts` (`RESEND_API_KEY`, Idempotency-Key, 409=deduped success). Receiving is NOT set up anywhere yet. | `supabase/functions/_shared/resend-client.ts` |
| Secret-key resolution helper exists: `_shared/resolve-secret-key.ts` (sb_secret format — legacy service-role key is revoked per memory `supabase-secret-key-not-legacy`). | `telnyx-webhook/index.ts:44` |
| Stack memory already anticipated this feature: "OCR (insurance, registrations, VINs)" listed as a future AI use case → intake now, OCR later. | `.claude/memory/general/project_stack.md:47` |
| Migrations naming `YYYYMMDDHHMMSS_snake.sql`, `BEGIN/COMMIT`, IDEMPOTENT (IF NOT EXISTS), COMMENT ON. | recent migrations |

## Vendor facts (verified via docs/web, 2026-07-21)

### Supabase Storage
- **S3-compatible endpoint is GA**: `https://<ref>.supabase.co/storage/v1/s3` (or `<ref>.storage.supabase.co`); auth via dashboard-generated **S3 access key + secret** (Storage → Configuration → S3) — credentials authenticate only the Storage S3 interface, i.e. a far smaller blast radius than the project secret key if the shop PC is ever compromised. Docs: supabase.com/docs/guides/storage/s3/{compatibility,authentication}.
- **Uploads insert rows into `storage.objects`** — official example wires a Database Webhook on `storage.objects` INSERT → edge function (Hugging Face image-captioning guide). Database Webhooks = pg_net-backed AFTER triggers; a plain AFTER INSERT trigger on `storage.objects` writing to a public table is equally supported mechanics (webhooks are "just a convenience wrapper around triggers"). Docs: guides/database/webhooks, guides/ai/examples/huggingface-image-captioning.
- Project upload size limit is configurable (local config uses 50MiB); bucket-level `file_size_limit` + `allowed_mime_types` exist per bucket.

### Resend inbound (receiving)
- Receiving = **MX record on a subdomain** (recommended when root domain already has MX — ours does: Microsoft 365) with lowest priority value; then ANY address at that domain is received (catch-all); route by `to`. Docs: resend.com/docs/dashboard/receiving/introduction, custom-domains, how-do-i-avoid-conflicting-with-my-mx-records.
- Webhook event **`email.received`** carries metadata ONLY (from/to/subject + attachment `{id, filename, content_type}`); body + attachments fetched via API: `GET /emails/receiving/{emailId}` (html/text/headers), `GET /emails/receiving/{emailId}/attachments` → items with **`download_url` (signed, expiring) + `size`**. Re-list to refresh expired URLs. Source: resend-skills/references/receiving.md (official repo).
- Webhooks are **svix-signed** (`svix-id`/`svix-timestamp`/`svix-signature`, `RESEND_WEBHOOK_SECRET`); verify or reject. Docs: resend.com/docs (webhooks).
- Inbound size limits are NOT documented precisely — treat as unknown; agent-side guard + skip-with-flag for oversized attachments. (Sending path caps at 40MB total per Resend docs; assume receiving is in that ballpark, verify empirically during E2E.)

### Windows always-on agent
- NSSM: no stable release in ~a decade. WinSW: maintenance limbo. **node-windows**: actively used (winsw-based under the hood), npm-native, installs a real Windows Service (auto-start at boot, runs with nobody logged in). Modern alternative: Servy. Sources: dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46, npmtrends, github coreybutler/node-windows.
- Fallback needing zero third-party: Task Scheduler task, trigger At startup, "Run whether user is logged on or not".
- Sleep: no software runs while the OS is suspended; the SMB share is also down → scanner-side save fails. Runbook must set `powercfg` never-sleep (display off is fine).

## Constraints & rules that bind the design

- `shop-agnostic.md`: shop config belongs in the DB → profile routing lives in a table, not code.
- `observability.md`: no silent failures; cron/trigger bodies wrap in EXCEPTION→error-log; every Supabase call checks `error`; Sentry tags incl. `shop_id`.
- PII: cards are PII-heavy → **private bucket only**, service-role/deny-all RLS on tables, no card data extracted to DB in v1 (OCR is a later feature), Sentry scrubbing already in place.
- TDD: pgTAP (row counts, not exceptions) + Deno tests per fn + Vitest for agent logic.
- Deploys: CLI only (`supabase db push`, `functions deploy`); MCP for read-verify.

## Addendum 2026-07-21 — email channel moved to Microsoft Graph (Chris: "prefer our domain")

Verified before the D7 rewrite:

- **Resend account state (via Resend MCP):** one domain `jeffsautomotive.com` — verified, Sending enabled, **Receiving disabled**. Receiving would require Resend to own the domain's MX; the root MX is Microsoft 365's (company mail) → root-domain receiving via Resend is impossible without a subdomain + forwarding hop. Also found: a pre-existing enabled webhook `email.received` → `https://yrufavkcxdrlqrqlzvpt.supabase.co/functions/v1/document-ingest-email` (created 2026-03-11, unknown Supabase project — flagged to Chris; delete pending his ID).
- **Graph change notifications** (learn.microsoft.com/graph/change-notifications-overview, doc updated 2026-04): Outlook `message` subscriptions — resource `/users/{id}/messages` (or `mailFolders('inbox')/messages`), basic notifications carry ids only (pull model), **max lifetime 10,080 min (<7 days)** (1,440 min for rich notifications — not used), latency <1 min avg / 3 min max, lifecycle notifications (`reauthorizationRequired`, `subscriptionRemoved`, `missed`) supported, webhook delivery with validationToken handshake + clientState (details: change-notifications-delivery-webhooks).
- **Mailbox scoping** (learn.microsoft.com/exchange/permissions-exo/application-rbac, doc updated 2026-03): **RBAC for Applications replaces Application Access Policies.** Grant `Application Mail.Read` via `New-ServicePrincipal` + `New-ManagementScope` (e.g. MemberOfGroup filter on a mail-enabled security group) + `New-ManagementRoleAssignment -CustomResourceScope`; verify with `Test-ServicePrincipalAuthorization`. Critical FAQ note: do NOT also consent tenant-wide Mail.Read in Entra — grants are a UNION, an unscoped Entra grant would defeat the Exchange scope. Permission cache propagation 30 min–2 h.
- Consequence: no DNS work at all; Resend stays send-only; fallback (Resend inbound on `scans.` subdomain + M365 forwarding + external-forwarding policy exception) stays documented here if Graph is ever abandoned.

## Open items going into plan

1. Naming defaults proposed: bucket `vehicle-docs`; profiles `inspection_docs` (insurance+registration → state-inspection app) + `loaner_insurance`; receiving domain `scans.jeffsautomotive.com`; addresses `inspection@` + `loaner@`. Chris may rename.
2. Which shop PC hosts the share + agent (needed at install time, not for the plan).
3. Local uploaded-copy retention (default 30 days) + accepted types (pdf/jpeg/png + heic pass-through).
4. Watchdog ("no docs received in X days" + agent heartbeat) — scoped as fast-follow phase, not v1 blocker.
