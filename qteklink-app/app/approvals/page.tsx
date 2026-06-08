/**
 * /approvals — the daily reconciliation review surface (C7 §8/§9).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. Everyone
 * allowed READS the open review queue; only admins run a day's reconciliation,
 * resolve an item, or record a manual payment (plan §14 — admins manage posting).
 * The page only READS (listOpenReviewItems) — the reconciliation job (a write) runs
 * via the admin RunReconcileForm action, never on render.
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { listOpenReviewItems, type ReviewItemRow } from "@/lib/dal/review-items";
import ResolveReviewItemForm from "./ResolveReviewItemForm";
import RunReconcileForm from "./RunReconcileForm";
import RecordManualPaymentForm from "./RecordManualPaymentForm";

const KIND_LABELS: Record<string, string> = {
  unmapped: "Unmapped account / source",
  tax_identity: "Tax identity mismatch",
  tax_high: "Sales tax above the 6% ceiling",
  payment_corrupt: "Corrupt payment amount",
};

function reasonList(detail: Record<string, unknown>): string[] {
  const r = detail.reasons;
  return Array.isArray(r) ? r.map(String) : [];
}

function ReviewItemCard({ item, isAdmin }: { item: ReviewItemRow; isAdmin: boolean }) {
  const reasons = reasonList(item.detail);
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[#96003C]/10 px-2 py-0.5 text-xs font-semibold text-[#96003C]">
          {KIND_LABELS[item.kind] ?? item.kind}
        </span>
        <span className="text-xs uppercase tracking-wide text-stone-500">
          {item.subjectKind} {item.subjectRef}
        </span>
        <span className="ml-auto text-xs text-stone-400">{new Date(item.createdAt).toLocaleString()}</span>
      </div>

      {reasons.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <li key={r} className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700">{r}</li>
          ))}
        </ul>
      )}
      {item.detail.docNumber != null && (
        <p className="mt-2 text-xs text-stone-500">{String(item.detail.docNumber)}</p>
      )}
      {item.kind === "tax_high" && (
        <p className="mt-1 text-xs text-stone-600">
          sales tax {String(item.detail.salesTaxCents)}¢ vs 6% ceiling {String(item.detail.baselineSalesTaxCents)}¢
          (base {String(item.detail.baseCents)}¢)
        </p>
      )}
      {item.kind === "tax_identity" && (
        <p className="mt-1 text-xs text-stone-600">
          totalSales {String(item.detail.totalSales)}¢ vs component sum {String(item.detail.componentSum)}¢
          (off by {String(item.detail.differenceCents)}¢)
        </p>
      )}

      {isAdmin && <ResolveReviewItemForm id={item.id} />}
    </li>
  );
}

export default async function ApprovalsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const { realmId, items } = await listOpenReviewItems(shopId);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Daily approvals</h1>
          <p className="text-sm text-stone-600">
            Reconciliation review queue &middot;{" "}
            <Link href="/dashboard" className="text-[#96003C] underline">back to dashboard</Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">{role} &middot; shop {shopId}</p>
        </div>
      </header>

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">
            QuickBooks isn&apos;t connected for this shop yet. Connect it from the dashboard before reconciling.
          </p>
        </section>
      ) : (
        <>
          {isAdmin && (
            <section className="mt-8 grid gap-6 md:grid-cols-2">
              <RunReconcileForm />
              <RecordManualPaymentForm />
            </section>
          )}

          <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">Open review items</h2>
              <span className="text-3xl font-bold text-stone-900">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">
                Nothing to review — every reconciled draft is postable. Run a day above to refresh.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {items.map((item) => (
                  <ReviewItemCard key={item.id} item={item} isAdmin={isAdmin} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
