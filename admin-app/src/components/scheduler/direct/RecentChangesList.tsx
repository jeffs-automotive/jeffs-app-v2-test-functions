"use client";

/**
 * RecentChangesList — compact, read-only audit history for /schedulerconfig
 * (direct sub-feature A). Purely presentational: the page server-fetches the
 * entries via `listAuditLog` (read-dal `AuditLogRow` shape) and passes them in.
 * No mutations, no actions, no router — a Refresh belongs to the owning tab.
 */
import { Fragment } from "react";
import { CircleAlert, Minus, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEastern } from "@/lib/format-time";
import type { AuditLogRow } from "@/lib/scheduler/read-dal";

interface RecentChangesListProps {
  entries: AuditLogRow[];
}

/** Human-friendly table names — falls back to the raw name if unmapped. */
const TABLE_LABELS: Record<string, string> = {
  routine_services: "Routine services",
  testing_services: "Testing services",
  concern_subcategories: "Subcategories",
  concern_questions: "Questions",
  concern_category_guidelines: "Guidelines",
  appointment_default_limits: "Appointment limits",
  closed_dates: "Closed dates",
  appointment_blocks: "Capacity blocks",
  scheduler_appointment_types: "Appointment types",
  scheduler_message_templates: "Message templates",
};

function tableLabel(name: string): string {
  return TABLE_LABELS[name] ?? name;
}

/** Map an operation string to a compact tone. */
function opVariant(
  op: string,
): "default" | "secondary" | "destructive" | "outline" {
  const o = op.toLowerCase();
  if (o.includes("delete") || o.includes("deactivat") || o.includes("remove")) {
    return "destructive";
  }
  if (o.includes("insert") || o.includes("create") || o.includes("add")) {
    return "default";
  }
  if (o.includes("update") || o.includes("set") || o.includes("edit")) {
    return "secondary";
  }
  return "outline";
}

export function RecentChangesList({ entries }: RecentChangesListProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No configuration changes recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">When (ET)</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>Op</TableHead>
            <TableHead className="text-right whitespace-nowrap">Changes</TableHead>
            <TableHead className="w-8" aria-label="Error indicator" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => {
            const who =
              e.user_label ??
              (e.oauth_client_id ? `client ${e.oauth_client_id}` : "system");
            const hasError = Boolean(e.error_message);
            return (
              <TableRow key={e.id} className={hasError ? "bg-destructive/5" : undefined}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {formatEastern(e.occurred_at)}
                </TableCell>
                <TableCell className="text-sm">{who}</TableCell>
                <TableCell className="text-sm">{tableLabel(e.table_name)}</TableCell>
                <TableCell>
                  <Badge variant={opVariant(e.operation)} className="font-mono text-[10px]">
                    {e.operation}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-2 font-mono text-xs">
                    {e.rows_added > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-green-700 dark:text-green-400">
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        {e.rows_added}
                        <span className="sr-only">added</span>
                      </span>
                    )}
                    {e.rows_modified > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        {e.rows_modified}
                        <span className="sr-only">modified</span>
                      </span>
                    )}
                    {e.rows_deactivated > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-destructive">
                        <Minus className="h-3 w-3" aria-hidden="true" />
                        {e.rows_deactivated}
                        <span className="sr-only">deactivated</span>
                      </span>
                    )}
                    {e.rows_added === 0 &&
                      e.rows_modified === 0 &&
                      e.rows_deactivated === 0 && (
                        <span className="text-muted-foreground">—</span>
                      )}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {hasError ? (
                    <span
                      className="inline-flex text-destructive"
                      title={e.error_message ?? "Error"}
                    >
                      <CircleAlert className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">
                        Error: {e.error_message}
                      </span>
                    </span>
                  ) : (
                    <Fragment />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
