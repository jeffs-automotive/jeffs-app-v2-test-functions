-- =====================================================================
-- scheduler_shop_now() — P1.6 post-validator fix (2026-05-25)
-- =====================================================================
-- Validator 2 caught: same-day cutoff math (SAME_DAY_CUTOFF_HOUR = 12 PM
-- ET) is computed from the Vercel server's `new Date()` clock in
-- `scheduler-app/src/lib/scheduler/wizard/shop-tz.ts:105` (shopLocalHourNow)
-- and `:84` (shopLocalToday). Vercel server clocks DO sync via NTP — but
-- two concerns:
--
--   1. Atomicity at the cutoff minute. If availability.ts reads the
--      Vercel clock at 11:59:59.998 PM and renders today as available,
--      then submit-date.ts re-checks the Vercel clock at 12:00:00.002 PM
--      and rejects the submission, the customer sees an inconsistent UX
--      (date was in the picker; now it's invalid). With a single Postgres
--      clock as source of truth, both reads use the same authoritative
--      time and the customer either sees today consistently OR doesn't.
--
--   2. Mixed-clock comparison. The rest of the system uses Postgres `now()`
--      for time-based decisions (appointment_holds.expires_at, the
--      hold-reaper cron, scheduler_audit_log occurred_at, etc.). Reading
--      the cutoff from a DIFFERENT clock (Vercel) creates a small drift
--      window between when availability says "cutoff hit" and when other
--      DB queries reflect that. Always-consult-the-Postgres-clock
--      eliminates the drift class.
--
-- Returns JSONB: { date: "YYYY-MM-DD", hour: int, minute: int,
--                  iso_local: "YYYY-MM-DDTHH:MI:SS" } in America/New_York.
--
-- SECURITY INVOKER — reads only the system clock; no privilege escalation
-- needed. Matches cross-module-anchors.md SECURITY DEFINER policy
-- ("don't unless needed").
--
-- STABLE — `now()` returns transaction_timestamp() which is constant
-- within a single statement. STABLE allows the query planner to fold
-- away repeated calls in the same query. Each top-level RPC call gets
-- a fresh `now()` (each is its own transaction). Matches the volatility
-- class of `current_timestamp`, `now()`, and similar built-ins.
--
-- Single-shop Phase 1: timezone is hardcoded to "America/New_York".
-- When multi-shop ships, the function will accept a shop_id arg and
-- resolve the timezone from `shops.timezone` per
-- `.claude/rules/shop-agnostic.md`. Tracked as future work via the
-- shop_id-as-arg pattern in P2.8 (validator-2).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.scheduler_shop_now()
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'date',
      to_char(
        timezone('America/New_York', now()),
        'YYYY-MM-DD'
      ),
    'hour',
      extract(hour from timezone('America/New_York', now()))::int,
    'minute',
      extract(minute from timezone('America/New_York', now()))::int,
    'iso_local',
      to_char(
        timezone('America/New_York', now()),
        'YYYY-MM-DD"T"HH24:MI:SS'
      )
  );
$$;

COMMENT ON FUNCTION public.scheduler_shop_now() IS
'P1.6 post-validator fix (2026-05-25). Returns the current shop-local clock as JSONB { date, hour, minute, iso_local }. Single source of truth for same-day cutoff math + any other time-of-day gating. Single-shop Phase 1: timezone hardcoded to America/New_York; multi-shop future will accept shop_id arg.';

-- Lock down public access — RPC is for the scheduler-app service-role
-- client only, not for anon/authenticated callers (consistent with the
-- other scheduler_* RPCs in this migration set).
REVOKE ALL ON FUNCTION public.scheduler_shop_now() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scheduler_shop_now() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scheduler_shop_now() TO service_role;

COMMIT;
