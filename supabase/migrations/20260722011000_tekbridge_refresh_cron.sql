-- tekbridge session refresh — schema + cron
--
-- Keeps the bot's Tekmetric token alive server-side: a cron calls the
-- tekbridge-refresh edge fn every 6h, which hits Tekmetric's refresh endpoint
-- (GET /api/token/shop/{shopId}) with the stored token and persists a fresh one.
-- No browser / reCAPTCHA after the one-time human bootstrap. On failure the fn
-- emails the operator (de-duped) to re-log-the-bot-in. See
-- docs/tekmetric/tekbridge-plan.md + the headless-automation research doc.
--
-- 6h cadence = 4 runs inside the ~16h token life, so a single failed run still
-- leaves ~10h of runway before the chain breaks. IDEMPOTENT. Apply: supabase db push.

-- Alert de-dup stamp (added to the session-state table from 20260722010000).
ALTER TABLE public.tekbridge_session_state
  ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tekbridge_session_state.last_alert_at IS
  'Last time an operator alert email was sent for this shop''s broken bot session. Cleared on a successful refresh; used to de-dup alerts to at most once per 12h.';

-- ---------------------------------------------------------------------
-- Cron: tekbridge-refresh — every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
-- ---------------------------------------------------------------------
SELECT cron.unschedule('tekbridge-refresh')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tekbridge-refresh');

-- Body wrapped in BEGIN/EXCEPTION → scheduler_error_log (observability rule 8;
-- same pattern as back-office-ro-watch / document-intake) so a Vault/pg_net
-- dispatch failure is recorded, not silent.
SELECT cron.schedule(
  'tekbridge-refresh',
  '0 */6 * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('tekbridge-refresh', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'tekbridge-refresh', 'cron/tekbridge-refresh', 'error', SQLSTATE, SQLERRM);
  END $$;
  $cron$
);

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'tekbridge-refresh';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'tekbridge-refresh cron failed to register (rows=%)', v_count;
  END IF;
END
$$;
