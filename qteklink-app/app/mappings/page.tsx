/**
 * /mappings — Tekmetric line -> QBO account mappings (C2).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. Everyone
 * allowed can READ the mappings; only admins see the editor + per-row remove
 * (plan §14 — admins manage config). The DB RPC is the authoritative role-compat
 * gate; this page resolves account names for display + flags any mapping whose
 * account has since been removed from QBO.
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { listMappings, listMappableAccounts, type MappingRow } from "@/lib/dal/mappings";
import { listTekmetricItems } from "@/lib/dal/tekmetric-items";
import {
  MAPPING_KINDS,
  KIND_LABELS,
  ROLE_LABELS,
  type MappingKind,
  type PostingRole,
} from "@/lib/mappings/catalog";
import MappingEditor from "./MappingEditor";
import DeactivateMappingButton from "./DeactivateMappingButton";

export default async function MappingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";

  const { realmId, mappings } = await listMappings(shopId);
  const accounts = isAdmin && realmId ? await listMappableAccounts(shopId) : [];
  const items = isAdmin && realmId ? (await listTekmetricItems(shopId)).items : [];

  const byKind = new Map<string, MappingRow[]>();
  for (const m of mappings) {
    const arr = byKind.get(m.kind) ?? [];
    arr.push(m);
    byKind.set(m.kind, arr);
  }
  const staleCount = mappings.filter((m) => m.accountStale).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Account mappings</h1>
          <p className="text-sm text-stone-600">
            Tekmetric &rarr; QuickBooks &middot;{" "}
            <Link href="/dashboard" className="text-[#96003C] underline">
              back to dashboard
            </Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">
            {role} &middot; shop {shopId}
          </p>
        </div>
      </header>

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">
            QuickBooks isn&apos;t connected for this shop yet. Connect it and sync
            the chart of accounts from the dashboard before mapping.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-8 flex items-center gap-6 rounded-lg border border-stone-200 bg-white p-6">
            <div>
              <p className="text-3xl font-bold text-stone-900">{mappings.length}</p>
              <p className="text-xs uppercase tracking-wide text-stone-500">active mappings</p>
            </div>
            {staleCount > 0 && (
              <p className="text-sm text-red-700">
                {staleCount} mapping{staleCount === 1 ? "" : "s"} point to an account
                that&apos;s been removed or deactivated in QuickBooks — re-map below.
              </p>
            )}
          </section>

          <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-stone-900">Current mappings</h2>
            {mappings.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">
                No mappings yet.{" "}
                {isAdmin
                  ? "Add the first one below."
                  : "An admin needs to set these up."}
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                {MAPPING_KINDS.filter((k) => byKind.has(k)).map((kind) => (
                  <div key={kind}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      {KIND_LABELS[kind as MappingKind]}
                    </h3>
                    <ul className="mt-2 divide-y divide-stone-100">
                      {byKind.get(kind)!.map((m) => (
                        <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                          <span className="flex-1">
                            <span className="font-medium text-stone-900">{m.sourceKey}</span>
                            <span className="text-stone-400"> &rarr; </span>
                            <span className={m.accountStale ? "text-red-700 line-through" : "text-stone-700"}>
                              {m.accountNum ? `${m.accountNum} · ` : ""}
                              {m.accountName ?? m.qboAccountId}
                            </span>
                            {m.accountStale && (
                              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                                removed / inactive in QBO
                              </span>
                            )}
                            {m.passThrough && (
                              <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
                                pass-through
                              </span>
                            )}
                          </span>
                          <span className="mx-3 text-xs uppercase tracking-wide text-stone-400">
                            {ROLE_LABELS[m.postingRole as PostingRole] ?? m.postingRole}
                          </span>
                          {isAdmin && <DeactivateMappingButton id={m.id} sourceKey={m.sourceKey} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {isAdmin && <MappingEditor items={items} accounts={accounts} />}
        </>
      )}
    </main>
  );
}
