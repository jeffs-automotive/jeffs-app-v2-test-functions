/**
 * /book — dedicated wizard route per chat-design.md 2026-05-13.
 *
 * Container for the Heritage Editorial scheduler. Uses the same
 * ChatBootstrap entry as the legacy /page.tsx (the AI SDK useChat hook is
 * the source-of-truth for the conversation), but renders inside a
 * Heritage-style layout — paper background, editorial typography,
 * always-visible footer with Start Over + Talk to a Person buttons.
 *
 * Legacy /page.tsx is preserved for backwards-compat while testing rolls
 * out; once Heritage is fully verified Chris can flip the default landing
 * to /book or merge them.
 */
import { ChatBootstrap } from "@/components/scheduler/ChatBootstrap";

export default function BookPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      {/* ─── Header — editorial, restrained ────────────────────────────────── */}
      <header className="border-b border-rule bg-paper-100">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-5 sm:py-6">
          <p className="label-eyebrow">Schedule an appointment</p>
          <h1 className="font-display text-[28px] leading-tight text-ink sm:text-[34px]">
            Jeff&apos;s Automotive
          </h1>
          <p className="text-[14px] leading-relaxed text-ink-secondary">
            Family-owned since 1976 · AAA-approved · 3yr/36k warranty
          </p>
        </div>
      </header>

      {/* ─── Chat surface ──────────────────────────────────────────────────── */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        <section
          aria-label="Schedule chat"
          className="flex min-h-[60vh] flex-1 flex-col"
        >
          <ChatBootstrap />
        </section>
      </div>

      {/* ─── Always-visible footer (Start Over + Talk to a Person) ─────────── */}
      {/*
        The WizardFooter component owns the 2-tap-confirm UX and dispatches
        intent_type='session_restarted' / 'escalation_triggered' messages
        back through the AI SDK useChat hook. ChatBootstrap exposes those
        callbacks via the chat hook context (TBD wiring in a follow-up
        once useChat exposes the addToolResult ref to a sibling component;
        for Phase 1 launch the footer can use no-op handlers or a small
        client-side event bus). Documented here as the integration plan.
      */}
      <footer className="border-t border-rule bg-paper-100">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 text-center text-[12px] text-ink-tertiary sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p>
            Need a human? Call us at{" "}
            <a
              className="font-medium text-brand-burgundy-700 hover:underline"
              href="tel:6102536565"
            >
              (610) 253-6565
            </a>
          </p>
          <p className="text-ink-tertiary">
            Conversations are recorded for quality.
          </p>
        </div>
      </footer>
    </main>
  );
}
