-- =====================================================================
-- process_sms_stop(p_phone) — atomic inbound-STOP handler  (2026-07-18)
-- =====================================================================
-- Code-review finding #1 (non-atomic-multi-write): the telnyx-webhook STOP
-- branch performed the marketing-consent revoke and the transactional
-- appointment-SMS suppression as TWO separate JS writes. A mid-sequence
-- failure could leave STOP half-applied (marketing stopped, reminders still
-- sending) — a compliance gap on the legally load-bearing STOP path.
--
-- This RPC folds both mutations into ONE transaction, per
-- cross-module-anchors.md §A ("multi-step writes that must be consistent use
-- a Postgres RPC transaction, NOT sequential JS writes"). The inbound-message
-- ledger insert stays in the caller — it is independent of the STOP action.
-- =====================================================================

begin;

create or replace function public.process_sms_stop(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked int;
  v_opt_out_shops int;
begin
  -- 1. Revoke active marketing consent (idempotent — only non-revoked rows).
  update public.sms_consents
     set revoked_at = now(), revoke_source = 'sms_stop'
   where phone_e164 = p_phone
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  -- 2. Suppress transactional appointment SMS for every shop this phone was
  --    messaged from (anyone who can text STOP received a ledgered outbound
  --    message). ON CONFLICT against the active partial unique = the phone is
  --    already opted out at that shop → no-op.
  with ins as (
    insert into public.sms_appointment_opt_outs (shop_id, phone_e164, source)
    select distinct m.shop_id, p_phone, 'sms_stop'
      from public.sms_messages m
     where m.phone_e164 = p_phone
       and m.direction = 'outbound'
    on conflict (shop_id, phone_e164) where restored_at is null do nothing
    returning 1
  )
  select count(*)::int into v_opt_out_shops from ins;

  return jsonb_build_object(
    'revoked_count', v_revoked,
    'opt_out_shops', v_opt_out_shops
  );
end;
$$;

comment on function public.process_sms_stop(text) is
  'Atomic STOP handler (2026-07-18, code-review #1). In one transaction: revokes active marketing sms_consents AND suppresses transactional appointment SMS (inserts sms_appointment_opt_outs for every shop the phone was messaged from). Called by telnyx-webhook on inbound STOP. Returns { revoked_count, opt_out_shops }.';

revoke all on function public.process_sms_stop(text) from public, anon, authenticated;
grant execute on function public.process_sms_stop(text) to service_role;

commit;
