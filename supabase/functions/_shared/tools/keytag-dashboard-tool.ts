// getKeytagDashboard — the live pool snapshot for the admin-app Dashboard tab.
//
// Thin wrapper over `buildKeytagDashboardData` (the same data the 7 AM email
// renders). Reshapes the raw 180-tag list into compact grid tiles and exposes
// counts / stale / ROs-without-tags so the admin-app can render the email's
// layout in React. Read-only; the admin-app caches the result (60s) so each
// poll is cheap despite the Tekmetric customer-name resolution inside.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildKeytagDashboardData,
  type KeytagRow,
  type RoWithoutKeytagDetail,
  type StaleTagDetail,
} from "../keytag-dashboard-data.ts";

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
