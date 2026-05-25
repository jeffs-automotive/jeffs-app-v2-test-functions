/**
 * /schedulerconfig — placeholder shell for Phase D+E+F build-out.
 *
 * Will be the parent route for the 8 scheduler edit surfaces (testing
 * services, routine services, concerns, subcategory descriptions,
 * subcategory service map, question required facts, appointment default
 * limits, closed dates) per docs/admin-dashboard/PLAN.md §4.
 *
 * Phase A: protected route that renders a stub. Establishes the URL
 * + auth gate so the dashboard card can link here cleanly.
 */
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOutAction } from "@/actions/sign-out";

export default async function SchedulerConfigPage() {
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
          <h1 className="mt-2 text-3xl font-bold text-[#96003c]">
            Scheduler config
          </h1>
          <p className="text-sm text-stone-600">
            Edit testing services, routine services, concerns, subcategories,
            required facts, appointment limits, and closed dates.
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
        <p className="text-lg font-medium text-stone-900">Coming in Phases D–F</p>
        <p className="mt-2 text-sm text-stone-600">
          8 edit surfaces wired to the existing orchestrator MCP typed tools.
          See <code>docs/admin-dashboard/PLAN.md</code> §5 for the build order
          (closed-dates + appointment-limits + routine-services first, then
          the other 5).
        </p>
      </section>
    </main>
  );
}
