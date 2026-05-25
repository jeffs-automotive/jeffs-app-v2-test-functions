/**
 * /keytags — placeholder shell for Phase C build-out.
 *
 * Will be a single page with tabs for the 10 keytag operations per
 * docs/admin-dashboard/PLAN.md §4: live state, assign/release,
 * posted/revert, reconcile, manual reviews, audit history.
 *
 * Phase A: protected route that renders a stub. Establishes the URL
 * + auth gate so the dashboard card can link here cleanly.
 */
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOutAction } from "@/actions/sign-out";

export default async function KeytagsPage() {
  const { email } = await requireAdmin();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <Link
            href="/dashboard"
            className="text-xs text-stone-500 underline hover:text-stone-700"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-[#96003c]">Key tags</h1>
          <p className="text-sm text-stone-600">
            Assign, release, revert, post, reconcile, and audit the 180-tag pool.
            Look up + resolve manual reviews.
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-stone-700">{email}</p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-xs text-stone-500 underline hover:text-stone-700"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="rounded-lg border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-medium text-stone-900">Coming in Phase C</p>
        <p className="mt-2 text-sm text-stone-600">
          6 tabs wired to the existing orchestrator MCP keytag tools
          (listWipKeyTags, whoIsOnTag, assignKeytagToRo, releaseKeytagFromRo,
          revertKeytagToAssigned, markKeytagPosted, runBulkReconcile,
          lookupManualReview, resolveManualReview, getKeytagAuditHistory).
          See <code>docs/admin-dashboard/PLAN.md</code> §5 Phase C.
        </p>
      </section>
    </main>
  );
}
