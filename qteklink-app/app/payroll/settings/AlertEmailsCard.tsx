"use client";

/**
 * AlertEmailsCard — who gets the two payroll alert emails (Void & clone /
 * Payroll completed). Each list renders as removable chips + an add row with
 * email validation (the AllowedUsersManager add-list shape). Every add/remove
 * submits BOTH lists comma-joined — the settings action's existing contract
 * (the DAL replaces alert_emails whole, so the two fields always travel
 * together; "" clears a list).
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { updatePayrollSettingsAction } from "@/actions/payroll";
import type { PayrollAlertEmails } from "@/lib/dal/payroll";
import { emailRx } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

type ListKey = keyof PayrollAlertEmails; // "void_clone" | "completed"

export default function AlertEmailsCard({ alertEmails }: { alertEmails: PayrollAlertEmails }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(updatePayrollSettingsAction, null);
  const [, start] = useTransition();
  const [inputs, setInputs] = useState<Record<ListKey, string>>({ void_clone: "", completed: "" });
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      setInputs({ void_clone: "", completed: "" });
      setClientError(null);
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router]);

  /** Submit BOTH lists (the action requires them together; "" clears one). */
  function submitLists(next: PayrollAlertEmails) {
    const fd = new FormData();
    fd.set("void_clone_alert_emails", next.void_clone.join(", "));
    fd.set("completed_alert_emails", next.completed.join(", "));
    start(() => dispatch(fd));
  }

  function add(which: ListKey) {
    const raw = inputs[which].trim();
    if (!emailRx.test(raw)) {
      setClientError("Enter a valid email address (person@company.com).");
      return;
    }
    const current = alertEmails[which];
    if (current.some((e) => e.toLowerCase() === raw.toLowerCase())) {
      setClientError(`${raw} is already on that list.`);
      return;
    }
    setClientError(null);
    submitLists({ ...alertEmails, [which]: [...current, raw] });
  }

  function remove(which: ListKey, email: string) {
    setClientError(null);
    submitLists({ ...alertEmails, [which]: alertEmails[which].filter((e) => e !== email) });
  }

  function renderSection(which: ListKey, title: string, helper: string) {
    const list = alertEmails[which];
    return (
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{helper}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one gets this alert yet.</p>
          ) : (
            list.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
              >
                {email}
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${email}`}
                  disabled={pending}
                  onClick={() => remove(which, email)}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            ))
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(which);
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <label className={labelCls}>
            Add a recipient
            <Input
              type="email"
              value={inputs[which]}
              onChange={(e) => setInputs((prev) => ({ ...prev, [which]: e.target.value }))}
              placeholder="person@jeffsautomotive.com"
              className="mt-0.5 w-64"
              disabled={pending}
            />
          </label>
          <Button type="submit" size="sm" loading={pending} loadingText="Saving…" disabled={pending}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>
      </div>
    );
  }

  return (
    <Card className="mt-6 shadow-xs">
      <CardHeader>
        <CardTitle>Payroll alert emails</CardTitle>
        <CardDescription>
          Choose who gets each payroll email. Every list accepts several addresses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {renderSection(
            "void_clone",
            "Void & clone alerts",
            "Sent when a completed run is voided and re-cloned for correction.",
          )}
          {renderSection(
            "completed",
            "Payroll completed alerts",
            "Sent when a payroll run is marked complete and locked.",
          )}
        </div>
        {clientError && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400">{clientError}</p>
        )}
        {!clientError && state?.ok === false && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400">{state.message}</p>
        )}
        {state?.ok && (
          <p className="mt-3 text-sm text-emerald-800 dark:text-emerald-300">Saved.</p>
        )}
      </CardContent>
    </Card>
  );
}
