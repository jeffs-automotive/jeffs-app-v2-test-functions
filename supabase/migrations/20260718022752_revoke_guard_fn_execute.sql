-- =====================================================================
-- Revoke EXECUTE on the append-only guard trigger functions  (2026-07-18)
-- =====================================================================
-- Supabase advisor (anon/authenticated_security_definer_function_executable):
-- the BEFORE-UPDATE guard trigger functions are SECURITY DEFINER and were
-- executable by anon/authenticated via /rest/v1/rpc — a privilege-escalation
-- surface (they'd error outside a trigger context, but should not be callable
-- at all). Trigger functions do NOT need EXECUTE granted to fire (the trigger
-- runs them as the definer), so revoking EXECUTE is safe and closes the WARN.
--
-- Covers the new sms_appointment_opt_outs guard (introduced 2026-07-18) and
-- the pre-existing sms_consents guard (same pattern, same advisor finding).
-- =====================================================================

begin;

revoke execute on function public.sms_appointment_opt_outs_guard_update()
  from public, anon, authenticated;

revoke execute on function public.sms_consents_guard_update()
  from public, anon, authenticated;

commit;
