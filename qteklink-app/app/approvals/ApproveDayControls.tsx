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
import { AlertTriangle, Lock, Send } from "lucide-react";
import { approveAndPostDayAction, type ApproveDayDryRun } from "@/actions/approve-day";
import { fmtUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

  const locked = blockedCount > 0;

  // Close-guard: never let the dialog close (Esc / overlay-click / Cancel)
  // while a dry-run-bound execute is mid-flight (admin-app's Pattern A/S idiom).
  // Closing routes through the SAME setModal(null) that drove open/close before
  // — the dry-run/confirm wiring + scopeHash flow are unchanged.
  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    if (!next) setModal(null);
  }

  return (
    <Card className="mt-6 shadow-xs">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            One button posts the whole day — every journal entry goes to QuickBooks together.
          </p>
          <div className="flex flex-col items-end gap-1">
            <Button disabled={pending || locked} loading={pending} loadingText="Checking…" onClick={dryRun}>
              <Send aria-hidden="true" />
              Approve + post this day
            </Button>
            <span className="text-xs text-muted-foreground">Posts to QuickBooks</span>
          </div>
        </div>
        {locked && (
          <p className="flex flex-wrap items-center gap-1 text-sm text-amber-800">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            {blockedCount} item{blockedCount === 1 ? "" : "s"} on this day still need{blockedCount === 1 ? "s" : ""} attention.
            Fix {blockedCount === 1 ? "it" : "them"} on the{" "}
            <Button render={<Link href={`/approvals/review?date=${date}`} />} variant="link" className="h-auto px-0 text-amber-800">fix-it list</Button>{" "}
            first — nothing posts until the day is clean.
          </p>
        )}
        {msg && <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>}
      </CardContent>

      <Dialog open={modal !== null} onOpenChange={handleOpenChange}>
        {modal && (
          <DialogContent className="sm:max-w-lg shadow-lg" showCloseButton={false}>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <AlertTriangle className="size-5 text-amber-800" aria-hidden="true" />
                </div>
                <DialogTitle>Post to QuickBooks?</DialogTitle>
              </div>
              <DialogDescription>
                You&apos;re about to write <span className="font-semibold text-foreground">{modal.summary.jeCount}</span> daily journal entr{modal.summary.jeCount === 1 ? "y" : "ies"} for <span className="font-medium text-foreground">{date}</span> — the whole day at once. This is a <span className="font-semibold text-primary">live write</span> to QuickBooks.
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-1 text-sm">
              {modal.summary.perCategory.map((c) => (
                <li key={c.category} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{categoryLine(c)}</span>
                  <span className="font-medium tabular-nums">{c.action === "delete" ? "—" : fmtUsd(c.cents)}</span>
                </li>
              ))}
            </ul>
            {modal.summary.jeCount === 0 && <p className="text-sm text-muted-foreground">Nothing to post for this day.</p>}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setModal(null)}>Cancel</Button>
              <Button type="button" loading={pending} loadingText="Posting…" disabled={pending || modal.summary.jeCount === 0} onClick={confirmExecute}>
                Yes, post to QuickBooks
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
