"use client";

/**
 * GoalsEditor — the bonus panel's per-run editable goals/tiers (design spec
 * §3b "Goals (editable this run)"). Edits pay_config fields for one run entry
 * via the existing updatePayrollEntryAction; the DAL WRITES THE CHANGE THROUGH
 * to the employee master record (round-3 #26) so future runs prefill it — the
 * helper text says so out loud. The patch carries the FULL pay_config object
 * (the RPC validates it whole); this editor only swaps the edited keys.
 *
 * Field sets per family:
 *   service_advisor — GP Goal 1/2 ($), Tier 1/2/3 (%), Spiff amount ($),
 *                     Sales goal fallback ($, used only when no prior-year data)
 *   office_manager  — Monthly sales goal ($), Bonus (%)
 *   shop_foreman    — Shop-hour goal (hrs), Bonus per hour over goal ($)
 * Percent fields display 0–100 and store 0–1 (the pay_config shape).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { updatePayrollEntryAction } from "@/actions/payroll";
import type { Family } from "@/lib/payroll/types";
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

type GoalUnit = "usd" | "pct" | "hours" | "usd_per_hour";

interface GoalField {
  key: string;
  label: string;
  unit: GoalUnit;
}

const FIELDS_BY_FAMILY: Partial<Record<Family, GoalField[]>> = {
  service_advisor: [
    { key: "gp_goal_1_cents", label: "GP Goal 1", unit: "usd" },
    { key: "gp_goal_2_cents", label: "GP Goal 2", unit: "usd" },
    { key: "tier1_pct", label: "Tier 1", unit: "pct" },
    { key: "tier2_pct", label: "Tier 2", unit: "pct" },
    { key: "tier3_pct", label: "Tier 3", unit: "pct" },
    { key: "spiff_amount_cents", label: "Spiff amount", unit: "usd" },
    { key: "sales_goal_cents", label: "Sales goal (fallback)", unit: "usd" },
  ],
  office_manager: [
    { key: "sales_goal_cents", label: "Monthly sales goal", unit: "usd" },
    { key: "bonus_pct", label: "Bonus", unit: "pct" },
  ],
  shop_foreman: [
    { key: "shop_hour_goal", label: "Shop-hour goal", unit: "hours" },
    { key: "shop_hour_bonus_cents_per_hour", label: "Bonus per hour over goal", unit: "usd_per_hour" },
  ],
};

function toDisplay(raw: unknown, unit: GoalUnit): string {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "";
  if (unit === "usd" || unit === "usd_per_hour") return (raw / 100).toFixed(2);
  if (unit === "pct") return String(Math.round(raw * 10000) / 100);
  return String(raw);
}

function fromDisplay(s: string, unit: GoalUnit): number | null {
  const n = Number(s);
  if (s.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  if (unit === "usd" || unit === "usd_per_hour") return Math.round(n * 100);
  if (unit === "pct") return n > 100 ? null : Math.round(n * 100) / 10000;
  return Math.round(n * 100) / 100;
}

const unitSuffix: Record<GoalUnit, string> = {
  usd: "$",
  pct: "%",
  hours: "hrs",
  usd_per_hour: "$/hr",
};

export function GoalsEditor({
  entryId,
  displayName,
  family,
  payConfig,
}: {
  entryId: string;
  displayName: string;
  family: Family;
  /** The entry's CURRENT raw pay_config (sent back whole with the edits). */
  payConfig: Record<string, unknown>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fields = FIELDS_BY_FAMILY[family] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toDisplay(payConfig[f.key], f.unit)])),
  );

  if (fields.length === 0) return null;

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    setOpen(next);
    if (next) setErr(null);
  }

  function save() {
    const nextConfig: Record<string, unknown> = { ...payConfig };
    for (const f of fields) {
      const parsed = fromDisplay(values[f.key] ?? "", f.unit);
      if (parsed === null) {
        setErr(`${f.label} must be a non-negative ${f.unit === "pct" ? "percent (0–100)" : "number"}.`);
        return;
      }
      nextConfig[f.key] = parsed;
    }
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_employee_id", entryId);
      fd.set("patch", JSON.stringify({ pay_config: nextConfig }));
      const res = await updatePayrollEntryAction(null, fd);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setErr(res.message);
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => handleOpenChange(true)}>
        <Settings2 aria-hidden="true" />
        Edit goals
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md shadow-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Goals — {displayName}</DialogTitle>
            <DialogDescription>
              These apply to this run <span className="font-semibold text-foreground">and</span>{" "}
              write through to {displayName}&apos;s employee record, so future runs prefill the new
              values.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <label
                key={f.key}
                className="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {f.label} ({unitSuffix[f.unit]})
                <Input
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  inputMode="decimal"
                  className="mt-0.5 text-right tabular-nums"
                  aria-label={`${displayName} ${f.label}`}
                  disabled={pending}
                />
              </label>
            ))}
          </div>

          {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={pending} loadingText="Saving…" onClick={save}>
              Save goals
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
