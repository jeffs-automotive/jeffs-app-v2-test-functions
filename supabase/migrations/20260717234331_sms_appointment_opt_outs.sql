-- =====================================================================
-- Appointment SMS → transactional + opt-out  (2026-07-17)
-- =====================================================================
-- Appointment confirmation/reminder SMS becomes TRANSACTIONAL (sends by
-- default) instead of opt-IN-gated on sms_consents. This table is the
-- phone-level SUPPRESSION ledger: an ACTIVE row (restored_at IS NULL) means
-- "do not send appointment SMS to this phone." Written by the wizard opt-out
-- checkbox AND by inbound STOP (telnyx-webhook). START restores.
--
-- sms_consents stays as the MARKETING consent ledger (moving to the customer
-- portal). Email is transactional and unaffected. OTP has its own basis.
--
-- Conventions mirror sms_consents (20260702180000): uuid pk, shop_id integer,
-- E.164 phone check, one active row per (shop, phone), RLS service_role-only,
-- append-then-restore immutability guard.
-- =====================================================================

begin;

create table public.sms_appointment_opt_outs (
  id uuid primary key default gen_random_uuid(),
  shop_id integer not null check (shop_id > 0),
  phone_e164 text not null check (phone_e164 ~ '^\+1[0-9]{10}$'),
  source text not null
    check (source in ('wizard_checkbox', 'sms_stop', 'staff')),
  opted_out_at timestamptz not null default now(),
  restored_at timestamptz,
  restore_source text
    check (restore_source in ('sms_start', 'staff', 'wizard')),
  chat_session_id uuid references public.customer_chat_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  -- restore fields travel together.
  check ((restored_at is null) = (restore_source is null))
);

comment on table public.sms_appointment_opt_outs is
  'Transactional appointment-SMS suppression ledger (2026-07-17). An ACTIVE row (restored_at IS NULL) suppresses confirmation/reminder SMS for (shop_id, phone_e164). Written by the wizard opt-out checkbox + inbound STOP; START restores. Confirmation/reminder SMS senders skip when an active row exists. Email + OTP unaffected. PII — service_role only.';

-- One active opt-out per phone per shop.
create unique index sms_appointment_opt_outs_active_key
  on public.sms_appointment_opt_outs (shop_id, phone_e164)
  where restored_at is null;

create index sms_appointment_opt_outs_phone_idx
  on public.sms_appointment_opt_outs (phone_e164, opted_out_at desc);

-- History integrity: an opt-out row is immutable except for the restore pair.
create or replace function public.sms_appointment_opt_outs_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.id, new.shop_id, new.phone_e164, new.source, new.opted_out_at,
      new.chat_session_id, new.created_at)
     is distinct from
     (old.id, old.shop_id, old.phone_e164, old.source, old.opted_out_at,
      old.chat_session_id, old.created_at) then
    raise exception 'sms_appointment_opt_outs: only restored_at/restore_source may change after insert';
  end if;
  if old.restored_at is not null and new.restored_at is distinct from old.restored_at then
    raise exception 'sms_appointment_opt_outs: a restored row cannot be re-opened or re-restored';
  end if;
  return new;
end;
$$;

create trigger sms_appointment_opt_outs_guard_update_trg
  before update on public.sms_appointment_opt_outs
  for each row execute function public.sms_appointment_opt_outs_guard_update();

alter table public.sms_appointment_opt_outs enable row level security;
revoke all on table public.sms_appointment_opt_outs from anon, authenticated;
revoke delete, truncate on table public.sms_appointment_opt_outs from service_role;

-- Proof-of-consent: the disclosure version the customer saw when they
-- proceeded WITHOUT opting out (transactional consent basis). NULL until the
-- session reaches the phone step.
alter table public.customer_chat_sessions
  add column if not exists appointment_sms_disclosure_version text;

-- Extend scheduler_reminders.skip_reason for the new transactional-SMS gate:
--   'opted_out'            — active appointment-SMS opt-out for the phone
--   'opt_out_lookup_failed'— suppression lookup errored → fail closed (no send)
-- (existing 'no_consent' retained for historical rows.)
alter table public.scheduler_reminders
  drop constraint scheduler_reminders_skip_reason_check;
alter table public.scheduler_reminders
  add constraint scheduler_reminders_skip_reason_check
  check (skip_reason in ('no_consent', 'quiet_hours', 'no_contact',
                         'stale_appointment', 'provider_stub', 'no_template',
                         'opted_out', 'opt_out_lookup_failed'));

commit;
