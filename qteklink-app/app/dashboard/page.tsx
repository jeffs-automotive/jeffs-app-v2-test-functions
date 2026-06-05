/**
 * /dashboard — the authed QTekLink landing (C0 placeholder).
 *
 * Proves the end-to-end auth gate: requireQtekUser() enforces session + Entra
 * oid + allowlist + active, and we render the resolved identity + role. The
 * real surfaces (connection status, COA mapping, approval/resolution queues,
 * reconciliation) land in later phases (C6+).
 */
import { requireQtekUser } from "@/lib/auth";
import SignOutButton from "./SignOutButton";

export default async function DashboardPage() {
  const { email, role, shopId } = await requireQtekUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">QTekLink</h1>
          <p className="text-sm text-stone-600">Tekmetric &rarr; QuickBooks sync</p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-sm font-medium text-stone-900">{email}</p>
            <p className="text-xs uppercase tracking-wide text-stone-500">
              {role} &middot; shop {shopId}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">Coming soon</h2>
        <p className="mt-2 text-sm text-stone-600">
          The sync dashboard — connection status, chart-of-accounts mapping,
          the approval &amp; resolution queues, and the reconciliation report —
          is being built. You&apos;re signed in and authorized.
        </p>
      </section>
    </main>
  );
}
