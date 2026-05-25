# Feature-workflow hook — implementation plan

> **Status:** APPROVED 2026-05-25. Ready to build.
> **Owner:** Chris (decisions) + Claude (build).
> **Purpose:** force the research → plan → implement → verify discipline on Claude when starting new features. Stop the "jump straight to code" failure mode that just bit us on (1) E2E test enablement, (2) loading spinners.

---

## 1. Why

Chris's "no assumptions / audit before changes" rule is in `MEMORY.md`. It works when Claude reads it. It fails when:

- Claude is mid-flow on a multi-step task and gets a follow-up feature request
- The new feature looks small enough to skip planning
- Context pressure compresses the discipline into "let's just code it"

The fix is **hook enforcement** — make Claude Code physically stop writing code until the upstream steps have been declared done.

---

## 2. Locked decisions (per the 2026-05-25 design discussion)

| # | Decision |
|---|---|
| D1 | **Hybrid design**: slash-command phase mode (explicit opt-in) **+** UserPromptSubmit prompt-warning hook (catches forgotten opt-in) |
| D2 | **Hard block** on phase violations (not just warn). Bypass requires explicit `/feature-skip`. |
| D3 | **Gated paths**: `admin-app/src/**`, `admin-app/app/**`, `scheduler-app/src/**`, `scheduler-app/app/**`, `supabase/functions/**`, `supabase/migrations/**` |
| D4 | **Reads always allowed** — only Write/Edit/MultiEdit gate. Test runs, log queries, doc reads pass through. |
| D5 | **Plan doc itself does NOT get gated** — Claude needs to write the plan doc DURING the `plan` phase. So `docs/**` and `.claude/work/**` are excluded from the block list. |
| D6 | **Skip marker auto-expires** after 30 minutes. Single-shot bypass for genuine small fixes. |

---

## 3. State file shape

`.claude/work/current-feature.json`:

```json
{
  "feature": "loading-spinners",
  "phase": "research" | "plan" | "implement" | "verify" | "done",
  "started_at": "2026-05-25T14:00:00Z",
  "phase_entered_at": "2026-05-25T14:30:00Z",
  "artifacts": {
    "research": [".tmp/research-2026-05-25T14-15.md"],
    "plan": ["docs/admin-app/loading-spinners-plan.md"],
    "implement_commits": ["abc1234"],
    "verify_commands": ["npm run typecheck", "npm run build"]
  }
}
```

When `phase === "done"` OR file is absent: no enforcement (small fixes pass naturally).

Companion skip file `.claude/work/feature-skip.json`:

```json
{
  "reason": "small fix to typo in card title",
  "started_at": "2026-05-25T14:45:00Z"
}
```

Hook treats skip as active for 30 minutes from `started_at`; auto-expires.

---

## 4. Hook A — `feature-phase-guard.mjs` (PreToolUse)

**Fires on:** every tool call (PreToolUse with `matcher: "*"`).

**Reads:**
- `.claude/work/current-feature.json` (if present)
- `.claude/work/feature-skip.json` (if present + not expired)

**Decision tree:**

```
1. If skip file exists + not expired (now - started_at < 30 min):
     → APPROVE (skip honor)
2. If no current-feature.json OR phase === "done":
     → APPROVE (no active feature; small fixes pass)
3. If tool is not in {Write, Edit, MultiEdit}:
     → APPROVE (reads, bash, etc. always allowed)
4. If tool.input.file_path is NOT under a gated path:
     → APPROVE (docs/plans/memory always editable)
5. Based on phase:
     - "research" → BLOCK with "Research phase. Code edits not allowed. Use /feature-plan when research is done."
     - "plan"     → BLOCK with "Plan phase. Code edits not allowed. Finish the plan doc then use /feature-implement."
     - "implement"→ APPROVE
     - "verify"   → BLOCK with "Verify phase. No new code edits during verify. If a fix is needed, use /feature-implement to go back."
```

**Block output shape** (per Claude Code PreToolUse spec):

```json
{
  "decision": "block",
  "reason": "Feature phase is 'research'. Code edits to admin-app/src/... are blocked. Either: (a) finish research + /feature-plan, OR (b) /feature-skip if this is unrelated to the current feature."
}
```

**Performance:** must complete in < 5000ms (Claude Code default hook timeout). All ops are local file reads — trivial.

---

## 5. Hook B — `feature-prompt-warning.mjs` (UserPromptSubmit)

**Fires on:** every user message (UserPromptSubmit with `matcher: "*"`).

**Reads:**
- The user's prompt text (`hookInput.prompt`)
- `.claude/work/current-feature.json` (to know if feature mode is already active)

**Decision tree:**

```
1. If feature-mode is already active (current-feature.json exists + phase !== "done"):
     → APPROVE silently (Claude already knows it's in feature flow)
2. If prompt matches a "new feature" trigger pattern:
     Triggers: /\b(let'?s? )?(add|build|create|make|implement)\b/i
              + /\b(feature|page|tab|component|surface|button|form)\b/i
     in the same prompt
     AND prompt does NOT contain anti-trigger:
     Anti-triggers: /per the plan|already planned|after researching|finish the existing|continue.*phase/i
     →  Inject systemMessage:
        "It looks like this might be a new feature. Per the
         research → plan → implement → verify rule, run
         /feature-start <name> first so the hook can guide you.
         If this is a small fix, /feature-skip to bypass."
3. Else:
     → APPROVE silently
```

**Output:** `{ "systemMessage": "..." }` — visible to Chris in the UI, NOT seen by Claude in conversation. The reminder is for Chris to interrupt + redirect Claude.

Optional (deferred): could also use `additionalContext` so Claude itself sees the reminder. But that adds noise to every "let's add a button" message. Keep as Chris-visible only for v1; iterate.

