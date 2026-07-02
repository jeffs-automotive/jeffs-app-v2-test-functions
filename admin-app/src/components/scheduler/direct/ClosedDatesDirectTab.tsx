"use client";

/**
 * ClosedDatesDirectTab — /schedulerconfig "Closed dates + capacity blocks".
 *
 * Two independent card surfaces (house style mirrors OperationsTab):
 *   1. Closed dates — full-day shop closures (holidays etc.). Upcoming list
 *      with a two-click inline Remove, plus an Add form.
 *   2. Capacity blocks — finer-grained blocks (whole day / a type / a specific
 *      waiter time slot). Upcoming list with a two-click inline Unblock, plus
 *      a Block form.
 *
 * SPIN FIX: every mutation runs the Server Action IMPERATIVELY with a plain
 * `loading` flag (NOT useActionState) — the imperative await resolves on the
 * action's RETURN, decoupled from the RSC re-render that useActionState's
 * transition would wait on. Same idiom as AssignKeytagForm (2026-06-26).
 * After a successful write we toast + router.refresh() to re-fetch the
 * server-rendered rows.
 *
 * Staleness: closed-date + capacity mutations are insert/delete keyed on
 * natural keys (no expected_updated_at token), so the actions never return
 * `status: "stale"` here — but we still branch on it defensively (toast +
 * refresh) so the tab stays correct if the action contract ever adds a token.
 */
import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarOff, CalendarX2, Plus, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { formatEasternDate } from "@/lib/format-time";
import {
  addClosedDateAction,
  removeClosedDateAction,
  blockCapacityDirectAction,
  unblockCapacityDirectAction,
} from "@/actions/scheduler/direct-config-actions";
import type { DirectFormState } from "@/lib/scheduler/direct-form-state";
import type { ClosedDateRow, BlockRow } from "@/lib/scheduler/read-dal";

interface Props {
  closedDates: ClosedDateRow[];
  blocks: BlockRow[];
}

