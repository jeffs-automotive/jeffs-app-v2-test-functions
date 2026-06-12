"use client";

/**
 * PaymentMethods (PR2) — the dedicated "Payment methods" view. Shows how EVERY method the shop
 * takes books to QuickBooks: first-class methods (Credit Card / Cash / Check / Affirm) always
 * deposit to Undeposited Funds; "Other" sub-types (Synchrony / Mistake / TPP / …) are each a
 * DEPOSIT (→ Undeposited, "deposits like a card") or a CONTRA (→ an account), or unclassified.
 * Admins classify the Other types inline (reuses mapTekmetricItemAction; the DB RPC is the
 * authoritative role↔account-type gate). On success it router.refresh()es.
 */
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save } from "lucide-react";
import { mapTekmetricItemAction } from "@/actions/mappings";
import type { PaymentMethodView } from "@/lib/dal/payment-methods";
import type { MappableAccount } from "@/lib/dal/mappings";
import { fmtUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function BookingBadge({ m }: { m: PaymentMethodView }) {
  if (m.booking === "deposit_undeposited")
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">→ {m.accountLabel ?? "Undeposited Funds"}</Badge>;
  if (m.booking === "contra")
    return <Badge variant="secondary">→ {m.accountLabel}</Badge>;
  return (
    <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800">
      <AlertTriangle aria-hidden="true" />
      not classified
    </Badge>
  );
}

export default function PaymentMethods({
  methods,
  accounts,
  undepositedAccountId,
  undepositedAccountLabel,
}: {
  methods: PaymentMethodView[];
  accounts: MappableAccount[];
  undepositedAccountId: string | null;
  undepositedAccountLabel: string | null;
}) {
  const router = useRouter();
  const firstClass = methods.filter((m) => !m.configurable);
  const other = methods.filter((m) => m.configurable);
  const classifiable = other.filter((m) => m.subtype != null && m.subtype !== ""); // a null sub-type can't be mapped
  const canEdit = accounts.length > 0; // accounts are only loaded for admins

  const [subtype, setSubtype] = useState("");
  const [routeChoice, setRouteChoice] = useState<"deposit" | "contra">("deposit");
  const [account, setAccount] = useState("");
  const [state, formAction, pending] = useActionState(mapTekmetricItemAction, null);

  const selected = useMemo(() => other.find((m) => m.subtype === subtype) ?? null, [other, subtype]);

  // Selecting a type preselects its current classification (so "save" = update).
  useEffect(() => {
    if (selected) {
      setRouteChoice(selected.booking === "contra" ? "contra" : "deposit");
      setAccount(selected.booking === "contra" ? selected.accountId ?? "" : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtype]);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  // Deposit → the system Undeposited account; contra → the picked account.
  const submitAccount = routeChoice === "deposit" ? undepositedAccountId ?? "" : account;

  const acctByType = new Map<string, MappableAccount[]>();
  for (const a of accounts) {
    const t = a.accountType ?? "Other";
    const arr = acctByType.get(t) ?? [];
    arr.push(a);
    acctByType.set(t, arr);
  }

  const labelCls = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
  const fieldCls =
    "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-muted disabled:text-muted-foreground";
  const num = "px-3 py-2 text-right tabular-nums";

  const Rows = ({ rows }: { rows: PaymentMethodView[] }) => (
    <>
      {rows.map((m) => {
        const fullyVoided = m.seen === 0 && m.voidedCount > 0;
        return (
          <TableRow key={`${m.code}|${m.subtype ?? ""}`}>
            <TableCell className="px-3 py-2 font-medium text-foreground">{m.label}</TableCell>
            <TableCell className="px-3 py-2">
              {fullyVoided ? (
                <Badge variant="secondary">voided</Badge>
              ) : (
                <BookingBadge m={m} />
              )}
            </TableCell>
            <TableCell className={`${num} text-muted-foreground`}>
              {m.seen}
              {m.voidedCount > 0 && <span className="block text-xs text-muted-foreground">{m.voidedCount} voided</span>}
            </TableCell>
            <TableCell className={num}>
              {fmtUsd(m.amountCents)}
              {m.voidedCount > 0 && <span className="block text-xs text-muted-foreground">voided {fmtUsd(m.voidedAmountCents)}</span>}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );

  return (
    <Card className="mt-8 shadow-xs">
      <CardHeader>
        <CardTitle>Payment methods</CardTitle>
        <p className="text-sm text-muted-foreground">
          How each payment method books to QuickBooks. Card / Cash / Check / Affirm deposit to{" "}
          <span className="font-medium text-foreground">{undepositedAccountLabel ?? "Undeposited Funds"}</span> automatically.
          Classify the &ldquo;Other&rdquo; types below as a <span className="font-medium text-foreground">deposit</span> (financing
          that pays your bank, like Synchrony &rarr; Undeposited) or a <span className="font-medium text-foreground">contra</span>{" "}
          (warranty / internal &rarr; a contra account).
        </p>
      </CardHeader>
      <CardContent>
      <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 py-2 text-left">Method</TableHead>
            <TableHead className="px-3 py-2 text-left">Books to</TableHead>
            <TableHead className="px-3 py-2 text-right">Seen</TableHead>
            <TableHead className="px-3 py-2 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {firstClass.length > 0 && (
            <TableRow className="bg-muted/60 hover:bg-muted/60"><TableCell colSpan={4} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deposit methods (automatic → Undeposited)</TableCell></TableRow>
          )}
          <Rows rows={firstClass} />
          {other.length > 0 && (
            <TableRow className="bg-muted/60 hover:bg-muted/60"><TableCell colSpan={4} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other payment types (you classify)</TableCell></TableRow>
          )}
          <Rows rows={other} />
          {methods.length === 0 && (
            <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">No payments recorded yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      {canEdit && classifiable.length > 0 && (
        <form action={formAction} className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
          <input type="hidden" name="kind" value="noncash_payment_type" />
          <input type="hidden" name="source_key" value={selected?.subtype ?? ""} />
          <input type="hidden" name="qbo_account_id" value={submitAccount} />
          <input type="hidden" name="deposits_like_card" value={routeChoice === "deposit" ? "on" : ""} />

          <label className="block sm:col-span-2">
            <span className={labelCls}>Classify an &ldquo;Other&rdquo; payment type</span>
            <select value={subtype} onChange={(e) => setSubtype(e.target.value)} required className={fieldCls}>
              <option value="" disabled>Select a payment type…</option>
              {classifiable.map((m) => (
                <option key={m.subtype ?? ""} value={m.subtype ?? ""}>
                  {m.label}{m.booking === "unmapped" ? " (not classified)" : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="sm:col-span-2" disabled={!selected}>
            <span className={labelCls}>How does it book?</span>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input type="radio" name="_route" checked={routeChoice === "deposit"} onChange={() => setRouteChoice("deposit")} className="mt-0.5" />
                <span><span className="font-medium">Deposit</span> — financing that pays your bank (Synchrony, Affirm…). Books <span className="font-mono text-xs">Dr Undeposited / Cr A/R</span> &rarr; {undepositedAccountLabel ?? "Undeposited Funds"}; enter the financing fee in QuickBooks.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input type="radio" name="_route" checked={routeChoice === "contra"} onChange={() => setRouteChoice("contra")} className="mt-0.5" />
                <span><span className="font-medium">Contra</span> — a true non-cash type (warranty / internal). Books <span className="font-mono text-xs">Dr &lt;account&gt; / Cr A/R</span> &rarr; pick the account.</span>
              </label>
            </div>
          </fieldset>

          {routeChoice === "contra" && (
            <label className="block sm:col-span-2">
              <span className={labelCls}>Contra account</span>
              <select value={account} onChange={(e) => setAccount(e.target.value)} required disabled={!selected} className={fieldCls}>
                <option value="" disabled>Select an account…</option>
                {[...acctByType.entries()].map(([type, accts]) => (
                  <optgroup key={type} label={type}>
                    {accts.map((a) => (
                      <option key={a.qboAccountId} value={a.qboAccountId}>{a.acctNum ? `${a.acctNum} · ${a.name}` : a.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || !selected || !submitAccount} loading={pending} loadingText="Saving…">
              <Save aria-hidden="true" />
              Save classification
            </Button>
            {state?.ok && <span className="ml-3 text-sm text-emerald-800 dark:text-emerald-300">Saved.</span>}
            {state && !state.ok && <span className="ml-3 text-sm text-red-700 dark:text-red-400">{state.message}</span>}
          </div>
        </form>
      )}
      </CardContent>
    </Card>
  );
}
