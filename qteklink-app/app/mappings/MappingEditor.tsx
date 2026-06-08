"use client";

/**
 * MappingEditor — the Tekmetric-item picker. The admin picks an ITEM from a dropdown
 * (each annotated with its current account in parentheses), then the QuickBooks account
 * it should post to. No "source key" / "Tekmetric id" / "kind" / "posting role" jargon —
 * the action derives those from the chosen item server-side. Fees keep the one
 * pass-through judgment. On success it router.refresh()es so the server re-renders.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mapTekmetricItemAction } from "@/actions/mappings";
import type { TekmetricItem } from "@/lib/dal/tekmetric-items";
import type { MappableAccount } from "@/lib/dal/mappings";

export default function MappingEditor({
  items,
  accounts,
}: {
  items: TekmetricItem[];
  accounts: MappableAccount[];
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [account, setAccount] = useState("");
  const [passThrough, setPassThrough] = useState(false);
  const [state, formAction, pending] = useActionState(mapTekmetricItemAction, null);

  const item = items.find((i) => i.token === token) ?? null;

  // Selecting an item preselects its current account + pass-through (so "save" = update).
  useEffect(() => {
    setAccount(item?.mappedQboAccountId ?? "");
    setPassThrough(item?.passThrough ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const itemGroups = new Map<string, TekmetricItem[]>();
  for (const i of items) {
    const arr = itemGroups.get(i.group) ?? [];
    arr.push(i);
    itemGroups.set(i.group, arr);
  }
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

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-stone-900">Map a Tekmetric item</h2>
      <p className="mt-1 text-sm text-stone-600">
        Pick a Tekmetric item, then the QuickBooks account it should post to. The item&apos;s
        current account (if any) shows in parentheses; picking a new one replaces it.
      </p>

      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-amber-800">
          No chart-of-accounts yet — sync it from the dashboard first.
        </p>
      ) : (
        <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* The chosen item carries kind + sourceKey (the action derives the role). */}
          <input type="hidden" name="kind" value={item?.kind ?? ""} />
          <input type="hidden" name="source_key" value={item?.sourceKey ?? ""} />

          <label className="block sm:col-span-2">
            <span className={labelCls}>Tekmetric item</span>
            <select value={token} onChange={(e) => setToken(e.target.value)} required className={fieldCls}>
              <option value="" disabled>
                Select an item…
              </option>
              {[...itemGroups.entries()].map(([group, gi]) => (
                <optgroup key={group} label={group}>
                  {gi.map((i) => (
                    <option key={i.token} value={i.token}>
                      {i.label}
                      {i.mappedAccountLabel ? ` (${i.mappedAccountLabel})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="block sm:col-span-2">
            <span className={labelCls}>QuickBooks account</span>
            <select
              name="qbo_account_id"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
              disabled={!item}
              className={fieldCls}
            >
              <option value="" disabled>
                {item ? "Select an account…" : "Pick a Tekmetric item first"}
              </option>
              {[...acctByType.entries()].map(([type, accts]) => (
                <optgroup key={type} label={type}>
                  {accts.map((a) => (
                    <option key={a.qboAccountId} value={a.qboAccountId}>
                      {a.acctNum ? `${a.acctNum} · ${a.name}` : a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {item?.kind === "fee" && (
            <label className="flex items-start gap-2 sm:col-span-2">
              <input
                type="checkbox"
                name="pass_through"
                checked={passThrough}
                onChange={(e) => setPassThrough(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-stone-700">
                <span className="font-medium">Pass-through fee</span> — exclude from the
                discount waterfall (a mandated / third-party fee is never discounted).
              </span>
            </label>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending || !item}
              className="rounded bg-[#96003C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7e0033] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : item?.mappedAccountLabel ? "Update mapping" : "Save mapping"}
            </button>
            {state?.ok && <span className="ml-3 text-sm text-emerald-700">Mapping saved.</span>}
            {state && !state.ok && <span className="ml-3 text-sm text-red-700">{state.message}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
