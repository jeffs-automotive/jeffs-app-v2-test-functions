"use client";

/**
 * CapacityCalendarStrip — 90-day forward view of closed_dates +
 * appointment_blocks for the current shop.
 *
 * Per plan v0.5 §7. Rendered BELOW the closed-dates <CatalogEditorTab>
 * (additive — the MD path is the canonical way to manage closed_dates;
 * this strip is for ad-hoc per-day appointment_blocks).
 *
 * Per-day status (precedence):
 *   1. CLOSED (closed_dates row, full-day) — read-only here; manage via
 *      the MD path above. Shows the reason as context.
 *   2. BLOCKED (appointment_blocks row, whole-day) — has an Unblock button.
 *   3. PARTIAL (appointment_blocks row, specific type/time) — show as
 *      "partially blocked"; no inline Unblock for Phase 1 (granular UI
 *      deferred — Chris would use orchestrator MCP directly).
 *   4. AVAILABLE — has a Block… button (opens BlockDayDialog).
 *
 * On block/unblock success, calls router.refresh() to re-fetch the
 * 90-day window data + revalidatePath fires in the action.
 */
import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  startTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarX, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  unblockAppointmentCapacityAction,
  type UnblockAppointmentCapacityState,
} from "@/actions/scheduler/unblock-appointment-capacity";
import { BlockDayDialog } from "./BlockDayDialog";
import { formatUtcShort } from "@/lib/scheduler/format";
import type {
  CapacityCalendarLoad,
  ClosedDateRow,
  AppointmentBlockRow,
} from "@/actions/scheduler/list-capacity-calendar";

const initialUnblock: UnblockAppointmentCapacityState = { kind: "idle" };

export interface CapacityCalendarStripProps {
  load: CapacityCalendarLoad;
}

type DayStatus =
  | { kind: "available" }
  | { kind: "closed"; reason: string | null; source: string | null }
  | { kind: "blocked_full"; reason: string | null; created_by: string | null }
  | {
      kind: "blocked_partial";
      blocks: { type: string | null; time: string | null; reason: string | null }[];
    };

interface DayRow {
  date: string; // YYYY-MM-DD
  status: DayStatus;
}

function buildDayRows(load: CapacityCalendarLoad): DayRow[] {
  // Build a 90-day forward index from start_date.
  const start = new Date(`${load.start_date}T00:00:00Z`);
  const days: DayRow[] = [];

  // Index closed_dates + appointment_blocks for O(1) per-day lookup.
  const closedByDate = new Map<string, ClosedDateRow>();
  for (const r of load.closed_dates) closedByDate.set(r.closed_date, r);

  const blocksByDate = new Map<string, AppointmentBlockRow[]>();
  for (const b of load.appointment_blocks) {
    const arr = blocksByDate.get(b.blocked_date) ?? [];
    arr.push(b);
    blocksByDate.set(b.blocked_date, arr);
  }

  for (let i = 0; i < load.days_ahead; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const iso = d.toISOString().split("T")[0]!;

    const closed = closedByDate.get(iso);
    if (closed) {
      days.push({
        date: iso,
        status: { kind: "closed", reason: closed.reason, source: closed.source },
      });
      continue;
    }
    const blocks = blocksByDate.get(iso) ?? [];
    if (blocks.length === 0) {
      days.push({ date: iso, status: { kind: "available" } });
      continue;
    }
    const wholeDay = blocks.find((b) => !b.blocked_type && !b.blocked_time);
    if (wholeDay) {
      days.push({
        date: iso,
        status: {
          kind: "blocked_full",
          reason: wholeDay.reason,
          created_by: wholeDay.created_by_name,
        },
      });
      continue;
    }
    days.push({
      date: iso,
      status: {
        kind: "blocked_partial",
        blocks: blocks.map((b) => ({
          type: b.blocked_type,
          time: b.blocked_time,
          reason: b.reason,
        })),
      },
    });
  }

  return days;
}

