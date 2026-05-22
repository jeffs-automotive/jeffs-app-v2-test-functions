---
plan: 07
title: Operational + pre-launch infrastructure
audit_findings: [I-OTH-1, I-OTH-2, I-OTH-4, P1, P2]
research_inputs: [research-supabase-postgres, research-security-hardening]
estimated_effort: 2 days
prerequisites: []
risk_level: low
---

# Plan 07 — Operational + pre-launch infrastructure

> Cleanup + pre-launch infrastructure. Most of this is straightforward but easy to forget. Includes DNS mapping for `appointments.jeffsautomotive.com`, performance advisor follow-ups, .env hygiene, and Sentry Seer enablement decision.

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **P1** | pre-launch | `appointments.jeffsautomotive.com` NOT mapped to Vercel | 1 |
| **I-OTH-2** | perf | Auth DB connections using absolute (10), should be percentage-based | 2 |
| **I-OTH-1** | perf | 2 unindexed FKs (`keytag_manual_reviews.resolution_audit_log_id`, `oauth_refresh_tokens.parent_token_hash`) | 2 |
| **I-OTH-4** | hygiene | `scheduler-app/.env.local.bak-*` lingering on disk (3.6KB secrets, gitignored but unnecessary surface) | 3 |
| **P2** | sentry | 4 stale Sentry issues to resolve (covered partially in Plan-02 Phase 2B) | 3 |
| _bonus_ | obs | Sentry Seer GitHub integration (Phase 2 decision) | 4 |

## Research summary

- **Sentry Seer** is $40/active-contributor/month (changed Jan 2026 — no longer per-PR). Solo Chris = predictable $40/mo. GitHub-only (cloud OR Enterprise). Auto-RCA runs only on "high confidence" issues. **Source code IS transmitted to LLM provider** for RCA — Sentry policy says "no training" but doesn't preclude transmission. Recommendation: wait until 2-3 modules ship in production before enabling; start with PR auto-generation OFF (analysis only). [sentry-observability §7]
- **Supabase Auth percentage-based connections** — Supabase doc recommendation. Allows increasing instance size to scale auth without manually adjusting the cap. [supabase-postgres §1]

---

## Phase 1 — Custom domain mapping (P1, ~1 hour)

**Goal:** Map `appointments.jeffsautomotive.com` to the Vercel project. Right now only `*.vercel.app` URLs work.

**Steps:**

1. **Vercel dashboard:**
   - Project → Settings → Domains
   - Add `appointments.jeffsautomotive.com`
   - Note the CNAME or A record Vercel provides (usually `cname.vercel-dns.com.`)

2. **DNS provider** (likely GoDaddy, Cloudflare, or Route53 — whichever hosts `jeffsautomotive.com`):
   - Add CNAME: `appointments` → `cname.vercel-dns.com.` (TTL 3600)
   - OR A record per Vercel's instructions

3. **Verify:**
   ```bash
   dig +short appointments.jeffsautomotive.com
   # expects: cname.vercel-dns.com.
   ```
   Or: `curl.exe -I https://appointments.jeffsautomotive.com/` → expects 200 from Vercel

