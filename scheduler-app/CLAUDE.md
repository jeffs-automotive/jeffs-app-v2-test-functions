# scheduler-app

Read [`../.claude/memory/scheduler/scheduler_system_architecture.md`](../.claude/memory/scheduler/scheduler_system_architecture.md) first — it's the canonical map (stack versions, routes, components, server actions, edge functions, DB schema, crons, RLS, deployment, Sentry, code patterns, deferred items). Lives in `.claude/memory/scheduler/` alongside `scheduler_research_findings.md` and the `research/` subdir. The keytag system has its own folder at `.claude/memory/keytag/`.

On any change touching scheduler code/schema/edge fns/crons/Vercel/Sentry, update `scheduler_system_architecture.md` and bump its "Last updated" line in the same commit. See the "When you make a change" table at the bottom of the doc.