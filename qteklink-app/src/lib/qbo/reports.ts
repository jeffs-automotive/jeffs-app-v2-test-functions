/**
 * QBO Reports API — read-only ProfitAndLoss fetch for the payroll GP
 * composition (round-5 decision #38, docs/qteklink/payroll-workbook-
 * extraction-2026-07-10.md): QBO supplies ONLY the technician cost — the P&L
 * COGS row for account "6010 Technicians" — while sales/parts stay Tekmetric
 * (#45/#37).
 *
 * Shape: a PURE parser over the report's Rows tree (unit-testable; THROWS with
 * clear text on every surprise — NO silent fallback in here; the payroll DAL
 * owns the single sanctioned catch + Sentry capture + computed-GP fallback),
 * fed by a thin fetcher that reuses the QboClient plumbing (token refresh,
 * 429/5xx retry, intuit_tid capture, typed Faults — see client.ts).
 *
 * Account resolution (the documented pick): NEVER a hardcoded QBO account id —
 * a re-mapped chart still matches. The sturdiest form: the qbo_accounts COA
 * mirror is consulted for acct_num '6010' and, when it yields exactly one
 * account, its QBO id feeds an id-based match on the report rows (report
 * ColData carries the account id). The number/name label match
 * (`^6010(\s|$)` OR contains "Technicians") runs as well; when both flavors
 * hit, they must agree on the SAME single row. An empty/ambiguous mirror
 * lookup (COA never synced, unnumbered chart) degrades to the label match
 * alone; a missing or ambiguous row in the REPORT throws.
 *
 * accounting_method: pinned to "Accrual" explicitly (no prior report idiom in
 * this repo) — the #34/#38 June proof numbers came from the books' accrual
 * P&L, and pinning beats depending on the company's report preference.
 *
 * MULTI-TENANT: shopId comes from the caller's session; the realm is resolved
 * server-side via the shop-bound connection (resolveRealmForShop), and the
 * qbo_accounts lookup is (shop_id, realm_id)-scoped.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClient } from "@/lib/qbo/client";
import { QboClientError } from "@/lib/qbo/errors";
import { monthDateRange, roundCents } from "@/lib/payroll/derive";

/** The account this module resolves (decision #38). Matching is by number/name
 *  (+ the mirror's id), never a hardcoded QBO id. */
export const QBO_TECH_COST_ACCT_NUM = "6010";
export const QBO_TECH_COST_ACCOUNT_NAME = "Technicians";

// ── Report JSON shapes (loose on purpose — the wire tree nests Sections) ──────

interface PnlColData {
  value?: string;
  id?: string;
}

export interface PnlRow {
  type?: string;
  group?: string;
  ColData?: PnlColData[];
  Header?: { ColData?: PnlColData[] };
  Rows?: { Row?: PnlRow[] };
  Summary?: { ColData?: PnlColData[] };
}

export interface PnlReport {
  Header?: Record<string, unknown>;
  Columns?: Record<string, unknown>;
  Rows?: { Row?: PnlRow[] };
}

// ── The PURE parser ────────────────────────────────────────────────────────────

interface CollectedRow {
  /** QBO account id from the row's first ColData (absent on some totals rows). */
  id: string | null;
  /** The rendered account label, e.g. "6010 Technicians". */
  label: string;
  /** The money column (last ColData value), still a string. */
  amount: string | null;
}

/** Depth-first collect of account (non-Section) rows across the whole tree —
 *  sub-accounts nest under Section rows, so every level is walked. */
function collectAccountRows(rows: PnlRow[] | undefined, out: CollectedRow[]): void {
  for (const row of rows ?? []) {
    const first = row.ColData?.[0];
    if (row.type !== "Section" && first && typeof first.value === "string" && first.value.length > 0) {
      const cols = row.ColData ?? [];
      const last = cols.length > 1 ? cols[cols.length - 1] : undefined;
      out.push({
        id: typeof first.id === "string" && first.id.length > 0 ? first.id : null,
        label: first.value,
        amount: typeof last?.value === "string" ? last.value : null,
      });
    }
    collectAccountRows(row.Rows?.Row, out);
  }
}

/** Label test: starts with the account NUMBER (word-bounded — "6010-1 …" does
 *  NOT match) OR contains the account NAME (case-insensitive). */
function labelMatchesTechCost(label: string): boolean {
  const trimmed = label.trim();
  if (new RegExp(`^${QBO_TECH_COST_ACCT_NUM}(\\s|$)`).test(trimmed)) return true;
  return trimmed.toLowerCase().includes(QBO_TECH_COST_ACCOUNT_NAME.toLowerCase());
}

export interface PnlTechCostMatch {
  /** The row's amount in integer cents (round half away from zero). */
  cents: number;
  /** The row's account label as QBO rendered it. */
  label: string;
  matchedBy: "account_id" | "label";
}

/**
 * Find THE "6010 Technicians" row in a ProfitAndLoss report and return its
 * amount in cents. `accountId` (from the qbo_accounts mirror) refines the match
 * when known. Throws — with text precise enough to act on — when the report is
 * empty, the row is absent, the match is ambiguous, the id- and label-matches
 * disagree, or the amount cell is missing/non-numeric. No silent fallback.
 */
