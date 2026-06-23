"use client";

/**
 * BoardClient — the interactive Live board: holds the tagged + untagged row
 * arrays (seeded from server props), runs the poller, and renders the two
 * action tables. A `frozen` set (ro_numbers with an in-flight action) protects
 * a mid-action row from being mutated by an incoming poll merge.
 *
 * Functional wiring only — visual polish (the design spec) is applied later.
 */
import { useCallback, useRef, useState } from "react";
import { ExternalLink, KeyRound, Inbox } from "lucide-react";
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

  const setBusy = useCallback((roNumber: number, busy: boolean) => {
    if (busy) frozen.current.add(roNumber);
    else frozen.current.delete(roNumber);
  }, []);

  const onResolved = useCallback((roNumber: number) => {
    frozen.current.delete(roNumber);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The live key tag board — act on a row to assign or release a tag.
        </p>
        <LiveBoardPoller generatedAt={generatedAt} onState={onState} />
      </div>

      {/* ── Tagged (in use) ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-foreground">In use</h3>
          <Badge variant="outline" className="font-mono text-xs tabular-nums">
            {tagged.length} / 180
          </Badge>
        </div>
        {tagged.length === 0 ? (
          <EmptyRow icon="key" text="No tags in use." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Tag</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-24">RO #</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="w-20">Stale</TableHead>
                  <TableHead className="w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tagged.map((r) => {
                  const sd = staleDays(r.last_activity_at);
                  return (
                    <TableRow key={`${r.tag_color}-${r.tag_number}`}>
                      <TableCell>
                        <TagBadge color={r.tag_color} number={r.tag_number} size="sm" />
                      </TableCell>
                      <TableCell>
                        <span
                          className="block max-w-[18ch] truncate text-sm text-foreground"
                          title={r.customer_name ?? undefined}
                        >
                          {r.customer_name ?? <span className="text-muted-foreground">—</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <a
                          href={r.ro_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-primary hover:underline"
                        >
                          #{r.ro_number}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.status === "assigned" ? "secondary" : "outline"}
                          className="text-[10px] font-normal uppercase tracking-wider"
                        >
                          {r.status === "assigned" ? "WIP" : "Posted A/R"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatEastern(r.last_activity_at)}
                      </TableCell>
                      <TableCell>
                        {sd !== null && sd >= STALE_DAYS ? (
                          <StatusBadge status="warning" micro>
                            {sd}d
                          </StatusBadge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ReleaseRowAction
                          roNumber={r.ro_number}
                          onResolved={onResolved}
                          onPendingChange={(busy) => setBusy(r.ro_number, busy)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Untagged (needs a tag) ──────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-base font-medium text-foreground">Needs a tag</h3>
        {untagged.length === 0 ? (
          <EmptyRow icon="ok" text="No repair orders are waiting for a key tag." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">RO #</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Why untagged</TableHead>
                  <TableHead className="w-32">Review</TableHead>
                  <TableHead className="w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {untagged.map((r) => (
                  <TableRow key={r.review_code}>
                    <TableCell className="font-mono text-sm tabular-nums">
                      {r.ro_number !== null ? (
                        <a
                          href={`/keytags?tab=manual-reviews&review=${encodeURIComponent(r.review_code)}`}
                          className="text-primary hover:underline"
                        >
                          #{r.ro_number}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-normal uppercase tracking-wider"
                      >
                        {r.status_label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.why}</TableCell>
                    <TableCell>
                      <a
                        href={`/keytags?tab=manual-reviews&review=${encodeURIComponent(r.review_code)}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {r.review_code}
                      </a>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.ro_number !== null ? (
                        <AssignRowAction
                          roNumber={r.ro_number}
                          onResolved={onResolved}
                          onPendingChange={(busy) => setBusy(r.ro_number as number, busy)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyRow({ icon, text }: { icon: "ok" | "key"; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      {icon === "ok" ? (
        <Inbox className="size-4" aria-hidden="true" />
      ) : (
        <KeyRound className="size-4" aria-hidden="true" />
      )}
      {text}
    </div>
  );
}