---

## 6. Slash commands

Seven `.claude/commands/*.md` files. Each is a markdown spec for Claude on what the phase means + state-file manipulation.

### `/feature-start <name>`

Initialize a feature. Sets phase = "research". Writes the marker.

```markdown
# Start a new feature

You're starting a new feature: $ARGUMENTS

1. Create `.claude/work/current-feature.json` with:
   { feature: "$ARGUMENTS", phase: "research", started_at: <now>, phase_entered_at: <now>, artifacts: { research: [], plan: [], implement_commits: [], verify_commands: [] } }
2. The feature-phase-guard hook is now active. You CANNOT write to src/app/supabase paths until you transition to "implement" phase.
3. Begin the research phase: read existing code, official docs, related plans. Cite sources.
4. When research is complete, run `/feature-plan` to transition.
```

### `/feature-research`

Mark research phase. Used if you skipped /feature-start. (Same effect as start but doesn't take a name.)

### `/feature-plan`

Transition to plan phase. Update phase + phase_entered_at in marker file. Claude writes the plan doc + adds the path to `artifacts.plan`. Hook still blocks src writes.

### `/feature-implement`

Transition to implement phase. **Requires** at least one entry in `artifacts.plan` (Claude refuses transition otherwise). Hook now allows src writes.

### `/feature-verify`

Transition to verify phase. Hook blocks new src writes (forces you to run tests/build only). Claude runs typecheck/build/test and appends to `artifacts.verify_commands`.

### `/feature-done`

Mark phase = "done". Hook stops enforcing. Feature is complete; commit the marker file change.

### `/feature-skip <reason>`

Write `.claude/work/feature-skip.json` with reason + 30min TTL. Bypass for genuine small fixes.

---

## 7. Edge cases

| Case | Behavior |
|---|---|
| Marker file is malformed JSON | Hook treats as "no marker" → no enforcement. Logs warning. |
| Skip file expired | Hook ignores skip; falls through to phase check. |
| Multiple consecutive features (forgot /feature-done) | Hook still enforces against the stale marker. Use `/feature-done` first or `/feature-skip` for the new work. |
| Hook itself has a bug | Falls back to APPROVE on any exception. Don't break Claude. |
| Hook timeout (>5s) | Claude Code treats as APPROVE by default. Acceptable — all our checks are local file reads, no network. |
| Chris wants to disable for a session | Add `FEATURE_GUARD_DISABLED=1` env var check at top of hook. Set in shell when needed. |
| Cross-app boundary (admin-app feature creates supabase migration) | Both paths gated. Single feature = single marker. Allow as long as phase = implement. |
| `verify` blocks legit hotfix | Use `/feature-implement` to flip back. Explicit; one-line cost. |

---

## 8. File inventory

**dotfiles-v2-test-data (committed there since hooks are shared):**

| Path | Purpose |
|---|---|
| `jeffs-app-v2-test-data/.claude/hooks/feature-phase-guard.mjs` | PreToolUse hook (~120 lines) |
| `jeffs-app-v2-test-data/.claude/hooks/feature-prompt-warning.mjs` | UserPromptSubmit hook (~80 lines) |
| `jeffs-app-v2-test-data/.claude/commands/feature-start.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/commands/feature-research.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/commands/feature-plan.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/commands/feature-implement.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/commands/feature-verify.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/commands/feature-done.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/commands/feature-skip.md` | Slash command spec |
| `jeffs-app-v2-test-data/.claude/settings.json` | + 2 hook registrations |

**jeffs-app-v2-test-data (this repo):**

| Path | Purpose |
|---|---|
| `docs/feature-workflow-hook/PLAN.md` | THIS FILE (committed for posterity) |

---

## 9. Verify

Smoke scenarios to run after build:

1. **Idle state:** no marker file → confirm Write/Edit works on a gated path (sanity check that hook doesn't always block).
2. **Research block:** `/feature-start test`. Try to Edit `admin-app/src/lib/test.ts`. Expect block with reason mentioning "research phase".
3. **Plan block:** `/feature-plan`. Try to Edit same file. Expect block with reason mentioning "plan phase".
4. **Plan-doc OK:** `/feature-plan` still active. Write `docs/test/PLAN.md`. Expect APPROVE (docs/** not gated).
5. **Implement OK:** `/feature-implement` (after `/feature-plan` added an artifact). Try to Edit `admin-app/src/lib/test.ts`. Expect APPROVE.
6. **Verify block:** `/feature-verify`. Try to Edit `admin-app/src/lib/test.ts`. Expect block.
7. **Done releases:** `/feature-done`. Try Edit. Expect APPROVE.
8. **Skip bypass:** with marker in research phase, `/feature-skip "typo fix"`. Try Edit. Expect APPROVE.
9. **Skip expiry:** mutate skip file's started_at to >30min ago. Try Edit. Expect block.
10. **Prompt warning:** with no marker, send "let's add a new button". Confirm systemMessage appears in UI.

All 10 scenarios should pass before the hook lands in production.

---

## 10. Open follow-ups (defer)

- **Cross-session continuity:** if Claude clears or compacts, the marker file persists — so phase carries forward. That's correct behavior. Document in MEMORY.md.
- **Multi-feature parallelism:** v1 supports one active feature at a time. If you need to context-switch, `/feature-done` (or skip) the current one, `/feature-start` the new one.
- **Artifact validation in `/feature-implement`:** v1 just checks `artifacts.plan.length > 0`. A future version could verify the file actually exists + has > N bytes.
- **Phase-duration metrics:** could log entries to a separate file for retrospective ("research took 5min, plan 30min, implement 2hr, verify 10min"). Deferred.
