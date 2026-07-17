"use client";

/**
 * AddInvoiceDialog — the office manager's "Add" for invoice_issue / open_ro. Type an
 * invoice number → fetch the matching QBO Bill/Purchase(s) → confirm & edit → create.
 * Handles the four states the fetch action produces: enter → fetching (skeleton) →
 * found/confirm (pick + confirm) → not-found (retry / manual) or couldn't-fetch (an
 * amber "send to admin" / "enter manually" fork). Purely skins the states the action
 * already returns — the QBO fetch, the state shape, and the form bindings are unchanged.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchVendorDocAction, createInvoiceIssueAction } from "@/actions/back-office/issues";
import { centsToUsd } from "@/lib/back-office/format";
import type { VendorDocCandidate } from "@/lib/qbo/vendor-docs";
import type { IssueKind } from "@/lib/dal/back-office";

const inputCls =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ConfirmForm({
  cand,
  kind,
  onDone,
  onBusyChange,
}: {
  cand: VendorDocCandidate | null;
  kind: IssueKind;
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createInvoiceIssueAction, null);
  const [amount, setAmount] = useState(cand?.totalCents != null ? (cand.totalCents / 100).toFixed(2) : "");

  useEffect(() => {
    onBusyChange(pending);
  }, [pending, onBusyChange]);

  useEffect(() => {
    if (state?.ok) {
      onDone();
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router, onDone]);

  const cents = amount.trim() === "" ? "" : String(Math.round(Number(amount) * 100));

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="kind" value={kind} />
      {cand?.qboTxnType && <input type="hidden" name="qbo_txn_type" value={cand.qboTxnType} />}
      {cand?.qboTxnId && <input type="hidden" name="qbo_txn_id" value={cand.qboTxnId} />}
      <input type="hidden" name="total_cents" value={Number.isFinite(Number(cents)) ? cents : ""} />
      <p className="text-xs text-muted-foreground">Check these match the paper invoice before adding.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor">
          <Input name="vendor_name" defaultValue={cand?.vendorName ?? ""} maxLength={200} />
        </Field>
        <Field label="Bill / Expense #">
          <Input name="bill_no" defaultValue={cand?.billNo ?? ""} maxLength={64} />
        </Field>
        <Field label="RO #">
          <Input name="ro_number" defaultValue={cand?.roNumber ?? ""} maxLength={64} />
        </Field>
        <Field label="Bill date (YYYY-MM-DD)">
          <Input name="bill_date" defaultValue={cand?.billDate ?? ""} maxLength={10} placeholder="2026-07-17" />
        </Field>
        <Field label="Amount ($)">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular-nums" />
        </Field>
      </div>
      <Field label="Note for the service advisor">
        <textarea name="bo_notes" rows={3} maxLength={4000} className={inputCls} placeholder="What's wrong with this invoice?" />
      </Field>
      {state?.ok === false && <p className="text-xs text-red-700 dark:text-red-400">{state.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={pending} loadingText="Adding…">
          <Plus aria-hidden="true" />
          Add issue
        </Button>
      </div>
    </form>
  );
}

export function AddInvoiceDialog({
  kind,
  fallbackAdminEmail,
}: {
  kind: IssueKind;
  fallbackAdminEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<VendorDocCandidate | null>(null);
  const [manual, setManual] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [fetchState, fetchAction, fetchPending] = useActionState(fetchVendorDocAction, null);

  const reset = () => {
    setOpen(false);
    setSelected(null);
    setManual(false);
    setConfirmBusy(false);
  };

  const candidates = fetchState?.ok ? fetchState.data : [];
  const showConfirm = manual || selected !== null;
  // ok===false with reason "validation" is a bad/empty number (inline hint); any other
  // reason is a QBO connectivity/read failure → the recoverable amber "couldn't fetch" fork.
  const validationError = fetchState?.ok === false && fetchState.reason === "validation";
  const fetchFailed = fetchState?.ok === false && fetchState.reason !== "validation";

  const adminMailto = fallbackAdminEmail
    ? `mailto:${fallbackAdminEmail}?subject=${encodeURIComponent("Back office — help finding an invoice")}&body=${encodeURIComponent("I couldn't find this invoice in QuickBooks:\n\nInvoice #: \nVendor: \nNotes: ")}`
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && (fetchPending || confirmBusy)) return; // don't close mid-fetch/mid-add
        return o ? setOpen(true) : reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus aria-hidden="true" />
        Add
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {kind === "open_ro" ? "an invoice on an open RO" : "an invoice issue"}</DialogTitle>
          <DialogDescription>Look it up in QuickBooks by invoice number, or enter it manually.</DialogDescription>
        </DialogHeader>

        {!showConfirm && (
          <>
            <form action={fetchAction} className="mt-2 flex items-end gap-2">
              <label className="flex-1 text-xs font-medium text-muted-foreground">
                Invoice / expense number
                <Input name="invoice_number" className="mt-1 tabular-nums" placeholder="e.g. 110381" />
              </label>
              <Button type="submit" variant="outline" loading={fetchPending} loadingText="Searching…">
                <Search aria-hidden="true" />
                Fetch
              </Button>
            </form>

            {/* Fetching — a skeleton of the confirm card while QuickBooks is queried. */}
            {fetchPending && (
              <div className="mt-3 space-y-2" role="status" aria-live="polite">
                <p className="text-xs text-muted-foreground">Searching QuickBooks…</p>
                <div className="space-y-2 rounded-md border border-border p-3">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            )}

            {/* Bad / empty invoice number — inline hint, the field stays for correction. */}
            {!fetchPending && validationError && fetchState?.ok === false && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                {fetchState.message}
              </p>
            )}

            {/* Couldn't reach QuickBooks — recoverable amber fork: manual entry or send to admin. */}
            {!fetchPending && fetchFailed && fetchState?.ok === false && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-medium">Couldn&apos;t reach QuickBooks right now.</p>
                    <p className="mt-0.5 text-xs opacity-90">{fetchState.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setManual(true)}>
                        Enter manually
                      </Button>
                      {adminMailto && (
                        <Button size="sm" variant="ghost" render={<a href={adminMailto} />}>
                          Send to admin
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Not found — nothing matched; retry the number above, enter manually, or send to admin. */}
            {!fetchPending && fetchState?.ok && candidates.length === 0 && (
              <div className="mt-3 rounded-md border border-dashed border-border p-3 text-sm">
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  No Bill or expense found with that number. Check the number and try again, or:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setManual(true)}>
                    Enter manually
                  </Button>
                  {adminMailto && (
                    <Button size="sm" variant="ghost" render={<a href={adminMailto} />}>
                      Send to admin
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Found — one or many candidates to confirm/disambiguate. */}
            {!fetchPending && fetchState?.ok && candidates.length > 0 && (
              <div className="mt-3 grid gap-2">
                <p className="text-xs text-muted-foreground">
                  {candidates.length === 1 ? "Found 1 match — confirm it:" : `Found ${candidates.length} matches — pick one:`}
                </p>
                {candidates.map((c, idx) => (
                  <button
                    key={`${c.qboTxnType}-${c.qboTxnId}-${idx}`}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{c.vendorName ?? "Unknown vendor"}</span>
                      <span className="text-muted-foreground"> · {c.qboTxnType} #{c.billNo ?? "—"} · {c.billDate ?? "—"}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{centsToUsd(c.totalCents)}</span>
                  </button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setManual(true)} className="justify-self-start">
                  None of these — enter manually
                </Button>
              </div>
            )}
          </>
        )}

        {showConfirm && <ConfirmForm cand={selected} kind={kind} onDone={reset} onBusyChange={setConfirmBusy} />}
      </DialogContent>
    </Dialog>
  );
}
