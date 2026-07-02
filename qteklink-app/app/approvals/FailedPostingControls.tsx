"use client";

/**
 * FailedPostingControls (admin-only, resolution-workflow Part B) — the two exits
 * from a FAILED daily posting, on its fix-it card:
 *
 *   "I unlinked the deposit — retry now"  → re-sends the SAME journal entry update
 *   "Keep QuickBooks as-is"               → accepts the difference (terminal)
 *
 * Each button does a DRY RUN first (no write) → a confirm dialog stating exactly
 * what will happen → on confirm, the EXECUTE call bound to the dry-run's scope
 * hash (Pattern S — the server re-verifies, so a day that moved re-opens review).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { resolveFailedPostingAction, type FailedPostingDryRun } from "@/actions/failed-postings";
import { fmtUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CATEGORY_LABEL: Record<string, string> = { sales: "sales", payments: "payments", fees: "card-fees" };

export default function FailedPostingControls({ postingId }: { postingId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<FailedPostingDryRun | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function dryRun(choice: "retry" | "accept") {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("posting_id", postingId);
      fd.set("choice", choice);
      const res = await resolveFailedPostingAction(null, fd);
      if (res.ok && "needsConfirmation" in res.data) setModal(res.data);
      else if (!res.ok) setMsg({ kind: "err", text: res.message });
    });
  }

  function confirmExecute() {
    if (!modal) return;
    const m = modal;
    start(async () => {
      const fd = new FormData();
      fd.set("posting_id", postingId);
      fd.set("choice", m.choice);
      fd.set("scope_hash", m.plan.scopeHash);
      const res = await resolveFailedPostingAction(null, fd);
      setModal(null);
      if (res.ok && !("needsConfirmation" in res.data)) {
        setMsg({
          kind: "ok",
          text: res.data.outcome === "posted"
            ? "Posted to QuickBooks — the day is clean again."
            : res.data.outcome === "accepted"
              ? "Kept as-is — QuickBooks stays unchanged and the day is clean again."
              : "The day changed since review — check the numbers and try again.",
        });
        router.refresh();
      } else if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        router.refresh(); // a failed retry re-raises its fix-it item — show it
      }
    });
  }

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    if (!next) setModal(null);
  }

  const isRetry = modal?.choice === "retry";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} loading={pending} loadingText="Checking…" onClick={() => dryRun("retry")}>
          <RotateCcw aria-hidden="true" />
          I unlinked the deposit — retry now
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => dryRun("accept")}>
          <CheckCircle2 aria-hidden="true" />
          Keep QuickBooks as-is
        </Button>
      </div>
      {msg && <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}

      <Dialog open={modal !== null} onOpenChange={handleOpenChange}>
        {modal && (
          <DialogContent className="sm:max-w-lg shadow-lg" showCloseButton={false}>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <AlertTriangle className="size-5 text-amber-800" aria-hidden="true" />
                </div>
                <DialogTitle>{isRetry ? "Retry the posting?" : "Keep QuickBooks as-is?"}</DialogTitle>
              </div>
              <DialogDescription>
                {isRetry ? (
                  <>
                    This re-sends the <span className="font-medium text-foreground">{CATEGORY_LABEL[modal.plan.category]}</span> journal
                    entry update for <span className="font-medium text-foreground">{modal.plan.businessDate}</span>
                    {modal.plan.totalCents != null && <> ({fmtUsd(modal.plan.totalCents)})</>} — a{" "}
                    <span className="font-semibold text-primary">live write</span> to QuickBooks. If the deposit is still
                    linked, QuickBooks will reject it again (nothing breaks).
                  </>
                ) : (
                  <>
                    QuickBooks keeps what it has today. The difference below will{" "}
                    <span className="font-semibold text-foreground">NOT be posted by QTekLink</span> — enter it in
                    QuickBooks yourself if you want it there. The day stops showing as needing attention.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {modal.plan.variance && (modal.plan.variance.added.length > 0 || modal.plan.variance.removed.length > 0) ? (
              <ul className="space-y-1 text-sm">
                {modal.plan.variance.added.map((id) => (
                  <li key={`a${id}`} className="text-muted-foreground">+ payment {id} (not in QuickBooks yet)</li>
                ))}
                {modal.plan.variance.removed.map((id) => (
                  <li key={`r${id}`} className="text-muted-foreground">− payment {id} (still in QuickBooks)</li>
                ))}
              </ul>
            ) : modal.plan.variance?.changeKind === "descriptions-only" ? (
              <p className="text-sm text-muted-foreground">Only line wording differs — no dollar impact.</p>
            ) : modal.plan.variance?.changeKind === "amounts" ? (
              <p className="text-sm text-muted-foreground">Line amounts changed on the same payments.</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setModal(null)}>Cancel</Button>
              <Button type="button" loading={pending} loadingText={isRetry ? "Posting…" : "Saving…"} disabled={pending} onClick={confirmExecute}>
                {isRetry ? "Yes, retry the posting" : "Yes, keep QuickBooks as-is"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
