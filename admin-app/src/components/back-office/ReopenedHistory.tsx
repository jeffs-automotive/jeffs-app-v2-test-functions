/**
 * ReopenedHistory (admin / service-advisor) — the posting-lifecycle timeline for a reopened
 * RO, read from context.history (built by the back-office-ro-watch detector). Mirrors the
 * qteklink office-manager component so both apps render the reopened detail identically.
 * Presentation-only; each entry carries a pre-formatted shop-local timestamp (at_local).
 */
import { CircleDollarSign, DoorOpen, FileCheck2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HistoryItem {
  seq?: number;
  at?: string;
  at_local?: string;
  kind: string;
  actor?: string | null;
  posted_date?: string | null;
  total_cents?: number | null;
  payer?: string | null;
}

const LABEL: Record<string, string> = {
  ro_sent_to_ar: "Sent to A/R",
  ro_posted: "Posted",
  ro_unposted: "Unposted (reopened)",
  payment_made: "Payment received",
};

const ICON: Record<string, typeof FileCheck2> = {
  ro_sent_to_ar: FileCheck2,
  ro_posted: FileCheck2,
  ro_unposted: Undo2,
  payment_made: CircleDollarSign,
};

// Node accents (icons are aria-hidden / decorative → the 3:1 UI-contrast bar, not text 4.5:1).
function nodeClass(kind: string): string {
  if (kind === "ro_unposted") return "border-amber-500/60 text-amber-600 dark:text-amber-500";
  if (kind === "payment_made") return "border-emerald-600/50 text-emerald-700 dark:text-emerald-500";
  return "border-border text-muted-foreground"; // postings
}

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function detail(h: HistoryItem): string | null {
  if (h.kind === "ro_posted" || h.kind === "ro_sent_to_ar") {
    const parts: string[] = [];
    if (h.posted_date) parts.push(`date ${h.posted_date}`);
    if (typeof h.total_cents === "number") parts.push(money(h.total_cents));
    return parts.length ? parts.join(", ") : null;
  }
  if (h.kind === "payment_made" && h.payer) return h.payer;
  return null;
}

export function ReopenedHistory({ history }: { history: HistoryItem[] }) {
  if (!history || history.length === 0) return null;
  return (
    <div className="border-t border-border pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
      <ol className="mt-3">
        {history.map((h, i) => {
          const Icon = ICON[h.kind] ?? DoorOpen;
          const d = detail(h);
          const showActor = h.actor && h.kind !== "payment_made";
          const isLast = i === history.length - 1;
          return (
            <li key={h.seq ?? h.at ?? i} className="relative flex gap-3 pb-3 last:pb-0">
              {!isLast && <span aria-hidden="true" className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}
              <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card", nodeClass(h.kind))}>
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{LABEL[h.kind] ?? h.kind}</span>
                  {d ? <span className="text-muted-foreground"> · {d}</span> : null}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  <span>{h.at_local ?? h.at ?? "—"}</span>
                  {showActor ? <span> · {h.actor}</span> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