/** Today in ET as YYYY-MM-DD — used for the date-input `min` (no past dates). */
function todayEastern(): string {
  // en-CA yields ISO-ordered YYYY-MM-DD; pin the zone so the floor matches the
  // shop's calendar day regardless of the operator's browser timezone.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

/**
 * Toast a DirectFormState result. Returns true when the write succeeded (so the
 * caller can reset its form). Handles success / stale / validation / error, and
 * asks the caller to refresh on success + stale.
 */
function reportResult(
  state: DirectFormState,
  opts: { successMsg: string; onRefresh: () => void },
): boolean {
  switch (state.status) {
    case "success":
      toast.success(opts.successMsg);
      opts.onRefresh();
      return true;
    case "stale":
      toast.warning("Out of date", { description: state.error });
      opts.onRefresh();
      return false;
    case "validation_error":
      toast.error("Check your input", { description: state.error });
      return false;
    case "error":
      toast.error("Couldn't save", { description: state.error });
      return false;
    default:
      return false;
  }
}

export function ClosedDatesDirectTab({ closedDates, blocks }: Props) {
  return (
    <div className="space-y-6">
      <ClosedDatesCard closedDates={closedDates} />
      <CapacityBlocksCard blocks={blocks} />
    </div>
  );
}

// ─── Section 1: Closed dates ────────────────────────────────────────────────

function ClosedDatesCard({ closedDates }: { closedDates: ClosedDateRow[] }) {
  const router = useRouter();
  const today = todayEastern();

  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  // The closed_date currently pending its two-click Remove confirmation.
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  const onAdd = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setAdding(true);
      try {
        const result = await addClosedDateAction({
          closed_date: date,
          reason: reason.trim(),
        });
        const ok = reportResult(result, {
          successMsg: `Closed ${formatEasternDate(date)} — ${reason.trim()}`,
          onRefresh: refresh,
        });
        if (ok) {
          setDate("");
          setReason("");
        }
      } catch (err) {
        toast.error("Couldn't add closed date", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setAdding(false);
      }
    },
    [date, reason, refresh],
  );

  const onRemove = useCallback(
    async (closedDate: string) => {
      setRemoving(closedDate);
      try {
        const result = await removeClosedDateAction({ closed_date: closedDate });
        reportResult(result, {
          successMsg: `Reopened ${formatEasternDate(closedDate)}`,
          onRefresh: refresh,
        });
      } catch (err) {
        toast.error("Couldn't remove closed date", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRemoving(null);
        setConfirmingRemove(null);
      }
    },
    [refresh],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarOff className="h-4 w-4" aria-hidden="true" />
          Closed dates
        </CardTitle>
        <CardDescription>
          Full-day shop closures (holidays, staff events). The booking wizard
          hides these dates entirely. Past dates are not shown.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {closedDates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No upcoming closed dates.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closedDates.map((cd) => {
                  const isConfirming = confirmingRemove === cd.closed_date;
                  const isRemoving = removing === cd.closed_date;
                  return (
                    <TableRow key={cd.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatEasternDate(cd.closed_date)}
                      </TableCell>
                      <TableCell className="text-sm">{cd.reason}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {cd.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isConfirming ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">
                              Reopen this date?
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              loading={isRemoving}
                              loadingText="Removing…"
                              onClick={() => void onRemove(cd.closed_date)}
                            >
                              Confirm
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isRemoving}
                              onClick={() => setConfirmingRemove(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-destructive"
                            onClick={() => setConfirmingRemove(cd.closed_date)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Remove
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <form
            onSubmit={onAdd}
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[auto_1fr_auto] sm:items-end"
          >
            <div className="space-y-1">
              <Label
                htmlFor="closed-date"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Date
              </Label>
              <Input
                id="closed-date"
                name="closed_date"
                type="date"
                required
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={adding}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="closed-reason"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Reason
              </Label>
              <Input
                id="closed-reason"
                name="reason"
                type="text"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Independence Day"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={adding}
              />
            </div>
            <Button
              type="submit"
              loading={adding}
              loadingText="Adding…"
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add closed date
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section 2: Capacity blocks ─────────────────────────────────────────────

const WAITER_TIMES = ["08:00", "09:00"] as const;
type WaiterTime = (typeof WAITER_TIMES)[number];
type BlockType = "waiter" | "dropoff";

/** Human-readable scope label for a capacity-block row. */
function blockScope(b: BlockRow): string {
  if (!b.blocked_type) return "Full day (all types)";
  const typeLabel = b.blocked_type === "waiter" ? "Waiter" : "Drop-off";
  if (b.blocked_time) {
    // Postgres TIME comes back HH:MM:SS — trim seconds for display.
    return `${typeLabel} @ ${b.blocked_time.slice(0, 5)}`;
  }
  return `${typeLabel} (all times)`;
}

function CapacityBlocksCard({ blocks }: { blocks: BlockRow[] }) {
  const router = useRouter();
  const today = todayEastern();

  const [date, setDate] = useState("");
  const [type, setType] = useState<"" | BlockType>("");
  const [time, setTime] = useState<"" | WaiterTime>("");
  const [reason, setReason] = useState("");
  const [blocking, setBlocking] = useState(false);

  // Row currently pending its two-click Unblock confirmation, keyed by id.
  const [confirmingUnblock, setConfirmingUnblock] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  const onBlock = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setBlocking(true);
      try {
        // Time only applies to the waiter type; omit it otherwise.
        const args: {
          date: string;
          type?: BlockType;
          time?: WaiterTime;
          reason?: string;
        } = { date };
        if (type) args.type = type;
        if (type === "waiter" && time) args.time = time;
        const trimmedReason = reason.trim();
        if (trimmedReason) args.reason = trimmedReason;

        const result = await blockCapacityDirectAction(args);
        const ok = reportResult(result, {
          successMsg: `Blocked ${formatEasternDate(date)}`,
          onRefresh: refresh,
        });
        if (ok) {
          setDate("");
          setType("");
          setTime("");
          setReason("");
        }
      } catch (err) {
        toast.error("Couldn't block capacity", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBlocking(false);
      }
    },
    [date, type, time, reason, refresh],
  );

  const onUnblock = useCallback(
    async (b: BlockRow) => {
      setUnblocking(b.id);
      try {
        // Re-send the row's EXACT natural key (date + type + time) so the
        // unblock targets the same block precisely.
        const args: { date: string; type?: BlockType; time?: WaiterTime } = {
          date: b.blocked_date,
        };
        if (b.blocked_type === "waiter" || b.blocked_type === "dropoff") {
          args.type = b.blocked_type;
        }
        if (b.blocked_time) {
          const t = b.blocked_time.slice(0, 5);
          if (t === "08:00" || t === "09:00") args.time = t;
        }
        const result = await unblockCapacityDirectAction(args);
        reportResult(result, {
          successMsg: `Unblocked ${formatEasternDate(b.blocked_date)}`,
          onRefresh: refresh,
        });
      } catch (err) {
        toast.error("Couldn't unblock capacity", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setUnblocking(null);
        setConfirmingUnblock(null);
      }
    },
    [refresh],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarX2 className="h-4 w-4" aria-hidden="true" />
          Capacity blocks
        </CardTitle>
        <CardDescription>
          Finer-grained blocks than a full closure — block a whole day, a single
          appointment type, or one waiter time slot. Leave the type blank to
          block the entire day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {blocks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No upcoming capacity blocks.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.map((b) => {
                  const isConfirming = confirmingUnblock === b.id;
                  const isUnblocking = unblocking === b.id;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatEasternDate(b.blocked_date)}
                      </TableCell>
                      <TableCell className="text-sm">{blockScope(b)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {isConfirming ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">
                              Remove this block?
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              loading={isUnblocking}
                              loadingText="Unblocking…"
                              onClick={() => void onUnblock(b)}
                            >
                              Confirm
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isUnblocking}
                              onClick={() => setConfirmingUnblock(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-destructive"
                            onClick={() => setConfirmingUnblock(b.id)}
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Unblock
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <form
            onSubmit={onBlock}
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          >
            <div className="space-y-1">
              <Label
                htmlFor="block-date"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Date
              </Label>
              <Input
                id="block-date"
                name="date"
                type="date"
                required
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={blocking}
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="block-type"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Type (optional)
              </Label>
              <select
                id="block-type"
                name="type"
                value={type}
                onChange={(e) => {
                  const next = e.target.value as "" | BlockType;
                  setType(next);
                  // Time only applies to waiter — clear it when switching away.
                  if (next !== "waiter") setTime("");
                }}
                disabled={blocking}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                <option value="">Whole day (all types)</option>
                <option value="waiter">Waiter</option>
                <option value="dropoff">Drop-off</option>
              </select>
            </div>
            {type === "waiter" && (
              <div className="space-y-1">
                <Label
                  htmlFor="block-time"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Time (optional)
                </Label>
                <select
                  id="block-time"
                  name="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value as "" | WaiterTime)}
                  disabled={blocking}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">Both slots</option>
                  <option value="08:00">8:00 AM</option>
                  <option value="09:00">9:00 AM</option>
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label
                htmlFor="block-reason"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Reason (optional)
              </Label>
              <Input
                id="block-reason"
                name="reason"
                type="text"
                maxLength={200}
                placeholder="e.g. Tech out"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={blocking}
              />
            </div>
            <Button
              type="submit"
              loading={blocking}
              loadingText="Blocking…"
              className="gap-1.5 lg:col-start-4"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Block capacity
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
