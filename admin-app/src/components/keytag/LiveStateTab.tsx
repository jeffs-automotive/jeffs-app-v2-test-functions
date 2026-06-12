/**
 * LiveStateTab — Server Component.
 *
 * Top: WhoIsOnTagForm (client) for tag-by-tag lookups.
 * Bottom: table of every WIP key tag currently assigned (via
 * listWipKeyTags), with customer / RO / status info.
 *
 * Data is fetched fresh on each page render (force-dynamic). No
 * client-side polling for v1 — the user can reload to refresh, or use
 * the bulk reconcile tool in Phase C.6.
 */
import { ExternalLink, AlertCircle, KeyRound } from "lucide-react";
import {
  Card,
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
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import { TagBadge } from "./TagBadge";
import { WhoIsOnTagForm } from "./WhoIsOnTagForm";

/**
 * Days-since-last-activity threshold beyond which a held tag is "stale".
 *
 * SOURCE OF TRUTH: `supabase/functions/keytag-daily-report/index.ts:54`
 * (`const STALE_DAYS = 3`). The morning email + this UI both compute
 * stale-ness from `keytags.last_activity_at` against this exact cutoff.
 *
 * Don't change this independently — bump it in lockstep with the daily
 * report constant so the email + UI tell the same story.
 *
 * `last_activity_at` itself is maintained by:
 *   - touch_keytag_activity RPC (live via keytag-tekmetric-webhook on
 *     every Tekmetric updatedDate/postedDate change)
 *   - keytag-bulk-reconcile cron nightly (re-syncs from Tekmetric)
 */
const STALE_DAYS = 3;

interface StalenessInfo {
  isStale: boolean;
  daysOld: number | null;
}

function computeStaleness(lastActivityAt: string | null): StalenessInfo {
  if (!lastActivityAt) return { isStale: false, daysOld: null };
  const ms = Date.now() - new Date(lastActivityAt).getTime();
  if (Number.isNaN(ms)) return { isStale: false, daysOld: null };
  const days = Math.floor(ms / 86_400_000);
  return { isStale: days >= STALE_DAYS, daysOld: days };
}

export interface LiveStateTabProps {
  actorEmail: string;
}

export async function LiveStateTab({ actorEmail }: LiveStateTabProps) {
  let listResult: Awaited<ReturnType<typeof callKeytagTool<"listWipKeyTags">>> | null = null;
  let listError: string | null = null;
  try {
    listResult = await callKeytagTool("listWipKeyTags", {}, actorEmail);
  } catch (e) {
    listError =
      e instanceof OrchestratorClientError
        ? e.message
        : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Look up a tag</CardTitle>
          <CardDescription>
            Enter a color + number to see which RO currently holds the tag (if any).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WhoIsOnTagForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">All assigned tags</CardTitle>
              <CardDescription>
                {listError
                  ? "Couldn't load."
                  : listResult
                    ? `${listResult.count} ${listResult.count === 1 ? "tag" : "tags"} currently in use across WIP + posted-A/R.`
                    : "Loading…"}
              </CardDescription>
            </div>
            {listResult && (
              <Badge variant="outline" className="font-mono text-xs tabular-nums">
                {listResult.count} / 180
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {listError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">Couldn&apos;t load assigned tags.</p>
                  <p className="mt-0.5 text-destructive/90">{listError}</p>
                </div>
              </div>
            </div>
          )}
          {listResult && listResult.count === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <KeyRound className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">No tags in use.</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                No tags currently assigned. The pool is fully available.
              </p>
            </div>
          )}
          {listResult && listResult.count > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Tag</TableHead>
                    <TableHead>RO #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="w-28">Stale</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listResult.results.map((entry) => {
                    const staleness = computeStaleness(entry.last_activity_at);
                    return (
                      <TableRow key={`${entry.tag_color}-${entry.tag_number}`}>
                        <TableCell>
                          <TagBadge
                            color={entry.tag_color}
                            number={entry.tag_number}
                            size="sm"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm tabular-nums">
                          #{entry.ro_number}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={entry.status === "assigned" ? "secondary" : "outline"}
                            className="text-[10px] font-normal uppercase tracking-wider"
                          >
                            {entry.status === "assigned" ? "WIP" : "Posted A/R"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatEastern(entry.last_activity_at)}
                        </TableCell>
                        <TableCell>
                          {staleness.isStale ? (
                            <StatusBadge status="warning" micro>
                              {staleness.daysOld}d
                            </StatusBadge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <a
                            href={entry.ro_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            Open
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
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
