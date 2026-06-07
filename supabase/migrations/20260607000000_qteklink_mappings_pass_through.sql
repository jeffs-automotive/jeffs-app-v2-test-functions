-- =====================================================================
-- QTekLink C5 — qteklink_mappings.pass_through (fee excluded from discount waterfall)
-- =====================================================================
-- 2026-06-07. Plan §6: "pass-through / mandated fees are EXCLUDED from the discount
-- waterfall." A fee mapping can now be flagged pass_through; the C5 SALE JE builder
-- skips flagged fees when allocating discountTotal (they're never discounted).
--
-- pass_through is a FEE-only concept — a table CHECK + the RPC guard enforce
-- kind='fee'. qteklink_set_mapping gains a p_pass_through param: CREATE OR REPLACE
-- can't add a parameter, so the 7-arg form is DROPped and an 8-arg form created
-- (p_pass_through DEFAULT false → PostgREST callers that omit it stay compatible).
-- ALL of the C2 hardening is preserved verbatim (source_key identity, kind<->role
-- pre-check, system rules, search_path = '' with fully-qualified refs); only the
-- new param + the fee-only guard + persisting pass_through are added. The C2
-- BEFORE-write trigger (qteklink_mappings_validate) is unchanged and still fires.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

ALTER TABLE public.qteklink_mappings
  ADD COLUMN IF NOT EXISTS pass_through boolean NOT NULL DEFAULT false;

ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_passthrough_fee_only;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_passthrough_fee_only
  CHECK (pass_through = false OR kind = 'fee');

COMMENT ON COLUMN public.qteklink_mappings.pass_through IS
  'Fee mappings only (CHECK kind=fee): when true this pass-through / mandated fee is EXCLUDED from the C5 discount waterfall — it is never discounted. Default false.';

-- Re-create set_mapping with p_pass_through (8-arg). Preserves the C2 hardening.
DROP FUNCTION IF EXISTS public.qteklink_set_mapping(integer, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.qteklink_set_mapping(
  p_shop_id        integer,
  p_realm_id       text,
  p_kind           text,
  p_source_key     text,
  p_source_id      text,
  p_qbo_account_id text,
  p_posting_role   text,
  p_pass_through   boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_src_id  text := nullif(btrim(p_source_id), '');
  v_src_key text := btrim(coalesce(p_source_key, ''));
  v_id      uuid;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_set_mapping: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_kind IS NULL OR length(v_src_key) = 0
     OR p_qbo_account_id IS NULL OR length(btrim(p_qbo_account_id)) = 0
     OR p_posting_role IS NULL THEN
    RAISE EXCEPTION 'qteklink_set_mapping: kind, source_key, qbo_account_id and posting_role are required';
  END IF;

  -- Within-row rules pre-checked for clean messages (table CHECKs + trigger are the backstop).
  IF NOT public.qteklink_kind_accepts_role(p_kind, p_posting_role) THEN
    RAISE EXCEPTION 'qteklink_set_mapping: a % mapping cannot use posting_role %', p_kind, p_posting_role;
  END IF;
  -- pass_through is a fee-only concept (defense-in-depth alongside the table CHECK).
  IF coalesce(p_pass_through, false) AND p_kind <> 'fee' THEN
    RAISE EXCEPTION 'qteklink_set_mapping: pass_through is only valid for a fee mapping (got kind=%)', p_kind;
  END IF;
  IF p_kind = 'system' THEN
    IF v_src_key NOT IN ('accounts_receivable','undeposited_funds','cc_fee') THEN
      RAISE EXCEPTION 'qteklink_set_mapping: system source_key % must be accounts_receivable, undeposited_funds or cc_fee', v_src_key;
    END IF;
    IF p_posting_role <> v_src_key THEN
      RAISE EXCEPTION 'qteklink_set_mapping: a system mapping''s posting_role must equal its source_key (got % vs %)', p_posting_role, v_src_key;
    END IF;
  END IF;

  -- One active per source_key (the stable identity): deactivate the current active row.
  UPDATE public.qteklink_mappings
     SET active = false, updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND kind = p_kind
     AND source_key = v_src_key AND active;

  -- Insert the new active row (the BEFORE trigger validates account live/active/role<->type).
  INSERT INTO public.qteklink_mappings (
    shop_id, realm_id, kind, source_key, source_id, qbo_account_id, posting_role, pass_through, active, effective_from
  ) VALUES (
    p_shop_id, p_realm_id, p_kind, v_src_key, v_src_id, p_qbo_account_id, p_posting_role,
    coalesce(p_pass_through, false), true, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text, boolean) TO service_role;
COMMENT ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text, boolean) IS
  'QTekLink: upsert ONE active mapping for a source (deactivate-by-source_key, history kept). Validates kind<->role + system rules + (new) fee-only pass_through; the BEFORE trigger validates the account is live/active + role<->type. service_role only.';

COMMIT;
