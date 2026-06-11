/**
 * /postings — the POSTING QUEUE: repair orders that were unposted in Tekmetric and
 * posted again on a DIFFERENT day, while their original day's journal entry is
 * already in QuickBooks. Nothing changes in QuickBooks until the office manager
 * decides here (or the RO is re-posted back to its original day in Tekmetric).
 *
 * Everyone signed in can READ; only admins act (enforced in the actions).
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { listDateMoves, type DateMoveRow } from "@/lib/dal/date-moves";
import { fmtUsd } from "@/lib/format";
import { ApproveMoveButton, UnapproveMoveButton, RefreshQueueButton } from "./DateMoveControls";

function MoveCard({ m, isAdmin }: { m: DateMoveRow; isAdmin: boolean }) {
  const ro = m.roNumber ?? String(m.tekmetricRoId);
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[#96003C]/10 px-2 py-0.5 text-sm font-semibold text-[#96003C]">RO {ro}</span>
        <span className="text-sm text-stone-700">
          moved from <span className="font-medium">{m.originalBusinessDate}</span> to{" "}
          <span className="font-medium">{m.newBusinessDate}</span>
        </span>
        {m.newTotalCents != null && (
          <span className="ml-auto text-sm font-semibold tabular-nums text-stone-900">{fmtUsd(m.newTotalCents)}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-stone-500">
        Found {new Date(m.detectedAt).toLocaleString()}.{" "}
        {m.status === "approved"
          ? `Date change approved by ${m.approvedBy ?? "an admin"} — QuickBooks has been updated.`
          : `The original day's journal entry in QuickBooks still includes this repair order.`}
      </p>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {m.status === "pending" && (
            <ApproveMoveButton id={m.id} roNumber={ro} fromDate={m.originalBusinessDate} toDate={m.newBusinessDate} />
          )}
          {m.status === "approved" && <UnapproveMoveButton id={m.id} roNumber={ro} />}
        </div>
      )}
    </li>
  );
}

export default async function PostingQueuePage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const { realmId, open, recentlyResolved } = await listDateMoves(shopId);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Posting queue</h1>
          <p className="text-sm text-stone-600">
            Repair orders that moved to a different day &middot;{" "}
            <Link href="/dashboard" className="text-[#96003C] underline">back to home</Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">{role} &middot; shop {shopId}</p>
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm text-stone-700">
        <h2 className="font-semibold text-stone-900">What this page is for</h2>
        <p className="mt-1">
          An item shows up here when a repair order was <span className="font-medium">unposted in
          Tekmetric and posted again on a different day</span>, but the original day&apos;s journal
          entry is already in QuickBooks. Nothing changes in QuickBooks until you decide.
        </p>
        <p className="mt-2 font-medium text-stone-900">For each item, do ONE of these:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Usually:</span> ask the service advisor to re-post the
            repair order on the <span className="font-medium">original day</span> in Tekmetric, then
            press <span className="font-medium">Check again</span> — the item clears itself.
          </li>
          <li>
            <span className="font-medium">Only if the new date is really correct:</span> press{" "}
            <span className="font-medium">Approve the date change</span>. QTekLink moves the repair
            order between the two days&apos; journal entries in QuickBooks.
          </li>
        </ul>
        <p className="mt-2">
          Approved something by mistake? Use <span className="font-medium">Undo approval</span> on
          the item to put everything back.
        </p>
      </section>

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet.</p>
        </section>
      ) : (
        <>
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">
                Waiting on you {open.length > 0 && <span className="text-stone-500">({open.length})</span>}
              </h2>
              {isAdmin && <RefreshQueueButton />}
            </div>
            {open.length === 0 ? (
              <p className="mt-3 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
                Nothing in the queue — no repair orders have moved days. 👍
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {open.map((m) => <MoveCard key={m.id} m={m} isAdmin={isAdmin} />)}
              </ul>
            )}
          </section>

          {recentlyResolved.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Cleared in the last two weeks
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-stone-600">
                {recentlyResolved.map((m) => (
                  <li key={m.id}>
                    RO {m.roNumber ?? m.tekmetricRoId} — re-posted back to {m.originalBusinessDate}
                    {m.resolvedAt ? ` (${new Date(m.resolvedAt).toLocaleDateString()})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
