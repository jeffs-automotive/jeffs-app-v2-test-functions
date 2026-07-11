"use client";

/**
 * EmployeeForm — add/edit one payroll employee (admin-only; the action enforces
 * it). The visible pay-config fields swap with the selected role's family, and
 * the submit handler assembles the `pay_config` JSON the upsert action expects:
 * dollars entered in the UI become integer cents, percents become 0–1 fractions.
 *
 * IMPORTANT preservation rule: the form starts from the employee's EXISTING
 * pay_config and overlays only the fields it edits, then keeps only the target
 * family's allowed keys. That round-trips optional master-only keys the form
 * never shows (round-4 leave_rate_seed_* on technicians/foremen) instead of
 * silently deleting them on every edit. `rates_w2` is per-run only and is never
 * sent at the employee level.
 */
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, UserPlus } from "lucide-react";
import { upsertPayrollEmployeeAction } from "@/actions/payroll";
import type { PayrollEmployee } from "@/lib/dal/payroll";
import {
  ROLES,
  TEKMETRIC_ID_TYPE_BY_FAMILY,
  familyForRole,
  type Family,
  type Role,
} from "@/lib/payroll/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL, labelCls, selectCls } from "./payroll-ui";

// ── pay_config key whitelist per family (contract §pay_config JSONB) ───────────
// The seed keys are NOT edited here — listed so an edit PRESERVES them.

const COMMON_KEYS = ["config_version", "pto_balance_hours", "pto_accrual_hours_per_period"] as const;

const TECH_KEYS = [
  "hourly_rate_cents",
  "billed_rate_cents",
  "leave_rate_seed_cents_per_hour",
  "leave_rate_seed_history",
] as const;

const FAMILY_KEYS: Record<Family, readonly string[]> = {
  technician: TECH_KEYS,
  shop_foreman: [...TECH_KEYS, "shop_hour_goal", "shop_hour_bonus_cents_per_hour"],
  service_advisor: [
    "weekly_salary_cents",
    "gp_goal_1_cents",
    "gp_goal_2_cents",
    "sales_goal_cents",
    "tier1_pct",
    "tier2_pct",
    "tier3_pct",
    "spiff_amount_cents",
  ],
  office_manager: ["hourly_rate_cents", "sales_goal_cents", "bonus_pct"],
  support: ["hourly_rate_cents"],
};

/** Names the pay-sheet layout each family provisions (design spec §2.2). */
const FAMILY_SHEET_LABEL: Record<Family, string> = {
  technician: "Technician sheet — clock, OT, billed & efficiency",
  shop_foreman: "Foreman sheet — technician pay + shop-hours bonus",
  service_advisor: "Service-advisor sheet — salary + GP-tier bonus + spiff",
  office_manager: "Office-manager sheet — hourly + monthly sales bonus",
  support: "Support sheet — plain hourly (incentives entered per run)",
};

// ── Form-value parsing (throws with a per-field message; shown inline) ─────────

function readRaw(fd: FormData, name: string, label: string): string {
  const raw = String(fd.get(name) ?? "").trim();
  if (raw.length === 0) throw new Error(`${label} is required.`);
  return raw;
}

/** "$26.13" style dollars → integer cents. */
function readDollars(fd: FormData, name: string, label: string): number {
  const n = Number(readRaw(fd, name, label));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a dollar amount of 0 or more.`);
  return Math.round(n * 100);
}

/** "4.5" percent → 0.045 fraction (the DB stores 0–1). */
function readPercent(fd: FormData, name: string, label: string): number {
  const n = Number(readRaw(fd, name, label));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${label} must be between 0 and 100.`);
  return n / 100;
}

