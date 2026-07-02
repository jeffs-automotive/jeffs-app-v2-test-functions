-- =====================================================================
-- scheduler_message_templates — per-type customer comms templates (C)
-- =====================================================================
-- Plan §4 + §9 amendments (docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md).
-- Stores {{merge_field}} templated TEXT (never HTML) per
-- (appointment type × kind × channel). NULL type_id = the shop-level
-- fallback default — what makes a NEW type resolve working comms
-- immediately. RESOLUTION works from day one; actual SENDING stays gated on
-- the consent ledger + transports (revamp Phases 1-3) — the confirmation/
-- reminder senders do not exist yet by design. OTP is NOT templated
-- (hardcoded in scheduler-otp.ts per Chris).

create table public.scheduler_message_templates (
  id          uuid primary key default gen_random_uuid(),
  shop_id     integer not null check (shop_id > 0),
  type_id     uuid,   -- NULL = shop-level fallback default
  kind        text not null check (kind in ('confirmation','reminder_24h','reminder_2h')),
  channel     text not null check (channel in ('sms','email')),
  subject     text,
  body        text not null check (length(btrim(body)) > 0),
  active      boolean not null default true,
  updated_by_email text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- COMPOSITE FK (§9.1): a template can only reference ITS OWN shop's type.
  foreign key (shop_id, type_id)
    references public.scheduler_appointment_types (shop_id, id) on delete restrict,
  -- email requires a subject; SMS forbids one (§9.10).
  constraint scheduler_msg_tpl_subject_channel check (
    (channel = 'email' and subject is not null and length(btrim(subject)) > 0)
    or (channel = 'sms' and subject is null)
  )
);

-- ONE ACTIVE per (type-scope, kind, channel); the zero-uuid stands in for
-- the NULL shop-default scope. Writes are RPC-only (deactivate-then-insert
-- = edit history) — this expression index is deliberately NOT an upsert
-- target (PostgREST cannot address it; same 42P10 class as the webhook
-- tables).
create unique index scheduler_msg_tpl_one_active
  on public.scheduler_message_templates
     (shop_id, coalesce(type_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, channel)
  where active;

create index scheduler_msg_tpl_shop_kind
  on public.scheduler_message_templates (shop_id, kind, channel) where active;

comment on table public.scheduler_message_templates is
  'Customer confirmation/reminder templates per appointment type x kind x channel. {{merge_field}} TEXT bodies (whitelist-rendered, never eval/HTML). NULL type_id = shop default (fallback). History via active=false rows. Sends gated on consent (revamp P1-3).';

-- updated_at maintenance (staleness checks)
create trigger scheduler_msg_tpl_touch_updated_at
  before update on public.scheduler_message_templates
  for each row execute function public.scheduler_appt_types_touch();

alter table public.scheduler_message_templates enable row level security;
revoke all on table public.scheduler_message_templates from public, anon, authenticated;
revoke delete, truncate on table public.scheduler_message_templates from service_role;

-- ─── write RPC (deactivate-then-insert; audit in same transaction) ─────────
create or replace function public.scheduler_set_message_template(
  p_shop_id integer, p_actor text,
  p_type_id uuid,          -- NULL = shop default row
  p_kind text, p_channel text,
  p_subject text, p_body text,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.scheduler_message_templates%rowtype;
  v_new public.scheduler_message_templates%rowtype;
begin
  if p_type_id is not null then
    if not exists (select 1 from public.scheduler_appointment_types t
                   where t.id = p_type_id and t.shop_id = p_shop_id) then
      raise exception 'type_not_found_for_shop';
    end if;
  end if;

  select * into v_old from public.scheduler_message_templates
   where shop_id = p_shop_id and kind = p_kind and channel = p_channel and active
     and coalesce(type_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;

  if found and p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  if found then
    update public.scheduler_message_templates
       set active = false, updated_by_email = p_actor
     where id = v_old.id;
  end if;

  insert into public.scheduler_message_templates
    (shop_id, type_id, kind, channel, subject, body, active, updated_by_email)
  values
    (p_shop_id, p_type_id, p_kind, p_channel,
     nullif(btrim(coalesce(p_subject, '')), ''), p_body, true, p_actor)
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'scheduler_message_templates', 'message_templates',
    case when v_old.id is null then 1 else 0 end,
    case when v_old.id is null then 0 else 1 end,
    0,
    jsonb_build_object('type_id', p_type_id, 'kind', p_kind, 'channel', p_channel, 'via', 'webform'),
    case when v_old.id is null then null else to_jsonb(v_old) end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

revoke all on function public.scheduler_set_message_template(integer,text,uuid,text,text,text,text,timestamptz) from public;
revoke all on function public.scheduler_set_message_template(integer,text,uuid,text,text,text,text,timestamptz) from anon, authenticated;
grant execute on function public.scheduler_set_message_template(integer,text,uuid,text,text,text,text,timestamptz) to service_role;

-- ─── shop-default seeds (shop 7476) — all 6 kind×channel combos ────────────
-- Transactional voice; brand name in every SMS body; "Reply STOP" kept as
-- belt-and-braces beyond profile-level opt-out; merge fields are the
-- renderer whitelist (plan §4).
insert into public.scheduler_message_templates (shop_id, type_id, kind, channel, subject, body) values
  (7476, null, 'confirmation', 'sms', null,
   'Jeff''s Automotive: Your {{appointment_type_label}} appointment is confirmed for {{appointment_date}}{{appointment_time_suffix}}. Questions? Call {{shop_phone}}. Reply STOP to opt out.'),
  (7476, null, 'reminder_24h', 'sms', null,
   'Jeff''s Automotive: Reminder — your {{appointment_type_label}} appointment is tomorrow, {{appointment_date}}{{appointment_time_suffix}}. Need to reschedule? Call {{shop_phone}}. Reply STOP to opt out.'),
  (7476, null, 'reminder_2h', 'sms', null,
   'Jeff''s Automotive: See you soon — your {{appointment_type_label}} appointment is today{{appointment_time_suffix}}. Call {{shop_phone}} if anything changes. Reply STOP to opt out.'),
  (7476, null, 'confirmation', 'email', 'Your appointment is confirmed — Jeff''s Automotive',
   'Hi {{first_name}},' || E'\n\n' ||
   'Your {{appointment_type_label}} appointment at Jeff''s Automotive is confirmed for {{appointment_date}}{{appointment_time_suffix}}.' || E'\n\n' ||
   'Vehicle: {{vehicle}}' || E'\n' || 'Services: {{services_summary}}' || E'\n\n' ||
   'Questions or changes? Call us at {{shop_phone}}.'),
  (7476, null, 'reminder_24h', 'email', 'Appointment reminder — Jeff''s Automotive',
   'Hi {{first_name}},' || E'\n\n' ||
   'A quick reminder: your {{appointment_type_label}} appointment is tomorrow, {{appointment_date}}{{appointment_time_suffix}}.' || E'\n\n' ||
   'Vehicle: {{vehicle}}' || E'\n\n' || 'Need to reschedule? Call us at {{shop_phone}}.'),
  (7476, null, 'reminder_2h', 'email', 'See you soon — Jeff''s Automotive',
   'Hi {{first_name}},' || E'\n\n' ||
   'See you soon — your {{appointment_type_label}} appointment is today{{appointment_time_suffix}}.' || E'\n\n' ||
   'Call us at {{shop_phone}} if anything changes.');
