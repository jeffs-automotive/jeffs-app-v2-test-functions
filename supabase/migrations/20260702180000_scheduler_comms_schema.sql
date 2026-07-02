-- =====================================================================
-- Scheduler comms schema — consent ledger + message ledger + reminder
-- idempotency + appointments contact columns (revamp Phase 1)
-- =====================================================================
-- docs/scheduler/comms-phases-1-3-plan-2026-07-02.md. SMS consent is the
-- P0 go-live blocker (REVAMP-PLAN §4b/§8.2): no marketing-adjacent send
-- (confirmation/reminder) may fire without an ACTIVE granted row here.
-- OTP keeps its own consent basis (customer explicitly requests the code)
-- and is NOT gated on this ledger.
--
-- Conventions: shop_id INTEGER (Tekmetric shop id — this repo's scheduler
-- tables predate the shops-table follow-up), TEXT/TIMESTAMPTZ/uuid PKs,
-- plaintext PII per REVAMP-PLAN §6 (the pgcrypto rule is aspirational —
-- do NOT add encryption scope here), deny-all RLS, pgTAP row-count tests
-- in supabase/tests/database/scheduler_comms_schema.test.sql.

-- ---------------------------------------------------------------------
-- 1. sms_consents — the TCPA/CTIA proof-of-consent ledger (P0)
-- ---------------------------------------------------------------------
-- Append-then-revoke history: a grant INSERTs a row; a revoke UPDATEs ONLY
-- revoked_at/revoke_source on the active row (enforced by trigger below).
-- One ACTIVE (revoked_at IS NULL) row per (shop_id, phone_e164).
create table public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  shop_id integer not null check (shop_id > 0),
  phone_e164 text not null check (phone_e164 ~ '^\+1[0-9]{10}$'),
  -- The EXACT disclosure copy rendered to the consenter + its version —
  -- TCPA proof-of-consent requires storing what the customer actually saw.
  cta_text text not null,
  cta_version text not null,
  acquisition_medium text not null
    check (acquisition_medium in ('wizard_checkbox', 'sms_start', 'staff')),
  -- Who consented (entered name / staff label) + capture context.
  consenter_label text,
  chat_session_id uuid references public.customer_chat_sessions(id) on delete set null,
  consent_ip text,
  user_agent text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_source text
    check (revoke_source in ('sms_stop', 'staff', 'wizard')),
  -- revoke fields travel together.
  check ((revoked_at is null) = (revoke_source is null)),
  created_at timestamptz not null default now()
);

comment on table public.sms_consents is
  'TCPA/CTIA SMS consent ledger (revamp Phase 1). One ACTIVE row per (shop_id, phone_e164); STOP revokes (never deletes). cta_text stores the exact rendered disclosure. Confirmation/reminder SMS senders MUST check for an active row; OTP is exempt (own consent basis). PII — service_role only.';

-- One active consent per phone per shop.
create unique index sms_consents_active_key
  on public.sms_consents (shop_id, phone_e164)
  where revoked_at is null;

create index sms_consents_phone_idx
  on public.sms_consents (phone_e164, granted_at desc);

-- History integrity: granted rows are immutable except for the revoke pair.
create or replace function public.sms_consents_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.id, new.shop_id, new.phone_e164, new.cta_text, new.cta_version,
      new.acquisition_medium, new.consenter_label, new.chat_session_id,
      new.consent_ip, new.user_agent, new.granted_at, new.created_at)
     is distinct from
     (old.id, old.shop_id, old.phone_e164, old.cta_text, old.cta_version,
      old.acquisition_medium, old.consenter_label, old.chat_session_id,
      old.consent_ip, old.user_agent, old.granted_at, old.created_at) then
    raise exception 'sms_consents rows are append-then-revoke: only revoked_at/revoke_source may change';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'sms_consents: a revoked row cannot be re-opened or re-revoked';
  end if;
  return new;
end;
$$;

create trigger sms_consents_guard_update_trg
  before update on public.sms_consents
  for each row execute function public.sms_consents_guard_update();

alter table public.sms_consents enable row level security;
revoke all on table public.sms_consents from anon, authenticated;
revoke delete, truncate on table public.sms_consents from service_role;

