-- =====================================================================
-- QTekLink — qteklink_discover_tekmetric_items (the mapping-picker item list)
-- =====================================================================
-- 2026-06-08. The /mappings UX redesign: instead of typing a free-text "source key",
-- the admin picks a Tekmetric ITEM from a dropdown. The discoverable items (which
-- aren't a fixed list) are the distinct fee names, part categories, and non-cash
-- payment types that have actually appeared in this shop's events. This read-only
-- SECURITY DEFINER function aggregates them (with a "seen" count for sorting); the DAL
-- merges the FIXED items (labor / sublet / tax / A-R / undeposited / cc-fee) + annotates
-- each with its current mapping.
--
-- Latest-per-RO / latest-per-payment so re-deliveries don't inflate the counts.
-- service_role-only EXECUTE. Tenant isolation is by the (p_shop_id, p_realm_id) args —
-- the DAL passes the server-resolved realm. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qteklink_discover_tekmetric_items(
  p_shop_id  integer,
  p_realm_id text
)
RETURNS TABLE(kind text, source_key text, seen bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_ro AS (
    SELECT DISTINCT ON (tekmetric_ro_id) raw_body->'data' AS ro
    FROM public.qteklink_events
    WHERE shop_id = p_shop_id AND realm_id = p_realm_id
      AND event_kind IN ('ro_posted','ro_sent_to_ar') AND tekmetric_ro_id IS NOT NULL
    ORDER BY tekmetric_ro_id, received_at DESC
  ),
  latest_pay AS (
    SELECT DISTINCT ON (payment_id) raw_body->'data' AS d
    FROM public.qteklink_events
    WHERE shop_id = p_shop_id AND realm_id = p_realm_id
      AND event_kind = 'payment_made' AND payment_id IS NOT NULL
    ORDER BY payment_id, received_at DESC
  ),
  fees AS (
    SELECT btrim(f->>'name') AS name
    FROM latest_ro, jsonb_array_elements(coalesce(ro->'fees','[]'::jsonb)) f
    WHERE f->>'name' IS NOT NULL
    UNION ALL
    SELECT btrim(jf->>'name')
    FROM latest_ro,
         jsonb_array_elements(coalesce(ro->'jobs','[]'::jsonb)) j,
         jsonb_array_elements(coalesce(j->'fees','[]'::jsonb)) jf
    WHERE jf->>'name' IS NOT NULL
  ),
  parts AS (
    SELECT upper(btrim(p->'partType'->>'code')) AS code
    FROM latest_ro,
         jsonb_array_elements(coalesce(ro->'jobs','[]'::jsonb)) j,
         jsonb_array_elements(coalesce(j->'parts','[]'::jsonb)) p
    WHERE p->'partType'->>'code' IS NOT NULL
  ),
  noncash AS (
    SELECT btrim(
      CASE jsonb_typeof(d->'otherPaymentType')
        WHEN 'object' THEN d->'otherPaymentType'->>'name'
        WHEN 'string' THEN d->>'otherPaymentType'
      END
    ) AS name
    FROM latest_pay
    WHERE d ? 'otherPaymentType' AND jsonb_typeof(d->'otherPaymentType') <> 'null'
  )
  SELECT 'fee'::text, name, count(*)::bigint
    FROM fees WHERE length(coalesce(name,'')) > 0 GROUP BY name
  UNION ALL
  SELECT 'part_category'::text, code, count(*)::bigint
    FROM parts WHERE length(coalesce(code,'')) > 0 GROUP BY code
  UNION ALL
  SELECT 'noncash_payment_type'::text, name, count(*)::bigint
    FROM noncash WHERE length(coalesce(name,'')) > 0 GROUP BY name;
$$;

COMMENT ON FUNCTION public.qteklink_discover_tekmetric_items(integer, text) IS
  'Read-only: distinct Tekmetric fee names / part categories / non-cash payment types seen in a shop''s events (the /mappings item picker). The DAL merges the fixed items + annotates current mappings.';

REVOKE EXECUTE ON FUNCTION public.qteklink_discover_tekmetric_items(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_discover_tekmetric_items(integer, text) TO service_role;

COMMIT;
