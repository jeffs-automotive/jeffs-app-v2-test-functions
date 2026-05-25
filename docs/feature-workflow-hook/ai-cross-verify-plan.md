# AI cross-verify — implementation plan

> **Status:** APPROVED 2026-05-25. Ready to build.
> **Parent:** feature-workflow-hook (docs/feature-workflow-hook/PLAN.md)
> **Purpose:** add a Claude-independent second + third opinion to plans + builds. Catches assumptions Claude made + cross-app patterns Claude didn't see. Triggered manually via `/feature-cross-verify` or directly via `node scripts/ai-review.mjs ...`.

---

## 1. Why

Claude works alone. Even with the new feature-workflow hook enforcing research → plan → implement → verify, the actual judgment at each step is Claude's. When Claude is wrong, nothing catches it before code lands.

Existing scheduler-app scripts (`scripts/gemini-audit-scheduler-app.mjs`, `scripts/gpt-audit-scheduler-app.mjs`) prove the pattern: send the whole codebase to Gemini 2.5 Pro + GPT-5.5 via REST, get back fresh-eyes findings. But those scripts hardcode the whole scheduler-app path. Not generic, not invocable per-feature.

This feature builds a **generic** version: arbitrary file list + a brief "what we're doing" description → both models in parallel → markdown findings.

---

## 2. Locked decisions (per 2026-05-25 design Q&A)

| # | Decision |
|---|---|
| D1 | **Both models always, in parallel** (Gemini 2.5 Pro + GPT-5.5). Cost ~$0.10-1 per review depending on file count. Two perspectives surface disagreements that hint at real issues. |
| D2 | **New `/feature-cross-verify` slash command + standalone CLI script.** No hook auto-trigger. Outputs findings as artifacts; Chris reads + decides. Doesn't block phase transitions. |
| D3 | **Files-as-CLI-args + findings to `.claude/work/ai-review-{ISO}.md`**. Shell-friendly invocation; output is an artifact Chris can link from the feature marker. |
| D4 | **Non-prescriptive prompt** — system instruction is "fresh eyes, flag what matters." Don't bias the reviewer toward what we already think. User message just supplies "what we're doing" + file contents. |
| D5 | **Models pinned** to verified-current strings: `gemini-2.5-pro` + `gpt-5.5-2026-04-23`. Update by editing the script when newer versions ship. |

---

## 3. CLI shape

```bash
node scripts/ai-review.mjs \
  --what "adding loading spinners to ReconcileTab + write forms" \
  admin-app/src/components/keytag/ReconcileTab.tsx \
  admin-app/src/components/keytag/AssignKeytagForm.tsx \
  admin-app/src/components/keytag/ReleaseKeytagForm.tsx
```

Required args:
- `--what "<description>"` — the change being reviewed. Free text. Brief enough to keep prompts cheap.
- One or more file paths (positional). Paths must exist + be readable. Hard-fails on missing files.

Optional flags:
- `--output <path>` — override the default `.claude/work/ai-review-{ISO}.md`
- `--model <gemini|gpt|both>` — default `both`. Manual override.
- `--max-tokens-per-file <N>` — default 8000. Truncates files larger than this with a "..." marker + a note in the prompt. Protects against accidentally sending 500KB files.

