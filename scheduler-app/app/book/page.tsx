/**
 * /book — branded scheduler URL for advisor-shared links.
 *
 * Phase 15 cutover (2026-05-16): swapped from the legacy AI-SDK-driven
 * ChatBootstrap to the server-state-driven BookPageShell (same surface
 * as /book-v2 + /). Per chat-design.md "Architecture amendment —
 * 2026-05-14" + the migration plan in scheduler-refactor-state.json.
 *
 * Phase 16 will delete the legacy ChatBootstrap + its dependency tree
 * (the AI-SDK chat stream layer + XState + the now-unused
 * tools/system-prompt/orchestrator-client surfaces).
 */
import { BookPageShell } from "@/components/scheduler/wizard/BookPageShell";

// Force dynamic so cookie hydration + row read run on every request.
export const dynamic = "force-dynamic";

export default async function BookPage() {
  return <BookPageShell />;
}
