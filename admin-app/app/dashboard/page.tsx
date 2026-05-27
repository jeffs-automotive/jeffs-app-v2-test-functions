/**
 * /dashboard — landing page. Two-card directory of the available admin
 * surfaces. Uses the polished shadcn + AppShell visual language.
 */
import Link from "next/link";
import { KeyRound, Settings } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/shell/AppShell";

export default async function DashboardPage() {
  const { email } = await requireAdmin();

  return (
    <AppShell email={email}>
      <PageHeader
        title="Admin dashboard"
        description=""
      />

      <section className="grid gap-6 sm:grid-cols-2">
        <DashboardLinkCard
          href="/keytags"
          icon={KeyRound}
          title="Key tags"
          description="Live state, assign / release / revert, posted, bulk reconcile, manual reviews, audit history."
          badge="6 tools"
        />
        <DashboardLinkCard
          href="/schedulerconfig"
          icon={Settings}
          title="Scheduler config"
          description="Subcategory descriptions, routine + testing services, concerns, required facts, appointment limits, closed dates. Pattern S two-step apply with revert."
          badge="10 surfaces"
        />
      </section>

      <p className="mt-12 text-center text-xs text-muted-foreground">
        Signed in as <span className="font-medium">{email}</span> · Tenant-restricted to
        @jeffsautomotive.com
      </p>
    </AppShell>
  );
}

interface DashboardLinkCardProps {
  href: string;
  icon: typeof KeyRound;
  title: string;
  description: string;
  badge?: string;
  comingSoon?: boolean;
}

function DashboardLinkCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  comingSoon,
}: DashboardLinkCardProps) {
  const inner = (
    <Card className="group relative h-full overflow-hidden transition-all hover:border-primary hover:shadow-md">
      <CardHeader className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          {badge && (
            <Badge variant="secondary" className="font-normal">
              {badge}
            </Badge>
          )}
        </div>
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            {title}
            {comingSoon && (
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                Coming soon
              </span>
            )}
          </CardTitle>
          <CardDescription className="line-clamp-3">{description}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (comingSoon) {
    return <div className="cursor-not-allowed opacity-60">{inner}</div>;
  }
  return (
    <Link href={href} className="block">
      {inner}
    </Link>
  );
}
