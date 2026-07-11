-- Distinct job categories for payroll spiff discovery — recursive index
-- skip-scan over tekmetric_ro_jobs_category_idx.
--
-- Root cause (live, 2026-07-11): discoverNewCategories paged
-- `select job_category_name ... order by id range(...)` over the ~940k-row
-- jobs table and hit `57014 canceling statement due to statement timeout` on
-- the FIRST page (~8s) — the ORDER BY id plan scans the table. Chris hit it
-- via the settings "Check for new" button; Sentry captured the same error.
-- Plain SELECT DISTINCT is ~3.4s cold (bitmap heap scan over 83k matching
-- rows). The skip-scan below runs in ~1.7ms (one index probe per distinct
-- value; 82 probes measured) and stays flat as the mirror grows.
--
-- Convention: SECURITY DEFINER + pinned search_path + REVOKE/GRANT idiom per
-- 20260710210000_qteklink_payroll.sql (the mirror tables are service_role
-- SELECT-only, so the payroll DAL calls this through the definer).

CREATE OR REPLACE FUNCTION public.qteklink_payroll_distinct_job_categories(p_shop_id integer)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE cats AS (
    (SELECT job_category_name AS name FROM public.tekmetric_ro_jobs
      WHERE job_category_name IS NOT NULL AND shop_id = p_shop_id
      ORDER BY job_category_name LIMIT 1)
    UNION ALL
    (SELECT (SELECT j.job_category_name FROM public.tekmetric_ro_jobs j
              WHERE j.job_category_name > c.name AND j.shop_id = p_shop_id
              ORDER BY j.job_category_name LIMIT 1)
     FROM cats c WHERE c.name IS NOT NULL)
  )
  SELECT coalesce(array_agg(name ORDER BY name), ARRAY[]::text[])
  FROM cats WHERE name IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_distinct_job_categories(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_distinct_job_categories(integer)
  TO service_role;
