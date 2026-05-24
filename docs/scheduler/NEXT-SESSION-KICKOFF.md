# Scheduler-app — next session kickoff

> **Last refreshed:** 2026-05-24/25 end-of-session (post Plan 04 Phase 5B revalidate-scope reduction).
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

## 2. Today's headline (2026-05-24/25, end of day pt 5)

**Plan 04 Phase 5B shipped — per-session Next.js data cache + revalidate-scope reduction** (commit `(SHA after push)`, no migration):

- New helper `scheduler-app/src/lib/scheduler/cache.ts` exports `sessionTag(chatId)` + `getCachedSessionRow(chatId)` — wraps `customer_chat_sessions` row reads via `unstable_cache` with tag `session-${chatId}` + 60s TTL backstop
- Three RSC readers refactored: `hydrate-session.ts`, `get-current-card.ts`, `build-summary-data.ts:buildSummaryCardPayload`
- `transition.ts:applyWizardTransition` rewritten — `revalidateTag(sessionTag(chatId)) + revalidatePath("/", "page")` instead of the pre-Phase-5B 3-path loop. Per-session granularity achieved; single-path fallback preserved for defense-in-depth (CLN-15 tracks future removal)
- **2 parallel Opus verifier agents** (Explore subagent, fresh context, independent) caught 2 real gaps the orchestrator-alone audit would have missed:
  - Verifier A: `buildSummaryCardPayload` did an uncached supabase read — fixed (now uses cache helper)
  - Verifier B: `mark-abandoned/route.ts` wrote status='timed_out' without firing `revalidateTag` — customer returning within 60s would have skipped the wipe-in-place. Fixed.
