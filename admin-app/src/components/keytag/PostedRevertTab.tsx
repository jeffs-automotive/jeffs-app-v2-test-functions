/**
 * PostedRevertTab — Server Component, two side-by-side cards.
 */
import { CheckCircle2, Undo2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarkKeytagPostedForm } from "./MarkKeytagPostedForm";
import { RevertKeytagForm } from "./RevertKeytagForm";

export function PostedRevertTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-100 text-green-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Mark posted A/R</CardTitle>
              <CardDescription>
                Flip a WIP-assigned tag to posted-A/R. Use this when the work
                is approved and moving into accounts receivable.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <MarkKeytagPostedForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Revert to WIP</CardTitle>
              <CardDescription>
                Flip a posted-A/R tag back to WIP-assigned. Use when a tag was
                posted too early and needs to come back into active work.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <RevertKeytagForm />
        </CardContent>
      </Card>
    </div>
  );
}
