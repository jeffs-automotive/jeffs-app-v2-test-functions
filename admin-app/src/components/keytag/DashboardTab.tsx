/**
 * DashboardTab — Server Component. The module's default landing.
 *
 * Renders the SAME pool snapshot the 7 AM keytag-daily-report email shows —
 * counts, stale tags, A/R repair-orders-without-key-tags, and the full 180-tag
 * grid — but in the admin-app's light "Workshop Brass" UI. Data comes from the
 * cached getKeytagDashboard tool (60s TTL); the DashboardPoller refreshes it
 * every minute. Same section order as the email so the two read identically.
 */
import { AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import {
  Card,
  CardAction,
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
import { StatusBadge } from "@/components/ui/StatusBadge";
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

export async function DashboardTab() {
  let data: KeytagDashboardResult | null = null;
  let error: string | null = null;
  try {
    data = await getCachedDashboard();
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

  // A presentational lookup of which in-use tiles are ALSO stale (>3 days),
  // derived from the stale[] list the snapshot already carries. Used only to
  // layer a redundant "at-risk" ring on the matching grid cell — no data
  // change, the staleness itself comes straight from the tool result.
  const staleKeys = new Set(data.stale.map((s) => `${s.tag_color}-${s.tag_number}`));

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

      <TagGrid title="Red tags (R1–R90)" tiles={reds} staleKeys={staleKeys} />
      <TagGrid title="Yellow tags (Y1–Y90)" tiles={yellows} staleKeys={staleKeys} />

      <Legend />
    </div>
  );
}

// ─── Stat cards ──────────────────────────────────────────────────────────────

function StatCards({ counts }: { counts: KeytagDashboardResult["counts"] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="In use" value={counts.in_use} />
      <StatCard label="Available" value={counts.available} />
      <StatCard label="Stale (>3 days)" value={counts.stale} stale />
    </div>
  );
}

function StatCard({
  label,
  value,
  stale = false,
}: {
  label: string;
  value: number;
  stale?: boolean;
}) {
  const flagged = stale && value > 0;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-1.5 py-6 text-center">
        <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
          {value}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        {flagged && (
          <StatusBadge status="warning" micro className="mt-1">
            Needs review
          </StatusBadge>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Stale tags ──────────────────────────────────────────────────────────────

function StaleSection({ stale }: { stale: DashboardStaleTag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stale tags</CardTitle>
        <CardDescription>
          In-use tags whose Tekmetric RO has had no activity in more than 3 days.
        </CardDescription>
        {stale.length > 0 && (
          <CardAction>
            <Badge variant="outline" className="font-mono text-xs tabular-nums">
              {stale.length}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {stale.length === 0 ? (
          <EmptyState
            title="No stale tags"
            subtitle="Every in-use tag has recent activity."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Tag</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-28">RO #</TableHead>
                  <TableHead className="w-28 text-right">Stale</TableHead>
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
                        variant={s.category === "wip" ? "secondary" : "outline"}
                        className="text-[10px] font-normal uppercase tracking-wider"
                      >
                        {s.category === "wip" ? "WIP" : "A/R"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className="block max-w-[18ch] truncate text-sm text-foreground"
                        title={s.customer_name}
                      >
                        {s.customer_name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <RoLink url={s.ro_url} roNumber={s.ro_number} />
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status="warning" micro>
                        {s.days_stale}d
                      </StatusBadge>
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
        <CardTitle className="text-base">Repair orders without key tags</CardTitle>
        <CardDescription>
          A/R repair orders with no key tag tracked. Auto-released or never-tagged orders worth a
          look.
        </CardDescription>
        {rows.length > 0 && (
          <CardAction>
            <Badge variant="outline" className="font-mono text-xs tabular-nums">
              {rows.length}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="No untracked repair orders"
            subtitle="Every A/R order has a tag we can account for."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">RO #</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Key tag</TableHead>
                  <TableHead className="w-32 text-right">Released</TableHead>
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
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
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

// Tailwind v4 references CSS-var tokens with the parens form `bg-(--token)` —
// the v3 bare-bracket `bg-[--token]` shorthand was removed in v4 and is
// silently dropped (which would leave the grid unstyled). The fill/ink tokens
// carry the available/in-use semantic on the LABEL TEXT (AA: 6.81:1 / 7.60:1).
const GRID_CELL_BASE =
  "flex h-7 items-center justify-center rounded-(--radius-sm) border font-mono text-[11px] font-semibold tabular-nums";

function gridCellClasses(inUse: boolean, stale = false): string {
  const state = inUse
    ? "border-red-200 bg-(--color-grid-inuse-fill) text-(--color-grid-inuse-ink)"
    : "border-emerald-200 bg-(--color-grid-available-fill) text-(--color-grid-available-ink)";
  const ring = stale
    ? " ring-2 ring-(--color-grid-stale-ring) ring-offset-1 ring-offset-card"
    : "";
  return `${GRID_CELL_BASE} ${state}${ring}`;
}

function TagGrid({
  title,
  tiles,
  staleKeys,
}: {
  title: string;
  tiles: KeytagGridTile[];
  staleKeys: Set<string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-[repeat(15,minmax(0,1fr))]">
          {tiles.map((t) => {
            const label = (t.tag_color === "red" ? "R" : "Y") + t.tag_number;
            const isStale =
              t.in_use && staleKeys.has(`${t.tag_color}-${t.tag_number}`);
            const aria = `${label} — ${
              t.in_use
                ? `in use${t.ro_number ? `, RO #${t.ro_number}` : ""}${isStale ? " — stale" : ""}`
                : "available"
            }`;
            return (
              <div
                key={`${t.tag_color}-${t.tag_number}`}
                title={aria}
                aria-label={aria}
                className={gridCellClasses(t.in_use, isStale)}
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
    <div className="space-y-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className={`${gridCellClasses(false)} px-1.5`} aria-hidden="true">
            R4
          </span>
          available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`${gridCellClasses(true)} px-1.5`} aria-hidden="true">
            R4
          </span>
          in use
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`${gridCellClasses(true, true)} px-1.5`} aria-hidden="true">
            R4
          </span>
          stale &gt; 3 days
        </span>
      </div>
      <p className="max-w-prose leading-relaxed">
        A tag releases automatically when its RO is posted-paid or its A/R balance is paid. A stale
        ring means the keys may already be gone — release it from the keytag tools.
      </p>
    </div>
  );
}

// ─── Small shared bits ───────────────────────────────────────────────────────

function RoLink({ url, roNumber }: { url: string; roNumber: number | null }) {
  if (roNumber === null) return <span className="text-sm text-muted-foreground">—</span>;
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

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
      <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
