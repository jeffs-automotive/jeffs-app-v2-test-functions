/**
 * shop-clock — single source of truth for the current shop-local clock,
 * sourced from Postgres via the `scheduler_shop_now()` RPC.
 *
 * P1.6 post-validator fix (2026-05-25). Replaces the Vercel-clock-based
 * `shopLocalToday()` / `shopLocalHourNow()` helpers in
 * `wizard/shop-tz.ts` for SECURITY-CRITICAL cutoff logic
 * (availability filter + submit-date defensive re-check). The Vercel
 * helpers stay around for DISPLAY-ONLY uses (final confirmation bubble's
 * "same day?" copy switch, etc.) where a small clock drift produces
 * slightly-wrong copy but no booking-correctness consequence.
 *
 * Why pull from Postgres:
 *
 *   1. ATOMICITY. The cutoff is checked at two surfaces — availability.ts
 *      (RSC) when rendering the date picker AND submit-date.ts (Server
 *      Action) when the customer commits. With two clock sources (Vercel
 *      ≠ Postgres), the cutoff minute creates a UX inconsistency: today
 *      is in the picker but rejected on submit. With ONE clock source,
 *      both surfaces agree.
 *
 *   2. SINGLE SOURCE OF TRUTH. The rest of the system uses Postgres `now()`
 *      for time-based decisions: appointment_holds.expires_at,
 *      scheduler-hold-reaper cron, scheduler_audit_log occurred_at. The
 *      cutoff math joins that family.
 *
 *   3. TAMPER-RESISTANCE for any future client-side migration. If we ever
 *      need to expose the cutoff to client code (e.g., for client-side
 *      countdown rendering), the client could spoof its system clock to
 *      bypass the cutoff with the Vercel-server-clock pattern. With
 *      Postgres-server-clock, the cutoff is unreachable from the browser.
 *
 * Caching: per-request memoization via React `cache()`. A single render
 * (or single Server Action invocation) calls the RPC at most once; the
 * snapshot is shared across availability.ts + submit-date.ts + any
 * future caller within the same request. No cross-request cache —
 * each new request gets a fresh snapshot (which is what we want).
 *
 * Fallback: on RPC failure (DB unreachable, malformed response), the
 * helper falls back to a Vercel-derived snapshot + emits a Sentry
 * warning. Failing-OPEN here preserves the prior Vercel-clock behavior
 * for legitimate customers; the Sentry warning surfaces the issue so
 * operators can fix the underlying DB problem.
 */
import { cache } from "react";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  shopLocalDate as vercelShopLocalDate,
  shopLocalHourNow as vercelShopLocalHourNow,
  SAME_DAY_CUTOFF_HOUR,
} from "@/lib/scheduler/wizard/shop-tz";

export interface ShopClockSnapshot {
  /** Shop-local calendar date — "YYYY-MM-DD". */
  date: string;
  /** Shop-local wall-clock hour — 0-23. */
  hour: number;
  /** Shop-local wall-clock minute — 0-59. */
  minute: number;
  /**
   * Shop-local ISO string without TZ offset — "YYYY-MM-DDTHH:MM:SS".
   * Useful for logging / audit trails where the operator wants to see
   * the wall-clock value the system was using at decision time.
   */
  iso_local: string;
  /**
   * Current UTC instant captured at snapshot time as
   * "YYYY-MM-DDTHH:MM:SS.sssZ". Lets callers use the SAME instant for
   * every TIMESTAMPTZ comparison within a render — eliminates the
   * cross-`new Date()`-call drift that would otherwise pile up across
   * multiple supabase filters in availability.ts and similar surfaces.
   *
   * Sourced from Vercel `Date.now()` at the moment the snapshot was
   * captured (NOT from the Postgres RPC — the RPC returns shop-local
   * components only). NTP drift between Vercel + Postgres is ~10ms
   * bound; close enough that `expires_at > now_utc_iso` agrees with
   * `expires_at > Postgres.now()` for any non-microsecond-precision
   * application.
   */
  now_utc_iso: string;
  /** TRUE when the snapshot was sourced from the Postgres RPC. FALSE
   * when the RPC failed and the snapshot came from the Vercel-clock
   * fallback. Callers can branch on this for stricter behavior
   * (e.g., refuse to gate cutoffs on a fallback snapshot if a future
   * policy requires DB-clock guarantees). */
  source: "postgres" | "vercel_fallback";
}

const shopClockRpcSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  iso_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
});

/**
 * Get the current shop-local clock snapshot. Memoized per-request via
 * React `cache()` so multiple callers within a single render share the
 * same snapshot (avoids clock-skew between sibling reads).
 *
 * Returns the Postgres-clock value on the happy path. Falls back to the
 * Vercel clock on RPC failure with a Sentry warning so the gate remains
 * usable even during DB hiccups.
 */
export const getShopClock = cache(async (): Promise<ShopClockSnapshot> => {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("scheduler_shop_now");
    if (error) {
      Sentry.captureException(error, {
        tags: { surface: "shop_clock_rpc" },
        level: "warning",
        extra: {
          note: "scheduler_shop_now RPC failed — falling back to Vercel clock for this request.",
          code: error.code,
        },
      });
      return computeVercelFallback();
    }
    const parsed = shopClockRpcSchema.safeParse(data);
    if (!parsed.success) {
      Sentry.captureMessage("shop_clock_rpc_malformed", {
        level: "warning",
        tags: { surface: "shop_clock_rpc_parse" },
        extra: {
          received: typeof data,
          issues: parsed.error.issues.map((i) => i.message).join("; "),
        },
      });
      return computeVercelFallback();
    }
    return {
      ...parsed.data,
      now_utc_iso: new Date().toISOString(),
      source: "postgres",
    };
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "shop_clock_rpc_throw" },
      level: "warning",
    });
    return computeVercelFallback();
  }
});

function computeVercelFallback(): ShopClockSnapshot {
  const now = new Date();
  const date = vercelShopLocalDate(now);
  const hour = vercelShopLocalHourNow();
  // Pull minute from the same Intl probe as hour to keep them aligned.
  // (Building a second Intl formatter is fine — happens at most once per
  // request on the rare RPC-failure path.)
  const minute = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      minute: "2-digit",
    })
      .formatToParts(now)
      .find((p) => p.type === "minute")?.value ?? "0",
    10,
  );
  return {
    date,
    hour,
    minute,
    iso_local: `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
    now_utc_iso: now.toISOString(),
    source: "vercel_fallback",
  };
}

/**
 * Convenience: is the current shop-local time AT or PAST the same-day
 * cutoff (12 PM ET, per `SAME_DAY_CUTOFF_HOUR`)? Reads from the cached
 * snapshot — sharing the same clock-read as `getShopClock()` in
 * the same request.
 */
export async function isAfterSameDayCutoffPg(): Promise<boolean> {
  const snap = await getShopClock();
  return snap.hour >= SAME_DAY_CUTOFF_HOUR;
}

/**
 * Convenience: shop-local "YYYY-MM-DD" for "today" sourced from the
 * Postgres clock. Drop-in replacement for `shopLocalToday()` from
 * `wizard/shop-tz.ts` at security-critical surfaces.
 */
export async function getShopTodayPg(): Promise<string> {
  const snap = await getShopClock();
  return snap.date;
}
