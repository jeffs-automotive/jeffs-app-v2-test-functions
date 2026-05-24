# Scheduler-app — next session kickoff

> **Last refreshed:** 2026-05-24 end-of-session.
> **Refresh this file** at the end of EVERY session that did scheduler-app work — same commit that bumps `scheduler_system_architecture.md`. Keep the "Today's headline" + "Next-step todos" sections current.

---

## 1. Read these FIRST (in order, before any work)

| # | File | Why |
|---|---|---|
| 1 | `.claude/memory/MEMORY.md` | Sandbox orientation (test project `itzdasxobllfiuolmbxu`, NOT prod `lrsazdxnbtjczpvngcud`). Indexes every other memory file. |
| 2 | `.claude/memory/scheduler/scheduler_system_architecture.md` | THE canonical map: routes, edge fns, RPCs, crons, migrations chronological (§8.3), Sentry surface, RLS, deferred items. Required reading before touching anything in scheduler-app/ or scheduler-related Supabase code. |
| 3 | `docs/scheduler/REMEDIATION-PROGRESS.md` | Per-phase status of the 7 remediation plans. Where each phase landed (commit SHA), what's still open. Update in the SAME commit that closes a phase. |
| 4 | `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` | Living backlog. ALWAYS check this before flagging "new" findings — most of what you'll spot is already tracked. |
| 5 | `.claude/memory/general/sentry_api_and_cli.md` | When the Sentry MCP doesn't cover a use case, the Internal Integration Auth Token surface (cron monitors list, check-ins, alert rules). |

These five files give you the full picture. If you find yourself guessing about scheduler state, you missed one of them.

---

## 2. Today's headline (2026-05-24)

**Shipped (10 commits across 2 repos):**

1. Sentry cron pair-by-id fix (migration `20260524210000`, commit `3d9de2d`) — resolved `monitor_check_in_failure` issues on all 4 monitored crons by re-adding `check_in_id` to both POST + GET legs so pg_net's async delivery order doesn't break Sentry's pairing
2. OBS-8 flipped to RESOLVED in `DEFERRED-AUDIT-ITEMS.md` (commit `c87ea5c`) — Vault `sentry_dsn` populated + 9/9 cron checkins succeeding
3. PLANS-MASTER refresh + new `REMEDIATION-PROGRESS.md` (commit `894cfae`) — Plans 01/02/03 marked COMPLETE
4. Plan 04 Phase 1A — `apply_wizard_transition` RPC (commit `5d8a122`) — atomic 3-write wizard step advance. Closes I-COR-1. 13 new tests + 12 refactored. 167/167 unit suite passes.
5. Cleanup: root-level `botid` stray removed (no commit — pure revert); root `package.json` + `deno.lock` back to clean state
6. Architecture memo bumped 4× in dotfiles repo

**Plans state:**

- ✅ **Plans 01, 02, 03** — COMPLETE
- 🟡 **Plan 04** — IN PROGRESS (1 of 8 phases done)
- 🔜 **Plans 05, 06, 07** — NOT STARTED

---

## 3. Next-step TODOs (priority order)

### Tier A — confirm yesterday's work (do FIRST, in this order)

1. **[~5 min]** Check tomorrow's (now today's) daily cron fires — `keytag-bulk-reconcile` at 10:00 UTC and `keytag-daily-report` at 11:00 UTC. Query Sentry for any new `monitor_check_in_failure` issues on JEFFS-APP-V2-SUPABASE-B or -D. If clean: leave them resolved. If new failure event: the pair-by-id fix is wrong and we need to investigate further.
2. **[~5 min]** Spot-check the live wizard surface. The `apply_wizard_transition` RPC just shipped — exercise one complete booking flow at `appointments.jeffsautomotive.com` (greeting → phone → name → vehicle pick → service pick → date pick → confirm). If anything regresses, revert commit `5d8a122` immediately.
3. **[~2 min]** Confirm `vault.secrets.sentry_dsn` is still populated. Query: `SELECT name, created_at FROM vault.secrets WHERE name = 'sentry_dsn';` via Supabase MCP. Should return the row created at `2026-05-24 17:24:22Z`.

### Tier B — Plan 04 Phase 1B (the natural next step)

**Phase 1B: `hydrate_session_reset` RPC** — atomic 4-write reset for stale-session detection in `scheduler-app/src/lib/scheduler/hydrate-session.ts`. Same shape as Phase 1A (RPC-wrap the existing inline writes) but for the stale-session-detected-at-hydrate path instead of the per-step-advance path.

