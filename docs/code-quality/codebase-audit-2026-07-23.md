# Codebase audit + cleanup plan — 2026-07-23

> Full-repo audit (6 parallel auditors + deployed-Supabase cross-check) for a memory-consolidation,
> dead-code-cleanup, and documentation pass. **All deletions are human-gated — nothing is removed without
> Chris's per-item sign-off.** This doc is the synthesis + the tracking checklist.
>
> Deployed reality cross-checked: ~95 tables, 13 active crons, 32 edge functions, commits through `6982143`.

---

## 0. EXECUTION STATUS — applied 2026-07-23 (all verified: typecheck/build/tests + Vercel READY + live smoke)

| Group | Outcome | Commit(s) |
|---|---|---|
| **2A + 2E** code | ✅ Done — 44 files / 10,154 lines (MD-admin `_shared` cluster, admin MD residue, 8 scripts) | `59845e3` |
| **2D** deps/CSS | ✅ Done **with corrections** — removed `@ai-sdk/openai` + `msw` (scheduler) + `msw` direct dep (admin) + dead `--chart-*` CSS. **`shadcn` KEPT** (admin+qteklink `globals.css` `@import "shadcn/tailwind.css"` — removing broke the Tailwind build). **`msw` KEPT in qteklink** (used by `qbo/__tests__/client.test.ts`). | `99e2856` |
| **2B** MCP/OAuth | ✅ Done + **renamed `orchestrator-mcp` → `orchestrator`** (Chris). Deleted `mcp-auth`; stripped Branch B/PRM/handshake handlers; pruned `oauth.ts`. **Dropped 4 tables + 4 functions** (audit named only `oauth_validate_access_token`; verification found `oauth_consume_refresh_token`/`oauth_revoke_token_family`/`oauth_issue_token_pair` too). Old deployments deleted; live smoke passed. | `551f69a`, `3daa543` |
| **2C** qteklink drop | ✅ Done — dropped `qteklink_postings` (+ its 7 queue RPCs) + `qteklink_ro_state` (+ `qteklink_upsert_ro_state`) + `qteklink_claim_posting_by_id`. **`qteklink_settings` KEPT** (live). **Snapshot-prune DEFERRED**: there is NO `scheduler_admin_snapshots` table (2A's row 27 was wrong — snapshots are the `scheduler_admin_audit_log.pre_state_snapshot` column, and that table is LIVE, read by the schedulerconfig History tab). | `59794d7`, `c0527cb` |
| **§3 judgment** — acknowledge-day | ✅ **KEPT** — verified LIVE (`app/approvals/page.tsx` imports + renders `AcknowledgeDayButton`, as §3 itself flagged). Working, not replaced → not pruned. | — |
| **§3 judgment** — operator edge fns | ✅ Pruned `llm-testing`, `tekmetric-list-wip-keytags`, `tekmetric-find-ro-by-keytag` (0 live callers). **KEPT** `tekmetric-bootstrap`, `tekmetric-api-testing`, `keytag-seed-from-tekmetric`. | `fa1c5a3` |

**Lesson banked:** grep scope must include BOTH `<app>/app/` AND `<app>/src/` — a `src/`-only grep falsely marked acknowledge-day dead; `tsc` caught it on the delete. Verify-before-delete also overturned the `shadcn` and `msw`-in-qteklink calls.

**Still open (this pass did not touch):** §3 scheduler catalog-seed lineage + superseded eval artifacts; the per-app as-built docs + scheduler arch-doc stale-ref fixes (task 6); the snapshot-prune determination above.

---

## 1. Current capabilities (per surface — feeds the new `apps-overview` memory)

- **scheduler-app** — Next.js 15/React 19 customer booking wizard (`appointments.jeffsautomotive.com`, Heritage Editorial UI). Custom state machine (`customer_chat_sessions.current_step`, `apply_wizard_transition` RPC): greeting → phone+name (BotID + per-phone rate-limit + TCPA consent) → OTP (Telnyx) → customer/vehicle match → concern picker → **3-stage `diagnose-concern` LLM** (`claude-haiku-4-5`, per-stage env-overridable, via Anthropic SDK at Vercel AI Gateway) → confidence-gate/triage/clarify → appointment type → date/waiter-time → summary → Tekmetric confirm. Editable card copy (`card-text.ts` ← admin), SMS/email comms (consent ledger, `scheduler-comms`, Resend transcript), eval harness in `scripts/eval/`.
- **admin-app** — Next.js 15 Entra-gated employee dashboard (shadcn-on-`@base-ui/react`, dark mode live). Surfaces: `/dashboard`, `/keytags` (6 tabs), `/schedulerconfig` (11 tabs, direct webforms), `/back-office` (SA queue). Keytag **reads** = direct in-process service-role DAL; keytag **writes** (7) + `whoIsOnTag` = orchestrator-mcp Branch A. schedulerconfig writes = direct SECURITY DEFINER RPCs (`wrapAdminAction`). No QBO client (proxies to qteklink).
- **qteklink-app** — QBO posting + payroll (`qteklink.jeffsautomotive.com`). Posts each business day as ≤3 bulk JEs (sales/payments/fees) on a live-on-view + nightly-cron model; idempotent rotating `requestid`; 9 posting roles; deposit-locked (6540) → review items; full resolution workflow. Payroll (DONE): posted-only basis, authorized-jobs filter, GP via QBO 6010, PTO ledger, immutable runs, mirror-apply pipeline.
- **edge functions (32)** — LIVE by channel: crons (appointments-sync, transcript-dispatcher, scheduler-comms, keytag-daily-report, keytag-bulk-reconcile, back-office-ro-watch, back-office-daily-report, document-intake-email, **tekbridge-refresh**); webhooks (tekmetric, keytag-tekmetric, qbo, qteklink, telnyx, sentry, Graph); app-fetch (scheduler-{booking,otp,step2}-direct, scheduler-comms, scheduler-manual-review-email, back-office-notify, qteklink-email, orchestrator-mcp, document-intake-agent, qbo-oauth-callback). **tekbridge**/**tekbridge-refresh** current.

## 2. Cleanup candidates — CODE (human-gated)

### 2A. High-confidence dead code — retired MD-upload / stub residue
| Item | Path | Evidence | Confidence |
|---|---|---|---|
| Retired revert action | `admin-app/src/actions/scheduler/revert-md-upload-direct.ts` | 0 importers | HIGH |
| MD-file utils + its test | `admin-app/src/lib/scheduler/md-file-utils.ts` (+ `admin-app/tests/unit/md-file-utils.test.ts`) | 8 exports, 0 external users; only the test keeps it "covered" | HIGH |
| Stub tab | `admin-app/src/components/keytag/StubTab.tsx` | "Coming in Phase C.5/C.6" placeholder; those phases shipped; 0 importers | HIGH |
| **Scheduler MD-admin `_shared` cluster (~27 files)** | `supabase/functions/_shared/scheduler-admin-md.ts` + `scheduler-admin-md/`, `_shared/tools/scheduler-admin.ts` + `tools/scheduler-admin/`, `tools/scheduler-admin-catalog.ts` + `tools/scheduler-admin-catalog/` (+ `scheduler-admin-catalog.test.ts`) | `getSchedulerTools` no longer imports them (`scheduler-tools.ts:63,767`); import only each other; sole outside ref is one test | HIGH |
| Snapshot-prune cron + table | cron `scheduler-admin-snapshot-prune` (`20260519140000`) + `scheduler_admin_snapshots` table | Nothing writes the table anymore (MD-admin path dead) | HIGH |

### 2B. THE BIG ONE — Claude-Desktop MCP/OAuth teardown (Claude Desktop retired 2026-07-02)
`orchestrator-mcp` **must stay** (it hosts the keytag-mutation tool registry via Branch A + now tekbridge). But everything below is **dead-caller** and removable as a unit:
- **`mcp-auth` function** — entirely dead (OAuth 2.1/PKCE/DCR server; only client was the Claude Desktop connector).
- **`orchestrator-mcp` dead handlers** — Branch B OAuth-bearer validation (`index.ts:338-409`), `/.well-known/oauth-protected-resource` (`:449,:627`), `initialize`/`tools/list`/`ping`/`notifications`, WWW-Authenticate (`:412-445`), GET `/` health.
- **`oauth_*` tables + RPC** — `oauth_clients`, `oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_authorization_codes`, `oauth_validate_access_token()` (read/written only by the two functions above).
- **`_shared/oauth.ts` — export-level prune only** (NOT delete): remove `getExpectedMcpResource`, `sha256Base64Url`, `canonicalizeResource`, `verifyPkce`, `ProtectedResourceMetadata`/`AuthServerMetadata` types. KEEP `stripFunctionPrefix` (tekbridge), `functionUrl`/`base64UrlEncode`/`randomToken` (qbo-oauth-callback).
- Related DEFERRED-AUDIT OBS/SEC items about "legacy NULL-resource tokens" are now moot.

### 2C. DB drops — qteklink retired per-RO ledger
| Object | Migration | Rows | Evidence |
|---|---|---|---|
| `qteklink_postings` table + `qteklink_claim_posting_by_id` RPC | `20260607080000`, `20260608010000` | 80 | 0 `.from("qteklink_postings")` in code; backlog "drop unblocked". No DROP exists. |
| `qteklink_ro_state` table | `20260607090000` | 0 | 0 references in code |

### 2D. Unused dependencies
- **scheduler-app:** `@ai-sdk/openai` (0 imports — gateway model strings don't need it) · `react-hook-form` + `@hookform/resolvers` (0 real imports — known/accepted).
- **admin-app:** `msw` (0 references) · `shadcn` (CLI misfiled in `dependencies`) · **`intuit-oauth` — KEEP** (staged for the PAUSED QBO client). Dead CSS: `--chart-*` tokens in `app/globals.css`.

### 2E. Orphaned one-off scripts (scheduler-app/scripts/, dev-only, 0 refs)
`anthropic-smoke.mjs`, `anthropic-sdk-smoke.mjs`, `env-check.mjs`, `env-keys-only.mjs`, `env-line-inspect.mjs`, `fix-env-encoding.mjs`, `rebuild-embed-poc.mjs`, `run-llm-test-batch.mjs`.

## 3. Judgment calls — need Chris's decision (not clearly deletable)
- **qteklink acknowledge-day / "covered by Accounting Link" flow** — vestigial (AL retired, all days QTekLink-posted) but STILL WIRED (`app/approvals/page.tsx:216`). Remove the card, or keep?
- **6 operator-only edge functions** (no automated caller, service-role-gated, harmless): `tekmetric-bootstrap`, `tekmetric-api-testing`, `tekmetric-list-wip-keytags`, `tekmetric-find-ro-by-keytag`, `keytag-seed-from-tekmetric`, `llm-testing`. Keep as operator tools, or prune?
- **scheduler frozen catalog-seed lineage** (`canonical-concern-catalog.ts` + `scripts/catalog/` + `generate-catalog-migration.ts`/`generate-concern-md.ts`) — carry FROZEN banners, retained as provenance today. `generate-concern-md.ts` writes to a DELETED docs tree (stronger delete candidate).
- **scheduler superseded eval artifacts** (`run-eval-x.ts` + `last-run-x-*.json` + `diagnose-eval-x-*.md`) — one-run 2026-07-02 model-sweep snapshots.
- **`completed_date` payroll date-basis branch** — dead branch, intentionally kept per decision #51.
- **Governance:** `scheduler-app/scripts/eval/stage3-adjudication.json` is git-tracked but listed in the eval `.gitignore` (may embed real customer text) → confirm + `git rm --cached` if so.

## 4. Config fixes (dotfiles — `.claude/rules/**` is Claude-deny-listed; Chris edits or authorizes a workaround)
- `tool-preference.md:99` — cites nonexistent `v2-bash-checklist.mjs` hook → point at the settings deny-list. `:125` — phantom `Plan/` path → `.claude/work/` + `docs/`.
- `build-orchestration.md:13` — Surfaces list omits **qteklink-app**; "shared by scheduler + keytag" mischaracterizes the now-32-function edge tier.
- `observability.md` #1–#2 — assert `next-safe-action` universally; add the recalibration caveat (admin-app = `wrapAdminAction`).
- `module-manifest.json` — add lock units for **tekbridge**, **back-office**, **document-intake** (no module to `/project-start`-claim today).
- Add a **tekbridge** entry to the rules/skills (absent everywhere despite shipping).

## 5. Memory consolidation (additive = do now; archives = confirm)
- **CREATE `apps-overview`** memory (the §1 per-app capabilities — the highest-value gap; every memory today is an event log).
- **CREATE `open-config-items`** memory (scattered "Chris must set X": back-office recipient lists + `reopened_emails`, payroll alert lists, document-intake Sentry rule + shop-PC agent, telnyx `TELNYX_PUBLIC_KEY` + CLN-3, tekbridge concern-update role, Jeff Cantrel email typo).
- **ADD** `feedback_feature_workflow_always` to `MEMORY.md` (only un-indexed file); **regroup** `MEMORY.md` by app/module.
- **UPDATE (stale):** `code-review-gate` (45→52 agents, gpt-5.5→gpt-5.6-terra, "nothing committed"→committed) · `scheduler-blockday-waiter-plan` ("waiting on" dep shipped 2026-07-18 → unblocked) · `telnyx-10dlc-campaign-state` (verify) · `tekmetric-bridge-platform` (dedup the shipped Phase-2 leftover) · `qteklink-live-state` (trim done backlog).
- **DEDUP:** qteklink posting-invariant lesson (state once in `qteklink-live-state`) .
- **ARCHIVE (confirm):** `keytag/keytag-audit-2026-06-25` + `keytag-board-fix-project` (lift 2 durable lessons first: imperative-await vs `useActionState`; keep shared code inside `admin-app/`).
- **COMPRESS (confirm):** `code-review-gate` session-log tail; `qteklink-payroll-module` round-by-round log → durable facts + doc pointers.

## 6. Documentation
- **GAP: no per-app as-built architecture doc** for admin-app + qteklink-app (truth scattered across ~20 plan docs). Recommend one each.
- **tekbridge** as-built reference (the plan doc predates the build; token-refresh made the Fly.io/browser hedging moot).
- **scheduler arch doc** (`.claude/memory/scheduler/scheduler_system_architecture.md`) stale refs: `ChatBubble`, `append-bubble.ts`, `supabase/server.ts` (deleted); 2-stage→3-stage; 18→26 tests.
- **`docs/admin-dashboard/*`** all SUPERSEDED 2026-07-12 (describe old orchestrator MD-upload model) — archive.
- **Archive candidates:** `docs/scheduler/` May pre-launch set + `edge-parity/` (documents the deleted MD-upload surface) + one-run eval outputs; `docs/qteklink/` ~10 historical plans.

---

## Execution order (once approved)
1. Memory: create `apps-overview` + `open-config-items`, regroup index, apply UPDATE/DEDUP fixes, archive (on OK).
2. Docs: write the tekbridge + per-app as-built refs; correct the scheduler arch-doc stale refs; archive superseded docs.
3. Code deletions (per approved group): 2A, then 2B (MCP/OAuth teardown — migration to drop `oauth_*` + a redeploy of the trimmed `orchestrator-mcp` + removal of `mcp-auth`), 2C (qteklink DB drops), 2D/2E (deps/scripts). Each verified (typecheck + tests + fn sweep) before commit; deletions on a branch if you prefer.
