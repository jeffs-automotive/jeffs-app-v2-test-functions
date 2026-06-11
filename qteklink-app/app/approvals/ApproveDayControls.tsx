"use client";

/**
 * ApproveDayControls (admin-only) — ONE approval button for the whole day (Chris's
 * spec): every journal entry the day needs (sales / payments / CC fees) posts
 * together; there are no separate per-type post buttons. If anything on the day
 * still needs attention, the button is locked until the fix-it list is clear —
 * nothing posts while the day has an open issue.
 *
 * The button does a DRY RUN first (no write) → a confirm modal showing exactly
 * which journal entries will be created / replaced / deleted → on confirm, the
 * EXECUTE call (the live QBO write, bound to the dry-run's scope_hash). The server
 * re-verifies the hash, so the modal can't post a different set than was reviewed.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { approveAndPostDayAction, type ApproveDayDryRun } from "@/actions/approve-day";
import { fmtUsd } from "@/lib/format";

const CATEGORY_LABEL = { sales: "Sales JE", payments: "Payments JE", fees: "CC-fees JE" } as const;
const ACTION_LABEL = { create: "", update: " — replaces the posted JE", delete: " — deletes the posted JE (day emptied)" } as const;

function categoryLine(c: { category: "sales" | "payments" | "fees"; action: "create" | "update" | "delete"; constituents: number }): string {
  const what = c.category === "sales" ? `${c.constituents} RO${c.constituents === 1 ? "" : "s"}` : `${c.constituents} payment${c.constituents === 1 ? "" : "s"}`;
  return `${CATEGORY_LABEL[c.category]} (${what})${ACTION_LABEL[c.action]}`;
}

export default function ApproveDayControls({ date, blockedCount }: { date: string; blockedCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<ApproveDayDryRun | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function dryRun() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("scope", "day");
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
        const d = res.data;
        const staleNote = d.stale > 0 ? ` · ${d.stale} changed since review (re-open and approve again)` : "";
        setMsg({ kind: d.failed > 0 ? "err" : "ok", text: `Posted ${d.posted} JE${d.posted === 1 ? "" : "s"} · failed ${d.failed} · skipped ${d.skipped}${staleNote}.` });
        router.refresh();
      } else if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
      }
    });
  }

  const btn = "rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
  const locked = blockedCount > 0;

  return (
    <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">
          One button posts the whole day — every journal entry goes to QuickBooks together.
        </p>
        <button disabled={pending || locked} onClick={dryRun} className={`${btn} bg-[#96003C] text-white hover:bg-[#7e0033]`}>
          Approve + post this day ▲QBO
        </button>
      </div>
      {locked && (
        <p className="mt-3 text-sm text-amber-700">
          🔒 {blockedCount} item{blockedCount === 1 ? "" : "s"} on this day still need{blockedCount === 1 ? "s" : ""} attention.
          Fix {blockedCount === 1 ? "it" : "them"} on the{" "}
          <Link href={`/approvals/review?date=${date}`} className="font-medium underline">fix-it list</Link>{" "}
          first — nothing posts until the day is clean.
        </p>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-900">Post to QuickBooks?</h3>
            <p className="mt-1 text-sm text-stone-600">
              You&apos;re about to write <span className="font-semibold">{modal.summary.jeCount}</span> daily journal entr{modal.summary.jeCount === 1 ? "y" : "ies"} for <span className="font-medium">{date}</span> — the whole day at once. This is a <span className="font-semibold text-[#96003C]">live write</span> to QuickBooks.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {modal.summary.perCategory.map((c) => (
                <li key={c.category} className="flex justify-between gap-3">
                  <span className="text-stone-600">{categoryLine(c)}</span>
                  <span className="font-medium tabular-nums">{c.action === "delete" ? "—" : fmtUsd(c.cents)}</span>
                </li>
              ))}
            </ul>
            {modal.summary.jeCount === 0 && <p className="mt-3 text-sm text-stone-500">Nothing to post for this day.</p>}
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
