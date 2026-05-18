# Scheduler LLM prompts — read-only reference

The wizard uses two LLM calls per concern flow. Their system prompts
live in **code** (not the DB) because changes to them have system-wide
behavioral impact and need code review.

| File | Source code | Used at | Model |
|---|---|---|---|
| [`diagnose-concern.md`](./diagnose-concern.md) | `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` `buildSystemPrompt()` | Step 7.3 (after the customer types a free-text concern) | claude-haiku-4-5 |
| [`summarize-concern.md`](./summarize-concern.md) | `scheduler-app/src/lib/scheduler/wizard/llm/summarize-concern.ts` `buildSystemPrompt()` | End of clarification queue OR end of `runDiagnosticsV2` when no clarification questions queued | claude-haiku-4-5 |

## How to read these

The MD files in this folder are **read-only snapshots** of the system
prompts as they exist in the deployed code. They're here so service
advisors (and future Claude sessions) can SEE the current prompt
without spelunking the TypeScript files.

**To CHANGE a prompt**: edit the TypeScript source (`buildSystemPrompt`
in the relevant file), open a PR, get code review, ship. Then run
the regeneration script (TBD — for now, manually paste the new prompt
into the corresponding MD file in this folder).

## Why prompts aren't editable via Claude Desktop

Per Chris's 2026-05-18 directive:

> Prompts are system-wide LLM behavior. Changing them has cascading
> effects (the gap-detection rule 5 we tuned to fix Q629 location is a
> good example). Document them as read-only refs so advisors can SEE
> them, but actual edits go via PR + code review.

A bad prompt edit instantly degrades the LLM behavior for every
customer with no rollback gate. Tuning the prompts is a code-review
discipline.

## Provenance dates

| File | Last canonical update | Trigger |
|---|---|---|
| `diagnose-concern.md` | 2026-05-18 | "front right" gap-detection failure → tightened rule 5 with concrete answered-vs-unanswered patterns + worked example |
| `summarize-concern.md` | 2026-05-18 | Initial creation as part of the comma-separated Tekmetric description rewrite |
