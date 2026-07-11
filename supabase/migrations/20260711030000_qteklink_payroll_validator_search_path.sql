-- Pin search_path on the two payroll pay-config/overrides validator helpers.
--
-- supabase-compliance verify finding (2026-07-11, qteklink-payroll): both are
-- SECURITY INVOKER and only PERFORMed from DEFINER RPCs that already pin
-- search_path = public, so the real exploit surface is minimal — but Supabase's
-- database advisor lint 0011_function_search_path_mutable flags ANY public
-- function without an explicit search_path, and every other function in
-- 20260710210000_qteklink_payroll.sql pins it. Pin these two for consistency
-- and a clean get_advisors run.

ALTER FUNCTION public.qteklink_payroll_validate_pay_config(text, jsonb, boolean, text)
  SET search_path = public;

ALTER FUNCTION public.qteklink_payroll_validate_overrides(jsonb, text)
  SET search_path = public;
