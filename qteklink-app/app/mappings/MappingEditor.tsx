"use client";

/**
 * MappingEditor (C2, admin-only) — add/update one mapping via setMappingAction
 * (React 19 useActionState). On success it router.refresh()es so the server
 * component re-renders the list (keeps the action pure — no revalidatePath).
 * The account <select> is grouped by QBO account type; the DB RPC is the
 * authoritative role-compat gate, so an incompatible pick returns a clear error.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setMappingAction } from "@/actions/mappings";
import {
  MAPPING_KINDS,
  POSTING_ROLES,
  KIND_LABELS,
  ROLE_LABELS,
} from "@/lib/mappings/catalog";
import type { MappableAccount } from "@/lib/dal/mappings";

export default function MappingEditor({ accounts }: { accounts: MappableAccount[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState("labor");
  const [state, formAction, pending] = useActionState(setMappingAction, null);

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      formRef.current?.reset();
      setKind("labor"); // form.reset() doesn't reset a controlled select
    }
  }, [state?.timestamp, state?.ok, router]);

  const byType = new Map<string, MappableAccount[]>();
  for (const a of accounts) {
    const t = a.accountType ?? "Other";
    const arr = byType.get(t) ?? [];
    arr.push(a);
    byType.set(t, arr);
  }

  const labelCls = "text-xs font-medium uppercase tracking-wide text-stone-500";
  const fieldCls =
    "mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-[#96003C] focus:outline-none";

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-stone-900">Add / update a mapping</h2>
      <p className="mt-1 text-sm text-stone-600">
        Setting a mapping for a source that&apos;s already mapped replaces it (the
        previous one is kept as history).
      </p>

      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-amber-800">
          No chart-of-accounts yet — sync it from the dashboard first.
        </p>
      ) : (
        <form ref={formRef} action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Kind</span>
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={fieldCls}
            >
              {MAPPING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={labelCls}>Posting role</span>
            <select name="posting_role" defaultValue="income" className={fieldCls}>
              {POSTING_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={labelCls}>Source key</span>
            <input
              name="source_key"
              required
              maxLength={200}
              placeholder="e.g. Labor, Shop Supplies, Sales Tax"
              className={fieldCls}
            />
          </label>

          <label className="block">
            <span className={labelCls}>Tekmetric id (optional)</span>
            <input name="source_id" maxLength={200} placeholder="preferred match key" className={fieldCls} />
          </label>

          <label className="block sm:col-span-2">
            <span className={labelCls}>QuickBooks account</span>
            <select name="qbo_account_id" required defaultValue="" className={fieldCls}>
              <option value="" disabled>
                Select an account…
              </option>
              {[...byType.entries()].map(([type, accts]) => (
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

          {kind === "fee" && (
            <label className="flex items-start gap-2 sm:col-span-2">
              <input type="checkbox" name="pass_through" className="mt-0.5" />
              <span className="text-sm text-stone-700">
                <span className="font-medium">Pass-through fee</span> — exclude from the
                discount waterfall (a mandated / third-party fee is never discounted).
              </span>
            </label>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-[#96003C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7e0033] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save mapping"}
            </button>
            {state?.ok && <span className="ml-3 text-sm text-emerald-700">Mapping saved.</span>}
            {state && !state.ok && <span className="ml-3 text-sm text-red-700">{state.message}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
