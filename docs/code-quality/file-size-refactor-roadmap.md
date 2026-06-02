# File-Size Refactor — All-Batches Roadmap

> Companion to [file-size-audit-and-strategy-2026-05-31.md](file-size-audit-and-strategy-2026-05-31.md) and
> [file-size-refactor-plan-batch-1.md](file-size-refactor-plan-batch-1.md). Built on the **current** large-file
> list (post batch-1, 2026-05-31), sequenced around the in-flight phase-18 scheduler refactor. Drafted 2026-05-31.

## Process for every batch (the lesson from batch 1)

Each batch from here runs the full gate **before push**, in order, on a feature branch:

`/feature-start <batch>` → `/feature-plan` → `/feature-implement` (TDD) → **`/feature-verify`** (typecheck + tests + build + **`/code-review` atomic gate, pre-commit so the regression agents see a real diff**) → fix blockers → push → PR.

Batch 1 skipped `/feature-verify`; the gate was run retroactively and confirmed **batch-1 introduced 0 findings**, but it also surfaced **pre-existing** debt in `keytag-bulk-reconcile` (see Batch 4a). Don't repeat that — gate before push.

---

## State after Batch 1 (DONE, on `main`)

- `max-lines` warn guardrail (both apps) · `canonical-concern-catalog.ts` 6082→17 files · `_shared/resend-client.ts` + 2 live sites migrated · dead `sendOrphanEmail` removed.
- **35 non-test files remain >500 lines** (catalog data files exempted). Largest: `scheduler-admin.ts` (3534).

## Phase-18 coordination (the hard constraint)

Phase-18 (`phase_18_edge_consolidation`) is actively merging `scheduler-booking-direct` / `scheduler-otp-direct` / `scheduler-step2-direct` → `scheduler-server`, and re-pointing `wizard/llm/*`, `wizard/actions/*`, `booking-direct-client.ts`, and churning `WizardSurface.tsx`. **Everything on that surface is Batch 5 (LATER / fold-in).** Batches 2–4 deliberately stay on the surviving advisor/MCP/keytag/scripts surface.

---

## Batch 2 — Data catalogs, scripts & the UI phone-helper dedup
**Risk: low · Phase-18 collision: none · Theme: data extraction + tooling + the verified dedup win**

| File | LOC | Strategy |
|---|---|---|
| `_shared/tools/scheduler-admin-catalog.ts` | 2804 | Separate the static catalog DATA from the lookup logic; data → data module(s) |
| `_shared/scheduler-admin-md.ts` | 1915 | Split the MD parsers/builders by table (the 5 admin tables) behind a barrel |
| `scripts/code-review.mjs` | 831 | Extract the agent-runner / report-writer / arg-parsing into `scripts/lib/*` |
| `scheduler-app/scripts/run-llm-test-batch.mjs` | 660 | Extract batch-runner helpers; low blast radius |
| 3 heritage cards (`EscalationCard`, `CustomerInfoEditCard`, `NewCustomerInfoCard`) | — | **Extract the 4-copy phone-format helper** into one shared util (verified duplication; highest-value single UI dedup). Card *internals* only — no phase-18 wiring touched. |

## Batch 3 — The `scheduler-admin.ts` god-module
**Risk: medium · Phase-18 collision: none (advisor MD-upload surface) · Theme: Extract Class / split-by-surface**

| File | LOC | Strategy |
|---|---|---|
| `_shared/tools/scheduler-admin.ts` | 3534 | Extract the shared upload engine (parse → dry-run diff → confirm-token → apply RPC) used by all 5 uploaders into one module; split the 5 per-table uploaders into per-surface files behind a barrel. **Biggest single-file win in the repo.** |

