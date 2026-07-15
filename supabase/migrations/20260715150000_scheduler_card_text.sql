-- =====================================================================
-- scheduler_card_text — editable "main copy" for the wizard cards
-- =====================================================================
-- Feature: card-text-editor (docs/scheduler/card-text-editor-plan.md).
-- Lets admin staff edit the WORDING on each customer-wizard card (eyebrow /
-- title / description / footnote + a few in-body prose lines) from the
-- /schedulerconfig "Card Text" tab — WITHOUT changing layout or buttons.
--
-- Modeled on scheduler_appointment_types (20260702031500): the wizard reads
-- ACTIVE rows through a 5-min-cached loader (scheduler-app card-text.ts) with
-- a byte-identical hardcoded fallback (CARD_TEXT_DEFAULTS), so a config-table
-- outage can never blank a card. Edited IN PLACE (stable id per
-- (shop_id, card_key, slot_key)); history lives in scheduler_admin_audit_log.
--
-- Design decisions (plan §2/§4 + cross-verify §12):
--   * `body` is the current (editable) copy; may contain {{merge_field}}
--     tokens. `default_body` is the immutable seed copy -> "Reset to default".
--   * The write RPC is an UPSERT (not a bare UPDATE) so a shop/slot with no
--     row yet still persists — the structural fields (label/default_body/
--     allowed_merge_fields/sort) are carried by the admin action from its
--     manifest and used on the INSERT branch (cross-verify §12.1).
--   * Merge-field VALIDATION is app-side (fail-closed at save + fail-safe at
--     render); the DB just stores each slot's allowed set. `body` length is
--     capped (§12.5) to stop a pasted mega-payload bloating the cache/render.
--
-- This migration CREATES + seeds the mechanism plus the first card (greeting).
-- Remaining cards are seeded by follow-on migrations as their components are
-- migrated (all landing before the single verify+deploy).

create table public.scheduler_card_text (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              integer not null check (shop_id > 0),
  -- card_key === WizardCard.step (card-payloads.ts); slot_key names a copy
  -- slot on that card (eyebrow/title/description/footnote/body_*).
  card_key             text not null check (card_key ~ '^[a-z0-9_]{2,60}$'),
  slot_key             text not null check (slot_key ~ '^[a-z0-9_]{2,60}$'),
  -- Human field label shown in the editor ("Title", "Recording notice").
  label                text not null check (length(btrim(label)) between 1 and 80),
  -- Current (editable) copy; may contain {{merge_field}} tokens. Length cap
  -- per cross-verify §12.5.
  body                 text not null check (length(body) <= 2000),
  -- Immutable original copy -> "Reset to default". Set once at insert.
  default_body         text not null check (length(default_body) <= 2000),
  -- Whitelist of merge-field tokens allowed on THIS slot (subset of the
  -- global set the app renderer knows). Empty = a static line.
  allowed_merge_fields text[] not null default '{}',
  -- Slot order within the card (editor + preview layout).
  sort                 integer not null default 0,
  active               boolean not null default true,
  updated_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (shop_id, card_key, slot_key)
);

create index scheduler_card_text_shop_card
  on public.scheduler_card_text (shop_id, card_key, sort);

comment on table public.scheduler_card_text is
  'Editable "main copy" for the customer wizard cards (eyebrow/title/description/footnote + in-body prose). Wizard reads ACTIVE rows via the 5-min-cached loader (scheduler-app card-text.ts) with a hardcoded fallback; edited in place (stable id per shop_id+card_key+slot_key), history in scheduler_admin_audit_log. Plan: docs/scheduler/card-text-editor-plan.md';

-- ─── updated_at maintenance (plan §4; an unmaintained updated_at makes the
--     webform''s optimistic staleness check silently useless) ───────────────
create or replace function public.scheduler_card_text_touch()
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
revoke all on function public.scheduler_card_text_touch() from public;

create trigger scheduler_card_text_touch_updated_at
  before update on public.scheduler_card_text
  for each row execute function public.scheduler_card_text_touch();

-- ─── protection trigger (cross-verify §12.4): refuse DELETE (deactivate
--     instead); freeze slot identity (card_key/slot_key). default_body is left
--     mutable so a future migration can correct a default; the app never
--     writes it (the set RPC touches only `body`), and only service_role can
--     reach the table — so "Reset to default" stays trustworthy. ───────────
create or replace function public.scheduler_card_text_protect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'scheduler_card_text: delete_forbidden — deactivate instead (rows are the editable-copy source of truth)';
  end if;
  if new.card_key is distinct from old.card_key then
    raise exception 'scheduler_card_text: card_key_immutable';
  end if;
  if new.slot_key is distinct from old.slot_key then
    raise exception 'scheduler_card_text: slot_key_immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.scheduler_card_text_protect() from public;

create trigger scheduler_card_text_protect
  before update or delete on public.scheduler_card_text
  for each row execute function public.scheduler_card_text_protect();

