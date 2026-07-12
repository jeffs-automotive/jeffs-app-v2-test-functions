-- =====================================================================
-- QTekLink Payroll — LIVE snapshot substrate (round-7 decisions #40/#41)
-- =====================================================================
-- 2026-07-11. docs/qteklink/payroll-workbook-extraction-2026-07-10.md #40/#41.
--
-- OPEN runs gain a stored LIVE snapshot — a DISPLAY CACHE of the full derivation
-- (RunSnapshot JSON) so run tabs switch client-side instead of re-deriving
-- (10–20s: full chain + a live QBO P&L call per tab switch). It is refreshed by
-- the webhook → mirror-apply pipeline (debounced), open-run edits (inline), the
-- nightly ingest, and the manual refresh / dry-run actions.
--
--   live_snapshot                jsonb        — the cached RunSnapshot (display only)
--   live_snapshot_at             timestamptz  — when it was computed (the debounce clock)
--   live_snapshot_stale          boolean      — true = mirror changed since; recompute on read
--   live_snapshot_invalidated_at timestamptz  — when the LAST mark-stale fired (the
--     lost-invalidation race guard: a store whose compute began BEFORE this instant
--     must not clear the flag — see store_live_snapshot below)
--
-- INVARIANTS:
--   * OPEN runs only. Completed/voided runs render EXCLUSIVELY from the frozen
--     `snapshot` column (the Pattern S immutability wall); the RPCs below RAISE
--     on any non-open run, and the lock trigger is a second wall behind them.
--   * The live snapshot can NEVER freeze money: qteklink_payroll_complete_run
--     takes a fresh server-computed snapshot and hashes state INSIDE the
--     transaction — it never reads live_snapshot.
--   * NEITHER RPC touches updated_at (on runs or entries): the Pattern S state
--     hash (qteklink_payroll_state_hash, 20260710210000) covers run.updated_at +
--     count(entries) + max(entries.updated_at) + bonus flags, and a display-cache
--     write must not invalidate an in-flight complete/void preview.
--   * DELIBERATE DEPARTURE from "every mutating RPC writes >= 1 audit row":
--     these two write a display cache, not business state — auditing them would
--     flood qteklink_payroll_audit_log (webhook-driven recomputes run all day).
--
-- Also here (round-7 #39): tekmetric_ros gains a (shop_id, completed_date) index —
-- the hours derivations now bucket by COMPLETED date (the posted_date twin exists
-- since 20260703010000).
--
-- Grant idiom: REVOKE EXECUTE FROM PUBLIC/anon/authenticated; GRANT service_role
-- (model: 20260607090000_qteklink_settings_ro_state.sql). Apply: orchestrator
-- (supabase db push). IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.qteklink_payroll_runs
  ADD COLUMN IF NOT EXISTS live_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS live_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_snapshot_stale boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS live_snapshot_invalidated_at timestamptz;

COMMENT ON COLUMN public.qteklink_payroll_runs.live_snapshot IS
  'DISPLAY CACHE for OPEN runs: the last computed RunSnapshot JSON (round-7 #41 instant tabs). Never read by completion (which recomputes fresh in-transaction); meaningless once the run is completed/voided (the frozen `snapshot` column governs). Written only by qteklink_payroll_store_live_snapshot.';
COMMENT ON COLUMN public.qteklink_payroll_runs.live_snapshot_at IS
  'When live_snapshot was computed — the webhook pipeline''s recompute debounce clock.';
COMMENT ON COLUMN public.qteklink_payroll_runs.live_snapshot_stale IS
  'true = the Tekmetric mirror (or run inputs) changed since live_snapshot was stored — read paths recompute-and-store on sight. Flipped true by qteklink_payroll_mark_open_runs_stale; false only by a store whose compute began AFTER the last mark (live_snapshot_invalidated_at).';
COMMENT ON COLUMN public.qteklink_payroll_runs.live_snapshot_invalidated_at IS
  'When qteklink_payroll_mark_open_runs_stale LAST fired for this run (stamped on every mark, even when already stale). The lost-invalidation race guard: store_live_snapshot keeps stale=true when this is newer than the store''s p_compute_started_at — a mark landing mid-recompute is never clobbered.';

-- ─── #39 hours-basis index: completed-date window scans on the mirror ────────
CREATE INDEX IF NOT EXISTS tekmetric_ros_shop_completed_idx
  ON public.tekmetric_ros (shop_id, completed_date);

-- ─── RPC: store the live snapshot (open runs only) ───────────────────────────
-- An earlier draft of this (unapplied-remotely) migration shipped a 3-arg
-- signature; drop it so no ambiguous overload survives in any environment.
DROP FUNCTION IF EXISTS public.qteklink_payroll_store_live_snapshot(uuid, jsonb, timestamptz);
CREATE OR REPLACE FUNCTION public.qteklink_payroll_store_live_snapshot(
  p_run_id uuid,
  p_snapshot jsonb,
  p_computed_at timestamptz,
  p_compute_started_at timestamptz
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_invalidated_at timestamptz;
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'qteklink_payroll_store_live_snapshot: a non-null snapshot JSON object is required';
  END IF;
  IF p_compute_started_at IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_store_live_snapshot: p_compute_started_at is required (the lost-invalidation race guard)';
  END IF;
  -- FOR NO KEY UPDATE (this RPC updates the row itself): serializes against
  -- complete_run/void_run's FOR UPDATE — a store racing a completion waits here,
  -- re-reads the flipped status, and RAISEs instead of writing a cache onto a
  -- just-frozen run.
  SELECT r.status, r.live_snapshot_invalidated_at INTO v_status, v_invalidated_at
  FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_store_live_snapshot: run % not found', p_run_id;
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'qteklink_payroll_store_live_snapshot: run % is % — the live snapshot is for OPEN runs only (completed/voided runs render from their frozen snapshot)', p_run_id, v_status;
  END IF;

  -- Deliberately does NOT set updated_at: the Pattern S state hash covers it, and
  -- a display-cache write must never move the hash (see the header block).
  --
  -- LOST-INVALIDATION RACE GUARD: the snapshot is stored regardless (it is the
  -- freshest answer computed so far), but the stale flag only clears when NO
  -- mark_open_runs_stale fired after the compute began — a webhook landing mid-
  -- recompute (buildOpenRunSnapshot spans seconds: mirror reads + a QBO P&L call)
  -- re-marked the run for data THIS snapshot cannot contain, so it stays stale
  -- and the next read/notify/nightly recomputes.
  UPDATE public.qteklink_payroll_runs r SET
    live_snapshot       = p_snapshot,
    live_snapshot_at    = coalesce(p_computed_at, now()),
    live_snapshot_stale = (v_invalidated_at IS NOT NULL AND v_invalidated_at > p_compute_started_at)
  WHERE r.id = p_run_id;
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_store_live_snapshot(uuid, jsonb, timestamptz, timestamptz) IS
  'Store the computed LIVE snapshot (display cache) on an OPEN payroll run. Clears the stale flag ONLY when live_snapshot_invalidated_at is not newer than p_compute_started_at (a mark landing mid-recompute keeps the run stale — the lost-invalidation race guard). RAISEs on completed/voided runs. Never bumps updated_at (the Pattern S state hash covers it). No audit row — display cache, not business state.';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_store_live_snapshot(uuid, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_store_live_snapshot(uuid, jsonb, timestamptz, timestamptz) TO service_role;

-- ─── RPC: mark every open run of a shop stale (webhook consumer + ingest) ────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_mark_open_runs_stale(
  p_shop_id integer
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flipped integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_mark_open_runs_stale: a positive p_shop_id is required';
  END IF;
  -- EVERY open run is touched: stale=true AND live_snapshot_invalidated_at=now() —
  -- already-stale rows MUST be re-stamped too, or a mark landing during an
  -- in-flight recompute of an already-stale run would carry an old invalidated_at
  -- and the store would wrongly clear the flag (the lost-invalidation race).
  -- The returned count still means "runs newly invalidated" (was fresh, now stale).
  -- Open runs only — the WHERE keeps the lock trigger out of play entirely.
  -- Never bumps updated_at.
  WITH marked AS (
    UPDATE public.qteklink_payroll_runs r
    SET live_snapshot_stale = true,
        live_snapshot_invalidated_at = now()
    FROM (
      SELECT id, live_snapshot_stale AS was_stale
      FROM public.qteklink_payroll_runs
      WHERE shop_id = p_shop_id AND status = 'open'
      FOR NO KEY UPDATE
    ) old
    WHERE r.id = old.id
    RETURNING old.was_stale
  )
  SELECT count(*) FILTER (WHERE NOT was_stale)::integer INTO v_flipped FROM marked;
  RETURN v_flipped;
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_mark_open_runs_stale(integer) IS
  'Flip live_snapshot_stale=true AND stamp live_snapshot_invalidated_at=now() on every OPEN payroll run of the shop (mirror data changed: webhook mirror-apply, nightly/manual ingest). Already-stale runs are re-stamped (the lost-invalidation race guard). Returns the number of runs newly invalidated (fresh -> stale). Completed/voided runs untouched; never bumps updated_at. No audit row — display cache, not business state.';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_mark_open_runs_stale(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_mark_open_runs_stale(integer) TO service_role;

COMMIT;
