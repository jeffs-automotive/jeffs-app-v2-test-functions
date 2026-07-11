/**
 * Client-safe presentational helpers for the /payroll/employees pages —
 * human role labels, the shared label/select class strings (the settings-page
 * idiom), hour formatting (1–2 decimals), and the pay-basis summary line
 * rendered on each employee card. Pure formatting only: money renders from
 * integer cents via the existing fmtUsd; NO business logic lives here (the
 * DAL + RPCs own validation and computation).
 */
import { familyForRole, type Role } from "@/lib/payroll/types";
import { fmtUsd } from "@/lib/format";
import type { PayrollEmployee } from "@/lib/dal/payroll";

/** Human labels for the 8 payroll roles (contract §Roles + families). */
export const ROLE_LABEL: Record<Role, string> = {
  general_manager: "General Manager",
  service_manager: "Service Manager",
  asst_manager: "Asst Manager",
  office_manager: "Office Manager",
  shop_foreman: "Shop Foreman",
  technician: "Technician",
  shop_support: "Shop Support",
  office_support: "Office Support",
};

/** The settings-page uppercase field-label idiom (SettingsForm.tsx). */
export const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** The native styled <select> idiom (AllowedUsersManager.tsx) + disabled states. */
export const selectCls =
  "rounded-md border border-input bg-card px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/** Hours with 1 decimal (2 when the value needs it): 40 → "40.0", 3.55 → "3.55". */
export function fmtHours(h: number): string {
  const r2 = Math.round(h * 100) / 100;
  const r1 = Math.round(r2 * 10) / 10;
  return r1 === r2 ? r2.toFixed(1) : r2.toFixed(2);
}

/** Safe numeric read from the raw pay_config JSONB (render "not set" over NaN). */
export function cfgNum(cfg: Record<string, unknown>, key: string): number | null {
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * One-line pay basis for an employee card, per role family. Values that don't
 * apply to the family are simply not shown (never rendered as $0.00).
 */
export function payBasisLine(emp: PayrollEmployee): string {
  const cfg = emp.payConfig;
  const family = familyForRole(emp.role);
  const money = (key: string, suffix = "") => {
    const v = cfgNum(cfg, key);
    return v === null ? "not set" : `${fmtUsd(v)}${suffix}`;
  };
  switch (family) {
    case "service_advisor":
      return `Salary · ${money("weekly_salary_cents", "/wk")}`;
    case "shop_foreman": {
      const goal = cfgNum(cfg, "shop_hour_goal");
      const base = `Hourly · ${money("hourly_rate_cents", "/hr")} · billed ${money("billed_rate_cents", "/hr")}`;
      return goal === null ? base : `${base} · shop goal ${fmtHours(goal)} hrs`;
    }
    case "technician":
      return `Hourly · ${money("hourly_rate_cents", "/hr")} · billed ${money("billed_rate_cents", "/hr")}`;
    case "office_manager": {
      const salesGoal = cfgNum(cfg, "sales_goal_cents");
      const base = `Hourly · ${money("hourly_rate_cents", "/hr")}`;
      return salesGoal === null ? base : `${base} · sales goal ${fmtUsd(salesGoal)}`;
    }
    case "support":
      return `Hourly · ${money("hourly_rate_cents", "/hr")}`;
  }
}
