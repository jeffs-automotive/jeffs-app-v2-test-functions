"use client";

/**
 * LimitsDirectTab — per-day-of-week appointment capacity grid.
 *
 * One row per weekday (Sun..Sat, day_of_week 0..6). Each row edits:
 *   is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes.
 * Per-row Save is enabled only when the row is dirty. Closed days visually
 * mute + disable the numeric/notes inputs (the is_closed toggle stays live so
 * the day can be reopened).
 *
 * Mutations run IMPERATIVELY (plain `saving` flag + `await`), NOT via
 * useActionState — copied from AssignKeytagForm. On the force-dynamic
 * /schedulerconfig page a useActionState transition would wait on the
 * post-action RSC re-render (re-suspending sibling tabs) and pin the spinner
 * long after the (fast) write returned. An imperative await resolves on the
 * action's RETURN, so the spinner clears immediately; router.refresh() then
 * re-pulls the fresh rows out of band.
 *
 * Staleness: each Save submits the row's loaded updated_at as
 * expected_updated_at. When the action returns status 'stale', we toast the
 * message and router.refresh() so the operator sees the latest values.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAppointmentLimitsAction } from "@/actions/scheduler/direct-config-actions";
import type { LimitsRow } from "@/lib/scheduler/read-dal";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Numeric bounds mirror the server zod schema (direct-config-actions.ts). */
const SLOT_MAX = 20;
const DROPOFF_MAX = 200;
const NOTES_MAX = 300;

interface LimitsDirectTabProps {
  limits: LimitsRow[];
}

/** Local editable shape — numeric fields held as strings for controlled inputs. */
interface DraftRow {
  day_of_week: number;
  is_closed: boolean;
  waiter_8am_slots: string;
  waiter_9am_slots: string;
  dropoff_total: string;
  notes: string;
}

function toDraft(row: LimitsRow): DraftRow {
  return {
    day_of_week: row.day_of_week,
    is_closed: row.is_closed,
    waiter_8am_slots: String(row.waiter_8am_slots),
    waiter_9am_slots: String(row.waiter_9am_slots),
    dropoff_total: String(row.dropoff_total),
    notes: row.notes ?? "",
  };
}

function isDirty(draft: DraftRow, row: LimitsRow): boolean {
  return (
    draft.is_closed !== row.is_closed ||
    draft.waiter_8am_slots !== String(row.waiter_8am_slots) ||
    draft.waiter_9am_slots !== String(row.waiter_9am_slots) ||
    draft.dropoff_total !== String(row.dropoff_total) ||
    draft.notes !== (row.notes ?? "")
  );
}

export function LimitsDirectTab({ limits }: LimitsDirectTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Weekly capacity defaults
        </CardTitle>
        <CardDescription>
          Baseline appointment capacity for each day of the week. Waiter slots
          are the number of wait-here bookings at 8&nbsp;AM / 9&nbsp;AM;
          drop-off total is the day&apos;s combined drop-off capacity. Mark a
          day closed to stop all default booking on that weekday. One-off
          overrides live on the Closed dates / Capacity blocks surfaces.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {limits.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No weekly capacity defaults are configured yet.
          </p>
        ) : (
          limits
            .slice()
            .sort((a, b) => a.day_of_week - b.day_of_week)
            .map((row) => <LimitsDayRow key={row.day_of_week} row={row} />)
        )}
      </CardContent>
    </Card>
  );
}

