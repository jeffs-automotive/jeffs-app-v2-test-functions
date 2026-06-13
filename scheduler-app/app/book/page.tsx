/**
 * /book — branded scheduler URL for advisor-shared links.
 *
 * Phase 15 cutover (2026-05-16): the customer-facing wizard moved to the
 * server-state-driven BookPageShell (the same surface served at /).
 * Per chat-design.md "Architecture amendment — 2026-05-14".
 */
import { BookPageShell } from "@/components/scheduler/wizard/BookPageShell";

// Force dynamic so cookie hydration + row read run on every request.
export const dynamic = "force-dynamic";

export default async function BookPage() {
  return <BookPageShell />;
}
