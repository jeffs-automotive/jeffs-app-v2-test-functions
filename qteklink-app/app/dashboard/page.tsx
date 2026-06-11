/**
 * /dashboard — the authed QTekLink landing.
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. The nav
 * renders for EVERY role (the approvals/mappings/postings pages are all-roles
 * READ surfaces; mutations stay admin-gated in the actions); the QuickBooks
 * connect/COA card is admin-only.
 */
import { requireQtekUser } from "@/lib/auth";
import { getCoaSummary } from "@/lib/dal/coa";
import Link from "next/link";
import SignOutButton from "./SignOutButton";
import RefreshCoaButton from "./RefreshCoaButton";
import DisconnectQboButton from "./DisconnectQboButton";

export default async function DashboardPage() {
  const { email, role, shopId } = await requireQtekUser();
  const coa = role === "admin" ? await getCoaSummary(shopId) : null;
  // A connection ROW present (realm bound) → offer Reconnect + Disconnect. The
  // connect/reconnect flow is the /qbo/connect route (→ the qbo-oauth-callback edge fn).
  const connected = Boolean(coa?.realmId);

  let coaStatus = "QuickBooks isn't connected for this shop yet.";
  if (coa?.realmId) {
    coaStatus = coa.lastSyncedAt
      ? `${coa.count} account${coa.count === 1 ? "" : "s"} mirrored · last synced ${new Date(coa.lastSyncedAt).toISOString().replace("T", " ").slice(0, 16)} UTC`
      : "Not synced yet — click below to mirror your chart of accounts.";
  }

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

      {role === "admin" && (
        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-stone-900">Chart of accounts</h2>
          <p className="mt-1 text-sm text-stone-600">
            Mirror your QuickBooks chart of accounts so QTekLink can map Tekmetric
            line items to the right QBO accounts. Read-only — this never writes to
            QuickBooks.
          </p>
          <p className="mt-2 mb-4 text-sm font-medium text-stone-900">{coaStatus}</p>
          <RefreshCoaButton />
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href="/mappings" className="font-medium text-[#96003C] underline">
              Manage account mappings &rarr;
            </Link>
            <a href="/qbo/connect" className="font-medium text-[#96003C] underline">
              {connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
            </a>
          </p>
          {connected && (
            <div className="mt-4 border-t border-stone-100 pt-4">
              <DisconnectQboButton />
            </div>
          )}
        </section>
      )}

      <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">How QTekLink posts</h2>
        <p className="mt-2 text-sm text-stone-600">
          Tekmetric webhooks land all day; the nightly sync builds each business day into up
          to <span className="font-medium">3 daily journal entries</span> (sales, payments, CC
          fees). Review a day on <Link href="/approvals" className="font-medium text-[#96003C] underline">Daily approvals</Link>{" "}
          — nothing posts to QuickBooks without an admin&apos;s explicit approval.
        </p>
      </section>
    </main>
  );
}