Exit codes:
- `0` — both models returned findings (success, even if findings include blockers — they're warnings, not script errors)
- `1` — one or both API calls failed (network, auth, rate limit). Output file may be partial.
- `2` — bad args (missing --what, no files supplied, files don't exist)

---

## 4. Prompt design (non-prescriptive)

### System instruction (same for both models)

> "You are a senior software reviewer brought in for a second opinion. The user will describe what they are doing and supply the relevant files. Read everything, then surface the highest-signal findings.
>
> Be concise. Don't repeat the user's intent back. Don't list what looks fine. Focus on:
>   - Bugs (logic errors, missed edge cases, race conditions)
>   - Architectural smells (wrong layer, leaky abstractions, hidden coupling)
>   - Security risks (PII leaks, auth gaps, injection, missing validation)
>   - Missing tests, missing observability, missing error handling
>   - Patterns the user may not know exist in their own codebase
>
> Format your reply as markdown with severity buckets: BLOCKER / IMPORTANT / NICE-TO-HAVE. If you have nothing material to flag, say so plainly — don't pad."

### User message (per call)

```
What we're doing:
{--what value}

Files for review:

### admin-app/src/components/keytag/ReconcileTab.tsx
```{file extension}
{file contents, truncated to --max-tokens-per-file if needed}
```

### admin-app/src/components/keytag/AssignKeytagForm.tsx
```{file extension}
{file contents}
```

...
```

No "look for X". No "check Y." Just what + the files. Fresh eyes.

---

## 5. Output artifact shape

`.claude/work/ai-review-2026-05-25T21-45-00Z.md`:

```markdown
# AI cross-verify — 2026-05-25T21:45:00Z

**What:** adding loading spinners to ReconcileTab + write forms
**Files:** 3
**Cost estimate:** ~$0.23 (Gemini $0.12 + GPT $0.11)

---

## Gemini 2.5 Pro

{Gemini's verbatim markdown response}

---

## GPT-5.5 (gpt-5.5-2026-04-23, reasoning.effort=high)

{GPT's verbatim markdown response}

---

## Disagreements

{Optional: simple keyword diff. Anything one flagged as BLOCKER that the other didn't mention.}
```

---

## 6. File inventory

**Main repo (jeffs-app-v2-test-data):**

| Path | Purpose |
|---|---|
| `scripts/ai-review.mjs` | CLI entry point (~200 lines). Parses args, reads files, dispatches both models in parallel, writes findings. |
| `scripts/lib/ai-review-gemini.mjs` | Gemini REST helper (~60 lines). System+user prompt → response markdown. |
| `scripts/lib/ai-review-gpt.mjs` | GPT Chat Completions REST helper (~60 lines). Same shape; uses `reasoning.effort: "high"`. |
| `docs/feature-workflow-hook/ai-cross-verify-plan.md` | THIS FILE. |

**Dotfiles repo (dotfiles-v2-test-data):**

| Path | Purpose |
|---|---|
| `jeffs-app-v2-test-data/.claude/commands/feature-cross-verify.md` | Slash command spec — Claude runs `node scripts/ai-review.mjs --what "<phase summary>" <files-changed>` and reports findings back to Chris. |

---

## 7. Phasing

| Phase | Scope |
|---|---|
| 7.1 | API key resolution helper (reused from existing audit scripts) + Gemini caller + GPT caller |
| 7.2 | `ai-review.mjs` arg parser + file reader + dispatcher |
| 7.3 | Markdown output writer |
| 7.4 | `/feature-cross-verify` slash command |
| 7.5 | Smoke test against this very plan doc (the plan asks Claude to review its own files; cute eat-your-own-dogfood test) |
| 7.6 | Commit + push (main + dotfiles) |

---

## 8. Verify

Smoke-test scenarios:

1. **Happy path:** invoke with --what + 2-3 small files → confirm both models respond → output file written + readable markdown
2. **Missing --what:** exit 2 with clear error
3. **Missing file:** exit 2 with clear "file not found: ..."
4. **Massive file (>10MB):** truncated with marker, no OOM
5. **Network failure (block API host or unset env var):** exit 1 with clear error per model + partial output file (whichever model succeeded)
6. **Both models agree on no findings:** clean output, no panic
7. **Models disagree:** disagreement section populated

---

## 9. Open follow-ups

- **Cache hits:** if a file hasn't changed since the last review, could skip re-sending. Adds complexity; defer until cost actually matters.
- **Diff-only mode:** instead of full file contents, send `git diff` since a base SHA. Cheaper for incremental reviews. Defer.
- **Auto-prompt with git context:** infer --what from recent commit messages. Magical but lossy. Keep explicit for now.
- **Hook integration:** could wire `/feature-cross-verify` to auto-fire at the end of `/feature-plan` and `/feature-verify` if Chris wants enforcement (locked decision D2 said no for v1; can revisit).
- **Cost accounting:** running estimate based on input/output tokens. Pretty-print as part of the artifact (already in the output shape).
