/**
 * AuditHistoryTab — Server Component.
 *
 * Reads URL search params for filters (color, tag_number, ro_number,
 * action, limit), calls getKeytagAuditHistory, renders the result table.
 * Filter form (client) updates URL params and triggers re-render.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import type {
  GetKeytagAuditHistoryArgs,
  TagColor,
} from "@/lib/orchestrator/types";
import { TagBadge } from "./TagBadge";
import { AuditHistoryFilters } from "./AuditHistoryFilters";

export interface AuditHistoryTabProps {
  actorEmail: string;
  /** URL search params dict (already-resolved by the page) */
  searchParams: Record<string, string | string[] | undefined>;
}

function parseFilters(
  searchParams: AuditHistoryTabProps["searchParams"],
): GetKeytagAuditHistoryArgs {
  const args: GetKeytagAuditHistoryArgs = {};
  const color = searchParams.color;
  if (color === "red" || color === "yellow") {
    args.tag_color = color as TagColor;
  }
  const tagNumber = searchParams.tag_number;
  if (typeof tagNumber === "string") {
    const n = parseInt(tagNumber, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 90) args.tag_number = n;
  }
  const roNumber = searchParams.ro_number;
  if (typeof roNumber === "string") {
    const n = parseInt(roNumber, 10);
    if (Number.isInteger(n) && n > 0) args.ro_number = n;
  }
  const action = searchParams.action;
  if (
    typeof action === "string" &&
    [
      "assigned",
      "force_assigned",
      "marked_posted",
      "reverted",
      "released",
      "released_orphan",
    ].includes(action)
  ) {
    args.action = action as GetKeytagAuditHistoryArgs["action"];
  }
  const limit = searchParams.limit;
  if (typeof limit === "string") {
    const n = parseInt(limit, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 200) args.limit = n;
  } else {
    args.limit = 50;
  }
  return args;
}

const ACTION_LABEL: Record<string, { label: string; className: string }> = {
  assigned:        { label: "Assigned",        className: "bg-blue-100 text-blue-800 border-blue-200" },
  force_assigned:  { label: "Force assigned",  className: "bg-purple-100 text-purple-800 border-purple-200" },
  marked_posted:   { label: "Marked posted",   className: "bg-green-100 text-green-800 border-green-200" },
  reverted:        { label: "Reverted",        className: "bg-amber-100 text-amber-800 border-amber-200" },
  released:        { label: "Released",        className: "bg-stone-100 text-stone-700 border-stone-200" },
  released_orphan: { label: "Orphan released", className: "bg-red-100 text-red-800 border-red-200" },
};

export async function AuditHistoryTab({
  actorEmail,
  searchParams,
}: AuditHistoryTabProps) {
  const filters = parseFilters(searchParams);

  let result: Awaited<ReturnType<typeof callKeytagTool<"getKeytagAuditHistory">>> | null = null;
  let error: string | null = null;
  try {
    result = await callKeytagTool("getKeytagAuditHistory", filters, actorEmail);
  } catch (e) {
    error =
      e instanceof OrchestratorClientError
        ? e.message
        : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Narrow the audit log by tag, RO, action, or row count. Defaults to the last 50 entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditHistoryFilters />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Audit log
                {result && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({result.count} {result.count === 1 ? "entry" : "entries"}
                    {result.truncated ? ", truncated" : ""})
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Every assign / release / revert / post action, with actor + source.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}
          {result && result.count === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No audit entries match those filters.
            </div>
          )}
          {result && result.count > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">When</TableHead>
                    <TableHead className="w-20">Tag</TableHead>
                    <TableHead>RO #</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.results.map((entry) => {
                    const actionStyle = ACTION_LABEL[entry.action] ?? {
                      label: entry.action,
                      className: "bg-stone-100 text-stone-700 border-stone-200",
                    };
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(entry.occurred_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <TagBadge
                            color={entry.tag_color}
                            number={entry.tag_number}
                            size="sm"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {entry.ro_number ? `#${entry.ro_number}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-normal uppercase tracking-wider ${actionStyle.className}`}
                          >
                            {actionStyle.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {entry.user_label ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.source}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
