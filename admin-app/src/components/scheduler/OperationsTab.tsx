"use client";

/**
 * OperationsTab — composite for the Operations surface.
 *
 * Per plan v0.5 §7.5. Two independent "action card" surfaces:
 *   - <RunSyncCard> — on-demand appointments-sync trigger
 *   - <FindOrphansCard> — read-only orphan-customers scan
 *
 * Both are one-shot soft-confirm (NOT Pattern S — no dry_run / token /
 * revert). Different action shape than the 9 catalog tabs.
 *
 * Deliberately does NOT route through <CatalogEditorTab> — that
 * abstraction is Pattern-S-specific and would force fake MD/diff/revert
 * concepts here. Closes GPT v0.4 IMP "shared tab plumbing or action
 * adapters may accidentally treat Operations like a catalog editor".
 */
import {
  useActionState,
  useEffect,
  useState,
  startTransition,
} from "react";
import { toast } from "sonner";
import { Database, RefreshCcw, Search, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runAppointmentsSyncAction } from "@/actions/scheduler/run-appointments-sync";
import { findOrphanCustomersAction } from "@/actions/scheduler/find-orphan-customers";
import { formatEastern } from "@/lib/format-time";
import type {
  RunAppointmentsSyncState,
  FindOrphanCustomersState,
  OrphanCustomerEntry,
} from "@/lib/scheduler/types";

const initialRunSync: RunAppointmentsSyncState = { kind: "idle" };
const initialFindOrphans: FindOrphanCustomersState = { kind: "idle" };

export function OperationsTab() {
  return (
    <div className="space-y-6">
      <RunSyncCard />
      <FindOrphansCard />
    </div>
  );
}

// ─── RunSyncCard ────────────────────────────────────────────────────────

function RunSyncCard() {
  const [state, dispatch, isPending] = useActionState(
    runAppointmentsSyncAction,
    initialRunSync,
  );
  const [fullBackfill, setFullBackfill] = useState(false);

  useEffect(() => {
    if (state.kind === "success") {
      const s = state.data.summary;
      const summary = s
        ? `Synced. Upserted ${s.appointments_upserted ?? "?"}, soft-deleted ${s.appointments_soft_deleted ?? "?"} (${s.duration_ms ?? "?"} ms).`
        : state.data.message ?? "Sync complete.";
      toast.success(`Appointments sync finished`, { description: summary });
    }
    if (state.kind === "tool_error") {
      toast.error("Sync failed", { description: state.data.message });
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
  }, [state]);

  function handleRun() {
    const fd = new FormData();
    fd.set("full_backfill", fullBackfill ? "true" : "false");
    startTransition(() => dispatch(fd));
  }

  const summary = state.kind === "success" ? state.data.summary : undefined;
  const lastRunAt =
    state.kind === "success" ? formatEastern(new Date(state.timestamp)) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" aria-hidden="true" />
          Appointments sync
        </CardTitle>
        <CardDescription>
          Manually trigger the appointments-sync edge function (normally
          cron-driven every 5 min). Use when you know Tekmetric just changed
          and you want the local shadow refreshed now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fullBackfill}
              onChange={(e) => setFullBackfill(e.target.checked)}
              disabled={isPending}
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
            loading={isPending}
            loadingText="Syncing…"
            className="gap-1.5"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Run sync now
          </Button>

          {!isPending && state.kind === "success" && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
              <p className="font-medium">
                Last run: <span className="font-mono">{lastRunAt}</span>
              </p>
              {summary && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  <li>Upserted: <strong>{summary.appointments_upserted ?? "?"}</strong></li>
                  <li>Soft-deleted: <strong>{summary.appointments_soft_deleted ?? "?"}</strong></li>
                  <li>Duration: <strong>{summary.duration_ms ?? "?"} ms</strong></li>
                </ul>
              )}
            </div>
          )}

          {!isPending && state.kind === "tool_error" && (
            <p className="text-sm text-destructive">{state.data.message}</p>
          )}
          {!isPending && state.kind === "transport_error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── FindOrphansCard ────────────────────────────────────────────────────

function FindOrphansCard() {
  const [state, dispatch, isPending] = useActionState(
    findOrphanCustomersAction,
    initialFindOrphans,
  );
  const [lookbackDays, setLookbackDays] = useState<string>("30");

  useEffect(() => {
    if (state.kind === "success") {
      toast.success(
        state.data.count === 0
          ? "No orphans found"
          : `Found ${state.data.count} orphan${state.data.count === 1 ? "" : "s"}`,
      );
    }
    if (state.kind === "tool_error") {
      toast.error("Orphan scan failed", { description: state.data.message });
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
  }, [state]);

  function handleFind() {
    const fd = new FormData();
    fd.set("lookback_days", lookbackDays);
    startTransition(() => dispatch(fd));
  }

  const orphans: OrphanCustomerEntry[] =
    state.kind === "success" ? state.data.orphans : [];
  const showTable =
    !isPending && state.kind === "success" && orphans.length > 0;
  const showEmpty =
    !isPending && state.kind === "success" && orphans.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserX className="h-4 w-4" aria-hidden="true" />
          Orphan customers
        </CardTitle>
        <CardDescription>
          Find appointments in the local shadow whose <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">last_synced_at</code> is stale
          (&gt;24h) AND <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">deleted_at</code> is null — likely Tekmetric deletions
          the sync missed. Verify in Tekmetric before acting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="orphan-lookback" className="text-xs uppercase tracking-wider text-muted-foreground">
                Lookback (days)
              </Label>
              <Input
                id="orphan-lookback"
                type="number"
                min="1"
                max="180"
                value={lookbackDays}
                onChange={(e) => setLookbackDays(e.target.value)}
                disabled={isPending}
                className="w-24"
              />
            </div>
            <Button
              type="button"
              onClick={handleFind}
              loading={isPending}
              loadingText="Scanning…"
              className="gap-1.5"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Find orphans
            </Button>
          </div>

          {showEmpty && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
              No orphans found in the last {lookbackDays}-day window.
              Your cache is clean.
            </div>
          )}

          {showTable && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tekmetric ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Last synced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orphans.map((o, i) => (
                  <TableRow key={`${o.customer_id ?? o.tekmetric_id ?? i}`}>
                    <TableCell className="font-mono text-xs">
                      {o.tekmetric_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{o.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.last_seen_at ? formatEastern(o.last_seen_at) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.last_synced_at ? formatEastern(o.last_synced_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!isPending && state.kind === "tool_error" && (
            <p className="text-sm text-destructive">{state.data.message}</p>
          )}
          {!isPending && state.kind === "transport_error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
