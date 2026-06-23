/**
 * BoardBackupTools — the bottom-of-board manual fallback.
 *
 * Reuses the three existing forms verbatim (zero behavior change). The safety
 * net for ROs not surfaced on the board and for force-assigning a SPECIFIC tag
 * (the per-row Assign is auto round-robin only):
 *   - AssignKeytagForm   — assign-by-RO# (+ optional color/tag# force-assign)
 *   - ReleaseKeytagForm   — release-by-RO#
 *   - WhoIsOnTagForm      — "who's on tag X?" lookup (was the top of Live state)
 */
import { KeyRound, Eraser, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AssignKeytagForm } from "./AssignKeytagForm";
import { ReleaseKeytagForm } from "./ReleaseKeytagForm";
import { WhoIsOnTagForm } from "./WhoIsOnTagForm";

export function BoardBackupTools() {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardHeader>
        <CardTitle className="text-base">Manual tools</CardTitle>
        <CardDescription>
          Use these when the RO you need isn&apos;t on the board above, or to
          force a specific tag.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <BackupSection
            icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
            tone="primary"
            title="Assign a tag"
            description="Auto-assign (next round-robin) or force a specific tag (force-assign requires confirmation)."
          >
            <AssignKeytagForm />
          </BackupSection>

          <BackupSection
            icon={<Eraser className="h-4 w-4" aria-hidden="true" />}
            tone="destructive"
            title="Release a tag"
            description="Remove the tag from an RO and return it to the pool. Confirmation required."
          >
            <ReleaseKeytagForm />
          </BackupSection>
        </div>

        <BackupSection
          icon={<Search className="h-4 w-4" aria-hidden="true" />}
          tone="primary"
          title="Look up a tag"
          description="Enter a color + number to see which RO currently holds it."
        >
          <WhoIsOnTagForm />
        </BackupSection>
      </CardContent>
    </Card>
  );
}

function BackupSection({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  tone: "primary" | "destructive";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            tone === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary"
          }`}
        >
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