export function parsePnlTechnicianCostCents(
  report: PnlReport,
  opts: { accountId?: string | null } = {},
): PnlTechCostMatch {
  const rows: CollectedRow[] = [];
  collectAccountRows(report.Rows?.Row, rows);
  if (rows.length === 0) {
    throw new Error(
      "QBO P&L parse: the report contains no account rows (empty or unexpected Rows tree shape).",
    );
  }

  const accountId = opts.accountId ?? null;
  const idMatches = accountId === null ? [] : rows.filter((r) => r.id === accountId);
  const labelMatches = rows.filter((r) => labelMatchesTechCost(r.label));

  let matched: CollectedRow;
  let matchedBy: PnlTechCostMatch["matchedBy"];
  if (idMatches.length > 1) {
    throw new Error(
      `QBO P&L parse: ${idMatches.length} rows carry account id ${accountId} — refusing to guess.`,
    );
  } else if (idMatches.length === 1) {
    matched = idMatches[0] as CollectedRow;
    if (labelMatches.length > 0 && !labelMatches.includes(matched)) {
      const labels = labelMatches.map((r) => `"${r.label}"`).join(", ");
      throw new Error(
        `QBO P&L parse: the mirror's account id ${accountId} matched row "${matched.label}" but the ` +
          `${QBO_TECH_COST_ACCT_NUM}/${QBO_TECH_COST_ACCOUNT_NAME} label match found ${labels} — the chart ` +
          `of accounts has changed shape; refresh the COA mirror and re-check the mapping.`,
      );
    }
    matchedBy = "account_id";
  } else if (labelMatches.length === 1) {
    matched = labelMatches[0] as CollectedRow;
    matchedBy = "label";
  } else if (labelMatches.length === 0) {
    throw new Error(
      `QBO P&L parse: no row matching account ${QBO_TECH_COST_ACCT_NUM} "${QBO_TECH_COST_ACCOUNT_NAME}" ` +
        `found among ${rows.length} account rows — the technician-cost account may have been renamed or ` +
        `removed from the chart of accounts.`,
    );
  } else {
    const labels = labelMatches.map((r) => `"${r.label}"`).join(", ");
    throw new Error(
      `QBO P&L parse: ${labelMatches.length} rows match account ${QBO_TECH_COST_ACCT_NUM} ` +
        `"${QBO_TECH_COST_ACCOUNT_NAME}" (${labels}) — refusing to guess.`,
    );
  }

  if (matched.amount === null || matched.amount.trim() === "") {
    throw new Error(`QBO P&L parse: row "${matched.label}" has no amount column.`);
  }
  const dollars = Number(matched.amount.replace(/,/g, ""));
  if (!Number.isFinite(dollars)) {
    throw new Error(
      `QBO P&L parse: row "${matched.label}" amount "${matched.amount}" is not numeric.`,
    );
  }
  return { cents: roundCents(dollars * 100), label: matched.label, matchedBy };
}

// ── The thin fetcher ───────────────────────────────────────────────────────────

export interface QboTechCostResult {
  /** The month's QBO 6010 technician cost in integer cents. */
  valueCents: number;
  /** The matched P&L row label (e.g. "6010 Technicians") — UI provenance. */
  accountLabel: string;
  matchedBy: "account_id" | "label";
  realmId: string;
}

/**
 * The month's technician cost from the QBO P&L (decision #38):
 * GET /v3/company/{realmId}/reports/ProfitAndLoss over the month, Accrual,
 * parsed by {@link parsePnlTechnicianCostCents}. Every failure THROWS (no
 * connection, DB error on the mirror lookup, QBO fault, absent/ambiguous row,
 * surprising shape) — the payroll DAL catches, Sentry-captures with the
 * shop_id tag, and falls back to the computed-GP path (its ONLY sanctioned
 * catch).
 */
export async function qboMonthTechnicianCostCents(
  shopId: number,
  month: string,
): Promise<QboTechCostResult> {
  const { start, end } = monthDateRange(month); // throws on a malformed month
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", {
      kind: "reconnect_required",
    });
  }

  // Mirror refinement (see module doc): exactly one acct_num-6010 account →
  // id-based row match; zero or several → label match alone. A DB ERROR still
  // throws — never silently degrade when the mirror was merely unreachable.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qbo_accounts")
    .select("qbo_account_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("acct_num", QBO_TECH_COST_ACCT_NUM);
  if (error) {
    throw new Error(`payroll qbo tech cost: qbo_accounts lookup failed: ${error.message}`);
  }
  const accounts = (data ?? []) as { qbo_account_id: string }[];
  const accountId = accounts.length === 1 ? (accounts[0] as { qbo_account_id: string }).qbo_account_id : null;

  const client = new QboClient({ realmId });
  const report = await client.request<PnlReport>("GET", "reports/ProfitAndLoss", {
    query: { start_date: start, end_date: end, accounting_method: "Accrual" },
  });
  const parsed = parsePnlTechnicianCostCents(report, { accountId });
  return {
    valueCents: parsed.cents,
    accountLabel: parsed.label,
    matchedBy: parsed.matchedBy,
    realmId,
  };
}
