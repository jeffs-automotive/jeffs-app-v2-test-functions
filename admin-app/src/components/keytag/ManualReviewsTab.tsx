/**
 * ManualReviewsTab — Server Component shell that wraps the
 * client LookupManualReviewForm.
 */
import { AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LookupManualReviewForm } from "./LookupManualReviewForm";

export function ManualReviewsTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Look up a manual review</CardTitle>
              <CardDescription>
                Paste the 6-character code from the email (e.g.{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">ORP-4XKZ9P</code>)
                to see the situation + advisor choices. The code is single-use
                pre-approval; rate-limited to 3 failed lookups per hour per actor.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <LookupManualReviewForm />
        </CardContent>
      </Card>
    </div>
  );
}
