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
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function QboDisconnectedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-primary">QuickBooks disconnected</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        QTekLink is no longer connected to QuickBooks, so syncing is paused. Your
        chart-of-accounts mapping is kept — reconnecting the same company restores
        everything.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <Button render={<a href="/qbo/connect" />}>Reconnect QuickBooks</Button>
        <Button render={<Link href="/dashboard" />} variant="outline">Back to dashboard</Button>
      </div>
    </main>
  );
}