function LimitsDayRow({ row }: { row: LimitsRow }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftRow>(() => toDraft(row));
  const [saving, setSaving] = useState(false);

  // Re-sync local draft when the server row changes underneath us (e.g. after
  // router.refresh() following a save on this row or a stale-refresh). Keyed on
  // the row's updated_at so an unrelated re-render doesn't clobber in-progress
  // edits.
  useEffect(() => {
    setDraft(toDraft(row));
  }, [row.updated_at, row.day_of_week]);

  const dayName = DAY_NAMES[row.day_of_week] ?? `Day ${row.day_of_week}`;
  const dirty = useMemo(() => isDirty(draft, row), [draft, row]);
  const inputsDisabled = saving || draft.is_closed;

  const idBase = `limits-${row.day_of_week}`;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const w8 = Number(draft.waiter_8am_slots);
      const w9 = Number(draft.waiter_9am_slots);
      const dropoff = Number(draft.dropoff_total);
      const trimmedNotes = draft.notes.trim();

      const result = await setAppointmentLimitsAction({
        day_of_week: row.day_of_week,
        is_closed: draft.is_closed,
        waiter_8am_slots: w8,
        waiter_9am_slots: w9,
        dropoff_total: dropoff,
        notes: trimmedNotes.length === 0 ? null : trimmedNotes,
        expected_updated_at: row.updated_at,
      });

      if (result.status === "success") {
        toast.success(`Saved ${dayName} capacity`);
        router.refresh();
      } else if (result.status === "stale") {
        toast.error("Row changed", { description: result.error });
        router.refresh();
      } else if (
        result.status === "validation_error" ||
        result.status === "error"
      ) {
        toast.error(`Couldn't save ${dayName}`, { description: result.error });
      }
    } catch (e) {
      toast.error(`Couldn't save ${dayName}`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [draft, row.day_of_week, row.updated_at, dayName, router]);

  return (
    <div
      className={`rounded-lg border border-border p-4 transition-opacity ${
        draft.is_closed ? "bg-muted/40" : ""
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        {/* Day + closed toggle */}
        <div className="flex min-w-[9rem] items-center justify-between gap-3 lg:flex-col lg:items-start">
          <span className="text-sm font-medium">{dayName}</span>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.is_closed}
              onChange={(e) =>
                setDraft((d) => ({ ...d, is_closed: e.target.checked }))
              }
              disabled={saving}
              className="h-4 w-4 rounded border-border"
              aria-label={`${dayName} closed`}
            />
            <span className="text-muted-foreground">Closed</span>
          </label>
        </div>

        {/* Numeric inputs */}
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label
              htmlFor={`${idBase}-w8`}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Waiter 8&nbsp;AM
            </Label>
            <Input
              id={`${idBase}-w8`}
              type="number"
              min="0"
              max={SLOT_MAX}
              step="1"
              value={draft.waiter_8am_slots}
              onChange={(e) =>
                setDraft((d) => ({ ...d, waiter_8am_slots: e.target.value }))
              }
              disabled={inputsDisabled}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`${idBase}-w9`}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Waiter 9&nbsp;AM
            </Label>
            <Input
              id={`${idBase}-w9`}
              type="number"
              min="0"
              max={SLOT_MAX}
              step="1"
              value={draft.waiter_9am_slots}
              onChange={(e) =>
                setDraft((d) => ({ ...d, waiter_9am_slots: e.target.value }))
              }
              disabled={inputsDisabled}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`${idBase}-dropoff`}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Drop-off total
            </Label>
            <Input
              id={`${idBase}-dropoff`}
              type="number"
              min="0"
              max={DROPOFF_MAX}
              step="1"
              value={draft.dropoff_total}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dropoff_total: e.target.value }))
              }
              disabled={inputsDisabled}
            />
          </div>
        </div>
      </div>

      {/* Notes + Save */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label
            htmlFor={`${idBase}-notes`}
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Notes (optional)
          </Label>
          <Input
            id={`${idBase}-notes`}
            type="text"
            maxLength={NOTES_MAX}
            value={draft.notes}
            onChange={(e) =>
              setDraft((d) => ({ ...d, notes: e.target.value }))
            }
            disabled={inputsDisabled}
            placeholder={draft.is_closed ? "Closed" : "e.g. Holiday hours"}
          />
        </div>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          loading={saving}
          loadingText="Saving…"
          className="gap-1.5"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Save
        </Button>
      </div>
    </div>
  );
}
