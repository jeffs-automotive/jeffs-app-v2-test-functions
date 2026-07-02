-- =====================================================================
-- scheduler_appointment_types — DB-driven appointment types (sub-feature B)
-- =====================================================================
-- Plan: docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md §2 (+ §9
-- cross-verify amendments). EXPAND step of expand/migrate/contract: this
-- migration only CREATES + SEEDS — the three appointment_type CHECK
-- constraints on appointment_holds/appointments/customer_chat_sessions stay
-- until the readers/writers are table-driven (B5 swaps them for a
-- slug-exists trigger).
--
-- Two documented deviations from the plan sketch (both critic-driven):
--   1. label is split into label (short: "Wait" — transcript/staff surfaces,
--      today hardcoded in transcript-dispatcher.ts:613) + card_title /
--      card_description (the wizard card's long copy, today TYPE_META in
--      AppointmentTypeCard.tsx). Seeds reproduce the live copy byte-for-byte
--      so the payload-driven card renders IDENTICALLY.
--   2. tekmetric_color CHECK includes 'yellow' (the loaner row is seeded
--      inactive and the classifiers must know its color) even though yellow
--      is not yet write-probed — ACTIVATING a type is what requires a probed
--      color, enforced at the admin RPC/action layer in sub-feature A.
--
-- Capacity rule (v1): requires_time_slot only on the system waiter row —
-- enforced by CHECK (hold_waiter_slot's advisory-lock key is type-scoped;
-- two waitable types could race the shared 8/9 AM lane).
--
-- Edit model: rows are edited IN PLACE (stable id — templates FK it in
-- sub-feature C; history = scheduler_admin_audit_log). DELETE is always
-- refused (deactivate instead); slug and is_system are immutable; system
-- rows additionally freeze color/requires_time_slot and cannot deactivate.

create table public.scheduler_appointment_types (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            integer not null check (shop_id > 0),
  slug               text not null check (slug ~ '^[a-z0-9_]{2,40}$'),
  label              text not null check (length(btrim(label)) between 1 and 30),
  card_title         text not null check (length(btrim(card_title)) between 1 and 60),
  card_description   text check (card_description is null or length(card_description) <= 300),
  emoji              text check (emoji is null or length(emoji) <= 16),
  tekmetric_color    text not null check (tekmetric_color in ('red','navy','orange','yellow')),
  requires_time_slot boolean not null default false,
  is_system          boolean not null default false,
  active             boolean not null default true,
  sort               integer not null default 0,
  updated_by_email   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- v1 capacity rule: only the system waiter row is time-slotted.
  constraint scheduler_appt_types_slot_system check (not requires_time_slot or is_system),
  -- composite-FK target for scheduler_message_templates (cross-shop guard, plan §9.1)
  unique (shop_id, id)
);

-- One row per slug EVER (in-place edits; not a partial index).
create unique index scheduler_appt_types_slug_key
  on public.scheduler_appointment_types (shop_id, slug);

-- Color is the Tekmetric classification channel — never ambiguous among
-- ACTIVE types (plan §9.2). Inactive rows may share (classifiers prefer the
-- active row on conflict).
create unique index scheduler_appt_types_one_active_color
  on public.scheduler_appointment_types (shop_id, tekmetric_color) where active;

create index scheduler_appt_types_shop_active_sort
  on public.scheduler_appointment_types (shop_id, active, sort);

comment on table public.scheduler_appointment_types is
  'DB-driven appointment/schedule types (waiter, dropoff, loaner, ...). Wizard reads ACTIVE rows; the color->type classifiers read ALL rows (bookable is a subset of classifiable). Edited in place (stable id); history in scheduler_admin_audit_log. Plan: docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md';

-- ─── updated_at maintenance (plan §9.4 — an unmaintained updated_at makes
--     the webforms'' optimistic staleness check silently useless) ──────────
create or replace function public.scheduler_appt_types_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.scheduler_appt_types_touch() from public;

create trigger scheduler_appt_types_touch_updated_at
  before update on public.scheduler_appointment_types
  for each row execute function public.scheduler_appt_types_touch();

-- ─── protection trigger (plan §2 + §9: DELETE refused; slug/is_system
--     immutable; system rows freeze color/requires_time_slot/active) ──────
create or replace function public.scheduler_appt_types_protect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'scheduler_appointment_types: delete_forbidden — deactivate instead (rows are referenced by templates + history)';
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'scheduler_appointment_types: slug_immutable (slug is stored on appointments/holds/sessions)';
  end if;
  if new.is_system is distinct from old.is_system then
    raise exception 'scheduler_appointment_types: is_system_immutable';
  end if;

  if old.is_system then
    if new.tekmetric_color is distinct from old.tekmetric_color then
      raise exception 'scheduler_appointment_types: system_color_frozen (classifiers + booked appointments depend on it)';
    end if;
    if new.requires_time_slot is distinct from old.requires_time_slot then
      raise exception 'scheduler_appointment_types: system_capacity_frozen';
    end if;
    if old.active and not new.active then
      raise exception 'scheduler_appointment_types: system_type_cannot_deactivate (waiter/dropoff are behaviorally load-bearing)';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.scheduler_appt_types_protect() from public;

create trigger scheduler_appt_types_protect
  before update or delete on public.scheduler_appointment_types
  for each row execute function public.scheduler_appt_types_protect();

-- ─── security posture (qteklink_mappings precedent 20260606010000:65-68) ──
alter table public.scheduler_appointment_types enable row level security;
revoke all on table public.scheduler_appointment_types from public, anon, authenticated;
-- service_role: no DELETE/TRUNCATE (the trigger blocks DELETE anyway — belt
-- and braces; deactivation is the only removal path).
revoke delete, truncate on table public.scheduler_appointment_types from service_role;

-- ─── seeds (shop 7476) ────────────────────────────────────────────────────
-- waiter/dropoff copy is BYTE-IDENTICAL to the live TYPE_META in
-- AppointmentTypeCard.tsx + the labels in transcript-dispatcher.ts:613, so
-- the payload-driven card/transcript render unchanged. loaner/tow_in are
-- INACTIVE: not bookable, but the classifiers recognize their colors
-- (appointments-sync/index.ts:140-141 conventions).
insert into public.scheduler_appointment_types
  (shop_id, slug, label, card_title, card_description, emoji, tekmetric_color,
   requires_time_slot, is_system, active, sort)
values
  (7476, 'waiter', 'Wait', 'Wait while we work',
   'Grab a coffee — most waiter jobs are 30 to 60 minutes. Available at 8 AM or 9 AM.',
   '☕', 'red', true, true, true, 10),
  (7476, 'dropoff', 'Drop-off', 'Drop off in the morning',
   'Drop your car off by 10 AM. We''ll text or call when it''s ready.',
   '🚗', 'navy', false, true, true, 20),
  (7476, 'loaner', 'Loaner', 'Drive one of ours',
   'Drop your car off and take one of our loaner vehicles while we work.',
   '🔑', 'yellow', false, false, false, 30),
  (7476, 'tow_in', 'Tow-in', 'Have it towed in',
   'Your vehicle arrives by tow — we''ll take it from there.',
   '🛻', 'orange', false, false, false, 40);
