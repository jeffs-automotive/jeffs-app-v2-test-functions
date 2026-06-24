"use client";

/**
 * BoardClient — the interactive Live board: holds the tagged + untagged row
 * arrays (seeded from server props), runs the poller, and renders the two
 * action tables. A `frozen` set (ro_numbers with an in-flight action) protects
 * a mid-action row from being mutated by an incoming poll merge.
 *
 * Visual contract (design spec): reads as the twin of DashboardTab — same
 * warm-paper Cards, same CardHeader section rhythm + count pills, same calm
 * poller, same `max-w-[18ch] truncate` customer cells, same RoLink. The two
 * action tables differ only by their single per-row button (red Release on the
 * in-use table, burgundy Assign on the needs-a-tag table) — semantic, not chrome.
 * Fixed column widths + tabular-nums keep live cell updates from reflowing.
 *
 * Functional wiring is untouched: the 15s poll, the freeze-preserving merge,
 * the `frozen` ref semantics, onResolved/onPendingChange/onState, and each row's
 * own useActionState all stay exactly as built.
 */
import { useCallback, useRef, useState } from "react";
import { ExternalLink, KeyRound, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatEastern } from "@/lib/format-time";
import type {
  BoardState,
  UntaggedBoardRow,
  WipKeyTagEntry,
} from "@/lib/orchestrator/types";
import { TagBadge } from "./TagBadge";
import { ReleaseRowAction, AssignRowAction } from "./KeytagActionRow";
import { LiveBoardPoller } from "./LiveBoardPoller";

const STALE_DAYS = 3;

function staleDays(last: string | null): number | null {
  if (!last) return null;
  const d = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  return Number.isNaN(d) ? null : d;
}

