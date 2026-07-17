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
import { ArrowRightLeft, ChevronRight, ClipboardList, Wallet, type LucideIcon } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getCoaSummary } from "@/lib/dal/coa";
import { listPayrollEmployees } from "@/lib/dal/payroll";
import { listAllActiveIssues } from "@/lib/dal/back-office";
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

  // The two hints load concurrently; a rejected read reports to Sentry and its
  // hint is omitted — the landing page never pays serial round-trips or 500s.
  const [coaRes, rosterRes, backOfficeRes] = await Promise.allSettled([
    getCoaSummary(shopId),
    listPayrollEmployees(shopId), // active-only by default
    listAllActiveIssues(shopId),
  ]);

  let qboHint: string | null = null;
  if (coaRes.status === "fulfilled") {
    qboHint = coaRes.value.realmId ? "QuickBooks connected" : "QuickBooks not connected";
  } else {
    Sentry.captureException(coaRes.reason, {
      tags: {
        qteklink_surface: "module_directory",
        qteklink_hint: "qbo_connection",
        shop_id: String(shopId),
      },
    });
  }

  let payrollHint: string | null = null;
  if (rosterRes.status === "fulfilled") {
    const n = rosterRes.value.length;
    payrollHint = `${n} active employee${n === 1 ? "" : "s"}`;
  } else {
    Sentry.captureException(rosterRes.reason, {
      tags: {
        qteklink_surface: "module_directory",
        qteklink_hint: "payroll_roster",
        shop_id: String(shopId),
      },
    });
  }

  let backOfficeHint: string | null = null;
  if (backOfficeRes.status === "fulfilled") {
    const n = backOfficeRes.value.length;
    backOfficeHint = `${n} open issue${n === 1 ? "" : "s"}`;
  } else {
    Sentry.captureException(backOfficeRes.reason, {
      tags: {
        qteklink_surface: "module_directory",
        qteklink_hint: "back_office",
        shop_id: String(shopId),
      },
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

      <p className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Modules
      </p>

      <section aria-label="Modules" className="mt-2 grid gap-6 sm:grid-cols-2">
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
        <ModuleCard
          href="/back-office/dashboard"
          icon={ClipboardList}
          title="Back Office"
          description="Invoice + repair-order issues — raise, send to a service advisor, verify, and track."
          hint={backOfficeHint}
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
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
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
