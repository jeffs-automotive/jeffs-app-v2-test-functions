/**
 * /payroll/employees — manage the people on payroll: list active + archived
 * (collapsed), add/edit per role family, archive/unarchive with confirm.
 * requireQtekUser() gates the page; everyone signed in can READ the roster,
 * only admins see the editors (mutations are re-gated in the actions —
 * the settings-page fork idiom).
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { listPayrollEmployees } from "@/lib/dal/payroll";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import EmployeeManager from "./EmployeeManager";

export const dynamic = "force-dynamic"; // the roster must always be current

export default async function PayrollEmployeesPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const employees = await listPayrollEmployees(shopId, { includeArchived: true });
  const activeCount = employees.filter((e) => e.archivedAt === null).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader title="Employees" description="Add, edit, and archive the people on payroll">
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button render={<Link href="/payroll" />} variant="link" className="h-auto px-0">
          <ArrowLeft aria-hidden="true" />
          Back to payroll
        </Button>
        <p className="text-sm text-muted-foreground">
          {activeCount} active employee{activeCount === 1 ? "" : "s"}
        </p>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        Everyone here appears on new payroll runs. The role decides the pay-sheet layout
        (technician, foreman, service advisor, office manager, or support), and the pay
        setup below prefills each run&apos;s numbers.
        {!isAdmin && (
          <>
            {" "}
            <span className="font-medium text-foreground">
              Only an admin can change the roster
            </span>{" "}
            — you can see the current setup below.
          </>
        )}
      </section>

      <EmployeeManager employees={employees} isAdmin={isAdmin} />
    </main>
  );
}