4. **Wait for cert provisioning** (5-30 min for Let's Encrypt). Vercel dashboard shows the cert status.

5. **Update CSP** in `scheduler-app/next.config.ts` (per Plan 03 Phase 5) if domain is referenced anywhere.

6. **Update `_shared/fetch-template-from-repo.ts`** — confirm any URL constants don't need updates (likely fine since it points to raw.githubusercontent.com).

**Verification:**
1. `curl.exe -I https://appointments.jeffsautomotive.com/book-v2/` → 200 (or whatever the wizard returns)
2. https://securityheaders.com/?q=appointments.jeffsautomotive.com → rating ≥ B (will be A after Plan 03 Phase 5)
3. https://www.ssllabs.com/ssltest/analyze.html?d=appointments.jeffsautomotive.com → grade A+

**Risk + rollback:**
- LOW. DNS change is reversible (remove CNAME). Vercel domain mapping is also reversible.

---

## Phase 2 — DB performance follow-ups (I-OTH-1 + I-OTH-2, ~1 hour)

### Phase 2A — Add 2 covering indexes for unindexed FKs

**Migration:**
```sql
-- supabase/migrations/20260522NNNNNN_unindexed_fk_covers.sql
BEGIN;

CREATE INDEX IF NOT EXISTS keytag_manual_reviews_resolution_audit_log_id_idx
  ON public.keytag_manual_reviews (resolution_audit_log_id)
  WHERE resolution_audit_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_parent_token_hash_idx
  ON public.oauth_refresh_tokens (parent_token_hash)
  WHERE parent_token_hash IS NOT NULL;

COMMIT;
```

**Verification:**
1. Apply migration
2. `mcp__supabase__get_advisors type=performance` → no longer flags these 2

### Phase 2B — Auth DB connections percentage-based

**Steps:**
1. Supabase dashboard → Project Settings → Auth → Connection Pooling
2. Switch from absolute (currently 10) to percentage (recommended: 25-50% of pool depending on instance size)
3. No migration needed — it's a dashboard setting

**Verification:**
1. `mcp__supabase__get_advisors type=performance` → no longer flags `auth_db_connections_absolute`
2. Auth flow still works (probe via `mcp__supabase__execute_sql` `SELECT now();` via auth client)

**Risk + rollback:**
- LOW. Easily reverted in dashboard.

---

## Phase 3 — Cleanup (I-OTH-4 + P2, ~30 min)

### Phase 3A — Delete `.env.local.bak-*` files

**Files to remove:**
- `scheduler-app/.env.local.bak-1779116875` (and any sibling backup files)

**Steps:**
1. Verify file is gitignored (it is, but confirm)
2. `rm scheduler-app/.env.local.bak-*`
3. Audit Vercel + Supabase secrets to ensure the live values are stored correctly
4. Document in `.env.example` (if it exists per Plan 03) which vars each environment needs

### Phase 3B — Resolve 4 stale Sentry issues

Plan 02 Phase 2B downgrades the captureMessage calls. Once that ships, also resolve the stale issues:

**Sentry dashboard:**
- Issue K (AI Gateway 401) — Resolve as "fixed in next release" since the env var was added
- Issue J (runDiagnostics → second_routine_pass) — Resolve, will not surface again after Plan-02 fix
- Issue G (runDiagnostics → clarification_question) — same
- Issue A (submit_summary verify mismatch) — Plan 04 Phase 4 changes the handling; resolve with comment "behavior changed in Plan 04"

**Verification:**
- Sentry Issue stream for project `jeffs-app-v2-test-functions` shows 0 unresolved

---

## Phase 4 — Sentry Seer enablement (decision, ~30 min)

**Decision required:** enable Seer now or wait?

**Research recommendation:** wait until 2-3 modules ship in production before enabling. With Chris as solo dev, Seer's value-per-month ($40) is high IF errors actually surface. Pre-launch, we have basically zero production errors — Seer would have nothing to triage.

**Recommendation:** **DEFER** to post-launch. Re-evaluate 30 days after first real customer traffic. At that point:
1. Sentry → Project Settings → Seer → enable
2. Connect GitHub repo (jeffs-automotive/jeffs-app-v2-test-functions)
3. Start with "Analysis only" (NOT auto-PR generation) for first 2 weeks
4. After 2 weeks, evaluate whether suspect-commit links are useful → consider enabling auto-PR

**Track:** add to a new `docs/scheduler/POST-LAUNCH-CHECKLIST.md`:
```markdown
- [ ] 30 days post-launch: evaluate Sentry Seer enablement
```

---

## Sequence with other plans

- Independent of Plans 02, 03, 04, 05, 06.
- Phase 1 (DNS) should happen ONLY when all Tier-1 work is complete (don't expose a buggy app to a public domain).

## Open questions for Chris

1. **DNS provider:** GoDaddy / Cloudflare / Route53 — which one?
2. **Auth DB connections percentage:** 25% or 50%? Larger = more headroom for traffic spikes but less for other DB work
3. **Sentry Seer:** confirm DEFER to post-launch?

## Success criteria

- [ ] `appointments.jeffsautomotive.com` returns 200 with valid HTTPS cert
- [ ] securityheaders.com rating ≥ A on the domain
- [ ] Supabase advisors show 0 performance warnings on unindexed FKs + auth connections
- [ ] `.env.local.bak-*` files deleted from disk
- [ ] 0 unresolved Sentry issues in `jeffs-app-v2-test-functions` project
- [ ] `POST-LAUNCH-CHECKLIST.md` exists with Seer evaluation reminder

**Estimated effort:** 2 days.
