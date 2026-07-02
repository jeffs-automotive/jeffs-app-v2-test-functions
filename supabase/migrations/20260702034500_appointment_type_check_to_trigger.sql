-- =====================================================================
-- appointment_type: CHECK → slug-exists validation trigger (B5, contract)
-- =====================================================================
-- Final step of the expand/migrate/contract sequence for dynamic
-- appointment types (docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md
-- §2 + §9.5). Preconditions ALL LIVE before this migration:
--   B2 — both color→type classifiers are table-driven,
--   B3 — the wizard card + submit validator read/validate active slugs,
--   B4 — booking color/lane/labels come from the table.
--
-- The three 2-value CHECK constraints are replaced by ONE BEFORE-write
-- trigger validating appointment_type against scheduler_appointment_types
-- (ANY row for the shop, active or not — historical slugs stay writable by
-- sync/reads; ACTIVATION gating happens in the wizard/admin layer). This
-- keeps a real database guardrail (cross-verify overruled bare app-layer
-- enforcement: ADR-016 makes service-role callers the trust boundary)
-- while letting shops create new types without DDL.
--
-- NULL stays allowed where it was allowed (sessions pre-Step-8; the two
-- NOT NULL columns keep their own NOT NULL).

create or replace function public.scheduler_appt_type_slug_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.appointment_type is null then
    return new;
  end if;
  if exists (
    select 1 from public.scheduler_appointment_types t
    where t.shop_id = new.shop_id and t.slug = new.appointment_type
  ) then
    return new;
  end if;
  raise exception 'appointment_type_invalid: "%" is not a scheduler_appointment_types slug for shop %',
    new.appointment_type, new.shop_id;
end;
$$;
revoke all on function public.scheduler_appt_type_slug_valid() from public;

alter table public.appointments
  drop constraint appointments_appointment_type_check;
create trigger appointments_appt_type_valid
  before insert or update of appointment_type on public.appointments
  for each row execute function public.scheduler_appt_type_slug_valid();

alter table public.appointment_holds
  drop constraint appointment_holds_appointment_type_check;
create trigger appointment_holds_appt_type_valid
  before insert or update of appointment_type on public.appointment_holds
  for each row execute function public.scheduler_appt_type_slug_valid();

alter table public.customer_chat_sessions
  drop constraint customer_chat_sessions_appointment_type_check;
create trigger customer_chat_sessions_appt_type_valid
  before insert or update of appointment_type on public.customer_chat_sessions
  for each row execute function public.scheduler_appt_type_slug_valid();