export function CapacityCalendarStrip({ load }: CapacityCalendarStripProps) {
  const router = useRouter();
  const [, startRefreshTransition] = useTransition();
  const [unblockState, dispatchUnblock, isUnblockPending] = useActionState(
    unblockAppointmentCapacityAction,
    initialUnblock,
  );
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [blockDialogOpenFor, setBlockDialogOpenFor] = useState<string | null>(null);

  const days = buildDayRows(load);

  useEffect(() => {
    if (unblockState.kind === "success") {
      toast.success(
        unblockState.data.removed === 0
          ? `No matching block found for ${unblockState.data.date}`
          : `Unblocked ${unblockState.data.date} (removed ${unblockState.data.removed} row${unblockState.data.removed === 1 ? "" : "s"})`,
      );
      setPendingDate(null);
      startRefreshTransition(() => router.refresh());
    }
    if (unblockState.kind === "tool_error") {
      toast.error("Unblock failed", { description: unblockState.data.message });
      setPendingDate(null);
    }
    if (unblockState.kind === "transport_error") {
      toast.error("Transport error", { description: unblockState.message });
      setPendingDate(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unblockState]);

  function handleUnblock(date: string) {
    setPendingDate(date);
    const fd = new FormData();
    fd.set("date", date);
    // Whole-day match — omit type + time.
    startTransition(() => dispatchUnblock(fd));
  }

  function handleAfterBlock() {
    startRefreshTransition(() => router.refresh());
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-background">
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          Next {load.days_ahead} days · {load.start_date} → {load.end_date} · times shown in UTC
        </div>
        <ul className="divide-y divide-border" role="list">
          {days.map((day) => (
            <li key={day.date} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground" style={{ width: "11ch" }}>
                {formatUtcShort(`${day.date}T00:00:00Z`).slice(0, 6)}
              </span>
              <DayStatusContent
                day={day}
                isPending={isUnblockPending && pendingDate === day.date}
                onBlockClick={() => setBlockDialogOpenFor(day.date)}
                onUnblockClick={() => handleUnblock(day.date)}
              />
            </li>
          ))}
        </ul>
      </div>

      {blockDialogOpenFor && (
        <BlockDayDialog
          open={blockDialogOpenFor !== null}
          onOpenChange={(next) => {
            if (!next) setBlockDialogOpenFor(null);
          }}
          date={blockDialogOpenFor}
          onBlocked={handleAfterBlock}
        />
      )}
    </>
  );
}

function DayStatusContent({
  day,
  isPending,
  onBlockClick,
  onUnblockClick,
}: {
  day: DayRow;
  isPending: boolean;
  onBlockClick: () => void;
  onUnblockClick: () => void;
}) {
  switch (day.status.kind) {
    case "available":
      return (
        <>
          <span className="flex-1 text-xs text-muted-foreground">available</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBlockClick}
            className="gap-1"
          >
            <Ban className="h-3 w-3" aria-hidden="true" />
            Block…
          </Button>
        </>
      );
    case "closed":
      return (
        <>
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 gap-1">
            <CalendarX className="h-3 w-3" aria-hidden="true" />
            CLOSED
          </Badge>
          <span className="flex-1 text-xs text-foreground">
            {day.status.reason ?? "(no reason)"}
            {day.status.source && (
              <span className="ml-2 text-muted-foreground">via {day.status.source}</span>
            )}
          </span>
          <span className="text-xs text-muted-foreground italic">
            manage via MD tab above
          </span>
        </>
      );
    case "blocked_full":
      return (
        <>
          <Badge variant="destructive" className="gap-1">
            <Lock className="h-3 w-3" aria-hidden="true" />
            BLOCKED
          </Badge>
          <span className="flex-1 text-xs text-foreground">
            {day.status.reason ?? "(no reason)"}
            {day.status.created_by && (
              <span className="ml-2 text-muted-foreground">by {day.status.created_by}</span>
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onUnblockClick}
            loading={isPending}
            loadingText="…"
            className="gap-1"
          >
            <Unlock className="h-3 w-3" aria-hidden="true" />
            Unblock
          </Button>
        </>
      );
    case "blocked_partial":
      return (
        <>
          <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-900">
            partial
          </Badge>
          <span className="flex-1 text-xs text-muted-foreground">
            {day.status.blocks.length} slot-block
            {day.status.blocks.length === 1 ? "" : "s"} ·{" "}
            {day.status.blocks
              .map((b) => [b.type, b.time].filter(Boolean).join(" "))
              .join(", ")}
          </span>
          <span className="text-xs text-muted-foreground italic">
            granular unblock via orchestrator
          </span>
        </>
      );
  }
}
