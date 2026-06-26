"use client";

/**
 * ReconcileTab — single-button page that triggers runBulkReconcile.
 *
 * Confirmation: a soft UI gate (Dialog with summary) rather than Pattern A
 * tokens. dry_run mode is a safe-by-default toggle; flip it off to apply.
 *
 * SPIN FIX (2026-06-26): runs the Server Action IMPERATIVELY with a plain
 * `loading` flag instead of `useActionState`. useActionState ties `isPending` to
 * the React transition that applies the post-action RSC re-render; on the
 * force-dynamic six-tab /keytags page that re-render re-suspends the other tabs'
 * Suspense boundaries and the transition WAITS for them, pinning the spinner long
 * after the orchestrator already returned. An imperative await resolves on the
 * action's RETURN, decoupled from the re-render — so the spinner reflects the
 * real (~60s) reconcile duration and then clears. Same pattern as LiveBoardPoller
 * / KeytagActionRow.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCcw,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  runBulkReconcileAction,
  type RunBulkReconcileState,
} from "@/actions/keytag/run-bulk-reconcile";

const initial: RunBulkReconcileState = { kind: "idle" };

export function ReconcileTab() {
  const [state, setState] = useState<RunBulkReconcileState>(initial);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  // Snapshot the mode chosen at dispatch time so the running copy doesn't
  // change if the user toggles the checkbox mid-run. Per loading-spinners
  // plan §4c (GPT cross-verify finding 2026-05-25).
  const [runningMode, setRunningMode] = useState<"dry-run" | "real" | null>(null);

  const run = useCallback(async (fd: FormData) => {
    setLoading(true);
    try {
      // Imperative await — resolves on the action's RETURN, not the route
      // re-render commit (see the file header). The action ignores prevState.
      const result = await runBulkReconcileAction(initial, fd);
      setState(result);
      if (result.kind === "success") {
        toast.success("Reconcile complete", {
          description: `${result.data.tekmetric_wip_count} WIP + ${result.data.tekmetric_ar_count} A/R checked in ${result.data.duration_ms}ms`,
        });
        setConfirmOpen(false);
        setRunningMode(null);
      } else if (result.kind === "transport_error") {
        toast.error("Reconcile failed", { description: result.message });
        setRunningMode(null);
        // Close the dialog on terminal error too — symmetric with success
        // path. (Gemini cross-verify 2026-05-25.)
        setConfirmOpen(false);
      } else if (result.kind === "validation_error") {
        // Defensive: form validators should catch this, but if it slips
        // through (e.g., manual tampering), still surface + reset.
        // (Both models flagged the missing case 2026-05-25.)
        toast.error("Reconcile validation error", { description: result.message });
        setRunningMode(null);
        setConfirmOpen(false);
      }
    } catch (e) {
      toast.error("Reconcile failed", {
        description: e instanceof Error ? e.message : String(e),
      });
      setRunningMode(null);
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleRun() {
    setRunningMode(dryRun ? "dry-run" : "real");
    const fd = new FormData();
    if (dryRun) fd.set("dry_run", "true");
    void run(fd);
  }

  // Guard dialog close while pending — refuse Escape / outside-click
  // while the orchestrator is still working. Per loading-spinners plan
  // §4c (GPT cross-verify finding).
  function handleDialogOpenChange(next: boolean) {
    if (loading && !next) return;
    setConfirmOpen(next);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Bulk reconcile from Tekmetric</CardTitle>
              <CardDescription>
                Pulls every WIP + A/R RO from Tekmetric, computes diffs against our
                keytag pool, assigns / posts / reverts / releases as needed.
                Typically takes 5–30 seconds.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              Re-syncing can move tags between states. Start with dry-run to preview, then disable for the real run.
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
            <input
              id="dry-run-toggle"
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            />
            <Label htmlFor="dry-run-toggle" className="cursor-pointer text-sm font-normal">
              Dry-run only (preview the actions without applying)
            </Label>
          </div>

          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            loading={loading}
            loadingText="Running…"
            className="gap-1.5"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            {dryRun ? "Run dry-run" : "Run reconcile"}
          </Button>
        </CardContent>
      </Card>

      {/* Hide stale success card while the next run is in flight. Per
          loading-spinners plan §4b (both models flagged the stale-state bug). */}
      {!loading && state.kind === "success" && <ReconcileResultCard data={state.data} />}

      <Dialog open={confirmOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 sm:mx-0">
              {loading ? (
                <Loader2
                  className="h-5 w-5 text-amber-700 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
              )}
            </div>
            <DialogTitle>
              {loading
                ? `Running ${runningMode === "dry-run" ? "dry-run" : "reconcile"}…`
                : `Run ${dryRun ? "dry-run " : ""}reconcile?`}
            </DialogTitle>
            <DialogDescription>
              {loading
                ? "Typically takes 5–30 seconds. Pulling RO data from Tekmetric + computing diffs against the keytag pool."
                : dryRun
                  ? "Dry-run: previews actions without making changes."
                  : "This will assign, post, revert, or release tags to match Tekmetric. Cannot be undone in bulk."}
            </DialogDescription>
          </DialogHeader>

          {/* Running indicator must live INSIDE the dialog — a card below
              the action buttons would be hidden behind this modal during
              the 5–30s wait. Per loading-spinners plan §4a (GPT
              cross-verify finding 2026-05-25). */}
          {loading && (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3"
            >
              <Loader2
                className="h-5 w-5 shrink-0 text-primary motion-safe:animate-spin"
                aria-hidden="true"
              />
              <span className="text-sm">
                Working through Tekmetric…
              </span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={dryRun ? "default" : "destructive"}
              onClick={handleRun}
              loading={loading}
              loadingText="Running…"
            >
              {dryRun ? "Run dry-run" : "Run for real"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReconcileResultCard({
  data,
}: {
  data: import("@/lib/orchestrator/types").RunBulkReconcileResult;
}) {
  const { actions, pool, tekmetric_wip_count, tekmetric_ar_count, duration_ms, orphan_email } = data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-100 text-green-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">Reconcile result</CardTitle>
            <CardDescription>
              Completed in {duration_ms}ms · Tekmetric: {tekmetric_wip_count} WIP + {tekmetric_ar_count} A/R · Pool: {pool.in_use} in use, {pool.available} available
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <StatTile label="Assigned" value={actions.assigned_new} accent="primary" />
          <StatTile label="Posted" value={actions.marked_posted} accent="green" />
          <StatTile label="Reverted" value={actions.reverted} accent="amber" />
          <StatTile label="Released" value={actions.released_orphan} accent="red" />
          <StatTile label="Touched" value={actions.touched} accent="muted" />
          <StatTile label="Repatched" value={actions.repatched} accent="muted" />
          <StatTile label="No-op" value={actions.noop} accent="muted" />
          <StatTile label="Errors" value={actions.error} accent={actions.error > 0 ? "red" : "muted"} />
        </div>
        {orphan_email.attempted && (
          <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Orphan email: {orphan_email.sent ? "sent" : "FAILED"} for {orphan_email.orphan_count} orphan{orphan_email.orphan_count === 1 ? "" : "s"}
            {orphan_email.error && (
              <span className="ml-2 text-destructive">— {orphan_email.error}</span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "primary" | "green" | "amber" | "red" | "muted";
}) {
  const colorClasses: Record<typeof accent, string> = {
    primary: "border-primary/30 bg-primary/5 text-primary",
    green: "border-green-200 bg-green-50 text-green-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    muted: "border-border bg-muted/30 text-muted-foreground",
  };
  return (
    <div className={`rounded-md border p-3 ${colorClasses[accent]}`}>
      <p className="text-xs uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
