/**
 * Landing page for appointments.jeffsautomotive.com.
 *
 * Phase 15 cutover (2026-05-16): swapped from the legacy AI-SDK-driven
 * ChatBootstrap to the server-state-driven BookPageShell (same surface
 * as /book + /book-v2). Per chat-design.md "Architecture amendment —
 * 2026-05-14" + the migration plan in scheduler-refactor-state.json.
 *
 * Per chat-design.md 2026-05-13 visual lock: Heritage Editorial layout
 * (paper background, Fraunces serif title, label-eyebrow tagline,
 * gold-rule separators). BookPageShell owns the layout.
 */
import { BookPageShell } from "@/components/scheduler/wizard/BookPageShell";

// Force dynamic rendering so the cookie + DB hydration happens on every
// request (not cached at build time). The middleware-set cookie is the
// session-identifying input; cached HTML would lock everyone to the
// build-time-generated UUID.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  return <BookPageShell />;
}
