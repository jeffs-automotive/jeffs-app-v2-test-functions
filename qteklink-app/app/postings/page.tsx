/**
 * /postings — the LEGACY per-RO/payment posting ledger (read-only) + the shop settings.
 *
 * Daily-JE rework step 4: posting is ALWAYS bulk-per-day from /approvals (up to 3 daily
 * category JEs) — the individual approve/reject + "Post next approved" controls are
 * REMOVED (Chris: never individual). The per-RO write path is fully retired; this page
 * remains a read-only audit view of the legacy rows until Chris retires the rows too.
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. Only admins
 * change settings.
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { listPostings, type PostingRow } from "@/lib/dal/postings";
import { getShopSettings } from "@/lib/dal/settings";
import SettingsForm from "./SettingsForm";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending approval",
  approved: "Approved — ready to post",
  posting: "Posting…",
  failed: "Failed",
  needs_resolution: "Needs resolution",
};

function money(cents: number | null): string {
  return cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;
}

function PostingCard({ p }: { p: PostingRow }) {
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[#96003C]/10 px-2 py-0.5 text-xs font-semibold text-[#96003C]">{p.kind}</span>
        <span className="text-sm font-medium text-stone-900">{p.docNumber ?? `RO ${p.tekmetricRoId}`}</span>
        {p.postingVersion > 1 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">v{p.postingVersion}</span>}
        <span className="ml-auto text-sm font-semibold text-stone-900">{money(p.totalCents)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-stone-500">
        <span className="uppercase tracking-wide">{STATUS_LABELS[p.status] ?? p.status}</span>
        <span>txn {p.txnDate}</span>
        {p.qboJeId && <span className="text-green-700">QBO JE {p.qboJeId}</span>}
      </div>
    </li>
  );
}

export default async function PostingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const [{ realmId, postings }, { settings }] = await Promise.all([listPostings(shopId), getShopSettings(shopId)]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Posting ledger (legacy)</h1>
          <p className="text-sm text-stone-600">
            Read-only &middot; posting is bulk-per-day from{" "}
            <Link href="/approvals" className="text-[#96003C] underline">Approvals</Link> &middot;{" "}
            <Link href="/dashboard" className="text-[#96003C] underline">back to dashboard</Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">{role} &middot; shop {shopId}</p>
        </div>
      </header>

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet. Connect it from the dashboard.</p>
        </section>
      ) : (
        <>
          {isAdmin && (
            <section className="mt-8 grid gap-6 md:grid-cols-2">
              <SettingsForm settings={settings} />
              <div className="rounded-lg border border-stone-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-stone-900">Posting moved to Approvals</h2>
                <p className="mt-1 text-xs text-stone-500">
                  QuickBooks writes are bulk-per-day: up to 3 daily journal entries (sales / payments /
                  CC fees) from the <Link href="/approvals" className="text-[#96003C] underline">Approvals</Link> page.
                  Individual postings are never approved one-by-one.
                </p>
              </div>
            </section>
          )}

          <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">Legacy per-RO rows (read-only)</h2>
              <span className="text-3xl font-bold text-stone-900">{postings.length}</span>
            </div>
            {postings.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">No legacy rows.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {postings.map((p) => <PostingCard key={p.id} p={p} />)}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
