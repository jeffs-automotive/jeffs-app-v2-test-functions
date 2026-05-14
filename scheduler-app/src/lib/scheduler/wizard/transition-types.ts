/**
 * Transition result returned by every wizard Server Action.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14": Server Actions
 * write the row + (optionally) append a chat-bubble + revalidate the page.
 * The page re-reads the row via `getCurrentCard` and renders the next card.
 *
 * The return is intentionally minimal:
 *   - `ok: true` + `next_step` — useful for tests and optional optimistic UI
 *   - `ok: false` + `error` — surfaced inline by the calling card component
 *     (toast / FormMessage / retry affordance, depending on context)
 *
 * No `card_payload_overrides`, no `directive`, no `flags`. The row IS the
 * directive; the row IS the flag set. Anything a card needs to render lives
 * in the row's columns and is built by `getCurrentCard`.
 */
import type { WizardStep } from "../session-state";

export type WizardTransitionResult =
  | { ok: true; next_step: WizardStep }
  | { ok: false; error: string };
