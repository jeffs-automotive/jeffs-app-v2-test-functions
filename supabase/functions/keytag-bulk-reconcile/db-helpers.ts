// db-helpers — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import { type TagColor } from "../_shared/keytag-format.ts";
import { sb } from "./config.ts";

// ── DB helpers ──────────────────────────────────────────────────────────────

export interface ExistingTag {
  tag_color: TagColor;
  tag_number: number;
  status: "assigned" | "posted_ar" | "available";
}

export async function getExistingTagsByRoId(
  roIds: number[],
): Promise<Map<number, ExistingTag>> {
  const map = new Map<number, ExistingTag>();
  if (roIds.length === 0) return map;
  const { data, error } = await sb
    .from("keytags")
    .select("ro_id, tag_color, tag_number, status")
    .in("ro_id", roIds);
  if (error) {
    throw new Error(`Bulk keytags lookup failed: ${error.message}`);
  }
  for (const row of data ?? []) {
    map.set(row.ro_id as number, {
      tag_color: row.tag_color as TagColor,
      tag_number: row.tag_number as number,
      status: row.status as "assigned" | "posted_ar" | "available",
    });
  }
  return map;
}

export interface InUseTagRow {
  ro_id: number;
  ro_number: number | null;
  tag_color: TagColor;
  tag_number: number;
  status: "assigned" | "posted_ar";
}

/**
 * Returns every keytag row currently held (status = assigned OR posted_ar).
 * Used by the reverse pass to detect tags whose RO is no longer in the
 * WIP/AR forward-list (and therefore needs an individual GET to determine
 * its current Tekmetric state).
 */
export async function getAllInUseTags(): Promise<InUseTagRow[]> {
  const { data, error } = await sb
    .from("keytags")
    .select("ro_id, ro_number, tag_color, tag_number, status")
    .in("status", ["assigned", "posted_ar"]);
  if (error) {
    throw new Error(`In-use tags query failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ro_id: r.ro_id as number,
    ro_number: (r.ro_number as number | null) ?? null,
    tag_color: r.tag_color as TagColor,
    tag_number: r.tag_number as number,
    status: r.status as "assigned" | "posted_ar",
  }));
}

export async function getPoolCounts(): Promise<{ in_use: number; available: number }> {
  const { data, error } = await sb
    .from("keytags")
    .select("status");
  if (error) {
    throw new Error(`Pool count query failed: ${error.message}`);
  }
  let inUse = 0;
  let available = 0;
  for (const r of data ?? []) {
    if (r.status === "available") available += 1;
    else inUse += 1;
  }
  return { in_use: inUse, available };
}