-- ─── write RPC: UPSERT one slot's body (edit-in-place) ─────────────────────
-- INSERT-or-UPDATE on (shop_id, card_key, slot_key). Optimistic concurrency:
-- when p_expected_updated_at is provided and the live row's updated_at differs,
-- raise 'stale_write: …' (last-write-wins is NOT silent). The config change +
-- its manual_change audit row commit in the SAME transaction.
create or replace function public.scheduler_set_card_text(
  p_shop_id integer,
  p_actor text,
  p_card_key text,
  p_slot_key text,
  p_body text,
  p_label text,
  p_default_body text,
  p_allowed_merge_fields text[],
  p_sort integer,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.scheduler_card_text%rowtype;
  v_new public.scheduler_card_text%rowtype;
begin
  if p_shop_id is null or p_shop_id <= 0 then
    raise exception 'invalid_shop_id';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'invalid_actor';
  end if;

  select * into v_old
    from public.scheduler_card_text
   where shop_id = p_shop_id and card_key = p_card_key and slot_key = p_slot_key
   for update;

  if found then
    if p_expected_updated_at is not null
       and v_old.updated_at is distinct from p_expected_updated_at then
      raise exception 'stale_write: row changed at % (expected %)',
        v_old.updated_at, p_expected_updated_at;
    end if;
    update public.scheduler_card_text
       set body = p_body, active = true, updated_by_email = p_actor
     where id = v_old.id
     returning * into v_new;
  else
    insert into public.scheduler_card_text
      (shop_id, card_key, slot_key, label, body, default_body,
       allowed_merge_fields, sort, active, updated_by_email)
    values
      (p_shop_id, p_card_key, p_slot_key,
       coalesce(nullif(btrim(coalesce(p_label, '')), ''), p_slot_key),
       p_body, coalesce(p_default_body, p_body),
       coalesce(p_allowed_merge_fields, '{}'), coalesce(p_sort, 0), true, p_actor)
     returning * into v_new;
  end if;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'scheduler_card_text', 'card_text',
    case when found then 0 else 1 end,   -- rows_added
    case when found then 1 else 0 end,   -- rows_modified
    0,                                    -- rows_deactivated
    jsonb_build_object('card_key', p_card_key, 'slot_key', p_slot_key, 'via', 'webform'),
    case when found then to_jsonb(v_old) else null end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── reset RPC: restore a slot's body to its default_body ──────────────────
create or replace function public.scheduler_reset_card_text(
  p_shop_id integer,
  p_actor text,
  p_card_key text,
  p_slot_key text,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.scheduler_card_text%rowtype;
  v_new public.scheduler_card_text%rowtype;
begin
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'invalid_actor';
  end if;

  select * into v_old
    from public.scheduler_card_text
   where shop_id = p_shop_id and card_key = p_card_key and slot_key = p_slot_key
   for update;
  if not found then
    raise exception 'card_text_slot_not_found';
  end if;
  if p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)',
      v_old.updated_at, p_expected_updated_at;
  end if;

  update public.scheduler_card_text
     set body = v_old.default_body, updated_by_email = p_actor
   where id = v_old.id
   returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'scheduler_card_text', 'card_text',
    0, 1, 0,
    jsonb_build_object('card_key', p_card_key, 'slot_key', p_slot_key,
                       'via', 'webform', 'reset', true),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── grants (appointment-types precedent 20260702031500:129-134) ───────────
alter table public.scheduler_card_text enable row level security;
revoke all on table public.scheduler_card_text from public, anon, authenticated;
-- service_role reaches the table (RLS-bypass); the app enforces shop scoping +
-- requireAdmin. No DELETE/TRUNCATE (the protect trigger blocks DELETE anyway).
revoke delete, truncate on table public.scheduler_card_text from service_role;

revoke all on function public.scheduler_set_card_text(integer,text,text,text,text,text,text,text[],integer,timestamptz) from public, anon, authenticated;
grant execute on function public.scheduler_set_card_text(integer,text,text,text,text,text,text,text[],integer,timestamptz) to service_role;
revoke all on function public.scheduler_reset_card_text(integer,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.scheduler_reset_card_text(integer,text,text,text,timestamptz) to service_role;

-- ─── seeds (shop 7476) — byte-identical to the current component literals ──
-- so the payload-driven card renders IDENTICALLY on day one. body = default_body
-- at seed; editing changes body, "Reset to default" restores default_body.
-- Card: greeting (GreetingCard.tsx). Remaining cards seeded by follow-on
-- migrations as their components are migrated.
insert into public.scheduler_card_text
  (shop_id, card_key, slot_key, label, body, default_body, allowed_merge_fields, sort)
values
  (7476, 'greeting', 'eyebrow', 'Eyebrow',
   'Welcome', 'Welcome', '{}', 10),
  (7476, 'greeting', 'title', 'Title',
   'Hi, I''m {{agent_name}} 👋', 'Hi, I''m {{agent_name}} 👋', '{agent_name}', 20),
  (7476, 'greeting', 'description', 'Description',
   'I''m the AI scheduling assistant for {{shop_name}}. I''ll walk you through booking an appointment in just a few steps.',
   'I''m the AI scheduling assistant for {{shop_name}}. I''ll walk you through booking an appointment in just a few steps.',
   '{shop_name}', 30),
  (7476, 'greeting', 'body_disclosure', 'Recording notice',
   'Heads up — this conversation is recorded and reviewed by our team to make sure we''re taking good care of you.',
   'Heads up — this conversation is recorded and reviewed by our team to make sure we''re taking good care of you.',
   '{}', 40),
  (7476, 'greeting', 'body_question', 'Returning-customer question',
   'Have you been to our shop before?', 'Have you been to our shop before?', '{}', 50),
  (7476, 'greeting', 'footnote', 'Footnote',
   'Need a human instead? Tap "Talk to a person" below — no problem. 📞',
   'Need a human instead? Tap "Talk to a person" below — no problem. 📞',
   '{}', 60);
