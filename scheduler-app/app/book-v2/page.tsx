/**
 * /book-v2 — parallel migration route for the server-state-driven wizard.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" + the migration
 * plan in scheduler-refactor-state.json: this route is where phases 3-14
 * build the new wizard. /book stays on the legacy AI-SDK-driven surface
 * during the same window. Phase 15 swaps the routes; phase 16 deletes
 * /book-v2 entirely.
 *
 * The pattern is intentionally minimal compared to /book/page.tsx:
 *   1. hydrateSession — read cookie, generate chatId if needed
 *   2. ensureSessionExists — idempotent INSERT of the row
 *   3. getCurrentCard — read row, build WizardCard
 *   4. <WizardSurface chatId card /> — client component dispatches on
 *      card.step
 *
 * No initialMessages, no ChatBootstrap, no AI SDK. The chat-bubble layer
 * (customer_chat_messages transcript) is rendered in a sibling component
 * starting in phase 14 (cross-cutting) — phase 3 only proves the Step 1
 * card-and-revalidate round trip.
 */
import { ensureSessionExists } from "@/lib/scheduler/chat-store";
import { hydrateSession } from "@/lib/scheduler/hydrate-session";
import { getCurrentCard } from "@/lib/scheduler/wizard/get-current-card";
import { WizardCrossCutting } from "@/components/scheduler/wizard/WizardCrossCutting";
import { WizardSurface } from "@/components/scheduler/wizard/WizardSurface";

// Force dynamic so cookie hydration + row read run on every request.
export const dynamic = "force-dynamic";

export default async function BookV2Page() {
  const { chatId } = await hydrateSession();

  // Idempotent — creates the row on the very first request for this chatId,
  // no-ops on every subsequent request.
  await ensureSessionExists({ chatId, channel: "web" });

  // Defensive default: getCurrentCard returns null only on DB read error.
  // A row that exists but has current_step=NULL already resolves to
  // greeting inside getCurrentCard itself.
  const card = (await getCurrentCard(chatId)) ?? {
    step: "greeting" as const,
    payload: {},
  };

  return (
    <main className="flex min-h-dvh flex-col bg-paper">
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

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        <section
          aria-label="Schedule wizard (V2)"
          className="flex min-h-[60vh] flex-1 flex-col"
        >
          <WizardSurface chatId={chatId} card={card} />
        </section>
      </div>

      <WizardCrossCutting chatId={chatId} currentStep={card.step} />

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
