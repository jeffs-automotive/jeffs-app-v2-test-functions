/**
 * Root `/` — the MODULE DIRECTORY: the post-login landing listing the available
 * QTekLink modules (extraction doc #30). Each module card links into its own
 * surface (QBO Link → /dashboard, Payroll → /payroll) and each module carries
 * its own tab set (QtlTabs scopes itself by pathname and hides HERE — this page
 * is its own navigation surface).
 *
 * Navigation-presentation only: no existing URL moved — office-manager emails
 * still deep-link /approvals/[date].
 *
 * The per-card status hints are cheap live reads, each isolated in its own
 * try/catch: a failed read reports to Sentry and the hint is simply omitted —
 * it NEVER breaks the directory.
 */
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { ArrowRightLeft, ChevronRight, Wallet, type LucideIcon } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getCoaSummary } from "@/lib/dal/coa";
import { listPayrollEmployees } from "@/lib/dal/payroll";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import SignOutButton from "./dashboard/SignOutButton";

export const dynamic = "force-dynamic"; // hints (QBO connection, roster count) must be live

export default async function ModuleDirectoryPage() {
  const { email, role, shopId } = await requireQtekUser();

  let qboHint: string | null = null;
  try {
    const coa = await getCoaSummary(shopId);
    qboHint = coa.realmId ? "QuickBooks connected" : "QuickBooks not connected";
  } catch (error) {
    Sentry.captureException(error, {
      tags: { qteklink_surface: "module_directory", qteklink_hint: "qbo_connection" },
    });
  }

  let payrollHint: string | null = null;
  try {
    const active = await listPayrollEmployees(shopId); // active-only by default
    payrollHint = `${active.length} active employee${active.length === 1 ? "" : "s"}`;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { qteklink_surface: "module_directory", qteklink_hint: "payroll_roster" },
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader title="QTekLink" description="Tekmetric → QuickBooks tools for Jeff's Automotive">
        <div className="flex items-center gap-3">
          <IdentityBlock email={email} role={role} shopId={shopId} />
          <SignOutButton />
        </div>
      </PageHeader>

      <section aria-label="Modules" className="mt-8 grid gap-6 sm:grid-cols-2">
        <ModuleCard
          href="/dashboard"
          icon={ArrowRightLeft}
          title="QBO Link"
          description="Daily QuickBooks postings — approvals, day breakdowns, payments and account mappings."
          hint={qboHint}
        />
        <ModuleCard
          href="/payroll"
          icon={Wallet}
          title="Payroll"
          description="Bi-weekly payroll runs — employees, Tekmetric-tracked hours and bonuses."
          hint={payrollHint}
        />
      </section>
    </main>
  );
}

function ModuleCard({
  href,
  icon: Icon,
  title,
  description,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  hint: string | null;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="h-full shadow-xs transition-all group-hover:shadow-md group-hover:ring-foreground/25 motion-safe:group-hover:-translate-y-0.5">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="mt-2 flex items-center gap-1 text-lg">
            {title}
            <ChevronRight
              className="size-4 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {hint !== null && (
          <CardContent>
            <p className="text-xs font-medium tabular-nums text-muted-foreground">{hint}</p>
          </CardContent>
        )}
      </Card>
    </Link>
  );
}
