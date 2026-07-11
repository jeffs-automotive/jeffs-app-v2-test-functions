/**
 * Shared page-local presentational helpers for the /payroll dashboard surfaces
 * (page.tsx + EmployeesCard.tsx). Display-only: no data fetching, no actions.
 */
export const ROLE_LABELS: Record<string, string> = {
  general_manager: "General Manager",
  service_manager: "Service Manager",
  asst_manager: "Asst Manager",
  office_manager: "Office Manager",
  shop_foreman: "Shop Foreman",
  technician: "Technician",
  shop_support: "Shop Support",
  office_support: "Office Support",
};

/** Hours, one decimal ("40.0", "3.5"). */
export function fmtHours(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Hours with up to two decimals — for accrual rates like 1.54 hrs/period. */
export function fmtHours2(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** "2026" or "2026–27" when a period straddles New Year. */
export function periodYears(startIso: string, endIso: string): string {
  const y1 = startIso.slice(0, 4);
  const y2 = endIso.slice(0, 4);
  return y1 === y2 ? y1 : `${y1}–${y2.slice(2)}`;
}

/** The breakdown page's right-aligned numeric-cell idiom. */
export const numCell = "px-3 py-2 text-right tabular-nums";

/** The breakdown page's table-header treatment. */
export const headerCls =
  "bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:px-3 [&_th]:py-2";

/** "n/a" with the reason in title + accessible name — never a misleading $0.00. */
export function NotApplicable({ reason }: { reason: string }) {
  return (
    <span className="text-muted-foreground" title={reason} aria-label={`n/a — ${reason}`}>
      n/a
    </span>
  );
}
