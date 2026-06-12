/**
 * /mappings — Tekmetric line -> QBO account mappings (C2).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. Everyone
 * allowed can READ the mappings; only admins see the editor + per-row remove
 * (plan §14 — admins manage config). The DB RPC is the authoritative role-compat
 * gate; this page resolves account names for display + flags any mapping whose
 * account has since been removed from QBO.
 */
import { AlertTriangle } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { listMappings, listMappableAccounts, type MappingRow } from "@/lib/dal/mappings";
import { listTekmetricItems } from "@/lib/dal/tekmetric-items";
import { listPaymentMethods } from "@/lib/dal/payment-methods";
import {
  MAPPING_KINDS,
  KIND_LABELS,
  ROLE_LABELS,
  type MappingKind,
  type PostingRole,
} from "@/lib/mappings/catalog";
import MappingEditor from "./MappingEditor";
import PaymentMethods from "./PaymentMethods";
import DeactivateMappingButton from "./DeactivateMappingButton";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function MappingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";

  const { realmId, mappings } = await listMappings(shopId);
  const accounts = isAdmin && realmId ? await listMappableAccounts(shopId) : [];
  const items = isAdmin && realmId ? (await listTekmetricItems(shopId)).items : [];
  const paymentMethods = realmId ? await listPaymentMethods(shopId) : null;

  const byKind = new Map<string, MappingRow[]>();
  for (const m of mappings) {
    const arr = byKind.get(m.kind) ?? [];
    arr.push(m);
    byKind.set(m.kind, arr);
  }
  const staleCount = mappings.filter((m) => m.accountStale).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <PageHeader title="Account mappings" description="Which QuickBooks account each Tekmetric item posts to">
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        This page tells QTekLink which QuickBooks account each Tekmetric item belongs to —
        labor, parts, fees, taxes, and payment types. If something shows{" "}
        <span className="font-medium text-amber-800">not mapped</span>, pick an account for it;
        days can&apos;t post until everything on them is mapped.
      </section>

      {!realmId ? (
        <section className="mt-8 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">
            QuickBooks isn&apos;t connected for this shop yet. Connect it and sync
            the chart of accounts from the dashboard before mapping.
          </p>
        </section>
      ) : (
        <>
          <Card className="mt-8 shadow-xs">
            <CardContent className="flex items-center gap-6">
              <div>
                <p className="text-3xl font-bold tabular-nums text-foreground">{mappings.length}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">active mappings</p>
              </div>
              {staleCount > 0 && (
                <p className="flex items-start gap-1.5 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {staleCount} mapping{staleCount === 1 ? "" : "s"} point to an account
                  that&apos;s been removed or deactivated in QuickBooks — re-map below.
                </p>
              )}
            </CardContent>
          </Card>

          {paymentMethods && (
            <PaymentMethods
              methods={paymentMethods.methods}
              accounts={accounts}
              undepositedAccountId={paymentMethods.undepositedAccountId}
              undepositedAccountLabel={paymentMethods.undepositedAccountLabel}
            />
          )}

          <Card className="mt-8 shadow-xs">
            <CardHeader>
              <CardTitle>Current mappings</CardTitle>
            </CardHeader>
            <CardContent>
              {mappings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No mappings yet.{" "}
                  {isAdmin
                    ? "Add the first one below."
                    : "An admin needs to set these up."}
                </p>
              ) : (
                <div className="space-y-6">
                  {MAPPING_KINDS.filter((k) => byKind.has(k)).map((kind) => (
                    <div key={kind}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {KIND_LABELS[kind as MappingKind]}
                      </h3>
                      <ul className="mt-2 divide-y divide-border">
                        {byKind.get(kind)!.map((m) => (
                          <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                            <span className="flex-1">
                              <span className="font-medium text-foreground">{m.sourceKey}</span>
                              <span className="text-muted-foreground"> &rarr; </span>
                              <span className={m.accountStale ? "text-red-700 line-through" : "text-foreground"}>
                                {m.accountNum ? `${m.accountNum} · ` : ""}
                                {m.accountName ?? m.qboAccountId}
                              </span>
                              {m.accountStale && (
                                <Badge variant="destructive" className="ml-2">removed / inactive in QBO</Badge>
                              )}
                              {m.passThrough && (
                                <Badge variant="secondary" className="ml-2">pass-through</Badge>
                              )}
                            </span>
                            <span className="mx-3 text-xs uppercase tracking-wide text-muted-foreground">
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
            </CardContent>
          </Card>

          {isAdmin && <MappingEditor items={items} accounts={accounts} />}
        </>
      )}
    </main>
  );
}
