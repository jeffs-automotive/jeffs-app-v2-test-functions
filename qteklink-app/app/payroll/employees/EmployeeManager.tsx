"use client";

/**
 * EmployeeManager — the /payroll/employees roster (AllowedUsersManager idiom):
 * a card per active employee (name, role badge, pay basis, PTO), an inline
 * per-card editor, archive/unarchive behind ConfirmDialog, archived employees
 * collapsed in a native <details>, and the dashed "Add someone" form at the
 * bottom. Admin-gated mutations happen in the server action; non-admins get
 * the same roster rendered read-only (no affordances).
 *
 * Archive/unarchive re-submits the employee's CURRENT values verbatim
 * (pay_config passed through untouched as JSON) with only the archived flag
 * flipped — the form path is the only thing that reshapes pay_config.
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChevronRight, Pencil, Users, X } from "lucide-react";
import { upsertPayrollEmployeeAction } from "@/actions/payroll";
import type { PayrollEmployee } from "@/lib/dal/payroll";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import EmployeeForm from "./EmployeeForm";
import { ROLE_LABEL, cfgNum, fmtHours, payBasisLine } from "./payroll-ui";

function EmployeeCard({ emp, isAdmin }: { emp: PayrollEmployee; isAdmin: boolean }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(upsertPayrollEmployeeAction, null);
  const [, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const archived = emp.archivedAt !== null;
  const ptoBalance = cfgNum(emp.payConfig, "pto_balance_hours");
  const ptoAccrual = cfgNum(emp.payConfig, "pto_accrual_hours_per_period");

  /** Flip ONLY the archived flag; everything else passes through verbatim. */
  function flipArchived() {
    const fd = new FormData();
    fd.set("employee_id", emp.id);
    fd.set("display_name", emp.displayName);
    fd.set("role", emp.role);
    if (emp.tekmetricEmployeeId !== null) {
      fd.set("tekmetric_employee_id", String(emp.tekmetricEmployeeId));
    }
    fd.set("archived", archived ? "false" : "true");
    fd.set("pay_config", JSON.stringify(emp.payConfig));
    setConfirmOpen(false);
    start(() => dispatch(fd));
  }

  return (
    <li
      id={emp.id}
      className={`rounded-lg border border-border p-3 shadow-xs ${archived ? "bg-muted opacity-70" : "bg-card"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{emp.displayName}</span>
        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
          {ROLE_LABEL[emp.role]}
        </Badge>
        {archived && <Badge variant="secondary">Archived</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{payBasisLine(emp)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        PTO {ptoBalance === null ? "not set" : `${fmtHours(ptoBalance)} hrs available`}
        {" · "}
        accrues {ptoAccrual === null ? "not set" : `${fmtHours(ptoAccrual)} hrs/period`} (manual for now)
        {" · "}
        {emp.tekmetricEmployeeId === null
          ? "not linked to Tekmetric"
          : `Tekmetric ${emp.tekmetricIdType === "service_writer" ? "service-writer" : "technician"} id ${emp.tekmetricEmployeeId}`}
      </p>

      {isAdmin && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!archived && (
            <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)} disabled={pending}>
              {editing ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
              {editing ? "Close" : "Edit"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={pending}
            className={
              archived
                ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                : "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
            }
          >
            {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            {archived ? "Unarchive" : "Archive"}
          </Button>
          {state?.ok === false && (
            <span className="text-xs text-red-700 dark:text-red-400">{state.message}</span>
          )}
        </div>
      )}

      {isAdmin && editing && !archived && (
        <div className="mt-3 border-t border-border pt-3">
          <EmployeeForm employee={emp} onDone={() => setEditing(false)} />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next) setConfirmOpen(false);
        }}
        isPending={pending}
        title={archived ? `Unarchive ${emp.displayName}?` : `Archive ${emp.displayName}?`}
        body={
          archived
            ? "They go back on the active roster and are included the next time a run's roster is synced."
            : "Archived employees keep their history but stop appearing on new payroll runs. You can unarchive them any time."
        }
        confirmLabel={archived ? "Unarchive" : "Archive"}
        confirmingLabel="Working…"
        variant="default"
        onConfirm={flipArchived}
      />
    </li>
  );
}

export default function EmployeeManager({
  employees,
  isAdmin,
}: {
  employees: PayrollEmployee[];
  isAdmin: boolean;
}) {
  const active = employees.filter((e) => e.archivedAt === null);
  const archived = employees.filter((e) => e.archivedAt !== null);

  return (
    <div className="mt-8 space-y-6">
      {active.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees yet"
          subtext={
            isAdmin
              ? "Add your first employee below to start running payroll."
              : "An admin needs to add employees before payroll can run."
          }
        />
      ) : (
        <ul className="space-y-3">
          {active.map((e) => (
            <EmployeeCard key={e.id} emp={e} isAdmin={isAdmin} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground select-none">
            <ChevronRight
              className="size-4 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            Show {archived.length} archived employee{archived.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-3 space-y-3">
            {archived.map((e) => (
              <EmployeeCard key={e.id} emp={e} isAdmin={isAdmin} />
            ))}
          </ul>
        </details>
      )}

      {isAdmin && (
        <div className="rounded-lg border border-dashed border-border p-4">
          <p className="text-sm font-medium text-foreground">Add someone</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The role picks which pay-sheet layout they get; the rates entered here prefill every new
            run (each run keeps its own copy, so later changes never rewrite history).
          </p>
          <div className="mt-3">
            <EmployeeForm />
          </div>
        </div>
      )}
    </div>
  );
}
