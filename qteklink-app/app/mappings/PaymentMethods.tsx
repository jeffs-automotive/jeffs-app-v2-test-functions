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
import { mapTekmetricItemAction } from "@/actions/mappings";
import type { PaymentMethodView } from "@/lib/dal/payment-methods";
import type { MappableAccount } from "@/lib/dal/mappings";
import { fmtUsd } from "@/lib/format";

function BookingBadge({ m }: { m: PaymentMethodView }) {
  if (m.booking === "deposit_undeposited")
    return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">→ {m.accountLabel ?? "Undeposited Funds"}</span>;
  if (m.booking === "contra")
    return <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">→ {m.accountLabel}</span>;
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">⚠ not classified</span>;
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

  const labelCls = "text-xs font-medium uppercase tracking-wide text-stone-500";
  const fieldCls =
    "mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-[#96003C] focus:outline-none disabled:bg-stone-50 disabled:text-stone-400";
  const num = "px-3 py-2 text-right tabular-nums";

  const Rows = ({ rows }: { rows: PaymentMethodView[] }) => (
    <>
      {rows.map((m) => (
        <tr key={`${m.code}|${m.subtype ?? ""}`} className="border-t border-stone-100">
          <td className="px-3 py-2 font-medium text-stone-800">{m.label}</td>
          <td className="px-3 py-2"><BookingBadge m={m} /></td>
          <td className={`${num} text-stone-500`}>{m.seen}</td>
          <td className={num}>{fmtUsd(m.amountCents)}</td>
        </tr>
      ))}
    </>
  );

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-stone-900">Payment methods</h2>
      <p className="mt-1 text-sm text-stone-600">
        How each payment method books to QuickBooks. Card / Cash / Check / Affirm deposit to{" "}
        <span className="font-medium">{undepositedAccountLabel ?? "Undeposited Funds"}</span> automatically.
        Classify the &ldquo;Other&rdquo; types below as a <span className="font-medium">deposit</span> (financing
        that pays your bank, like Synchrony &rarr; Undeposited) or a <span className="font-medium">contra</span>{" "}
        (warranty / internal &rarr; a contra account).
      </p>

      <table className="mt-4 w-full text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 text-left">Method</th>
            <th className="px-3 py-2 text-left">Books to</th>
            <th className="px-3 py-2 text-right">Seen</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {firstClass.length > 0 && (
            <tr className="bg-stone-50/60"><td colSpan={4} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Deposit methods (automatic → Undeposited)</td></tr>
          )}
          <Rows rows={firstClass} />
          {other.length > 0 && (
            <tr className="bg-stone-50/60"><td colSpan={4} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Other payment types (you classify)</td></tr>
          )}
          <Rows rows={other} />
          {methods.length === 0 && (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-stone-500">No payments recorded yet.</td></tr>
          )}
        </tbody>
      </table>

      {canEdit && other.length > 0 && (
        <form action={formAction} className="mt-6 grid gap-4 border-t border-stone-200 pt-6 sm:grid-cols-2">
          <input type="hidden" name="kind" value="noncash_payment_type" />
          <input type="hidden" name="source_key" value={selected?.subtype ?? ""} />
          <input type="hidden" name="qbo_account_id" value={submitAccount} />
          <input type="hidden" name="deposits_like_card" value={routeChoice === "deposit" ? "on" : ""} />

          <label className="block sm:col-span-2">
            <span className={labelCls}>Classify an &ldquo;Other&rdquo; payment type</span>
            <select value={subtype} onChange={(e) => setSubtype(e.target.value)} required className={fieldCls}>
              <option value="" disabled>Select a payment type…</option>
              {other.map((m) => (
                <option key={m.subtype ?? ""} value={m.subtype ?? ""}>
                  {m.label}{m.booking === "unmapped" ? " (not classified)" : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="sm:col-span-2" disabled={!selected}>
            <span className={labelCls}>How does it book?</span>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm text-stone-700">
                <input type="radio" name="_route" checked={routeChoice === "deposit"} onChange={() => setRouteChoice("deposit")} className="mt-0.5" />
                <span><span className="font-medium">Deposit</span> — financing that pays your bank (Synchrony, Affirm…). Books <span className="font-mono text-xs">Dr Undeposited / Cr A/R</span> &rarr; {undepositedAccountLabel ?? "Undeposited Funds"}; enter the financing fee in QuickBooks.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-stone-700">
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
            <button type="submit" disabled={pending || !selected || !submitAccount} className="rounded bg-[#96003C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7e0033] disabled:cursor-not-allowed disabled:opacity-60">
              {pending ? "Saving…" : "Save classification"}
            </button>
            {state?.ok && <span className="ml-3 text-sm text-emerald-700">Saved.</span>}
            {state && !state.ok && <span className="ml-3 text-sm text-red-700">{state.message}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
