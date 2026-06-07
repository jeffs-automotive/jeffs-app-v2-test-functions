/**
 * /qbo/disconnected — the QuickBooks "Disconnect URL".
 *
 * Two ways here: (1) the customer disconnected QTekLink from INSIDE QuickBooks
 * (Settings → Apps → Disconnect) and Intuit redirected them here, or (2) they used
 * the in-app Disconnect button (which already ran the soft disconnect).
 *
 * This page is a CONFIRMATION only — it performs NO destructive action. The
 * Intuit-redirect case is unauthenticated (the visitor isn't signed into QTekLink),
 * so acting on its `realmId` query param would be an unauthenticated
 * disconnect-anyone vector. We don't: when QuickBooks initiates the disconnect it
 * has already revoked the grant on Intuit's side, so the connection is effectively
 * dead (the next sync surfaces reconnect-required); an admin can run the in-app
 * Disconnect to also tombstone the local tokens, or just reconnect.
 */
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function QboDisconnectedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-[#96003C]">QuickBooks disconnected</h1>
      <p className="mt-3 text-sm text-stone-600">
        QTekLink is no longer connected to QuickBooks, so syncing is paused. Your
        chart-of-accounts mapping is kept — reconnecting the same company restores
        everything.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
        <a
          href="/qbo/connect"
          className="rounded bg-[#96003C] px-4 py-2 font-medium text-white transition hover:bg-[#7e0033]"
        >
          Reconnect QuickBooks
        </a>
        <Link
          href="/dashboard"
          className="rounded border border-stone-300 px-4 py-2 font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
