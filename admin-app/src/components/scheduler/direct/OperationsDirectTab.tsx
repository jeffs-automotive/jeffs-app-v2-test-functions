"use client";

/**
 * OperationsDirectTab — ops surface for the /schedulerconfig DIRECT rewrite
 * (sub-feature A, no orchestrator). Two independent cards:
 *
 *   • Run appointments sync — imperative-await trigger of
 *     `runAppointmentsSyncDirectAction` (optional full-backfill), result toast.
 *   • Orphan appointments — read-only table of the server-fetched `orphans`
 *     payload. Because the data is fetched by the page, a "Refresh" simply
 *     `router.refresh()`es the RSC tree.
 *
 * SPIN FIX: the sync action runs IMPERATIVELY with a plain `loading` flag
 * (NOT useActionState) — on a force-dynamic route, useActionState's isPending
 * is tied to the post-action RSC re-render whose Suspense boundaries re-suspend
 * and pin the spinner. Imperative await resolves on the action's RETURN.
 * (Same idiom as AssignKeytagForm.)
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, RefreshCcw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { runAppointmentsSyncDirectAction } from "@/actions/scheduler/direct-config-actions";
import { formatEastern } from "@/lib/format-time";
import type { OrphanRow } from "@/lib/scheduler/read-dal";

interface OperationsDirectTabProps {
  orphans: {
    orphans: OrphanRow[];
    count: number;
    lookback_days: number;
  };
}

export function OperationsDirectTab({ orphans }: OperationsDirectTabProps) {
  return (
    <div className="space-y-6">
      <RunSyncCard />
      <OrphanAppointmentsCard orphans={orphans} />
    </div>
  );
}

// ─── RunSyncCard ────────────────────────────────────────────────────────────

function RunSyncCard() {
  const router = useRouter();
  const [fullBackfill, setFullBackfill] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  async function handleRun() {
    setLoading(true);
    try {
      const result = await runAppointmentsSyncDirectAction({
        full_backfill: fullBackfill,
      });
      if (result.status === "success") {
        setLastRunAt(formatEastern(new Date(result.timestamp)));
        toast.success("Appointments sync finished", {
          description: fullBackfill
            ? "Full 7-day backfill triggered."
            : "Incremental sync triggered.",
        });
        // Refresh the RSC tree so the orphan list reflects the new sync state.
        router.refresh();
      } else if (result.status === "stale") {
        toast.warning("Out of date", { description: result.error });
        router.refresh();
      } else if (
        result.status === "error" ||
        result.status === "validation_error"
      ) {
        toast.error("Sync failed", { description: result.error });
      }
    } catch (e) {
      toast.error("Sync failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" aria-hidden="true" />
          Appointments sync
        </CardTitle>
        <CardDescription>
          Manually trigger the appointments-sync edge function (normally
          cron-driven every 5 min). Use when you know Tekmetric just changed and
          you want the local shadow refreshed now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fullBackfill}
              onChange={(e) => setFullBackfill(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-border"
            />
            <span>
              <strong>Full backfill</strong> — re-pull the entire 7-day rolling
              window from scratch (slower but catches any incremental-sync drift).
            </span>
          </label>

          <Button
            type="button"
            onClick={handleRun}
            loading={loading}
            loadingText="Syncing…"
            className="gap-1.5"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Run sync now
          </Button>

          {!loading && lastRunAt && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
              <p className="font-medium">
                Last triggered: <span className="font-mono">{lastRunAt}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The edge function runs asynchronously — refresh the orphan list
                below in a moment to confirm the shadow updated.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── OrphanAppointmentsCard ──────────────────────────────────────────────────

function OrphanAppointmentsCard({
  orphans,
}: {
  orphans: OperationsDirectTabProps["orphans"];
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  function handleRefresh() {
    setRefreshing(true);
    // router.refresh() re-runs the RSC tree (which re-fetches the orphan list).
    // The pending flag is cleared imperatively — we don't wait on the re-render
    // commit here (same reasoning as the spin-fix note in the file header).
    router.refresh();
    // Clear shortly after so the button doesn't stay stuck if the refresh is
    // a no-op (data unchanged → no re-render callback).
    setTimeout(() => setRefreshing(false), 600);
  }

  const rows = orphans.orphans;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserX className="h-4 w-4" aria-hidden="true" />
          Orphan appointments
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {orphans.count}
          </span>
        </CardTitle>
        <CardDescription>
          Appointments in the local shadow whose{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            tekmetric_synced_at
          </code>{" "}
          is stale (&gt;24h) AND{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            deleted_at
          </code>{" "}
          is null — likely Tekmetric deletions the sync missed. Verify in
          Tekmetric before acting. Looking back{" "}
          <strong>{orphans.lookback_days}</strong> days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            loading={refreshing}
            loadingText="Refreshing…"
            className="gap-1.5"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>

          {rows.length === 0 ? (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
              No orphan appointments in the last {orphans.lookback_days}-day
              window. Your shadow is clean.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Appointment ID</TableHead>
                    <TableHead>Customer ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Last synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => (
                    <TableRow key={o.appointment_id}>
                      <TableCell className="font-mono text-xs">
                        {o.appointment_id}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {o.customer_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.appointment_status}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatEastern(o.start_time)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatEastern(o.last_synced_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
