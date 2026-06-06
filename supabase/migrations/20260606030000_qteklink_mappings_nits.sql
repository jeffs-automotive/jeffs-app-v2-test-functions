-- =====================================================================
-- QTekLink C2 hardening — round-2 cross-verify nits (cheap, real)
-- =====================================================================
-- 2026-06-06. Round-2 cross-verify on the hardening surfaced a few cheap, real
-- refinements (the rest were moot on a blank-start table, false-positives, or
-- deferred to C3/C5). Fixes here:
--   - trigger fn qteklink_mappings_validate: REVOKE EXECUTE FROM PUBLIC (it is
--     SECURITY DEFINER; every other definer fn is revoked — clears advisor
--     0028/0029; trigger fns are invoked by the trigger mechanism, no GRANT
--     needed). NULL-safe active check (`active IS NOT TRUE`, not `NOT active`).
--     search_path = '' (it fully-qualifies its refs) for consistency with the
--     pure helpers. Cleaner user-facing RAISE messages (drop shop/realm internals).
--   - qteklink_set_mapping: search_path = '' (fully-qualified refs) — narrowest path.
--   - re-affirm the REVOKE on qteklink_role_accepts_type (it persisted through the
--     round-1 CREATE OR REPLACE, but make it explicit).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qteklink_mappings_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type    text;
  v_deleted timestamptz;
  v_active  boolean;
BEGIN
  IF NOT NEW.active THEN
    RETURN NEW;  -- deactivations / historical rows are never re-validated
  END IF;

  SELECT account_type, deleted_at, active INTO v_type, v_deleted, v_active
    FROM public.qbo_accounts
   WHERE shop_id = NEW.shop_id AND realm_id = NEW.realm_id AND qbo_account_id = NEW.qbo_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_mappings: account % is not in the chart of accounts', NEW.qbo_account_id;
  END IF;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'qteklink_mappings: account % has been removed from QuickBooks — cannot map to it', NEW.qbo_account_id;
  END IF;
  IF v_active IS NOT TRUE THEN  -- NULL-safe: a NULL active is treated as not-active
    RAISE EXCEPTION 'qteklink_mappings: account % is inactive in QuickBooks — only active accounts can be mapped', NEW.qbo_account_id;
  END IF;
  IF NOT public.qteklink_role_accepts_type(NEW.posting_role, coalesce(v_type, '')) THEN
    RAISE EXCEPTION 'qteklink_mappings: posting_role % is not compatible with account type % (account %)',
      NEW.posting_role, coalesce(v_type, '(none)'), NEW.qbo_account_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_mappings_validate() FROM PUBLIC, anon, authenticated;

-- Narrowest search_path for the set_mapping RPC (it fully-qualifies every ref).
ALTER FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text)
  SET search_path = '';

-- Re-affirm (explicit) — persisted through round-1's CREATE OR REPLACE, but state it.
REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
