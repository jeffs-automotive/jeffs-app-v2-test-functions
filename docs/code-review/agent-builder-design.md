# Code-review gate — OpenAI Agent Builder design

This is the **design surface** for the specialized code-review gate. You build the
graph + prompts visually in [OpenAI Agent Builder](https://platform.openai.com/agent-builder),
then the workflow runs **locally** via `scripts/code-review.mjs` using the OpenAI
Agents SDK (`@openai/agents`).

> **Why two halves?** Agent Builder's tool nodes are all *hosted* (File search, Web
> search, MCP, Code interpreter…). There is **no local-filesystem function-tool node**.
> Our reviewers must read your changed files + `.claude/rules/*.md` off local disk, so
> the file-reading tools (`read_file`, `list_dir`, `read_rule`, `search_repo`) are
> implemented in `scripts/code-review.mjs`, not in Builder. Use Builder to design the
> graph, the per-reviewer prompts, the model, and guardrails; iterate with Preview/Evals.
> The local runner is what actually executes against your code.
>
> Source of truth for the prompts: **`scripts/lib/code-review-agents.mjs`**. If you edit
> a prompt in Builder, mirror the change back into that file (and vice-versa) so the
> visual workflow and the local runner stay in sync.

## Pinned versions / model

- `@openai/agents@^0.11.6`, `zod@^4`, **Node 22+** (repo runs Node 24).
- Model: `gpt-5.5-2026-04-23` (the model already proven in this repo's GPT tooling).
  Override per-run with `CODE_REVIEW_MODEL`. For review accuracy, raise reasoning
  effort if you move to the Responses-API model-settings path.
- API key: `OPENAI_API_KEY` (falls back to the prod `.env.local`, same resolver as
  `/feature-cross-verify`).

## Deterministic control flow (code-driven, not model-driven)

The runner does NOT hand an agent all files and trust it to iterate. Control flow is an
explicit code loop — the rigid equivalent of a Builder `While` node:

```
validate input (files exist, agents known)         ← rigid INPUT; bad => exit 2
        │
        ▼
build job grid = selected_agents × files           ← one job = one agent, one file
        │
        ▼
for each job (bounded concurrency pool):
    run(agent, "review EXACTLY this one file")      ← one model call, maxTurns cap
        │  retry up to CODE_REVIEW_MAX_RETRIES on error / malformed output
        ▼
    validate each finding (rigid OUTPUT):
        - filename resolves to a real repo file
          (== file under review for single-file reviewers;
           any repo file for cross-file/regression reviewer)
        - severity in enum, >=1 positive integer line number
        - rule_violated cites a rule file in THIS agent's scope
      pass → issues[]   ·   fail → rejected_findings[] (with reason)
        │
        ▼
sort findings deterministically (file, line, severity, text)
        │
        ▼
write {agent}.json + _summary.json
```

**Why this is rigid:** coverage (every file checked by every applicable reviewer) is
guaranteed by the grid loop, not by the model deciding it read enough. Rule-anchoring is
enforced in code after the run, not merely requested in the prompt. The report is
byte-stable regardless of which job finishes first. Nothing is silently dropped — a
malformed finding lands in `rejected_findings` with a reason.

## Graph to build in Agent Builder (optional)

If you mirror this in Builder visually, the per-reviewer subgraph is:

```
[Start] input: files_to_review (array), rule_scope (array)
   │
[Set state] issues_list = []
   │
[While] for each file in files_to_review            ← the explicit loop
   │   ├─ [Agent] review one file (preamble + specialty), outputType = ReviewOutput
   │   ├─ [Transform] validate findings; drop any whose rule_violated isn't in scope
   │   └─ [Set state] append accepted findings to issues_list
   │
[End] output: { findings: issues_list }
```

- The three reviewers are **independent** — no handoffs, no coordinator. Locally they run
  as separate jobs in a concurrency pool; in Builder, three such subgraphs (one per
  reviewer) fan out from Start.
- Each Agent node gets the **shared preamble + its specialty block** as instructions, the
  `ReviewOutput` schema as structured output, and (locally) the four function tools.
- **The local runner is the source of truth** — Builder's `While`/`Transform`/`Set state`
  nodes reproduce the loop + validation visually, but the runner enforces them in code so
  they can't be bypassed.

## Structured output schema (`ReviewOutput`)

Strict mode (OpenAI structured outputs): **all fields required, no optionals**. "Nothing
found" is an **empty `findings` array**, not omitted fields.

```jsonc
{
  "findings": [
    {
      "filename": "string",                       // repo-relative path of the offending file
      "severity": "blocker | important | nice-to-have",
      "rule_violated": "string",                  // "<rule-file.md> - <named rule/anchor>"
      "line_numbers": [1, 2, 3],                  // concrete line(s)
      "issue_found": "string",                    // what the code does
      "explanation": "string",                    // why it violates the cited rule
      "recommended_fix": "string"                 // how to fix it
    }
  ]
}
```

Zod (as used in the runner):

```ts
const Finding = z.object({
  filename: z.string(),
  severity: z.enum(["blocker", "important", "nice-to-have"]),
  rule_violated: z.string(),
  line_numbers: z.array(z.number()),
  issue_found: z.string(),
  explanation: z.string(),
  recommended_fix: z.string(),
});
const ReviewOutput = z.object({ findings: z.array(Finding) });
```

## Function tools (local runner only — not Builder nodes)

| Tool | Purpose |
|---|---|
| `read_file(path)` | Read a changed file in full. |
| `list_dir(path)` | List a directory (for orientation). |
| `read_rule(name)` | Read `.claude/rules/{name}.md` — the standards the agent enforces. |
| `search_repo(pattern)` | Regex-search code roots for callers/dependents (regression reviewer's core tool). |

All are sandboxed to the repo root.

## Reviewer prompts

Every reviewer shares the **preamble** below, then appends its **specialty**. (Canonical
copy: `scripts/lib/code-review-agents.mjs`.)

### Shared preamble (paste into every Agent node)

> You are a specialized, single-purpose code reviewer in an automated pre-deploy gate for
> a multi-tenant auto-shop SaaS (Next.js 15 App Router + Supabase Postgres/Edge Functions
> on Deno). You review ONLY within your assigned specialty and ignore issues that belong
> to other reviewers.
>
> **How you work:** (1) You are given changed files + the rule files defining your
> specialty's standards. (2) Read EVERY changed file in full with `read_file`; read EVERY
> assigned rule file with `read_rule`. Don't skip any. Don't stop at the first problem.
> (3) Full audit, not triage — list every real finding even if there are twenty.
> (4) **Two-pass verification:** Pass 1 note every candidate; Pass 2 re-read the rule file
> and confirm a NAMED rule is explicitly violated — if you can't cite one, discard it.
> (5) Anchor every finding to line numbers and set `rule_violated` to
> `"<rule-file.md> - <named rule>"`. (6) Stay in scope.
>
> **Severity:** `blocker` (data loss / security / multi-tenant breach / broken ship),
> `important` (should fix before ship), `nice-to-have` (minor).
>
> **Output:** structured findings only; empty array if nothing real — never invent issues.

### Reviewer specialties

| Reviewer | Rule scope (`read_rule`) | Hunts for |
|---|---|---|
| **security** | `shop-agnostic`, `observability`, `pattern-compliance`, `cross-module-anchors` | tenant key from client/URL/form instead of session; missing `shop_id` filter / `USING (true)`; `NEXT_PUBLIC_` secrets; PII leaks; missing Zod input validation / injection; silent failures (empty catch, unchecked Supabase `error`); `SECURITY DEFINER` missing `search_path`. |
| **pattern** | `pattern-compliance`, `cross-module-anchors`, `tool-preference` | Thin Action / Fat DAL violations; client-component data fetching; DB convention breaks (cents/TEXT/TIMESTAMPTZ/UUID/`shop_id` FK/RLS InitPlan); RBAC drift; reinvented primitives / off-stack deps; non-shadcn forms. |
| **regression** | `pattern-compliance`, `never-guess` | renamed/removed/changed exports with callers still on the old shape (found via `search_repo`); changed defaults/return/error shapes; renamed DB columns/RPCs referenced elsewhere. Every finding anchors to a concrete broken dependent. |

(Full specialty text is in `scripts/lib/code-review-agents.mjs` — paste each `specialty`
block after the shared preamble in the corresponding Builder Agent node.)

## Running locally

```bash
# from repo root, after npm install
node scripts/code-review.mjs --files scheduler-app/src/foo.ts,supabase/migrations/x.sql
# or via the slash command (infers changed files from git):
/code-review
```

Writes one report per reviewer to `.claude/work/verification-reports/{agent}.json` plus
`_summary.json`. Exit 0 = ran (findings are not a failure); 1 = a job failed after
retries; 2 = bad args/input. The block-on-blocker decision is made by the caller
(`/feature-verify`) or a future PreToolUse hook, not by the exit code.

### Report shape (`{agent}.json`)

```jsonc
{
  "schema_version": "code-review-1.0",
  "agent": "security",
  "model": "gpt-5.5-2026-04-23",
  "generated_at": "2026-…Z",
  "files_reviewed": ["…"],
  "rules_in_scope": ["shop-agnostic", "observability", "…"],
  "ok": true,                                  // false if any file's job failed after retries
  "coverage": { "files_total": 2, "files_ok": 2, "files_failed": 0 },
  "failed_files": [],                          // [{ file, error }] for jobs that never succeeded
  "issues": [ /* validated, rule-anchored, sorted Finding[] */ ],
  "rejected_findings": [ { "file": "…", "reason": "…", "raw": { /* the dropped finding */ } } ]
}
```

`rejected_findings` is the audit trail: every finding the model produced that failed
validation (hallucinated filename, out-of-scope rule citation, no line number) is kept
with the reason, so a false-positive is visible rather than silently passed or dropped.

### Tunable env vars

| Var | Default | Effect |
|---|---|---|
| `CODE_REVIEW_MODEL` | `gpt-5.5-2026-04-23` | model id |
| `CODE_REVIEW_MAX_TURNS` | `25` | per-job agent loop cap (one file → fewer turns needed) |
| `CODE_REVIEW_MAX_RETRIES` | `2` | retries per job on error / malformed output |
| `CODE_REVIEW_CONCURRENCY` | `4` | max parallel model calls |

## Roadmap

- **v1 (this):** file-only reviewers — security, pattern, regression.
- **v2:** Supabase-aware reviewers (migration-vs-live-DB, edge-fn-vs-deployed) via a
  `supabase` CLI tool; a `git diff` tool so the regression reviewer sees exact hunks; and
  an optional PreToolUse hook that blocks `git push` / deploy when `_summary.json` has
  unresolved blockers.