(Self-contained batch because it's the largest, highest-coordination file and deserves its own verify pass.)

## Batch 4a — keytag / MCP edge entrypoints **+ observability hardening**
**Risk: medium · Phase-18 collision: none · Theme: handler + helpers split, AND fix the gate findings**

| File | LOC | Strategy / note |
|---|---|---|
| `keytag-bulk-reconcile/index.ts` | 1348 | Split (reconcile core / detection / handler / email) **AND fix the retroactive-gate findings**: ⚠️ 2 BLOCKERS — `silent-webhook-200` (handler returns 200 on `action:"error"` rows with no Sentry capture, line 1329) + `manual-review-dedup` (cross-category pre-dedup, line 632) — plus 15 unchecked Supabase `error`s (lines 619–1182). See **note below**. |
| `keytag-tekmetric-webhook/index.ts` | 1266 | Split webhook router → per-event handlers + helpers |
| `tekmetric-api-testing/index.ts` | 1099 | Test/probe harness; split by probe group |
| `keytag-daily-report/index.ts` | 848 | Extract the HTML/report builders from the handler |
| `mcp-auth/index.ts` | 729 | Split OAuth endpoints (DCR / consent / token / refresh) |
| `orchestrator-mcp/index.ts` | 688 | Split auth branches + dispatch wiring |
| `llm-testing/index.ts` | 2168 | Split the 22 handlers into route + helper modules |

> **⚠️ Recommendation — pull the `keytag-bulk-reconcile` *correctness* fixes out of the size work.** The 2 blockers are silent-failure bugs in a **live nightly cron** (errors hidden behind HTTP 200; cross-category anomaly suppression). They're independent of file size and arguably should ship **sooner**, as their own small `/feature-start keytag-reconcile-hardening` → `/feature-verify` pass, rather than waiting for the 1348-line split. Your call on sequencing.

## Batch 4b — Advisor `_shared/tools/*` cluster
**Risk: medium · Phase-18 collision: none (surviving MCP surface) · Theme: Extract Function / split-by-domain**

`scheduler-tools.ts` (1812) · `_shared/orchestrator.ts` (736) · `manual-review-tools.ts` (727) · `_shared/tools/scheduler-customer.ts` (806) · `keytag-extras.ts` (787) · `orchestrator-tools.ts` (585) · `scheduler-otp.ts` (559) · `scheduler-pricing.ts` (556) · `keytag-management.ts` (527). Split each by cohesive tool group; extract shared helpers once.

## Batch 5 — LATER: scheduler wizard lib + components + phase-18 edge
**Risk: high · Phase-18 collision: YES · Theme: defer until phase-18 settles, or fold INTO it**

- **Fold into phase-18:** `scheduler-slots.ts` (1346), `scheduler-booking-direct` (941), `scheduler-step2-direct` (511), `transcript-dispatcher` (972) — their splits should land *as part of* the consolidation, not compete with it. Includes the **deferred batch-1 Resend migrations** (`transcript-dispatcher`, `scheduler-manual-review-email`).
- **Defer until phase-18 settles:** `diagnose-concern.ts` (1373), `get-current-card.ts` (1267), `extracted-facts.ts` (1136), `submit-summary.ts` (914), `run-diagnostics.ts` (582), `booking-direct-client.ts` (517), `load-diagnostic-catalog.ts`; `WizardSurface.tsx` (652, most-churned).
- **Big test files** (`submit-summary.test` 990, `run-diagnostics.test` 932, etc.) — split by scenario; lowest priority.

---

## Suggested order & rationale

1. **(Optional, soonest) keytag-reconcile-hardening** — the 2 live-cron silent-failure blockers, on their own. Independent of file size.
2. **Batch 2** — lowest risk, big LOC (data catalogs), plus the phone-helper dedup. Good momentum.
3. **Batch 3** — the 3534-line `scheduler-admin.ts`, the single biggest win.
4. **Batch 4a / 4b** — keytag/MCP edge + advisor tools (4a folds in the reconcile hardening if not already done in step 1).
5. **Batch 5** — only after phase-18 lands; coordinate directly with that work.

After each: flip the relevant files' `max-lines` from warn toward error as the backlog clears (audit §5c).

## Open question for Chris
- Do you want the **keytag-reconcile silent-failure fixes** pulled out as a near-term standalone hardening task (recommended), or handled inside Batch 4a's split?
