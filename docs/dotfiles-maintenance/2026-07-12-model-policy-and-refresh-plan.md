# Model policy + dotfiles refresh — plan (2026-07-12)

> Chris's directives (2026-07-12): (1) switch the OpenAI review models from GPT-5.5 to **Terra**;
> (2) main loop on **Opus 4.8** with **effort `max` for planning** and **ultracode for implement/review**;
> (3) review subagents on **Fable 5, always at ultracode-equivalent effort**; (4) full dotfiles hygiene
> pass — everything up to date and indexed correctly, even where untouched by this work.
> Research + audit evidence: 9-agent workflow `wf_67101407-8c2` + gap-fill `wf_c573716f-aa1` (2026-07-12).

---

## 0. Research conclusions the plan rests on

| Fact | Source (fetched 2026-07-12) |
|---|---|
| "Terra" = **`gpt-5.6-terra`**, mid tier of OpenAI's GPT-5.6 family (Sol/Terra/Luna), GA 2026-07-09 | developers.openai.com/api/docs/models/gpt-5.6-terra |
| Terra pricing **$2.50 in / $0.25 cached / $15 out per MTok** — exactly **half of GPT-5.5** ($5/$0.50/$30) | same |
| Terra ≥ GPT-5.5 on every published coding/agentic benchmark (SWE-Bench Pro 63.4 vs 59.4; Terminal-Bench 2.1 87.4 vs 85.6; AA Coding Agent Index 77.4 vs 76.4) | OpenAI launch data via MarkTechPost + Vellum; AA self-measured index |
| Terra `reasoning_effort` values: `none/low/medium/high/xhigh/max` (default `medium`; **no `minimal`**) | OpenAI API reference for gpt-5.6-terra |
| Terra is on **v1/responses, v1/chat/completions, v1/batch** — both our call paths work unchanged | OpenAI changelog 2026-07-09 |
| Caution: no independent code-REVIEWER validation of any GPT-5.6 tier yet; AA-IFBench instruction-following 71.2 (vs GPT-5.4's 73.9); METR flagged reward-hacking on **Sol** (not Terra) | artificialanalysis.ai, METR 2026-06-26, BenchLM |
| Claude Code effort surfaces: `effortLevel` settings key persists **low/medium/high/xhigh only**; `max` + `ultracode` are **session-only** (`/effort`, `--effort`; ultracode needs v2.1.203+) | code.claude.com/docs/en/model-config, /en/settings |
| Subagent frontmatter supports **`model:` (incl. `fable`) and `effort:` (low→max, no ultracode)**; effort inherits from session unless overridden; dispatch `model` param overrides frontmatter; `CLAUDE_CODE_SUBAGENT_MODEL` env overrides everything | code.claude.com/docs/en/sub-agents |
| Skill/command frontmatter supports `model:` + `effort:` — applies for the rest of the invoking turn | code.claude.com/docs/en/skills |
| Ultracode = `xhigh` to the model + dynamic-workflow orchestration. A read-only single-task subagent doesn't orchestrate workflows, so **`effort: xhigh` IS the ultracode-equivalent for a subagent** | code.claude.com/docs/en/model-config |
| No plan-mode↔execution effort auto-split exists (only `opusplan`, which is model-level and Opus→Sonnet — not our shape) | same |

**Terra decision:** adopt `gpt-5.6-terra` for both OpenAI call paths. Rationale: it beats the model it
replaces (5.5) on every published benchmark at half the price, and both our API surfaces support it.
The reviewer-reliability caveats are managed by (a) the gate's existing fail-closed design, (b) the
`CODE_REVIEW_MODEL` env var as an instant no-code rollback to `gpt-5.5-2026-04-23`, and (c) a verify-phase
smoke run before this ships.

---

## Part A — Claude model + effort policy

**A1. Project settings** — `dotfiles…/.claude/settings.json` (project scope beats Chris's user-level
`"model": "claude-fable-5[1m]"`, which stays untouched for other projects):
- add `"model": "opus"` (alias → latest Opus = 4.8; auto-tracks)
- add `"effortLevel": "xhigh"` (persistable baseline = ultracode's model signal; `max`/`ultracode` are not accepted here by design)

**A2. Session effort conventions** (config can't fully express them — encode as command-file banners):
- `feature-plan.md`: add frontmatter `model: opus` + `effort: max` (covers the plan-writing turn) + a body reminder: "planning sessions run `/effort max`; drop back to ultracode for implement".
- `feature-implement.md` + `feature-verify.md`: body reminder "run `/effort ultracode` (v2.1.203+) for implement/review sessions — it cannot be persisted in settings".
- `feature-research.md`: no change (xhigh baseline is right).

**A3. Reviewer subagents → Fable 5 @ xhigh** — all 11 read-only reviewers in `.claude/agents/`
(quickbooks-/supabase-/vercel-/sentry-compliance, security-, pattern-, regression-, design-, wiring-,
dead-code-, behavior-parity-review): frontmatter `model: opus` → `model: fable`, add `effort: xhigh`.
**Builders stay Opus**: `frontend-implementer`, `frontend-design-director` keep `model: opus` (no effort
field — inherit the session's ultracode/xhigh).

**A4. Dispatch-time pins must move with frontmatter** (dispatch `model` param overrides frontmatter):
- `feature-verify.md:413–414` — both reviewer fan-out lines: `model: "opus"` → `model: "fable"`.
- `feature-plan.md:246` (design-director) and `feature-implement.md:211` (implementer): stay `model: "opus"`.
- `.claude/agents/INDEX.md` — contract item 8 + dispatch examples (lines ~86/102/121/127): reviewers `model: "fable"` + `effort: xhigh` note; builders opus.
- `.claude/memory/feedback_opus_for_subagents.md` — rewrite to the role-split rule (reviewers fable@xhigh, builders/other opus); keep the strong-verifier rationale; keep the "dispatch param overrides frontmatter" and `CLAUDE_CODE_SUBAGENT_MODEL` warnings.
- `.claude/memory/MEMORY.md:67` echo line — update to match.

**A5. Why this shape (evidence):** Anthropic's own default recommendation for agentic coding is Opus 4.8
("start with Claude Opus 4.8 for complex agentic coding"); Fable 5 is positioned for highest-capability
verification-grade work at 2× Opus price; cross-model fresh-context review is the officially documented
Writer/Reviewer pattern and the best-supported finding in the verifier literature (CriticGPT 2407.00215,
self-preference bias 2404.13076, verification asymmetry 2305.20050). Implementation volume moves to the
$5/$25 model; the $10/$50 model runs only the bounded, cache-friendly review slice.

## Part B — OpenAI swap: gpt-5.5 → gpt-5.6-terra

Functional (2 lines):
- `scripts/lib/ai-review-gpt.mjs:13` — `const MODEL = "gpt-5.5-2026-04-23"` → `"gpt-5.6-terra"` (cross-verify path; Chat Completions; sends no effort param — Terra defaults to `medium`, fine).
- `scripts/code-review.mjs:70` — default fallback → `"gpt-5.6-terra"` (gate path; @openai/agents → Responses API; `CODE_REVIEW_REASONING_EFFORT` env stays default `medium`, valid for Terra).

Accuracy/doc updates in the same pass:
- `ai-review-gpt.mjs` comments (2,5,6,8,9,41,46,54–63), `code-review.mjs` JSDoc :36 + effort-enum comment :76 (Terra set: none/low/medium/high/xhigh/max — drop `minimal`), `ai-review.mjs:4` header.
- Document `CODE_REVIEW_REASONING_EFFORT` (currently undocumented anywhere): add to `code-review.mjs` Env JSDoc, `code-review.md:81` tunable-env list, `agent-builder-design.md:235` env table.
- `agent-builder-design.md`: model refs :31/:215/:235 → terra; `schema_version` sample `code-review-1.0` → `code-review-2.0`; `CODE_REVIEW_MAX_TURNS` default 25 → 30.
- `.agents/skills/code-review/README.md:6`, `code-review-agents.mjs:7,37` prose; `feature-cross-verify.md:58` → "Gemini 3.5 Flash + GPT-5.6 Terra"; `docs/feature-workflow-hook/ai-cross-verify-plan.md` (D5 row :27 + :13,23,52,110,116,137) — append a dated D5 amendment rather than rewriting history; dotfiles `README.md:211`.
- Gemini stays `gemini-3.5-flash` (already current). No `OPENAI_MODEL` env exists; nothing else to move.

Rollback: `CODE_REVIEW_MODEL=gpt-5.5-2026-04-23` env (gate, zero-code) / revert the one-line pin (cross-verify). Invalid-id failure mode is fail-closed (verified: gate=block, exit 1).

## Part C — Hygiene cleanup (from the 7-audit sweep + critic)

**C-CRITICAL**
1. `deployment.md:78` — `supabase link --project-ref lrsazdxnbtjczpvngcud` (**PROD**) → `itzdasxobllfiuolmbxu`; also :76 stale `~/Apps/jeffs-app-v2` path. [rules → Bash workaround, Chris-authorized]

**C-HIGH (contradictions / broken refs)**
2. `pattern-compliance.md` — remove the nonexistent `Plan/references/` bundle instructions (§1 + "Reference bundle conventions"), point at `.claude/work/planning/references/` + `.claude/memory/`; drop Context7 as usable (:5,:7,:160); add the scheduler-app/admin-app Thin-Action-departure callout mirroring `cross-module-anchors.md`. [rules]
3. `tool-preference.md` — "Next.js 16" → 15 (:7,:19); `mcp__vercel__*` → `mcp__vercel-team__*` (:53,:55,:56,:63). [rules]
4. `MEMORY.md:177` — names the wrong file (deployment.md) for the vercel-tool drift; it's tool-preference.md. [memory]
5. Claude-Desktop-retired cluster (retired 2026-07-02, still described as live): `ai_sdk_and_models.md:34–42` project-assignment rows; `MEMORY.md:178` reminder #5 ("3 wizard LLM helpers" → 1: `diagnose-concern.ts`; router/advisor deleted); `MEMORY.md:143` "uploaded via Claude Desktop MCP" → /schedulerconfig webforms; `confirmation_patterns_decision_tree.md` TL;DR note (Pattern A chat surface retired; keep content as reference); `keytag_system_architecture.md` status banner (:3) + :340 `orchestrator.ts` DELETED note; **create** project-tree `feedback_claude_desktop_retired.md` (C2 broken-ref — copy policy from auto-memory) + index it.
6. `ai_sdk_and_models.md` — dated banner: 4.7/4.6/4.5 table is a superseded May-2026 snapshot (Opus 4.8/Fable 5 shipped); **KEEP** the `ai@^5`/`@ai-sdk/anthropic@^2`/`zod@^4` pins (bug vercel/ai#12020) and the in-app wizard model strings untouched. Same banner treatment on `cross-module-anchors.md:66` §F pin. **In-app model bumps are explicitly OUT of scope — Chris decides separately.**

**C-INDEX-DRIFT**
7. `MEMORY.md`: add qteklink as 3rd live system (§What's live, "Two systems" → three); command count 9 → 12 + `/project-*` trio (:68,:119,:120); hooks list + `feature-ui-agents.mjs` + lib/ (:121); `scheduler-refactor-state.json` COMPLETE not in-flight (:152,:81); refresh "Where I am right now" (:186–189); drop hard "16 active + 5 resolved" count (:182 → "see file").
8. Code-review agent-count chain — true count **52** (verified): `code-review-agents.mjs` header "(50)" → 52; "45 atomic agents" in `build-orchestration.md:45`, `cross-module-anchors.md:4`, `orchestration.md:73`; `AUDIT-2026-05-31.md:150` gets a dated correction note (audit docs are records — annotate, don't rewrite). Create the 2 missing skill dirs (`tekmetric-id-vs-human-number`, `tekmetric-posted-status-5-6`) under `.agents/skills/code-review/` following sibling SKILL.md shape.
9. `orchestration.md:38–43` hook table: add `feature-ui-agents.mjs | PostToolUse` (+ note session-start/pre-compact infra hooks); gated-paths table :42 + `feature-start.md:371` blocked-list: add `qteklink-app/src/**`, `qteklink-app/app/**`.
10. Dotfiles `README.md`: `(9 slash commands)` → 12 + add `/project-*` rows to the command table (:132, :206–216); "7 reviewers" → 11 + builder pair (:127); hooks line/table + `feature-ui-agents` (:131, :195–201); `Gemini 2.5 Pro` → `Gemini 3.5 Flash` (:211).
11. Commands: `project-start.md:502` module list + `loaner` (8 modules); `feature-done.md:176` archive filename → `{name}-{shipped|done|paused}-{ISO}` (status token was missing) + Windows-safe-dash note + fix the timestamp interpolation that produced `tekmetric-ro-mirror-shipped-undefined.json`.
12. `artifact-conventions.md` Docs section: index all docs/ subdirs (add code-quality, design, feature-workflow-hook, keytag, qteklink, tekmetric + new dotfiles-maintenance). [rules]
13. Scheduler arch doc: create `scheduler/scheduler-change-log.md` sibling (move the giant :11–126 header block per the ~500-line file policy) fixing broken-ref :126; fix the 5 `docs/chat-instructions/scheduler/` broken refs (:407,:838,:1267,:1268,:1331) → current /schedulerconfig webform pointers.
14. `project_stack.md`: :55 "three wizard LLM helpers" → one; :118 snapshot annotation; frontend-stack disclaimer line. `keytag-change-log.md:8` H1 sync (cosmetic).
15. `.claude/work/` runtime state: rename `feature-archive/tekmetric-ro-mirror-shipped-undefined.json` with a real ISO (from file mtime); fix branch field `keytag-board-release-fix` → `keytag-dashboard-spin-fix` in `claims/keytag.lock`, `claims/orchestrator.lock`, `active-projects.json`; note orchestrator co-claim in the registry entry.
16. docs/ tree + skill-body findings from gap-fill workflow `wf_c573716f-aa1` — folded in on completion (§C-GAP addendum below).

**Explicitly NOT touched:** in-app model strings (wizard `claude-haiku-4-5`, env-driven scheduler models);
`ai@^5`/`zod@^4` pins; scheduler-app eval fixtures (`openai/gpt-5.4*` — separate runtime subsystem);
ephemeral run artifacts (`.claude/work/verification-reports/`, `ai-review-*.md`, feature-archive contents);
historical decision logs in qteklink/scheduler/keytag docs; the active `qteklink-payroll` feature marker.

## Verification plan

1. `node --check` on the two edited scripts; grep-zero for `gpt-5.5-2026-04-23` outside historical records.
2. Smoke the gate on Terra: `node scripts/code-review.mjs` scoped to a small changed-file set — expect `gate` computed with `review_complete: true`, 0 failed agents, model stamped `gpt-5.6-terra` in `_summary.json`.
3. Smoke cross-verify: run `scripts/ai-review.mjs` against this plan doc — expect both models OK (also live-tests the Terra chat-completions path).
4. Frontmatter validation: re-read all 13 agent files + changed commands; confirm `model:`/`effort:` values are documented-legal (`fable`, `xhigh`, `max`).
5. Index reconciliation re-check: MEMORY.md entries ↔ files; INDEX.md ↔ agents; README counts ↔ reality; docs index ↔ docs tree. Post-edit symlink health check (`Get-Item` on .claude/.agents links).
6. Report every fix applied vs deferred to Chris, with the dotfiles-repo diff summary (no commit until Chris approves).

## Decision points surfaced to Chris (defaults applied, reversible)

- **Terra effort for the gate:** kept `medium` (current tuning); `CODE_REVIEW_REASONING_EFFORT=high` is the lever if precision on big diffs looks weak. Terra@high ≈ half the cost of 5.5@medium.
- **Fable reviewers at `xhigh` not `max`:** faithful to "ultracode" (ultracode sends xhigh); bump individual reviewers to `max` per-file if wanted.
- **In-app model pins (Opus 4.7 era):** banner-annotated as superseded snapshot, NOT changed — app-behavior change needs its own feature.
- **`docs/chat-instructions/`:** annotated as retired surface, not deleted.
- **User-level `~/.claude/settings.json`** (`claude-fable-5[1m]` global default): left alone; project settings now override for this repo. Change globally only if you want Opus everywhere.

---

## Verification results (2026-07-12, post-implementation)

- `node --check` clean on `code-review.mjs`, `ai-review-gpt.mjs`, `ai-review.mjs`; `code-review-agents.mjs` imports with `AGENTS.length = 52`.
- **Gate smoke on terra: PASS** — `no-silent-supabase-error` over `qteklink-app/src/lib/payroll/pto.ts`: `gate=pass`, `review_complete=true`, 0 failed agents, `model: "gpt-5.6-terra"` stamped in `_summary.json` (reports: `verification-reports/terra-smoke/`).
- **Cross-verify smoke on terra: PASS** — `ai-review.mjs --model gpt` on this plan doc: `gpt_ok=true`, artifact `ai-review-2026-07-12T21-55-47Z.md`.
- Frontmatter validation: all 13 agents legal — 11 reviewers `fable`/`xhigh`, 2 builders `opus`/inherit.
- Index reconciliation: 0 broken MEMORY.md links, 0 unindexed memory files (change-log sibling indexed), 52/52 code-review skill dirs, `.claude`/`.agents` symlinks healthy.
- Stale-string sweep: remaining `gpt-5.5-2026-04-23` hits are rollback notes, the dated one-shot `scripts/gpt-audit-scheduler-app.mjs` (historical), and archive records — all intentional.

Status: implemented + verified; **uncommitted in both repos pending Chris's approval.**

## Round 2 (2026-07-12, Chris's follow-up directives)

1. **Dotfiles committed:** `745aa67` (70 files, +5243/−122; includes previously-uncommitted audit-trail
   files — design specs, feature archives, loaner module manifest entry).
2. **In-app pins resolved:** the sole live in-app LLM (`diagnose-concern.ts`) runs `claude-haiku-4-5`,
   which is STILL the current Haiku — so no runtime change was needed or made. The reference table in
   `ai_sdk_and_models.md` was refreshed to the verified current line (Fable 5 / Opus 4.8 / Sonnet 5 /
   Haiku 4.5), and `cross-module-anchors.md` §F now pins the truthful single in-app model.
3. **Terra → highest effort (`max`):**
   - Gate: `CODE_REVIEW_REASONING_EFFORT` default `medium` → `max` (env steps it back down; `medium`
     was the pre-2026-07-12 tuning — watch FP rate on big diffs).
   - Cross-verify: `ai-review-gpt.mjs` migrated Chat Completions → **Responses API** (the only surface
     that accepts `reasoning.effort`), `reasoning: {effort: "max"}` (env `AI_REVIEW_GPT_EFFORT`),
     legacy usage field names preserved for the caller.
   - Smokes at max: gate PASS (`review_complete: true`, model `gpt-5.6-terra`, new
     `tekmetric-id-vs-human-number` skill exercised live); cross-verify smoke: first run hit a transient network error (`fetch failed` — not the API); a direct minimal /v1/responses probe returned 200 with correct parse/usage, and the re-run passed end-to-end (`gpt_ok: true`, artifact ai-review-2026-07-12T22-16-27Z.md). Migration verified.
