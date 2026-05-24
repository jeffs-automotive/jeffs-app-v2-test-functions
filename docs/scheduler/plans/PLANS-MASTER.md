# Scheduler-app remediation plans — master index

> Implementation plans for every audit finding in `docs/scheduler/AUDIT-2026-05-22.md`. Each plan is independently shippable but ordered by dependency. Research backing each plan is in `docs/scheduler/research-2026-05-22/`.
>
> **For phase-level status + commit SHAs:** see [`docs/scheduler/REMEDIATION-PROGRESS.md`](../REMEDIATION-PROGRESS.md). That file is the source of truth for what's landed; this file is the source of truth for what each plan DOES.
>
> **Estimated total effort:** 4-5 weeks for one engineer, sequencing per the dependency graph below.
>
> **Sequence the work this way:**
>
> 1. **Plan 01 (Pre-launch BLOCKERs)** must come first — 10 BLOCKERs + the broken cron + A2P 10DLC verification block launch. ~1-1.5 weeks.
> 2. After Plan 01 → Plans **02, 03, 04, 05** can run in parallel (different surfaces).
> 3. Plan **06 (Test coverage expansion)** sits on top of Plans 01-04 — test patterns + DAL refactor.
> 4. Plan **07 (Operational + pre-launch)** can land anytime; ideally just before Phase 1 DNS launch.

---

## Current state (2026-05-24)

✅ **Plans 01, 02, 03 — COMPLETE.** All 10 BLOCKERs + 16+ IMPORTANTs closed across 14 phase-level commits. See `REMEDIATION-PROGRESS.md` for per-phase commit SHAs.

🟡 **Plan 04 — IN PROGRESS.** Phase 1A (`apply_wizard_transition` RPC) landed 2026-05-24, closing I-COR-1. 7 remaining phases.

🔜 **Plans 05, 06, 07 — NOT STARTED.** Plans 05, 07 are unblocked + parallel-runnable with Plan 04's remaining phases; Plan 06 sits on top of Plan 04.

---

## The 7 plans at a glance

| Plan | Title | Status | Effort | Risk | Findings closed | Prerequisites |
|---|---|---|---|---|---|---|
| [01](./PLAN-01-pre-launch-blockers.md) | Pre-launch BLOCKERs | ✅ COMPLETE 2026-05-22 | 6-8 days | medium | B1-B10, I-OBS-2, I-INT-5 | — |
| [02](./PLAN-02-observability-hardening.md) | Observability hardening | ✅ COMPLETE 2026-05-24 | 3 days | low | I-OBS-1,3,4,5,7,8, I-INT-6 | Plan 01 Phase 3 (CI) |
| [03](./PLAN-03-security-hardening.md) | Security hardening | ✅ COMPLETE 2026-05-23 (SEC-7 BotID deferred to pre-launch) | 5-6 days | medium | I-SEC-1,3,4,5,6,7 + headers | Plan 01 Phase 1A + 3 |
| [04](./PLAN-04-atomicity-correctness.md) | Atomicity + correctness | 🟡 IN PROGRESS (Phase 1A landed 2026-05-24) | 4 days | medium-high | I-COR-1,2,3,4,5,6,7,8, I-OTH-3 | Plan 01 Phase 4 (tests) ✅ |
| [05](./PLAN-05-integration-robustness.md) | Integration robustness | 🔜 NOT STARTED | 5-6 days | medium | I-INT-1,2,3,4 | Plan 01 Phase 1A ✅ |
| [06](./PLAN-06-test-coverage-expansion.md) | Test coverage expansion + DAL refactor | 🔜 NOT STARTED | 1-2 weeks | low | I-TEST-1 through I-TEST-8 | Plan 01 Phase 3 ✅ + 4 ✅, Plan 04 |
| [07](./PLAN-07-operational-pre-launch.md) | Operational + pre-launch | 🔜 NOT STARTED | 2 days | low | I-OTH-1,2,4, P1, P2 | — |

---

## Dependency graph

```
                          ┌──────────────────────┐
                          │   Plan 01            │
                          │   Pre-launch BLOCKERs│
                          │   (6-8 days)         │
                          └─────────┬────────────┘
                                    │
                ┌─────────┬─────────┼─────────┬─────────┐
                │         │         │         │         │
                ▼         ▼         ▼         ▼         ▼
            ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
            │Plan 02│ │Plan 03│ │Plan 04│ │Plan 05│ │Plan 07│
            │ Obs   │ │ Sec   │ │ Atom  │ │ Integ │ │ Ops   │
            │ (3d)  │ │ (5-6d)│ │ (4d)  │ │ (5-6d)│ │ (2d)  │
            └───────┘ └───────┘ └───┬───┘ └───────┘ └───────┘
                                    │
                                    ▼
                              ┌────────────┐
                              │  Plan 06   │
                              │  Tests+DAL │
                              │  (1-2w)    │
                              └────────────┘
```

Plans 02-05 and 07 are independent — they can run in parallel after Plan 01 lands. Plan 06 builds on top.

---

## Findings coverage matrix

Every finding in `AUDIT-2026-05-22.md` is addressed by exactly one plan (with rare cross-references noted). Cross-check:

### BLOCKERs (10) — all in Plan 01