export function BoardClient({ initial }: { initial: BoardState }) {
  const [tagged, setTagged] = useState<WipKeyTagEntry[]>(initial.tagged);
  const [untagged, setUntagged] = useState<UntaggedBoardRow[]>(initial.untagged);
  const [generatedAt, setGeneratedAt] = useState(initial.generated_at);
  const frozen = useRef<Set<number>>(new Set());
  // Presentation-only mirror of `frozen` (which is a ref so it can't drive a
  // re-render). Used ONLY to dim a row while its action is in flight; the ref
  // above stays the authoritative gate for the poll merge — unchanged.
  const [busyRows, setBusyRows] = useState<Set<number>>(new Set());

  const setBusy = useCallback((roNumber: number, busy: boolean) => {
    if (busy) frozen.current.add(roNumber);
    else frozen.current.delete(roNumber);
    setBusyRows((cur) => {
      const next = new Set(cur);
      if (busy) next.add(roNumber);
      else next.delete(roNumber);
      return next;
    });
  }, []);

  const onResolved = useCallback((roNumber: number) => {
    frozen.current.delete(roNumber);
    setBusyRows((cur) => {
      if (!cur.has(roNumber)) return cur;
      const next = new Set(cur);
      next.delete(roNumber);
      return next;
    });
    setTagged((cur) => cur.filter((r) => r.ro_number !== roNumber));
    setUntagged((cur) => cur.filter((r) => r.ro_number !== roNumber));
  }, []);

  // Merge a fresh poll: take all non-frozen rows from the poll + keep any
  // frozen (mid-action) rows from current local state untouched.
  const onState = useCallback((s: BoardState) => {
    const fr = frozen.current;
    setTagged((cur) => {
      const fresh = s.tagged.filter((r) => !fr.has(r.ro_number));
      const keptFrozen = cur.filter((r) => fr.has(r.ro_number));
      return [...keptFrozen, ...fresh].sort(
        (a, b) =>
          a.tag_color.localeCompare(b.tag_color) || a.tag_number - b.tag_number,
      );
    });
    setUntagged((cur) => {
      const keptFrozen = cur.filter(
        (r) => r.ro_number !== null && fr.has(r.ro_number),
      );
      const seen = new Set(keptFrozen.map((r) => r.review_code));
      const fresh = s.untagged.filter(
        (r) =>
          !seen.has(r.review_code) &&
          (r.ro_number === null || !fr.has(r.ro_number)),
      );
      return [...keptFrozen, ...fresh];
    });
    setGeneratedAt(s.generated_at);
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Header strip — mirrors DashboardTab's intro row ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            The live key tag board — act on any tag or RO in place.
          </p>
          <Badge variant="outline" className="font-mono text-xs tabular-nums">
            {tagged.length} / 180
          </Badge>
        </div>
        <LiveBoardPoller generatedAt={generatedAt} onState={onState} busy={busyRows.size > 0} />
      </div>

      {/* ── Tagged (in use) ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">In use</CardTitle>
          <CardDescription>
            Every tag currently on a vehicle. Release a tag in place when its keys come back.
          </CardDescription>
          {tagged.length > 0 && (
            <CardAction>
              <Badge variant="outline" className="font-mono text-xs tabular-nums">
                {tagged.length}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {tagged.length === 0 ? (
            <EmptyState
              icon="key"
              title="No tags in use"
              subtitle="No tags currently assigned. The pool is fully available."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Tag</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="w-28">RO #</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="w-20">Stale</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tagged.map((r) => {
                    const sd = staleDays(r.last_activity_at);
                    const busy = busyRows.has(r.ro_number);
                    return (
                      <TableRow key={`${r.tag_color}-${r.tag_number}`} aria-busy={busy}>
                        <DataCell busy={busy}>
                          <TagBadge color={r.tag_color} number={r.tag_number} size="sm" />
                        </DataCell>
                        <DataCell busy={busy}>
                          <span
                            className="block max-w-[18ch] truncate text-sm text-foreground"
                            title={r.customer_name ?? undefined}
                          >
                            {r.customer_name ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </DataCell>
                        <DataCell busy={busy}>
                          <RoLink url={r.ro_url} roNumber={r.ro_number} />
                        </DataCell>
                        <DataCell busy={busy}>
                          <Badge
                            variant={r.status === "assigned" ? "secondary" : "outline"}
                            className="text-[10px] font-normal uppercase tracking-wider"
                          >
                            {r.status === "assigned" ? "WIP" : "Posted A/R"}
                          </Badge>
                        </DataCell>
                        <DataCell
                          busy={busy}
                          className="font-mono text-xs tabular-nums text-muted-foreground"
                        >
                          {formatEastern(r.last_activity_at)}
                        </DataCell>
                        <DataCell busy={busy}>
                          {sd !== null && sd >= STALE_DAYS ? (
                            <StatusBadge status="warning" micro>
                              {sd}d
                            </StatusBadge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </DataCell>
                        <TableCell className="text-right">
                          <ReleaseRowAction
                            roNumber={r.ro_number}
                            tagLabel={r.tag}
                            onResolved={onResolved}
                            onPendingChange={(b) => setBusy(r.ro_number, b)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Untagged (needs a tag) ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs a tag</CardTitle>
          <CardDescription>
            Repair orders the reconciler flagged as missing a key tag. Assign one in place.
          </CardDescription>
          {untagged.length > 0 && (
            <CardAction>
              <Badge variant="outline" className="font-mono text-xs tabular-nums">
                {untagged.length}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {untagged.length === 0 ? (
            <EmptyState
              icon="ok"
              title="Everything's tagged"
              subtitle="No open reviews and no A/R orders without a tag."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">RO #</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead>Why untagged</TableHead>
                    <TableHead className="w-32">Review</TableHead>
                    <TableHead className="w-24 text-right">Open</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {untagged.map((r) => {
                    const busy =
                      r.ro_number !== null && busyRows.has(r.ro_number);
                    return (
                      <TableRow key={r.review_code} aria-busy={busy}>
                        <DataCell busy={busy} className="font-mono text-sm tabular-nums">
                          {r.ro_number === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : r.kind === "review" ? (
                            <a
                              href={`/keytags?tab=manual-reviews&review=${encodeURIComponent(r.review_code)}`}
                              className="text-primary hover:underline"
                            >
                              #{r.ro_number}
                            </a>
                          ) : r.ro_url ? (
                            <a
                              href={r.ro_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              #{r.ro_number}
                            </a>
                          ) : (
                            <span>#{r.ro_number}</span>
                          )}
                        </DataCell>
                        <DataCell busy={busy}>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-normal uppercase tracking-wider"
                          >
                            {r.status_label}
                          </Badge>
                        </DataCell>
                        <DataCell busy={busy}>
                          <span
                            className="block max-w-[28ch] truncate text-sm text-foreground"
                            title={r.why}
                          >
                            {r.why}
                          </span>
                        </DataCell>
                        <DataCell busy={busy}>
                          {r.kind === "review" ? (
                            <a
                              href={`/keytags?tab=manual-reviews&review=${encodeURIComponent(r.review_code)}`}
                              className="font-mono text-xs font-semibold text-primary hover:underline"
                            >
                              {r.review_code}
                            </a>
                          ) : (
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px] font-normal uppercase tracking-wider"
                            >
                              was {r.released_tag}
                            </Badge>
                          )}
                        </DataCell>
                        <DataCell
                          busy={busy}
                          className="text-right font-mono text-xs tabular-nums text-muted-foreground"
                        >
                          {formatEastern(r.issued_at)}
                        </DataCell>
                        <TableCell className="text-right">
                          {r.ro_number !== null ? (
                            <AssignRowAction
                              roNumber={r.ro_number}
                              onResolved={onResolved}
                              onPendingChange={(b) =>
                                setBusy(r.ro_number as number, b)
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A data cell that dims while its row is mid-action (busy). The Actions cell is
 * intentionally NOT wrapped in this — the spinning button stays full opacity so
 * it remains the focus. Dim is `motion-safe:` so reduced-motion users get an
 * instant state change, not a transition.
 */
function DataCell({
  busy,
  className,
  children,
}: {
  busy: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableCell
      className={[
        "motion-safe:transition-opacity",
        busy ? "opacity-60" : "opacity-100",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </TableCell>
  );
}

function RoLink({ url, roNumber }: { url: string; roNumber: number | null }) {
  if (roNumber === null)
    return <span className="text-sm text-muted-foreground">—</span>;
  if (!url)
    return <span className="font-mono text-sm tabular-nums">#{roNumber}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-primary hover:underline"
    >
      #{roNumber}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: "ok" | "key";
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
      {icon === "ok" ? (
        <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" />
      ) : (
        <KeyRound className="size-8 text-muted-foreground" aria-hidden="true" />
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
