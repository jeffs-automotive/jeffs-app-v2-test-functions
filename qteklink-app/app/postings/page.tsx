/**
 * /postings — the posting approval queue + the auto_post/settings gate (C8c).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. Everyone allowed
 * READS the queue; only admins approve/reject, post, or change settings. The page only
 * READS (listPostings / getShopSettings); the writes are the admin client actions.
 *
 * ⚠️ The "Post next approved" button calls the LIVE QBO write path — it's the deliberate
 * human trigger for a real JournalEntry create. Nothing posts automatically here.
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { listPostings, type PostingRow } from "@/lib/dal/postings";
import { getShopSettings } from "@/lib/dal/settings";
import ApprovePostingButtons from "./ApprovePostingButtons";
import PostNextButton from "./PostNextButton";
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

function PostingCard({ p, isAdmin }: { p: PostingRow; isAdmin: boolean }) {
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
      {isAdmin && (p.status === "pending" || p.status === "approved") && (
        <ApprovePostingButtons id={p.id} status={p.status} />
      )}
    </li>
  );
}

export default async function PostingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const [{ realmId, postings }, { settings }] = await Promise.all([listPostings(shopId), getShopSettings(shopId)]);

  const approved = postings.filter((p) => p.status === "approved");

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Posting queue</h1>
          <p className="text-sm text-stone-600">
            Approve &amp; post to QuickBooks &middot;{" "}
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
                <h2 className="text-lg font-semibold text-stone-900">Post to QuickBooks</h2>
                <p className="mt-1 text-xs text-stone-500">
                  {approved.length} approved posting{approved.length === 1 ? "" : "s"} ready. Posting writes a
                  real JournalEntry to QuickBooks.
                </p>
                <div className="mt-3"><PostNextButton readyCount={approved.length} /></div>
              </div>
            </section>
          )}

          <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">Open postings</h2>
              <span className="text-3xl font-bold text-stone-900">{postings.length}</span>
            </div>
            {postings.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">Nothing queued. Run a day&apos;s reconciliation to enqueue postings.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {postings.map((p) => <PostingCard key={p.id} p={p} isAdmin={isAdmin} />)}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