-- ---------------------------------------------------------------------
-- 2. sms_messages — outbound/inbound SMS ledger
-- ---------------------------------------------------------------------
create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id integer not null check (shop_id > 0),
  direction text not null check (direction in ('outbound', 'inbound')),
  phone_e164 text not null,
  kind text not null
    check (kind in ('otp', 'confirmation', 'reminder_24h', 'reminder_2h', 'inbound')),
  -- NEVER store a live OTP code: kind='otp' rows keep body NULL.
  body text,
  check (kind <> 'otp' or body is null),
  telnyx_message_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  status_detail text,
  tekmetric_appointment_id bigint,
  chat_session_id uuid references public.customer_chat_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sms_messages is
  'Outbound + inbound SMS ledger (revamp Phase 1). DLR consumer updates status by telnyx_message_id. OTP rows never store the code body. PII — service_role only.';

create unique index sms_messages_telnyx_id_key
  on public.sms_messages (telnyx_message_id)
  where telnyx_message_id is not null;
create index sms_messages_phone_idx
  on public.sms_messages (phone_e164, created_at desc);
create index sms_messages_appt_idx
  on public.sms_messages (tekmetric_appointment_id)
  where tekmetric_appointment_id is not null;

alter table public.sms_messages enable row level security;
revoke all on table public.sms_messages from anon, authenticated;
revoke delete, truncate on table public.sms_messages from service_role;

-- ---------------------------------------------------------------------
-- 3. scheduler_reminders — send-idempotency ledger (claim-then-send)
-- ---------------------------------------------------------------------
-- The UNIQUE key is the ON CONFLICT DO NOTHING anchor: the sender claims
-- (appointment, kind, channel) FIRST; only the claimer sends. A 'skipped'
-- row documents WHY nothing was sent (consent/quiet-hours/contact gaps) so
-- coverage is auditable.
create table public.scheduler_reminders (
  id uuid primary key default gen_random_uuid(),
  shop_id integer not null check (shop_id > 0),
  tekmetric_appointment_id bigint not null,
  reminder_kind text not null
    check (reminder_kind in ('confirmation', 'reminder_24h', 'reminder_2h')),
  channel text not null check (channel in ('sms', 'email')),
  status text not null
    check (status in ('claimed', 'sent', 'skipped', 'failed')),
  skip_reason text
    check (skip_reason in ('no_consent', 'quiet_hours', 'no_contact',
                           'stale_appointment', 'provider_stub', 'no_template')),
  check (status <> 'skipped' or skip_reason is not null),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tekmetric_appointment_id, reminder_kind, channel)
);

comment on table public.scheduler_reminders is
  'Per-(appointment, kind, channel) send-idempotency ledger (revamp Phase 3). INSERT ... ON CONFLICT DO NOTHING is the claim; only the claimer sends. skipped rows carry the reason for auditability.';

create index scheduler_reminders_appt_idx
  on public.scheduler_reminders (tekmetric_appointment_id);
create index scheduler_reminders_status_idx
  on public.scheduler_reminders (status, created_at desc);

alter table public.scheduler_reminders enable row level security;
revoke all on table public.scheduler_reminders from anon, authenticated;
revoke delete, truncate on table public.scheduler_reminders from service_role;

-- ---------------------------------------------------------------------
-- 4. appointments — denormalized contact columns (app-booked first)
-- ---------------------------------------------------------------------
-- REVAMP-PLAN §4d: the shadow has no phone/email. App-booked appointments
-- copy the verified session contact at confirm time; the staff-booked
-- Tekmetric backfill (getCustomerById) is the fast-follow, gated on the
-- §12 staff-consent decision. Plaintext per §6.
alter table public.appointments
  add column if not exists customer_phone_e164 text,
  add column if not exists customer_email text,
  add column if not exists customer_first_name text,
  add column if not exists contact_source text
    check (contact_source in ('session', 'tekmetric')),
  add column if not exists contact_synced_at timestamptz;

comment on column public.appointments.customer_phone_e164 is
  'Denormalized reminder contact (revamp Phase 1). source=session: copied from the verified booking session at confirm. PII — service_role only (RLS already deny-all).';