- Bonus: `ensure-concern-summaries.ts` (called from run-diagnostics AFTER applyWizardTransition's revalidateTag) now fires its own `revalidateTag`
- 6 test files updated (revalidateTag added to mocks, redundant 3-path assertions consolidated)
- Full unit suite **212/212 passing** (was 211; net +1 after consolidation)
- Closes I-OTH-3

**Process changes this session:**
- **Context7 MCP permanently deny-listed** — Chris's call ("always outdated"). Policy at `feedback_no_context7.md`. Use vendor docs via WebFetch instead.
- **Opus sub-agents now the default for verification work** — Phase 5B was the first scheduler phase to use this pattern. Verifier agents independently found gaps. Policy at `feedback_opus_for_subagents.md`. Always pass `model: "opus"` on Agent dispatches in this project.

**Plans state:**

- ✅ **Plans 01, 02, 03** — COMPLETE
- 🟡 **Plan 04** — IN PROGRESS (7 of 8 phases done — Phase 1A + 1B + 2 + 3A + 3B + 4 + 5B)
- 🔜 **Plans 05, 06, 07** — NOT STARTED

**Earlier today/yesterday (2026-05-24/25):**

1. Sentry cron pair-by-id fix (`3d9de2d`)
2. OBS-8 RESOLVED (`c87ea5c`)
3. PLANS-MASTER refresh + REMEDIATION-PROGRESS (`894cfae`)
4. Plan 04 Phase 1A `apply_wizard_transition` RPC (`5d8a122`)
5. Plan 04 Phase 1B `hydrate_session_reset` RPC (`221b855`, dotfiles `ebabe3e`)
6. Plan 04 Phase 2 `submit-summary` CAS lock (`59452f0`, dotfiles `f872288`)
7. Plan 04 Phase 3A + 3B IDOR defenses (`80038cd`, dotfiles `cd2bc7b`)
8. Plan 04 Phase 4 verification-mismatch envelope (`a12cf0e`, dotfiles `371c36f`)
9. Architecture memo bumped 8× total in dotfiles repo

---

## (historical — Phase 4 detail preserved for context — was the prior "Today's headline" before Phase 5B)

**Plan 04 Phase 4 — verification-mismatch 3-state envelope** (migration `20260525000000`, commit `a12cf0e`):

- Migration adds 2 columns on `customer_chat_sessions`: `appointment_verification_status TEXT` (CHECK constraint on `confirmed | needs_review | NULL`) + `appointment_verification_diff JSONB`
- Migration also extends `apply_wizard_transition` RPC with CASE-WHEN-? branches for both new keys (same JSONB null-clear semantic as `edited_phones`/`edited_emails`/etc.)
- `submit-summary.ts` verify-mismatch block (previously log-only warning) now:
  - Bumps Sentry capture to ERROR level
  - Calls `create_manual_review` RPC with category=`appointment_verification_mismatch` + prefix='AVM' + 3 advisor options (update_tekmetric / update_our_records / contact_customer)
  - Persists `appointment_verification_status='needs_review'` + `appointment_verification_diff=<jsonb>` via `applyWizardTransition` payload
  - Returns apology bubble (`buildVerificationMismatchBubble`) instead of celebratory `buildConfirmedBubble`
  - Customer still advances to `customer_notes` per Chris's UX decision
- Reuses `keytag_manual_reviews` table per Chris's pattern-B decision (existing RPCs accept arbitrary `p_category` + `p_prefix`; keytag-specific p_tag_color / p_tag_number / p_ro_id / p_ro_number stay NULL for AVM entries)
- 4 new tests in `submit-summary.test.ts`; unit suite **211/211 passing** (was 207 after Phase 3)
- Closes I-COR-6

**Deferred for follow-up (CLN-13):** the per-issuance email send. Today's Phase 4 inserts the review row + fires Sentry error; the Resend-driven email (like keytag reviews get) is NOT wired because the Deno-side email helper isn't importable from the Vercel Server Action. Two paths forward documented in CLN-13 (new edge fn recommended).

**Plans state:**

- ✅ **Plans 01, 02, 03** — COMPLETE
- 🟡 **Plan 04** — IN PROGRESS (6 of 8 phases done — Phase 1A + 1B + 2 + 3A + 3B + 4)
- 🔜 **Plans 05, 06, 07** — NOT STARTED

**Earlier today/yesterday (2026-05-24/25, in chronological order):**

1. Sentry cron pair-by-id fix (migration `20260524210000`, commit `3d9de2d`)
2. OBS-8 flipped to RESOLVED in `DEFERRED-AUDIT-ITEMS.md` (commit `c87ea5c`)
3. PLANS-MASTER refresh + new `REMEDIATION-PROGRESS.md` (commit `894cfae`)
4. Plan 04 Phase 1A — `apply_wizard_transition` RPC (commit `5d8a122`)
5. Plan 04 Phase 1B — `hydrate_session_reset` RPC (commit `221b855`, dotfiles `ebabe3e`)
6. Plan 04 Phase 2 — `submit-summary` hold CAS lock (commit `59452f0`, dotfiles `f872288`)
7. Plan 04 Phase 3A + 3B — IDOR defenses (commit `80038cd`, dotfiles `cd2bc7b`)
8. Architecture memo bumped 7× total in dotfiles repo

---

## 3. Next-step TODOs (priority order)

### Tier A — confirm yesterday's work (do FIRST, in this order)

1. **[~5 min]** Check today's daily cron fires — `keytag-bulk-reconcile` at 10:00 UTC and `keytag-daily-report` at 11:00 UTC. Query Sentry for any new `monitor_check_in_failure` issues on JEFFS-APP-V2-SUPABASE-B or -D. If clean: leave them resolved.
2. **[~10 min]** Spot-check the live wizard surface. Five changes shipped 2026-05-24 across Plan 04:
   - Phase 1A `apply_wizard_transition` RPC (`5d8a122`) — every wizard step
   - Phase 1B `hydrate_session_reset` RPC (`221b855`) — stale reset
   - Phase 2 `submit-summary` CAS lock (`59452f0`) — atomic hold-claim before Tekmetric
   - Phase 3A `submit-vehicle-pick` IDOR defense (`(SHA after push)`) — vehicle_id ownership check
   - Phase 3B `submit-multi-account-choice` IDOR defense (`(SHA after push)`) — pending_candidates membership check

   Exercise:
   - **Full booking flow** at `appointments.jeffsautomotive.com` (greeting → … → date pick → confirm). Should land cleanly.
   - **Stale-reset path:** open wizard, wait > 5 min idle, reload — should land at greeting with no ghost bubbles.
   - **IDOR sanity (optional):** in DevTools, intercept the vehicle-pick Server Action POST and substitute a random vehicle_id. Action should return `vehicle_id_not_owned`. Same for multi-account-choice with a fake customer_id → `customer_id_invalid`.
   - If anything regresses, revert the offending commit immediately.
3. **[~2 min]** Confirm `vault.secrets.sentry_dsn` is still populated. Query: `SELECT name, created_at FROM vault.secrets WHERE name = 'sentry_dsn';` via Supabase MCP.
4. **[~2 min]** Confirm both Phase 1 RPCs exist in the DB. Query: `SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('apply_wizard_transition', 'hydrate_session_reset') ORDER BY proname;` via Supabase MCP. Should return 2 rows both with `prosecdef = false`.

### Tier B — Plan 04 Phase 6 (the last remaining Plan 04 phase)

**Phase 6: CASCADE FK audit + early-migration idempotency docs (I-COR-7 + I-COR-8)** — 4 FKs CASCADE off `customer_chat_sessions`; spec recommends changing `scheduler_audit_log.session_id` to `ON DELETE SET NULL` (audit logs should outlive sessions for compliance) and documenting the other 3 as intentional cascades. Plus a documentation pass on the early migrations that aren't idempotent. Risk: LOW — mostly DDL + docs.

**Before writing any code:**
- Read `docs/scheduler/plans/PLAN-04-atomicity-correctness.md` Phase 6 (lines ~500-end)
- Phase 6A: review the 4 CASCADE FKs in `pg_constraint` — confirm the schemas match the spec's claims about `scheduler_audit_log`, `appointment_holds`, `customer_chat_messages`, `appointment_concerns`
- Phase 6B: pick the early migrations that lack idempotency guards + document per Chris's preference (rewrite vs README note)
- Use the Opus sub-agent pattern from Phase 5B for the DB-schema audit (cleaner context, independent verification)

**Estimated:** 2-3 hr. Closes Plan 04 entirely (8/8 phases done) → unblocks Plans 05/06/07.

### Tier C — Plan 04 deferred follow-ups (post-Plan-04)

| Item | Scope | Reference |
|---|---|---|
| CLN-15 | Drop the `revalidatePath("/", "page")` fallback from `applyWizardTransition` once all RSC readers are independently re-verified as tag-instrumented | DEFERRED-AUDIT-ITEMS.md CLN-15 |
| CLN-13 | Wire email send for AVM manual reviews (new edge fn recommended) | DEFERRED-AUDIT-ITEMS.md CLN-13 |
| CLN-12 | RESET_COLUMNS divergence — extract to shared `reset-columns.ts` per Plan 06 | DEFERRED-AUDIT-ITEMS.md CLN-12 |

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
