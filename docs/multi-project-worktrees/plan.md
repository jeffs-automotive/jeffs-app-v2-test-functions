# Multi-project worktrees + per-module locking — PLAN

> Status: **plan / awaiting Chris's approval + manifest sign-off** (2026-06-15)
> Research: workflow `wf_f7e1cda8-658` (7 agents, 458k tokens) — findings cited inline.

## Goal (Chris)

Work on multiple projects **at the same time in multiple chat sessions**, each project in its **own git
worktree kept until it merges to `main`**, **one worktree per project**, and a **guardrail**: never two
concurrent projects on the **same module** (admin-app keytag, admin-app schedulerconfig, …) or — for
apps without modules (qteklink) — the **same app**. "One `currentstate.json` per app-or-module."

## Headline research findings (what changed the design)

1. **Claude Code has native worktree support** (`claude --worktree <name>`) — but it creates worktrees
   under **`.claude/worktrees/<name>`**, which *is the shared dotfiles symlink here*. Native default is a
   **trap**; we use **manual `git worktree add`** to a flat sibling dir instead. (src: code.claude.com/docs/en/worktrees)
2. **`CLAUDE_PROJECT_DIR` is per-session = the worktree root**, and hook stdin also carries a **`cwd`**
   field — so a hook can resolve state per-worktree. (src: code.claude.com/docs/en/hooks, settings)
3. **A fresh worktree contains only tracked files** — `.claude`/`.agents` symlinks and the generated
   `.mcp.json` are **not** copied (zero git-tracked symlinks in this repo). Each worktree **must re-run
   `install.ps1`**. (src: git-scm.com/docs/git-worktree + repo `git ls-files -s`)
4. **THE KEYSTONE CORRECTION:** because `.claude` is a whole-directory symlink to the one shared dotfiles
   tree, **anything under `$CLAUDE_PROJECT_DIR/.claude/` is shared across every worktree** — including
   today's marker `.claude/work/current-feature.json`. Per-worktree state must live **outside** the
   symlink. → new dir **`$CLAUDE_PROJECT_DIR/.feature/`** (a real per-worktree dir, gitignored).
5. **Module-collision risk is real, not hypothetical:** the supabase-map agent found **same-second
   migration timestamp collisions** (qbo + qteklink both at `2026-06-07 13:52`). Migrations are a strict
   order-sensitive shared surface. This is exactly the "detrimental failure" the guardrail prevents.
6. **Concurrency is solvable dependency-free:** atomic publish = write-temp-in-same-dir + `fs.renameSync`;
   atomic claim = `fs.openSync(lock, 'wx')` (O_EXCL, EEXIST = already held). Add a bounded Windows
   retry-with-backoff for transient EPERM/EBUSY (Defender/Search-indexer). No npm install. (src: nodejs.org/api/fs, proper-lockfile, write-file-atomic)
7. **Windows:** `core.longpaths` is **unset** — must set `true`; keep worktree paths short/flat; symlink
   creation needs Developer-Mode+PS7 / admin / git-bash (same as the main install).

## Architecture

### State locations
| What | Where | Scope | Notes |
|---|---|---|---|
| Feature marker (`current-feature.json`) | **`$CLAUDE_PROJECT_DIR/.feature/`** | **per-worktree** | OUTSIDE `.claude` symlink — the keystone fix. gitignored. |
| Skip marker (`feature-skip.json`) | `$CLAUDE_PROJECT_DIR/.feature/` | per-worktree | same |
| **Global registry** (`active-projects.json`) | `.claude/work/` (shared symlink) | **shared** | one canonical file all sessions see; the multi-project tracker + 1:1/lock view |
| **Module claim tokens** (`<module>.lock`) | `.claude/work/claims/` (shared) | **shared** | atomic `wx` create = the lock; exactly-one-wins module exclusion |
| Registry write-lock (`active-projects.lock`) | `.claude/work/` (shared) | shared | guards read-modify-write of the registry |

### Lock unit = a **module** (logical system), spanning app UI + edge fns + migrations. The
**module manifest** (below) maps each module → owned path globs. `/project-start <module>` does an atomic
claim on that module; if already claimed by another active project, it is **refused**.

### Lifecycle
```
/project-start <module> <name>
   → validate module against manifest
   → atomic claim .claude/work/claims/<module>.lock  (refuse if held)
   → git worktree add -b <name> <worktrees>/<name> main
   → re-run install.ps1 against the new worktree  (recreate .claude/.agents/.mcp.json)
   → npm install (per worktree)
   → register in active-projects.json (locked, atomic)
   → launch: claude  (in the new worktree dir)  → its own .feature/ marker
… work the feature workflow (research→plan→implement→verify) IN that worktree …
/project-done
   → require branch merged to main
   → git worktree remove <path>  (+ optional git branch -d)
   → release claim + deregister (atomic)
/project-list  → render active-projects.json (all sessions' projects + phases + locks)
```

## Module manifest (DRAFT — needs Chris's sign-off; derived from code, not guessed)

