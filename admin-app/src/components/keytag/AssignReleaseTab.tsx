/**
 * AssignReleaseTab — Server Component, two side-by-side cards.
 */
import { KeyRound, Eraser } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AssignKeytagForm } from "./AssignKeytagForm";
import { ReleaseKeytagForm } from "./ReleaseKeytagForm";

export function AssignReleaseTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Assign a tag</CardTitle>
              <CardDescription>
                Auto-assign (next round-robin) or force-assign a specific tag.
                Forced assignment requires a confirmation step.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <AssignKeytagForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <Eraser className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Release a tag</CardTitle>
              <CardDescription>
                Remove the tag from an RO and return it to the pool. Pattern A
                confirmation always required.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ReleaseKeytagForm />
        </CardContent>
      </Card>
    </div>
  );
}
