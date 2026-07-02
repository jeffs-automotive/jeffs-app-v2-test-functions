/**
 * In-process cache for the DB-driven appointment types (sub-feature B3 of
 * docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md).
 *
 * The wizard's appointment_type step, the submit validator, and (from B4)
 * the booking color lookup all read public.scheduler_appointment_types
 * through this module. Mirrors routine-services-cache.ts: 5-minute TTL +
 * __resetForTests.
 *
 * FAIL-SAFE: if the table read errors, we serve FALLBACK_TYPES — the two
 * system rows with copy byte-identical to the B1 seeds — so the wizard can
 * never lose its appointment step to a config-table outage. The failure is
 * Sentry-captured, never silent (observability.md rule 9).
 */
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

export interface AppointmentType {
  slug: string;
  /** Short customer/staff-facing name ("Wait", "Drop-off"). */
  label: string;
  /** Wizard card title ("Wait while we work"). */
  card_title: string;
  card_description: string | null;
  emoji: string | null;
  /** Tekmetric calendar color NAME ('red' | 'navy' | ...). */
  tekmetric_color: string;
  /** true → consumes a waiter 8/9 AM slot; false → daily drop-off cap. */
  requires_time_slot: boolean;
  is_system: boolean;
  sort: number;
}

/** The capacity lane a type consumes (the pre-B5 storable enum). */
export type CapacityLane = "waiter" | "dropoff";

export function laneFor(t: AppointmentType): CapacityLane {
  return t.requires_time_slot ? "waiter" : "dropoff";
}

/**
 * Byte-identical to the B1 seeds (which were byte-identical to the retired
 * TYPE_META in AppointmentTypeCard.tsx) — the table-unreachable fallback.
 */
export const FALLBACK_TYPES: AppointmentType[] = [
  {
    slug: "waiter",
    label: "Wait",
    card_title: "Wait while we work",
    card_description:
      "Grab a coffee — most waiter jobs are 30 to 60 minutes. Available at 8 AM or 9 AM.",
    emoji: "☕",
    tekmetric_color: "red",
    requires_time_slot: true,
    is_system: true,
    sort: 10,
  },
  {
    slug: "dropoff",
    label: "Drop-off",
    card_title: "Drop off in the morning",
    card_description: "Drop your car off by 10 AM. We'll text or call when it's ready.",
    emoji: "🚗",
    tekmetric_color: "navy",
    requires_time_slot: false,
    is_system: true,
    sort: 20,
  },
];

const TTL_MS = 5 * 60_000;

let cache: { fetchedAt: number; rows: AppointmentType[] } | null = null;

/**
 * ACTIVE (bookable) appointment types in display order. Never throws — on a
 * read failure returns FALLBACK_TYPES (Sentry-captured).
 */
export async function getActiveAppointmentTypes(): Promise<AppointmentType[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.rows;
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("scheduler_appointment_types")
      .select(
        "slug, label, card_title, card_description, emoji, tekmetric_color, requires_time_slot, is_system, sort",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("sort", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AppointmentType[];
    if (rows.length === 0) {
      // A config table with zero active types would brick the wizard —
      // treat as an outage, not a valid state.
      throw new Error("scheduler_appointment_types returned 0 active rows");
    }
    cache = { fetchedAt: Date.now(), rows };
    return rows;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "appointment_types_load" },
      level: "warning",
    });
    return FALLBACK_TYPES;
  }
}

/** Active type by slug, or null when unknown/inactive. */
export async function getAppointmentTypeBySlug(
  slug: string,
): Promise<AppointmentType | null> {
  const types = await getActiveAppointmentTypes();
  return types.find((t) => t.slug === slug) ?? null;
}

/** Vitest-only: clear the cache between tests. */
export function __resetAppointmentTypesCacheForTests(): void {
  cache = null;
}
