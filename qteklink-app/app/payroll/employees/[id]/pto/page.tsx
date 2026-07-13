/**
 * /payroll/employees/[id]/pto — the per-employee PTO activity page (design spec
 * §2). A READ-ONLY ledger: every accrual, usage, adjustment, forfeit, and
 * void-reversal, newest first. requireQtekUser() gates it (the module page
 * idiom); everyone signed in can READ — no admin gate (mutations live on the
 * employees roster). `[id]` is the employee's UUID.
 *
 * Reads via the payroll-pto DAL: the ledger rows (already ordered newest-first)
 * + the employee identity (via the shop-scoped roster). The current balance is
 * the newest row's RPC-stamped balance_after_hours (the single balance truth —
 * plan §2b), so no extra query. A missing/foreign-shop employee → notFound().
 */
import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { notFound } from "next/navigation";
import { requireQtekUser } from "@/lib/auth";
import { getPtoLedger, listPayrollEmployees } from "@/lib/dal/payroll";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PtoLedgerTable } from "../../PtoLedgerTable";
import { fmtDateLong, PtoBalance } from "../../../payroll-ui";

export const dynamic = "force-dynamic"; // the ledger must always be current

export default async function PtoActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { email, role, shopId } = await requireQtekUser();
  const { id } = await params;

  // Shop-scoped roster (includeArchived — an archived employee still has a
  // ledger worth reviewing). Finding by id also enforces shop ownership: an
  // employee from another shop is simply absent → notFound().
  const employees = await listPayrollEmployees(shopId, { includeArchived: true });
  const employee = employees.find((e) => e.id === id);
  if (!employee) notFound();

  const entries = await getPtoLedger(shopId, id);
  // Balance = the newest row's stamped running total (the ledger is newest-first);
  // 0 when the employee has no ledger rows yet (unseeded).
  const balance = entries[0]?.balanceAfterHours ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader
        title={`PTO activity — ${employee.displayName}`}
        description="Every accrual, usage, and adjustment"
      >
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      {/* Self-labeling print header — the on-screen chrome is print:hidden, so
          the paper itself must name the person + as-of date. */}
      <div className="mb-4 hidden print:block">
        <p className="text-lg font-bold text-foreground">PTO activity — {employee.displayName}</p>
        <p className="text-sm text-muted-foreground">as of {fmtDateLong(new Date().toISOString())}</p>
      </div>

      <div className="mt-4">
        <Button render={<Link href="/payroll/employees" />} variant="link" className="h-auto px-0">
          <ArrowLeft aria-hidden="true" />
          Back to employees
        </Button>
      </div>

      {/* Balance summary strip (the info-strip idiom). */}
      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current balance</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
            <PtoBalance hours={balance} />
          </p>
        </div>
        {employee.archivedAt !== null && <Badge variant="secondary">Archived</Badge>}
      </section>

      <div className="mt-6">
        {entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No PTO activity yet"
            subtext="Accruals start after the waiting period; adjustments and usage appear here as they happen."
          />
        ) : (
          <PtoLedgerTable entries={entries} />
        )}
      </div>
    </main>
  );
}