**Before writing any code:**
- Read `docs/scheduler/plans/PLAN-04-atomicity-correctness.md` Phase 1B (lines ~154-260) — full spec is there
- Grep ALL callers that depend on the existing inline `hydrate-session.ts` writes for explicit-null clear semantic patterns BEFORE writing the migration. This is the lesson from Phase 1A — DO NOT skip the audit
- Use the CASE pattern (`CASE WHEN p_payload ? 'col' THEN ... ELSE col END`), NOT `COALESCE(..., col)` — the latter silently no-ops explicit-null clears (cost us ~30 min mid-execution on Phase 1A)
- The hydrate-session caller has a different shape than transition.ts — it doesn't take bubbles, just performs the reset. Simpler RPC signature

**Estimated:** 0.5 day. The pattern from Phase 1A applies directly.

### Tier C — Plan 04 remaining phases (any order; 5 phases × ~3-4 hr each)

| Phase | Scope | Reference |
|---|---|---|
| 2 | `submit-summary` hold CAS lock — prevent mark-abandoned race | PLAN-04 §Phase 2 |
| 3A | `submit-vehicle-pick` IDOR validation — verify vehicle_id is in customer's vehicles | PLAN-04 §Phase 3A |
| 3B | `submit-multi-account-choice` IDOR validation — verify customer_id is in `pending_candidates` | PLAN-04 §Phase 3B |
| 4 | `submit-summary` verification-mismatch 3-state envelope (pending → confirmed \| needs_review) | PLAN-04 §Phase 4 |
| 5 | `WIZARD_REVALIDATE_PATHS` scope reduction — replace path-revalidate with `revalidateTag(\`session-${id}\`)` (closes I-OTH-3) | PLAN-04 §Phase 5 |
| 6 | FK `ON DELETE CASCADE` rationale audit + early-migration idempotency docs (I-COR-7 + I-COR-8) | PLAN-04 §Phase 6 |

### Tier D — passive / waiting

- **`sentry-webhook` HMAC end-to-end verification** — receiver is deployed but no Sentry-signed delivery has landed yet. Query `SELECT * FROM sentry_webhook_events WHERE signature_verified = true LIMIT 1;` periodically. When the first one appears (organic — Sentry delivers when something the integration subscribes to fires), the loop is closed.
- **SEC-7 BotID activation** — deferred to pre-launch per `DEFERRED-AUDIT-ITEMS.md` SEC-7. Don't activate until customers are about to start hitting the live URL. The Vercel BotID dashboard is the click-to-enable surface.

### Tier E — open audit items NOT in Plan 04

These live in `DEFERRED-AUDIT-ITEMS.md` and are smaller-scope. Pick them when waiting for input or as warm-ups:

- **CLN-3** — hardcoded `shop_phone: "6102536565"` across multiple files (shop-agnostic rule violation; ~1 hr)
- **CLN-6** — `maxDuration: 300` not set on most route handlers (~1 hr)
- **MD-2** — `exhaust_system_testing` not linked to Tekmetric `canned_job` (content/docs, ~30 min)
- **OBS-1** — `logError` coverage on remaining 13 V2 actions (~2 hr observability sweep)
- **OBS-3** — extend `withSentryScope` wrap to the 10 remaining edge functions (~2 hr)

---

## 4. How to update yourself on scheduler-app state

| Question | Where to look |
|---|---|
| "What's the current schema?" | Query the live DB via Supabase MCP `list_tables` / `execute_sql` against `itzdasxobllfiuolmbxu` |
| "What was the most recent migration?" | `mcp__e22e5047-114c-47dc-9037-4e833e454fc0__list_migrations` OR `git log --oneline supabase/migrations/` |
| "What edge functions are deployed?" | `mcp__e22e5047-114c-47dc-9037-4e833e454fc0__list_edge_functions` |
| "What does X edge function source look like?" | Read `supabase/functions/X/index.ts` directly |
| "What Sentry issues are open?" | `mcp__sentry__search_issues` with `is:unresolved` and `projectSlug: "jeffs-app-v2-supabase"` |
| "What plans are done?" | `docs/scheduler/REMEDIATION-PROGRESS.md` "At a glance" table |
| "What deferred items are still open?" | `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` — search for "DEFERRED" or "active" in headers; "RESOLVED" items are closed |
| "What's the architecture?" | `.claude/memory/scheduler/scheduler_system_architecture.md` |
| "What's the test sandbox vs prod story?" | `.claude/memory/test-project-info.md` (NOT autoloaded; read explicitly if confused) |
| "Where do I find the cron schedules?" | `SELECT jobid, jobname, schedule, command FROM cron.job;` via Supabase MCP |

---

## 5. Self-update protocol (when YOU make a change)

The architecture doc has a "When you make a change" trigger table at the bottom that maps touched-files → sections-to-update. Use it.