| Module (lock unit) | App paths | Supabase paths |
|---|---|---|
| `keytag` | `admin-app/src/actions/keytag/**`, `admin-app/src/components/keytag/**`, `admin-app/app/keytags/**` | `supabase/functions/keytag-*/**` + keytag migrations |
| `schedulerconfig` | `admin-app/src/actions/scheduler/**`, `admin-app/src/components/scheduler/**`, `admin-app/src/lib/scheduler/**`, `admin-app/app/schedulerconfig/**` | scheduler-admin edge fns (`scheduler-manual-review-email`, `_shared/scheduler-admin-md`) + related migrations |
| `scheduler-wizard` | `scheduler-app/**` | `supabase/functions/{scheduler-booking-direct,scheduler-otp-direct,scheduler-step2-direct,appointments-sync,transcript-dispatcher}/**` + wizard migrations |
| `qteklink` | `qteklink-app/**` (whole app — sub-features share heavy infra; single lock) | `supabase/functions/qteklink-*/**`, `qbo-*` + qteklink/qbo migrations |
| `tekmetric` | — | `supabase/functions/tekmetric-*/**` |
| `orchestrator` | — | `supabase/functions/{orchestrator-mcp,mcp-auth}/**`, `_shared/orchestrator*`, `_shared/mcp-*` |
| `admin-core` (shared) | `admin-app/src/lib/**`, `admin-app/src/components/{shell,ui}/**`, `admin-app/middleware.ts`, `admin-app/app/{layout.tsx,auth,login,dashboard}/**` | — |

**Shared surfaces (cross-cutting — not a normal lock unit):**
- `supabase/migrations/**` — **order-sensitive**; recommend a **serialized shared lock** (any project
  acquires it briefly to author a migration with a guaranteed-monotonic timestamp). Prevents the
  observed same-second collisions.
- `supabase/functions/_shared/**` — touched by many modules; recommend **soft warning** (conflicts rare,
  different modules touch different utilities).
- `admin-core` — shared admin-app infra; a project touching it **also** claims `admin-core` (so two
  admin-app module projects can't both rewrite auth/shell simultaneously).

**Open manifest questions for Chris** (the boundaries code can't decide):
- Is `schedulerconfig` (admin config) genuinely separate from `scheduler-wizard` (customer app), or one lock?
- Should `qbo` be its own module (currently folded into `qteklink` — the qbo edge fns + tables back qteklink)?
- Keep `qteklink` as one whole-app lock (recommended) or split its 5 sub-features?

## Change surface (spans BOTH repos)

**dotfiles repo** (`.claude` config — most of the work):
1. **3 hooks** — resolve marker from `process.env.CLAUDE_PROJECT_DIR` → `.feature/` (fallback: stdin `cwd`, then legacy `__dirname`). Files: `feature-phase-guard.mjs:36-40`, `feature-prompt-warning.mjs:34-36`, `feature-ui-agents.mjs:42-45`.
2. **8 `feature-*` commands** — update the marker path from `.claude/work/current-feature.json` → `.feature/current-feature.json` (these are MY instructions; the path is load-bearing — the research agent was wrong that "no change needed").
3. **New `/project-*` commands** — `project-start`, `project-list`, `project-done`.
4. **New shared lib** — `.claude/hooks/lib/registry.mjs` (dep-free atomic registry + claim helpers) used by the project commands (and a new pre-edit scope-guard, optional).
5. **Rules** (`artifact-conventions.md`, `orchestration.md`) — document the new layout (deny-listed → node workaround).
6. **Memory** — replace `feedback_no_worktrees.md` with the new policy.
7. **dotfiles `.gitignore`** — ignore `active-projects.json`, `claims/`, `*.lock` (runtime state).

**app repo** (`jeffs-app-v2-test-functions`):
8. **`.gitignore`** — add `.feature/` (per-worktree state, ignored in every worktree).
9. **`install.ps1` / `install.sh`** — confirm worktree-aware (`-AppRoot <worktree>` already supported); add `core.longpaths true` + a `.worktreeinclude` if we adopt any native bits.

## Testing plan (TDD — every claim gets a test that fails if it regresses)
- **Hook resolution**: marker resolves to `$CLAUDE_PROJECT_DIR/.feature/` (not the shared `.claude/work/`); two different `CLAUDE_PROJECT_DIR`s → two different markers; fallback chain when env unset.
- **Registry concurrency**: N parallel writers → no lost updates, file always valid JSON; atomic claim → exactly one of two racers wins, other gets "already claimed"; stale-lock reclamation; Windows EPERM/EBUSY retry.
- **Module exclusion**: `/project-start keytag` twice → second refused; two different modules → both succeed.
- **Lifecycle**: worktree created on branch off main; `remove` refused while branch unmerged / tree dirty; claim released + deregistered on done.
- Reuse the proven harness from this session's hook tests (child-process stdin, byte-for-byte marker restore).

## Spike (first implement step — proves the make-or-break mechanics on THIS Windows box)
1. `git worktree add -b spike-test <sibling>/spike main` (after `core.longpaths true`).
2. Re-run `install.ps1 -AppRoot <sibling>/spike`; confirm `.claude`/`.agents` symlinks + `.mcp.json` exist.
3. Launch a throwaway check: confirm `CLAUDE_PROJECT_DIR` in that worktree = the worktree root, and a hook reads `.feature/` there (not the shared marker).
4. `git worktree remove` + branch cleanup. Abort+report if symlink perms fail.

## Rollout
Backend-style: land the registry lib + hook changes + commands behind the new layout, migrate the
current single marker into the new `.feature/` location, verify, THEN update memory/rules. Module
manifest ships as a committed `.claude/work/module-manifest.json` (or a rule) the commands read.
