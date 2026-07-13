"use client";

/**
 * AlertEmailsCard — who gets each payroll alert email. Four removable-chip lists:
 *   • the two LEGACY lists (Void & clone / Payroll completed) live in the
 *     alert_emails object and TRAVEL TOGETHER — the settings action replaces
 *     alert_emails whole, so every add/remove submits both ("" clears one).
 *   • the two PTO lists (PTO adjustment / Negative-balance admin) are INDEPENDENT
 *     TOP-LEVEL payroll keys (plan §2d/§10.1/C25) — each is its own whole-replace
 *     patch and does NOT travel with the others; a change to one submits only
 *     that key.
 * Each list renders as removable chips + an add row with email validation (the
 * AllowedUsersManager add-list shape).
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

// UI-local union: the two legacy lists live under alert_emails; the two PTO lists
// are top-level payroll keys (NOT members of PayrollAlertEmails — §10.1/C25).
type LegacyKey = keyof PayrollAlertEmails; // "void_clone" | "completed"
type PtoKey = "pto_adjustment" | "pto_negative";
type ListKey = LegacyKey | PtoKey;

const EMPTY_INPUTS: Record<ListKey, string> = {
  void_clone: "",
  completed: "",
  pto_adjustment: "",
  pto_negative: "",
};

export default function AlertEmailsCard({
  alertEmails,
  ptoAdjustmentEmails,
  ptoNegativeEmails,
}: {
  alertEmails: PayrollAlertEmails;
  ptoAdjustmentEmails: string[];
  ptoNegativeEmails: string[];
}) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(updatePayrollSettingsAction, null);
  const [, start] = useTransition();
  const [inputs, setInputs] = useState<Record<ListKey, string>>(EMPTY_INPUTS);
  const [clientError, setClientError] = useState<string | null>(null);

  // A read-through view of every list keyed by ListKey, so add/remove is uniform.
  const lists: Record<ListKey, string[]> = {
    void_clone: alertEmails.void_clone,
    completed: alertEmails.completed,
    pto_adjustment: ptoAdjustmentEmails,
    pto_negative: ptoNegativeEmails,
  };

  useEffect(() => {
    if (state?.ok) {
      setInputs(EMPTY_INPUTS);
      setClientError(null);
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router]);

  /** Legacy lists TRAVEL TOGETHER (the action requires both; "" clears one). */
  function submitLegacy(next: PayrollAlertEmails) {
    const fd = new FormData();
    fd.set("void_clone_alert_emails", next.void_clone.join(", "));
    fd.set("completed_alert_emails", next.completed.join(", "));
    start(() => dispatch(fd));
  }

  /** PTO lists are INDEPENDENT — submit ONLY the one field being changed. */
  function submitPto(which: PtoKey, next: string[]) {
    const fd = new FormData();
    fd.set(
      which === "pto_adjustment" ? "pto_adjustment_alert_emails" : "pto_negative_alert_admin_emails",
      next.join(", "),
    );
    start(() => dispatch(fd));
  }

  function commit(which: ListKey, next: string[]) {
    if (which === "void_clone") {
      submitLegacy({ ...alertEmails, void_clone: next });
    } else if (which === "completed") {
      submitLegacy({ ...alertEmails, completed: next });
    } else {
      submitPto(which, next);
    }
  }

  function add(which: ListKey) {
    const raw = inputs[which].trim();
    if (!emailRx.test(raw)) {
      setClientError("Enter a valid email address (person@company.com).");
      return;
    }
    const current = lists[which];
    if (current.some((e) => e.toLowerCase() === raw.toLowerCase())) {
      setClientError(`${raw} is already on that list.`);
      return;
    }
    setClientError(null);
    commit(which, [...current, raw]);
  }

  function remove(which: ListKey, email: string) {
    setClientError(null);
    commit(
      which,
      lists[which].filter((e) => e !== email),
    );
  }

  function renderSection(which: ListKey, title: string, helper: string) {
    const list = lists[which];
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
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"
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
          {renderSection(
            "pto_adjustment",
            "PTO adjustment alerts",
            "Sent when someone's PTO balance is manually adjusted.",
          )}
          {renderSection(
            "pto_negative",
            "Negative PTO balance alerts (admins)",
            "Sent to admins when a completed run leaves someone with a negative PTO balance.",
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
