/**
 * Landing page — authenticated. Two cards: Scheduler config + Keytags.
 *
 * Both linked sections are unimplemented in Phase A (the pages don't
 * exist yet). Phase C adds /keytags; Phase D adds /scheduler/*. The
 * "Coming soon" message prevents accidental 404 confusion when a Phase A
 * deploy is hit by someone before the later phases land.
 */
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOutAction } from "@/actions/sign-out";

export default async function HomePage() {
  const { email } = await requireAdmin();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#96003c]">
            Jeff&apos;s Automotive
          </h1>
          <p className="text-sm text-stone-600">Admin dashboard</p>
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

      <section className="grid gap-6 sm:grid-cols-2">
        <DashboardCard
          href="/scheduler"
          title="Scheduler config"
          description="Edit testing services, routine services, concerns, closed dates, appointment limits, and more. Replaces what you do through Claude Desktop today."
          comingSoon
        />
        <DashboardCard
          href="/keytags"
          title="Key tags"
          description="Assign, release, revert, and audit the 180-tag pool. Look up and resolve manual reviews. Replaces what Claude Desktop does for keytag ops."
          comingSoon
        />
      </section>

      <footer className="mt-12 text-center text-xs text-stone-400">
        Phase A scaffold — Phase C adds Keytags, Phase D adds Scheduler. See{" "}
        <code>docs/admin-dashboard/PLAN.md</code>.
      </footer>
    </main>
  );
}

interface DashboardCardProps {
  href: string;
  title: string;
  description: string;
  comingSoon?: boolean;
}

function DashboardCard({
  href,
  title,
  description,
  comingSoon,
}: DashboardCardProps) {
  const content = (
    <div className="group h-full rounded-lg border border-stone-200 bg-white p-6 shadow-sm transition hover:border-[#96003c] hover:shadow">
      <h2 className="text-xl font-semibold text-stone-900 group-hover:text-[#96003c]">
        {title}
        {comingSoon && (
          <span className="ml-2 rounded bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-500">
            Coming soon
          </span>
        )}
      </h2>
      <p className="mt-2 text-sm text-stone-600">{description}</p>
    </div>
  );

  if (comingSoon) {
    return <div className="cursor-not-allowed opacity-70">{content}</div>;
  }
  return <Link href={href}>{content}</Link>;
}
