/**
 * Landing page for appointments.jeffsautomotive.com.
 *
 * Per appointments_design.md §3.1:
 * - Brand: burgundy primary, gold accent
 * - Trust signals: AAA-approved, 3yr/36k, free loaners, family-owned since
 *   1976, hybrid/EV capable
 * - Mobile-first
 *
 * Mounts the chat via ChatBootstrap (client component) — that handles the
 * chatId picking + persistence to localStorage and renders <Chat />.
 */
import { ChatBootstrap } from "@/components/scheduler/ChatBootstrap";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-brand-burgundy-700">
          Jeff&apos;s Automotive
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Providing you with both customer and automotive service second to none!
        </p>
      </header>

      <section
        aria-label="Trust signals"
        className="mb-8 flex flex-wrap gap-2 text-xs text-gray-700"
      >
        <span className="rounded border border-brand-gold-300 bg-brand-gold-50 px-2 py-1">
          AAA-approved
        </span>
        <span className="rounded border border-brand-gold-300 bg-brand-gold-50 px-2 py-1">
          3yr / 36k warranty
        </span>
        <span className="rounded border border-brand-gold-300 bg-brand-gold-50 px-2 py-1">
          Free loaners
        </span>
        <span className="rounded border border-brand-gold-300 bg-brand-gold-50 px-2 py-1">
          Family-owned since 1976
        </span>
        <span className="rounded border border-brand-gold-300 bg-brand-gold-50 px-2 py-1">
          Hybrid &amp; EV capable
        </span>
      </section>

      <section
        aria-label="Schedule chat"
        className="flex min-h-[60vh] flex-1 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
      >
        <ChatBootstrap />
      </section>

      <footer className="mt-8 text-center text-xs text-gray-500">
        <p>
          Need to talk to a person? Call us at{" "}
          <a
            className="font-medium text-brand-burgundy-700 underline"
            href="tel:6102536565"
          >
            (610) 253-6565
          </a>
        </p>
      </footer>
    </main>
  );
}
