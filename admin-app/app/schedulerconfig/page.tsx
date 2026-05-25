/**
 * /schedulerconfig — placeholder for Phase D+E+F. Will host 8 edit
 * surfaces wired to existing orchestrator MCP scheduler tools.
 *
 * Phase A: stub with the polished AppShell + Coming-soon Card.
 */
import { Construction } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/shell/AppShell";

export default async function SchedulerConfigPage() {
  const { email } = await requireAdmin();

  return (
    <AppShell email={email}>
      <PageHeader
        title="Scheduler config"
        description="Edit testing services, routine services, concerns, subcategories, required facts, appointment limits, and closed dates."
      />

      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Construction className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle className="mt-4">Coming in Phases D–F</CardTitle>
          <CardDescription>
            8 edit surfaces wired to the existing orchestrator MCP typed tools.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-xs text-muted-foreground">
          See <code className="rounded bg-muted px-1.5 py-0.5">docs/admin-dashboard/PLAN.md</code> §5
          for the build order (closed-dates + appointment-limits +
          routine-services first, then the other 5).
        </CardContent>
      </Card>
    </AppShell>
  );
}
