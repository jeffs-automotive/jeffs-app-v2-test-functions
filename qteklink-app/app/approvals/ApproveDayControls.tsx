"use client";

/**
 * ApproveDayControls (admin-only) — the snapshot's "Approve + post" controls (plan §6). Each
 * button does a DRY RUN first (no write) → a confirm modal showing exactly what will post →
 * on confirm, the EXECUTE call (the live QBO write, bound to the dry-run's scope_hash). The
 * server re-verifies the hash, so the modal can't post a different set than was reviewed.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndPostDayAction, type ApproveDayDryRun } from "@/actions/approve-day";
import { fmtUsd } from "@/lib/format";

const SCOPE_LABEL = { day: "everything unapproved", sale: "Repair Orders", payment: "Customer Payments" } as const;

export default function ApproveDayControls({ date }: { date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<ApproveDayDryRun | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function dryRun(scope: "day" | "sale" | "payment") {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("scope", scope);
      const res = await approveAndPostDayAction(null, fd);
      if (res.ok && "needsConfirmation" in res.data) setModal(res.data);
      else if (!res.ok) setMsg({ kind: "err", text: res.message });
    });
  }

  function confirmExecute() {
    if (!modal) return;
    const m = modal;
    start(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("scope", m.scope);
      fd.set("scope_hash", m.scopeHash);
      const res = await approveAndPostDayAction(null, fd);
      setModal(null);
      if (res.ok && !("needsConfirmation" in res.data)) {
        setMsg({ kind: "ok", text: `Posted ${res.data.posted} · failed ${res.data.failed} · skipped ${res.data.skipped}.` });
        router.refresh();
      } else if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
      }
    });
  }

  const btn = "rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => dryRun("sale")} className={`${btn} border border-[#96003C] text-[#96003C] hover:bg-[#96003C]/5`}>Approve + post ROs ▲QBO</button>
        <button disabled={pending} onClick={() => dryRun("payment")} className={`${btn} border border-[#96003C] text-[#96003C] hover:bg-[#96003C]/5`}>Approve + post payments ▲QBO</button>
        <button disabled={pending} onClick={() => dryRun("day")} className={`${btn} ml-auto bg-[#96003C] text-white hover:bg-[#7e0033]`}>Approve + post everything (this day) ▲QBO</button>
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-900">Post to QuickBooks?</h3>
            <p className="mt-1 text-sm text-stone-600">
              You&apos;re about to post <span className="font-semibold">{modal.summary.jeCount}</span> journal entr{modal.summary.jeCount === 1 ? "y" : "ies"} for <span className="font-medium">{date}</span> ({SCOPE_LABEL[modal.scope]}). This is a <span className="font-semibold text-[#96003C]">live write</span> to QuickBooks.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {modal.summary.perType.filter((t) => t.count > 0).map((t) => (
                <li key={t.type} className="flex justify-between">
                  <span className="text-stone-600">{t.type === "sale" ? "Repair Orders" : "Customer Payments"} ({t.count})</span>
                  <span className="font-medium tabular-nums">{fmtUsd(t.cents)}</span>
                </li>
              ))}
            </ul>
            {modal.summary.jeCount === 0 && <p className="mt-3 text-sm text-stone-500">Nothing to post for this scope.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={pending} onClick={() => setModal(null)} className={`${btn} border border-stone-300 text-stone-700`}>Cancel</button>
              <button disabled={pending || modal.summary.jeCount === 0} onClick={confirmExecute} className={`${btn} bg-[#96003C] text-white`}>{pending ? "Posting…" : "Yes, post to QuickBooks"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