**Rule:** Update memos in the SAME commit that changes scheduler-app code/schema/edge fns/crons/Vercel/Sentry. Bump `scheduler_system_architecture.md`'s frontmatter "Last updated" line every time. The git history shows the diff; the memo describes the current shape.

**Phase commits (Plan 04+):**
1. Write the code/migration
2. Run typecheck + tests
3. Apply migration via CLI (`supabase db push --linked`)
4. Bump `scheduler_system_architecture.md` (frontmatter date + §8.3 row if a new migration)
5. Update `REMEDIATION-PROGRESS.md`:
   - Move the phase row from "Remaining" to "Completed" with the commit SHA
   - If the whole plan completes: flip the "At a glance" status to ✅ COMPLETE + date
6. Refresh THIS file (`NEXT-SESSION-KICKOFF.md`) — bump "Today's headline" + "Next-step TODOs"
7. Stage all related files (test-functions repo) + the memo (dotfiles repo) separately
8. Two commits: one in each repo, with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer
9. Push both

**Deferred-item lifecycle:**
- Spot a finding → add to `DEFERRED-AUDIT-ITEMS.md` under the right category section (NEW {ISO}). Don't track ad-hoc in conversation; session todo evaporates
- Resolve a finding → flip the section header to `— RESOLVED {ISO}`, append a "Resolution" paragraph with the commit SHA, leave the historical context intact

---

## 6. Critical lessons from the prior session (apply these from turn 1)

1. **Audit BEFORE you swap.** Before changing the persistence shape of any helper that has N callers, grep all N for the patterns you might break (explicit `null` in payloads, references to fields you're stripping, etc.). I learned this the hard way on Plan 04 Phase 1A — discovered the COALESCE-vs-CASE issue mid-execution because I hadn't checked which callers use `updates: { col: null }`. The fix was cheap because the migration wasn't applied yet, but it cost ~30 min of rework + a test-suite regression. The user's pushback ("check everything before you make changes") was correct.

2. **CASE-WHEN-? not COALESCE for partial JSONB-driven updates.** `COALESCE((p_payload->>'col')::TYPE, col)` preserves the prior value when `p_payload->>'col'` is SQL NULL — which happens BOTH when the key is absent AND when the value is JSONB null. The `.update({ col: null })` semantic (which 6 callers depend on) is "clear column to SQL NULL" — that's served by `CASE WHEN p_payload ? 'col' THEN (p_payload->>'col')::TYPE ELSE col END`. JSONB and ARRAY columns need an extra `jsonb_typeof(value) = 'null'` arm to map JSONB null → SQL NULL.

3. **Sentry cron pairing is by `check_in_id`, NOT by `monitor_slug + recency`.** When pg_net delivers in non-deterministic order (which it does, because async batching), Sentry can't pair in_progress + ok by recency alone. The `sentry_cron_checkin` RPC carries `check_in_id` on BOTH the POST upsert and the GET close-out for this reason. If you ever rewrite that function, preserve this — see migration `20260524210000` header comment for the failure mode.

4. **Plan specs may be stale.** Plan 04 was authored 2026-05-22. The 2026-05-23 date-picker fix changed wizard transition behavior in a way that conflicted with Plan 04 Phase 1A's spec (the `WHERE status = 'active'` guard). Always reconcile the plan spec against the latest deployed behavior BEFORE writing code. If conflict: surface to Chris with explicit option list; don't silently deviate.

5. **Sub-agents are 1-shot. Write to `.tmp/agent-output/{name}/`. They CAN read `.tmp/` but NOT `.claude/work/`.** When delegating work, inline the context they need (file paths, schemas, prior decisions) — they can't poke around the same way the orchestrator can. After they return, the orchestrator copies their output to canonical paths.

6. **Auto-mode classifier blocks specific operations.** Anything that reads `.env*` is blocked at the tool layer. Setting Supabase secrets autonomously is blocked unless the user explicitly authorizes for the session. Pushing to main on the dotfiles repo MAY be blocked depending on classifier mood — defer to user-explicit when blocked.

7. **Never-guess rule applies retroactively too.** If something looks like an inconsistency between docs and live state, the live state wins — flag the doc as needing an update, don't silently align in either direction.

---

## 7. Final wrap-up state (working directory snapshot)

- `scheduler-app/package-lock.json` — modified (CLN-11 churn — leave it; documented pattern)
- Everything else: clean
- Both repos pushed to `origin/main`
- All 167 unit tests pass
- All 4 cron monitors green (last verified 18:35 UTC)
- All Sentry issues resolved (post-fix)

---

## 8. If you want a one-line resume prompt to paste

```
Read docs/scheduler/NEXT-SESSION-KICKOFF.md first — then proceed.
```

That single line into a fresh session sends future-you to this file. Easy.
