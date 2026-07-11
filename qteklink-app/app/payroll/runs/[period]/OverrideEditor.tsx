"use client";

/**
 * OverrideEditor — the small editor the AutoValue pencil affordance opens
 * (design spec §3b: "writes overrides {value, note}"). One override key per
 * editor; saving composes the entry's FULL overrides object (the RPC replaces
 * the JSONB whole) with this key set — or removed, for "back to auto" — and
 * dispatches the existing updatePayrollEntryAction. Open runs + admins only
 * (the caller gates rendering; the action re-enforces).
 *
 * Units: "hours" (2dp ≥ 0), "usd" (dollars → integer cents; negatives allowed
 * only where the schema allows them, e.g. GP), "count" (integer ≥ 0). No
 * business math — this writes the override input; the server recomputes.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PencilLine, RotateCcw } from "lucide-react";
import { updatePayrollEntryAction } from "@/actions/payroll";
import type { Overrides } from "@/lib/payroll/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type OverrideKey = keyof Overrides;
export type OverrideUnit = "hours" | "usd" | "count";

const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

export function OverrideEditor({
  entryId,
  overrides,
  overrideKey,
  label,
  unit,
  allowNegative = false,
  autoDisplay,
}: {
  /** run_employee_id the patch targets. */
  entryId: string;
  /** The entry's CURRENT overrides object (replaced whole on save). */
  overrides: Overrides;
  overrideKey: OverrideKey;
  /** Human label, e.g. "Cantrell billed hours, week 1". */
  label: string;
  unit: OverrideUnit;
  allowNegative?: boolean;
  /** The auto value's formatted display, shown for context ("Auto: 42.5"). */
  autoDisplay?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const current = overrides[overrideKey];
  const [value, setValue] = useState(() =>
    current ? (unit === "usd" ? (current.value / 100).toFixed(2) : String(current.value)) : "",
  );
  const [note, setNote] = useState(current?.note ?? "");

  function parseValue(): number | null {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return null;
    if (!allowNegative && n < 0) return null;
    if (unit === "usd") return Math.round(n * 100);
    if (unit === "count") return Number.isInteger(n) ? n : null;
    return Math.round(n * 100) / 100; // hours, 2dp
  }

  function dispatch(next: Overrides, closeMsg: string) {
    start(async () => {
      const fd = new FormData();
      fd.set("run_employee_id", entryId);
      fd.set("patch", JSON.stringify({ overrides: next }));
      const res = await updatePayrollEntryAction(null, fd);
      if (res.ok) {
        setErr(null);
        setOpen(false);
        router.refresh();
      } else {
        setErr(`${closeMsg} failed: ${res.message}`);
      }
    });
  }

  function save() {
    const v = parseValue();
    if (v === null) {
      setErr(
        unit === "usd"
          ? "Enter a dollar amount (e.g. 1250.00)."
          : unit === "count"
            ? "Enter a whole number."
            : "Enter a number of hours.",
      );
      return;
    }
    dispatch({ ...overrides, [overrideKey]: { value: v, note } }, "Saving the override");
  }

  function clearOverride() {
    const next: Overrides = { ...overrides };
    delete next[overrideKey];
    dispatch(next, "Clearing the override");
  }

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    setOpen(next);
    if (next) setErr(null);
  }

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Override ${label}`}
        title={`Override ${label}`}
        onClick={() => handleOpenChange(true)}
      >
        <PencilLine aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md shadow-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Override {label}</DialogTitle>
            <DialogDescription>
              The value you enter replaces the auto number for this run only, and the note is kept
              next to it as provenance.{autoDisplay ? ` Auto value: ${autoDisplay}.` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className={labelCls}>
              Value {unit === "usd" ? "($)" : unit === "hours" ? "(hours)" : "(count)"}
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                className="mt-0.5 text-right tabular-nums"
                aria-label={`Override value for ${label}`}
              />
            </label>
            <label className={labelCls}>
              Note (why — saved with the override)
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-0.5"
                aria-label={`Override note for ${label}`}
                placeholder="e.g. Tekmetric missed a ticket"
              />
            </label>
            {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
          </div>

          <DialogFooter>
            {current && (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                disabled={pending}
                onClick={clearOverride}
              >
                <RotateCcw aria-hidden="true" />
                Back to auto
              </Button>
            )}
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={pending} loadingText="Saving…" onClick={save}>
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
