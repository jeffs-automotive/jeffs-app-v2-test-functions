/**
 * Landing page for appointments.jeffsautomotive.com.
 *
 * Per chat-design.md 2026-05-13 visual lock: Heritage Editorial layout
 * (paper background, Fraunces serif title, label-eyebrow tagline, gold-rule
 * separators). Mirror of /book — Phase 1 launch keeps the root reachable as
 * the canonical scheduler URL; /book exists for advisors who want a
 * branded link.
 *
 * Trust signals row was retired here per design lock (they distract from
 * the chat-first flow). They live on jeffsautomotive.com proper; the
 * scheduler subdomain focuses on the booking action.
 *
 * Server Component now (was implicitly server but rendered nothing
 * dynamic). Reads the `sched-chat-id` cookie set by middleware +
 * pre-hydrates initial messages so returning customers see their
 * conversation immediately instead of a flash of empty state.
 */
import { ChatBootstrap } from "@/components/scheduler/ChatBootstrap";
import { hydrateSession } from "@/lib/scheduler/hydrate-session";

// Force dynamic rendering so the cookie + DB hydration happens on every
// request (not cached at build time). The middleware-set cookie is the
// session-identifying input; cached HTML would lock everyone to the
// build-time-generated UUID.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { chatId, initialMessages, currentStep } = await hydrateSession();
  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      {/* ─── Editorial header ────────────────────────────────────────────── */}
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

      {/* ─── Chat surface ────────────────────────────────────────────────── */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        <section
          aria-label="Schedule chat"
          className="flex min-h-[60vh] flex-1 flex-col"
        >
          <ChatBootstrap
            chatId={chatId}
            initialMessages={initialMessages}
            initialStep={currentStep}
          />
        </section>
      </div>

      {/* ─── Quiet footer ────────────────────────────────────────────────── */}
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
