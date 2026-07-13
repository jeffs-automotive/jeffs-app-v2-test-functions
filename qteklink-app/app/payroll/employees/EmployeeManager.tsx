"use client";

/**
 * EmployeeManager — the /payroll/employees roster (AllowedUsersManager idiom):
 * a card per active employee (name, role badge, pay basis, LEDGER PTO balance),
 * an inline per-card editor, per-card PTO Adjust + Activity affordances,
 * archive-with-termination-date + unarchive, archived employees collapsed in a
 * native <details>, and the dashed "Add someone" form at the bottom. Admin-gated
 * mutations happen in the server actions; non-admins get the same roster rendered
 * read-only (only the Activity link stays visible — it's a read-only page).
 *
 * PTO balance is the LEDGER truth (getPtoBalances, threaded from the page), NOT
 * pay_config — an employee absent from the balance map has no ledger rows yet.
 * Archive → ArchiveEmployeeDialog (archiveEmployeeAction, captures the
 * termination date); unarchive stays a plain ConfirmDialog (unarchiveEmployeeAction,
 * which clears the termination date server-side).
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArchiveRestore, ChevronRight, History, Pencil, Users, X } from "lucide-react";
import { unarchiveEmployeeAction } from "@/actions/payroll-pto";
import type { PayrollEmployee } from "@/lib/dal/payroll";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import EmployeeForm from "./EmployeeForm";
import PtoAdjustDialog from "./PtoAdjustDialog";
import ArchiveEmployeeDialog from "./ArchiveEmployeeDialog";
import { PtoBalance } from "../payroll-ui";
import { ROLE_LABEL, payBasisLine } from "./payroll-ui";

function EmployeeCard({
  emp,
  isAdmin,
  ptoBalanceHours,
  hasLedger,
}: {
  emp: PayrollEmployee;
  isAdmin: boolean;
  /** Ledger balance (0 when the employee has no ledger rows yet). */
  ptoBalanceHours: number;
  /** False ⇒ no ledger rows yet — the Adjust dialog seeds the first entry. */
  hasLedger: boolean;
}) {
  const router = useRouter();
  const [unarchiveState, unarchiveDispatch, unarchivePending] = useActionState(
    unarchiveEmployeeAction,
    null,
  );
  const [, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (unarchiveState?.ok) router.refresh();
  }, [unarchiveState?.timestamp, unarchiveState?.ok, router]);

  const archived = emp.archivedAt !== null;

  /** Unarchive → the RPC clears termination_date server-side (C8/C23/C36). */
  function unarchive() {
    const fd = new FormData();
    fd.set("employee_id", emp.id);
    setConfirmOpen(false);
    start(() => unarchiveDispatch(fd));
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
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <span>PTO</span>
        {hasLedger ? (
          <PtoBalance hours={ptoBalanceHours} />
        ) : (
          <span className="text-muted-foreground">not set</span>
        )}
        <span>available</span>
        <span>·</span>
        <span>
          {emp.tekmetricEmployeeId === null
            ? "not linked to Tekmetric"
            : `Tekmetric ${emp.tekmetricIdType === "service_writer" ? "service-writer" : "technician"} id ${emp.tekmetricEmployeeId}`}
        </span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isAdmin && !archived && (
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)} disabled={unarchivePending}>
            {editing ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            {editing ? "Close" : "Edit"}
          </Button>
        )}
        {isAdmin && !archived && (
          <PtoAdjustDialog
            employeeId={emp.id}
            employeeName={emp.displayName}
            currentBalanceHours={ptoBalanceHours}
            needsSeed={!hasLedger}
            disabled={unarchivePending}
          />
        )}
        {/* Activity is read-only — visible to everyone, not just admins. */}
        <Button render={<Link href={`/payroll/employees/${emp.id}/pto`} />} variant="outline" size="sm">
          <History aria-hidden="true" />
          Activity
        </Button>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => (archived ? setConfirmOpen(true) : setArchiveOpen(true))}
            disabled={unarchivePending}
            className={
              archived
                ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                : "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
            }
          >
            {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            {archived ? "Unarchive" : "Archive"}
          </Button>
        )}
        {isAdmin && unarchiveState?.ok === false && (
          <span className="text-xs text-red-700 dark:text-red-400">{unarchiveState.message}</span>
        )}
      </div>

      {isAdmin && editing && !archived && (
        <div className="mt-3 border-t border-border pt-3">
          <EmployeeForm employee={emp} onDone={() => setEditing(false)} />
        </div>
      )}

      {/* Archive captures a termination date (archiveEmployeeAction). */}
      {isAdmin && !archived && (
        <ArchiveEmployeeDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          employeeId={emp.id}
          employeeName={emp.displayName}
        />
      )}

      {/* Unarchive stays a plain confirm (unarchiveEmployeeAction). */}
      {isAdmin && archived && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(next) => {
            if (!next) setConfirmOpen(false);
          }}
          isPending={unarchivePending}
          title={`Unarchive ${emp.displayName}?`}
          body="They go back on the active roster and are included the next time a run's roster is synced. Their termination date is cleared so PTO accrues again."
          confirmLabel="Unarchive"
          confirmingLabel="Working…"
          variant="default"
          onConfirm={unarchive}
        />
      )}
    </li>
  );
}

export default function EmployeeManager({
  employees,
  isAdmin,
  ptoBalanceEntries = [],
}: {
  employees: PayrollEmployee[];
  isAdmin: boolean;
  /** Ledger balances keyed by employee id (from getPtoBalances). An id ABSENT
   *  from the map has no ledger rows yet — the card shows "not set" and the
   *  Adjust dialog seeds the first entry. Serialized as entries (Maps aren't
   *  RSC-serializable) and rebuilt here. */
  ptoBalanceEntries?: [string, number][];
}) {
  const active = employees.filter((e) => e.archivedAt === null);
  const archived = employees.filter((e) => e.archivedAt !== null);
  const ptoBalances = new Map(ptoBalanceEntries);

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
            <EmployeeCard
              key={e.id}
              emp={e}
              isAdmin={isAdmin}
              ptoBalanceHours={ptoBalances.get(e.id) ?? 0}
              hasLedger={ptoBalances.has(e.id)}
            />
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
              <EmployeeCard
                key={e.id}
                emp={e}
                isAdmin={isAdmin}
                ptoBalanceHours={ptoBalances.get(e.id) ?? 0}
                hasLedger={ptoBalances.has(e.id)}
              />
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
