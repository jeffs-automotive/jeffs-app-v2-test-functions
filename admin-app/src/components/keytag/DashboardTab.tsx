/**
 * DashboardTab — Server Component. The module's default landing.
 *
 * Renders the SAME pool snapshot the 7 AM keytag-daily-report email shows —
 * counts, stale tags, A/R repair-orders-without-key-tags, and the full 180-tag
 * grid — but in the admin-app's light UI. Data comes from the cached
 * getKeytagDashboard tool (60s TTL); the DashboardPoller refreshes it every
 * minute. Same section order as the email so the two read identically.
 */
import { AlertCircle, ExternalLink, KeyRound, CheckCircle2 } from "lucide-react";
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
import { getCachedDashboard } from "@/lib/keytag/dashboard-cache";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import type {
  DashboardRoWithoutTag,
  DashboardStaleTag,
  KeytagDashboardResult,
  KeytagGridTile,
} from "@/lib/orchestrator/types";
import { TagBadge } from "./TagBadge";
import { DashboardPoller } from "./DashboardPoller";

export interface DashboardTabProps {
  actorEmail: string;
}

export async function DashboardTab({ actorEmail }: DashboardTabProps) {
  let data: KeytagDashboardResult | null = null;
  let error: string | null = null;
  try {
    data = await getCachedDashboard(actorEmail);
  } catch (e) {
    error =
      e instanceof OrchestratorClientError
        ? e.message
        : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Couldn&apos;t load the key tag dashboard.</p>
            <p className="mt-0.5 text-destructive/90">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const reds = data.grid
    .filter((t) => t.tag_color === "red")
    .sort((a, b) => a.tag_number - b.tag_number);
  const yellows = data.grid
    .filter((t) => t.tag_color === "yellow")
    .sort((a, b) => a.tag_number - b.tag_number);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The live key tag board — the same snapshot as the morning report.
        </p>
        <DashboardPoller generatedAt={data.generated_at} />
      </div>

      <StatCards counts={data.counts} />
      <StaleSection stale={data.stale} />
      <NoTagSection rows={data.ros_without_tags} />

      <TagGrid title="Red tags (R1–R90)" tiles={reds} />
      <TagGrid title="Yellow tags (Y1–Y90)" tiles={yellows} />

      <Legend />
    </div>
  );
}

// ─── Stat cards ──────────────────────────────────────────────────────────────

function StatCards({ counts }: { counts: KeytagDashboardResult["counts"] }) {
  const cards = [
    { label: "In Use", value: counts.in_use },
    { label: "Available", value: counts.available },
    { label: "Stale (>3 days)", value: counts.stale },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex flex-col items-center gap-1 py-6 text-center">
            <span className="text-3xl font-bold tabular-nums text-primary">{c.value}</span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {c.label}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Stale tags ──────────────────────────────────────────────────────────────

function StaleSection({ stale }: { stale: DashboardStaleTag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stale tags</CardTitle>
        <CardDescription>
          In-use tags (WIP or A/R) with no Tekmetric activity in more than 3 days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stale.length === 0 ? (
          <EmptyRow icon="ok" text="No stale tags." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Tag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>RO #</TableHead>
                  <TableHead className="text-right">Stale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stale.map((s) => (
                  <TableRow key={`${s.tag_color}-${s.tag_number}`}>
                    <TableCell>
                      <TagBadge color={s.tag_color} number={s.tag_number} size="sm" />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-normal uppercase tracking-wider"
                      >
                        {s.category === "wip" ? "WIP" : "A/R"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{s.customer_name}</TableCell>
                    <TableCell>
                      <RoLink url={s.ro_url} roNumber={s.ro_number} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {s.days_stale}d
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Repair orders without key tags ──────────────────────────────────────────

function NoTagSection({ rows }: { rows: DashboardRoWithoutTag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Repair Orders Without Key Tags</CardTitle>
        <CardDescription>
          A/R repair orders with no key tag tracked. Manually-released tags are filtered out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyRow icon="ok" text="No repair orders without key tags." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RO #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Key Tag</TableHead>
                  <TableHead className="text-right">Released</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.arn_code}>
                    <TableCell>
                      <RoLink url={r.ro_url} roNumber={r.ro_number} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-normal uppercase tracking-wider"
                      >
                        {r.status_label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.prior_tag_color && r.prior_tag_number !== null ? (
                        <TagBadge
                          color={r.prior_tag_color}
                          number={r.prior_tag_number}
                          size="sm"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {r.released_at
                        ? new Date(r.released_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "America/New_York",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 180-tag grid ────────────────────────────────────────────────────────────

function TagGrid({ title, tiles }: { title: string; tiles: KeytagGridTile[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-[repeat(15,minmax(0,1fr))]">
          {tiles.map((t) => {
            const label = (t.tag_color === "red" ? "R" : "Y") + t.tag_number;
            const aria = `${label} ${t.in_use ? `in use${t.ro_number ? `, RO #${t.ro_number}` : ""}` : "available"}`;
            return (
              <div
                key={`${t.tag_color}-${t.tag_number}`}
                title={aria}
                aria-label={aria}
                className={`rounded-md px-1 py-1.5 text-center font-mono text-xs font-semibold tabular-nums ring-1 ring-inset ${
                  t.in_use
                    ? "bg-red-50 text-red-800 ring-red-200"
                    : "bg-green-50 text-green-800 ring-green-200"
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm bg-green-50 ring-1 ring-inset ring-green-200" />
        available
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm bg-red-50 ring-1 ring-inset ring-red-200" />
        in use
      </span>
    </div>
  );
}

// ─── Small shared bits ───────────────────────────────────────────────────────

function RoLink({ url, roNumber }: { url: string; roNumber: number | null }) {
  if (roNumber === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (!url) return <span className="font-mono text-sm tabular-nums">#{roNumber}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-primary hover:underline"
    >
      #{roNumber}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function EmptyRow({ icon, text }: { icon: "ok"; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      {icon === "ok" ? (
        <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
      ) : (
        <KeyRound className="size-4" aria-hidden="true" />
      )}
      {text}
    </div>
  );
}
