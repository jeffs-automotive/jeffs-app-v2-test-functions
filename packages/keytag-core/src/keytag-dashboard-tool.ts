// getKeytagDashboard — the live pool snapshot for the admin-app Dashboard tab.
//
// COPY for the @jeffs/keytag-core read package (Phase 0 build-seam spike,
// 2026-06-26). Verbatim copy of
// `supabase/functions/_shared/tools/keytag-dashboard-tool.ts` with the
// SupabaseClient import changed to the bare specifier `@supabase/supabase-js`.
//
// Thin wrapper over `buildKeytagDashboardData` (the same data the 7 AM email
// renders). Reshapes the raw 180-tag list into compact grid tiles. Read-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildKeytagDashboardData,
  type KeytagRow,
  type RoWithoutKeytagDetail,
  type StaleTagDetail,
} from "./keytag-dashboard-data.ts";

/** One cell in the 180-tag grid (R1..R90, Y1..Y90). */
export interface KeytagGridTile {
  tag_color: "red" | "yellow";
  tag_number: number;
  in_use: boolean;
  status: string;
  ro_number: number | null;
}

export interface KeytagDashboardResult {
  ok: true;
  generated_at: string;
  counts: {
    in_use: number;
    available: number;
    stale: number;
    total: number;
  };
  stale: StaleTagDetail[];
  ros_without_tags: RoWithoutKeytagDetail[];
  grid: KeytagGridTile[];
}

/** Map a full keytag row to a lean grid tile (pure). */
export function toGridTile(t: KeytagRow): KeytagGridTile {
  return {
    tag_color: t.tag_color,
    tag_number: t.tag_number,
    in_use: t.status !== "available",
    status: t.status,
    ro_number: t.ro_number,
  };
}

export async function getKeytagDashboardTool(
  sb: SupabaseClient,
  shopId: number,
): Promise<KeytagDashboardResult> {
  const d = await buildKeytagDashboardData(sb, shopId);
  return {
    ok: true,
    generated_at: d.generatedAt,
    counts: {
      in_use: d.inUseCount,
      available: d.availableCount,
      stale: d.staleCount,
      total: d.tags.length,
    },
    stale: d.staleDetails,
    ros_without_tags: d.rosWithoutKeytags,
    grid: d.tags.map(toGridTile),
  };
}