| # | Finding | Plan |
|---|---|---|
| B1 | tekmetric-api-testing anon-key exposure | 01 P1A |
| B2 | tekmetric-bootstrap anon-key exposure | 01 P1A |
| B3 | _bulk_keytag_backfill RLS disabled | 01 P1B |
| B4 | _smoke_test_run RLS disabled | 01 P1B |
| B5 | tekmetric_webhook_events lacks UNIQUE | 01 P2 |
| B6 | No CI gate | 01 P3 |
| B7 | diagnose-concern.ts zero tests | 01 P4A |
| B8 | Tekmetric webhooks untested | 01 P4C |
| B9 | run-diagnostics.ts zero tests | 01 P4B |
| B10 | Playwright config missing | 01 P4D |

### IMPORTANTs (35+) — distributed

| Category | Findings | Plan |
|---|---|---|
| **Observability** (8) | I-OBS-1,2,3,4,5,7,8, I-INT-6 | Plan 02 (I-OBS-2 in Plan 01) |
| **Security** (7) | I-SEC-1,3,4,5,6,7 + headers | Plan 03 |
| **Correctness/atomicity** (8) | I-COR-1 through I-COR-8 | Plan 04 |
| **Integration robustness** (5) | I-INT-1,2,3,4 (I-INT-5 in Plan 01, I-INT-6 in Plan 02) | Plan 05 |
| **Test coverage** (8) | I-TEST-1 through I-TEST-8 | Plan 06 |
| **Operational** (4) | I-OTH-1,2,3,4 (I-OTH-3 in Plan 04) | Plan 07 |
| **Pre-launch** (2) | P1, P2 | Plan 07 |

### NICE-TO-HAVE (40+)

Not individually planned. Each plan includes the related NICE-TO-HAVE cleanups inline (e.g., Plan 04 Phase 6B documents early-migration idempotency in a README rather than rewriting them).

---

## Research artifacts

Each plan cites specific research findings. The 6 research reports (Supabase+Postgres, CI/CD+Testing, Sentry+Observability, Security Hardening, Integration Robustness, Server Action Atomicity) are at:

- `.tmp/agent-output/research-supabase-postgres/2026-05-22T16-00-00Z.md`
- `.tmp/agent-output/research-cicd-testing/2026-05-22T16-00-00Z.md`
- `.tmp/agent-output/research-sentry-observability/2026-05-22T16-00-00Z.md`
- `.tmp/agent-output/research-security-hardening/2026-05-22T16-00-00Z.md`
- `.tmp/agent-output/research-integration-robustness/2026-05-22T16-00-00Z.md`
- `.tmp/agent-output/research-server-action-atomicity/2026-05-22T16-00-00Z.md`

Each report cites 25-60 unique external sources (vendor docs, GitHub examples, production write-ups, SRE references). Source-of-truth for "why this pattern, not that pattern" claims in the plans.

**Recommend:** copy each research file to `docs/scheduler/research-2026-05-22/` and commit alongside the plans for permanent record.

---

## Open decisions for Chris (across all plans)

Each plan has its own list; here's the consolidated set:

### Plan 01 (BLOCKERs)
- Phase 1B: Drop or schema-move `_bulk_keytag_backfill` + `_smoke_test_run`?
- Phase 5: Are A2P 10DLC brand + campaign already registered? If not, **start NOW** in parallel (1-2 week approval window — could become the critical path).
- Phase 4D: Playwright test environment — local Supabase, branch, or preview deployment?

### Plan 02 (Observability)
- Sentry DSN value for cron check-ins (need to add to Vault)
- Alert channel for webhook-sig-fail warnings
- `captureMessage` migration: PR-list-then-fix vs mass-migration?

### Plan 03 (Security)
- BotID Deep Analysis: subscribe now or wait for attack traffic?
- Upstash Redis account: existing or new?
- OAuth resource backwards-compat window: 30 days?
- CSP rollout: Report-Only first or enforce immediately?
- Verify Next.js 16 `middleware.ts` vs `proxy.ts` naming

### Plan 04 (Atomicity)
- CAS lock value: reuse `released_at` or add dedicated column?
- Verification-mismatch UX copy wordsmithing
- revalidatePath scope reduction: wizard-cards-only or full session-tag refactor?
- Early-migration rewrite vs README documentation?

### Plan 05 (Integrations)
- Telnyx public key + Resend webhook secret env vars
- Upstash Redis account (same q as Plan 03)
- Queue-for-replay (Phase 3C): ship now or wait for first outage?
- Fallback UX wording

### Plan 06 (Tests + DAL)
- DAL refactor: incremental over 2-3 sprints or one push?
- Coverage threshold ramp: 60% → 85% over time or hard 85% now?

### Plan 07 (Operational)
- DNS provider: GoDaddy/Cloudflare/Route53?
- Auth DB connections percentage: 25% or 50%?
- Sentry Seer: defer to post-launch (recommended) or enable now?

---

## When to commit to remote

This master + the 7 plan documents + the 6 research artifacts together represent a single deliverable. Commit + push as one PR titled `docs(scheduler): comprehensive remediation plans — 2026-05-22`.

Suggested commit body summarizes:
- The 7 plans + their effort estimates
- Total findings closed (10 BLOCKER + 35+ IMPORTANT)
- Research sources cited (6 reports, 200+ external citations)
- Recommended execution sequence

---

## Status tracking

Progress is tracked at [`docs/scheduler/REMEDIATION-PROGRESS.md`](../REMEDIATION-PROGRESS.md) — per-phase commit SHAs, close criteria, and deferral cross-links to `DEFERRED-AUDIT-ITEMS.md`. Update that file in the same commit that closes a phase.

This file lives alongside the plans + gets updated as PRs land.
