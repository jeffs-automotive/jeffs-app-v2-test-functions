/**
 * Placeholder shown in tabs whose write actions are still pending
 * (assign/release + posted/revert + reconcile = Phase C.5 / C.6).
 *
 * Server Component; pure markup.
 */
import { Construction } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface StubTabProps {
  phase: "C.5" | "C.6";
  title: string;
  description: string;
}

export function StubTab({ phase, title, description }: StubTabProps) {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Construction className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <CardTitle className="mt-4 text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-center text-xs text-muted-foreground">
        Coming in Phase {phase}. See{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">docs/admin-dashboard/PLAN.md</code>{" "}
        §5 for the build order.
      </CardContent>
    </Card>
  );
}
