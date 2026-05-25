import { ensureSessionExists } from "@/lib/scheduler/chat-store";
import { hydrateSession } from "@/lib/scheduler/hydrate-session";
import { getCurrentCard } from "@/lib/scheduler/wizard/get-current-card";
import { signBeaconChatId } from "@/lib/security/beacon-hmac";
import { WizardCrossCutting } from "@/components/scheduler/wizard/WizardCrossCutting";
import { WizardSurface } from "@/components/scheduler/wizard/WizardSurface";

/**
 * BookPageShell — Phase 15 (2026-05-16) shared page body for the
 * scheduler routes. Renders the Heritage Editorial layout + the
 * server-state-driven WizardSurface + the cross-cutting affordances
 * (offline banner, idle timer, page footer with Start Over + Talk to
 * a person).
 *
 * Three routes consume this shell after the Phase 15 cutover:
 *   - /            — canonical scheduler URL on the
 *                    appointments.jeffsautomotive.com subdomain
 *   - /book        — branded link for advisors
 *   - /book-v2     — redirected to /book; this shell is the only
 *                    surface that should exist after Phase 16 cleanup
 *
 * Server Component on purpose — cookie hydration + the row read for
 * getCurrentCard happen on every request. `force-dynamic` is set on
 * each consuming route (Next.js doesn't propagate that flag through
 * imports — has to be declared at the route level).
 *
 * Header + footer copy match the prior /book + / + /book-v2 pages so
 * the cutover is visually identical to customers on the prior surface.
 */
export async function BookPageShell() {
  const { chatId } = await hydrateSession();

  // Idempotent — creates the row on the very first request for this
  // chatId, no-ops on every subsequent request.
  await ensureSessionExists({ chatId, channel: "web" });

  // Defensive default: getCurrentCard returns null only on a DB read
  // error. A row that exists but has current_step=NULL already resolves
  // to greeting inside getCurrentCard itself.
  const card = (await getCurrentCard(chatId)) ?? {
    step: "greeting" as const,
    payload: {},
  };

  // P1.5 (2026-05-25): server-side HMAC sig over chatId for the
  // mark-abandoned beacon. Empty string when SCHEDULER_BEACON_HMAC_SECRET
  // is unset (dev / pre-launch) — the helper emits a one-time Sentry
  // warning so operators can find the gap. The route's verifyBeaconSig
  // falls back to "skipped" in that posture, preserving the prior
  // unauthenticated behavior.
  const beaconSig = signBeaconChatId(chatId);

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
          aria-label="Schedule wizard"
          className="flex min-h-[60vh] flex-1 flex-col"
        >
          <WizardSurface chatId={chatId} card={card} />
        </section>
      </div>

      <WizardCrossCutting
        chatId={chatId}
        currentStep={card.step}
        beaconSig={beaconSig}
      />

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