function readHours(fd: FormData, name: string, label: string): number {
  const n = Number(readRaw(fd, name, label));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number of 0 or more.`);
  return n;
}

// ── Default-value formatting (raw JSONB → input strings) ───────────────────────

function centsToDollars(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? (v / 100).toFixed(2) : "";
}

function numToStr(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function fractionToPct(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 10000) / 100) : "";
}

/** Overlay the edited fields onto the existing config, keep the family's keys. */
function buildPayConfig(
  family: Family,
  existing: Record<string, unknown>,
  fd: FormData,
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    config_version: 1,
    pto_balance_hours: readHours(fd, "pto_balance_hours", "PTO balance"),
    pto_accrual_hours_per_period: readHours(fd, "pto_accrual_hours_per_period", "PTO accrual"),
  };
  if (family === "technician" || family === "shop_foreman") {
    values.hourly_rate_cents = readDollars(fd, "hourly_rate_dollars", "Hourly rate");
    values.billed_rate_cents = readDollars(fd, "billed_rate_dollars", "Billed rate");
  }
  if (family === "shop_foreman") {
    values.shop_hour_goal = readHours(fd, "shop_hour_goal", "Shop-hour goal");
    values.shop_hour_bonus_cents_per_hour = readDollars(fd, "shop_hour_bonus_dollars", "Shop-hour bonus");
  }
  if (family === "service_advisor") {
    values.weekly_salary_cents = readDollars(fd, "weekly_salary_dollars", "Weekly salary");
    values.gp_goal_1_cents = readDollars(fd, "gp_goal_1_dollars", "GP goal 1");
    values.gp_goal_2_cents = readDollars(fd, "gp_goal_2_dollars", "GP goal 2");
    values.sales_goal_cents = readDollars(fd, "sales_goal_dollars", "Monthly sales goal");
    values.tier1_pct = readPercent(fd, "tier1_pct", "Tier 1 %");
    values.tier2_pct = readPercent(fd, "tier2_pct", "Tier 2 %");
    values.tier3_pct = readPercent(fd, "tier3_pct", "Tier 3 %");
    values.spiff_amount_cents = readDollars(fd, "spiff_amount_dollars", "Spiff amount");
  }
  if (family === "office_manager") {
    values.hourly_rate_cents = readDollars(fd, "hourly_rate_dollars", "Hourly rate");
    values.sales_goal_cents = readDollars(fd, "sales_goal_dollars", "Monthly sales goal");
    values.bonus_pct = readPercent(fd, "bonus_pct", "Bonus %");
  }
  if (family === "support") {
    values.hourly_rate_cents = readDollars(fd, "hourly_rate_dollars", "Hourly rate");
  }

  const merged: Record<string, unknown> = { ...existing, ...values };
  const allowed = new Set<string>([...COMMON_KEYS, ...FAMILY_KEYS[family]]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

// ── Small field wrappers (presentational) ──────────────────────────────────────

function Field({
  name,
  label,
  defaultValue,
  hint,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className={labelCls}>
      {label}
      <Input
        name={name}
        inputMode="decimal"
        required
        defaultValue={defaultValue}
        placeholder={placeholder ?? "0.00"}
        className="mt-0.5"
      />
      {hint ? (
        <span className="mt-0.5 block text-xs font-normal normal-case text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export default function EmployeeForm({
  employee,
  onDone,
}: {
  /** Present = edit mode; absent = add mode. */
  employee?: PayrollEmployee;
  /** Edit mode: close the inline editor after a successful save / on Cancel. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(upsertPayrollEmployeeAction, null);
  const [, start] = useTransition();
  const [role, setRole] = useState<Role>(employee?.role ?? "technician");
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const isEdit = employee !== undefined;
  const family = familyForRole(role);
  const cfg: Record<string, unknown> = employee?.payConfig ?? {};

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      if (employee === undefined) {
        formRef.current?.reset();
        setRole("technician");
      } else {
        onDoneRef.current?.();
      }
    }
  }, [state?.timestamp, state?.ok, router, employee]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    const fd = new FormData(e.currentTarget);
    let payConfig: Record<string, unknown>;
    try {
      payConfig = buildPayConfig(family, cfg, fd);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Check the highlighted fields.");
      return;
    }
    const out = new FormData();
    if (employee) out.set("employee_id", employee.id);
    out.set("display_name", String(fd.get("display_name") ?? ""));
    out.set("role", role);
    const tek = String(fd.get("tekmetric_employee_id") ?? "").trim();
    if (tek.length > 0) out.set("tekmetric_employee_id", tek);
    // Archiving is a separate confirmed action on the card — the form never flips it.
    out.set("archived", employee?.archivedAt ? "true" : "false");
    out.set("pay_config", JSON.stringify(payConfig));
    start(() => dispatch(out));
  }

  const tekTypeLabel =
    TEKMETRIC_ID_TYPE_BY_FAMILY[family] === "technician" ? "technician" : "service-writer";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      {/* Identity */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          Name
          <Input
            name="display_name"
            required
            maxLength={200}
            defaultValue={employee?.displayName ?? ""}
            placeholder="First Last"
            className="mt-0.5"
          />
        </label>
        <label className={labelCls}>
          Role
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={`${selectCls} mt-0.5 block w-full`}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelCls}>
        Tekmetric employee ID (optional)
        <Input
          name="tekmetric_employee_id"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={employee?.tekmetricEmployeeId ?? ""}
          placeholder="e.g. 123456"
          className="mt-0.5 w-44"
        />
        <span className="mt-0.5 block text-xs font-normal normal-case text-muted-foreground">
          Matched as a {tekTypeLabel} id — derived from the role. Leave blank if this person isn&apos;t
          synced from Tekmetric.
        </span>
      </label>

      {/* Pay config (role-driven) — key={family} remounts the panel cleanly on swap */}
      <div key={family} className="rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-semibold text-foreground">{FAMILY_SHEET_LABEL[family]}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(family === "technician" || family === "shop_foreman") && (
            <>
              <Field
                name="hourly_rate_dollars"
                label="Hourly rate ($/hr)"
                defaultValue={centsToDollars(cfg, "hourly_rate_cents")}
              />
              <Field
                name="billed_rate_dollars"
                label="Billed rate ($/billed hr)"
                defaultValue={centsToDollars(cfg, "billed_rate_cents")}
              />
            </>
          )}
          {family === "shop_foreman" && (
            <>
              <Field
                name="shop_hour_goal"
                label="Shop-hour goal (hrs/month)"
                defaultValue={numToStr(cfg, "shop_hour_goal")}
                placeholder="0"
              />
              <Field
                name="shop_hour_bonus_dollars"
                label="Bonus ($/shop hr at goal)"
                defaultValue={centsToDollars(cfg, "shop_hour_bonus_cents_per_hour")}
              />
            </>
          )}
          {family === "service_advisor" && (
            <>
              <Field
                name="weekly_salary_dollars"
                label="Weekly salary ($/wk)"
                defaultValue={centsToDollars(cfg, "weekly_salary_cents")}
              />
              <Field
                name="spiff_amount_dollars"
                label="Spiff amount ($ each)"
                defaultValue={centsToDollars(cfg, "spiff_amount_cents")}
              />
              <Field
                name="gp_goal_1_dollars"
                label="GP goal 1 ($)"
                defaultValue={centsToDollars(cfg, "gp_goal_1_cents")}
              />
              <Field
                name="gp_goal_2_dollars"
                label="GP goal 2 ($)"
                defaultValue={centsToDollars(cfg, "gp_goal_2_cents")}
              />
              <Field
                name="sales_goal_dollars"
                label="Monthly sales goal ($)"
                defaultValue={centsToDollars(cfg, "sales_goal_cents")}
                hint="Fallback only — runs auto-derive the goal from the prior year's same month when data exists."
              />
              <div className="grid grid-cols-3 gap-3">
                <Field name="tier1_pct" label="Tier 1 (%)" defaultValue={fractionToPct(cfg, "tier1_pct")} placeholder="0" />
                <Field name="tier2_pct" label="Tier 2 (%)" defaultValue={fractionToPct(cfg, "tier2_pct")} placeholder="0" />
                <Field name="tier3_pct" label="Tier 3 (%)" defaultValue={fractionToPct(cfg, "tier3_pct")} placeholder="0" />
              </div>
            </>
          )}
          {family === "office_manager" && (
            <>
              <Field
                name="hourly_rate_dollars"
                label="Hourly rate ($/hr)"
                defaultValue={centsToDollars(cfg, "hourly_rate_cents")}
              />
              <Field
                name="sales_goal_dollars"
                label="Monthly sales goal ($)"
                defaultValue={centsToDollars(cfg, "sales_goal_cents")}
              />
              <Field
                name="bonus_pct"
                label="Bonus (% of sales over goal)"
                defaultValue={fractionToPct(cfg, "bonus_pct")}
                placeholder="0"
              />
            </>
          )}
          {family === "support" && (
            <Field
              name="hourly_rate_dollars"
              label="Hourly rate ($/hr)"
              defaultValue={centsToDollars(cfg, "hourly_rate_cents")}
            />
          )}
        </div>
      </div>

      {/* PTO (phase 1 — manual) */}
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          PTO
          <Badge variant="secondary">phase 1</Badge>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Accrual is entered by hand for now — the automatic accrual engine comes later.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            name="pto_balance_hours"
            label="Available balance (hours)"
            defaultValue={numToStr(cfg, "pto_balance_hours") || "0"}
            placeholder="0"
          />
          <Field
            name="pto_accrual_hours_per_period"
            label="Accrual (hours per pay period)"
            defaultValue={numToStr(cfg, "pto_accrual_hours_per_period") || "0"}
            placeholder="0"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending} loadingText="Saving…">
          {isEdit ? <Save aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          {isEdit ? "Save changes" : "Add employee"}
        </Button>
        {isEdit && onDone && (
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
        {clientError && <span className="text-sm text-red-700 dark:text-red-400">{clientError}</span>}
        {!clientError && state?.ok === false && (
          <span className="text-sm text-red-700 dark:text-red-400">{state.message}</span>
        )}
        {state?.ok && (
          <span className="text-sm text-emerald-800 dark:text-emerald-300">{isEdit ? "Saved." : "Added."}</span>
        )}
      </div>
    </form>
  );
}
