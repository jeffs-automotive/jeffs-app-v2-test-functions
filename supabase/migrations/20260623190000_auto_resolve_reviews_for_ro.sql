-- =====================================================================
-- auto_resolve_reviews_for_ro(p_ro_id, p_reason, p_source)
-- =====================================================================
-- Created 2026-06-23. The steady-state companion to
-- auto_resolve_manual_review (migration 20260623180000): closes EVERY open
-- review for one RO in a single atomic call, so the edge-function hooks at
-- the terminal-release sites don't have to do JSONB filtering over PostgREST.
--
-- Called right after a terminal release succeeds (webhook posted-paid /
-- payment, reconcile forward pass, orchestrator manual release). Because the
-- keys have left the shop, every open review for that RO — any category — is
-- moot. NEVER mutates a key tag (delegates to auto_resolve_manual_review).
--
-- ORP guardrail: this is only ever called from CONFIRMING terminal-release
-- sites, never from the reverse-pass orphan-release that BIRTHS an ORP, so an
-- orphan review is never auto-closed by the very release it is questioning.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.auto_resolve_reviews_for_ro(
  p_ro_id  bigint,
  p_reason text,
  p_source text DEFAULT 'webhook'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_res   RECORD;
  v_count INT := 0;
BEGIN
  IF p_ro_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT code
    FROM keytag_manual_reviews
    WHERE resolved_at IS NULL
      AND NULLIF(context->>'ro_id', '')::bigint = p_ro_id
  LOOP
    SELECT * INTO v_res
    FROM public.auto_resolve_manual_review(r.code, p_reason, p_source);
    IF v_res.ok THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.auto_resolve_reviews_for_ro IS
  'Closes every open manual review for one RO as moot (the RO terminally closed / keys left the shop). Delegates to auto_resolve_manual_review per code; never mutates a tag. Called from the edge-function terminal-release hooks. service_role only.';

REVOKE ALL ON FUNCTION public.auto_resolve_reviews_for_ro(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_resolve_reviews_for_ro(bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.auto_resolve_reviews_for_ro(bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resolve_reviews_for_ro(bigint, text, text) TO service_role;
