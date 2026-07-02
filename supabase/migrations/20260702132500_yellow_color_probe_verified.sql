-- =====================================================================
-- yellow joins the probe-verified Tekmetric color set (D8 gate widening)
-- =====================================================================
-- EMPIRICAL PROBE (2026-07-02, via tekmetric-api-testing, shop 7476):
--   POST /appointments { color: "yellow" } → 200, appointment 65743262
--   GET  /appointments/65743262 → color stored as "#FCB70D" (the exact hex
--        appointments-sync's classifier maps to the loaner convention)
--   DELETE /appointments/65743262 → 200 (probe cleaned up)
-- Yellow write-persistence is CONFIRMED — activating a yellow appointment
-- type (loaner) is now allowed. Re-issues scheduler_set_appointment_type
-- with the widened v_probed array; body otherwise identical to 20260702041000.

create or replace function public.scheduler_set_appointment_type(
  p_shop_id integer, p_actor text, p_type jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text := btrim(coalesce(p_type->>'slug', ''));
  v_old public.scheduler_appointment_types%rowtype;
  v_new public.scheduler_appointment_types%rowtype;
  v_is_insert boolean;
  -- red/navy/orange: 18-probe pass 2026-05-16; yellow: probe 2026-07-02
  -- (appointment 65743262, POST yellow → #FCB70D, deleted after verify).
  v_probed constant text[] := array['red','navy','orange','yellow'];
  v_active boolean;
  v_color text;
begin
  if v_slug = '' then raise exception 'slug_required'; end if;

  select * into v_old from public.scheduler_appointment_types
   where shop_id = p_shop_id and slug = v_slug
   for update;
  v_is_insert := not found;

  if not v_is_insert and p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  v_active := coalesce((p_type->>'active')::boolean, case when v_is_insert then true else v_old.active end);
  v_color := coalesce(p_type->>'tekmetric_color', case when v_is_insert then null else v_old.tekmetric_color end);
  if v_active and not (v_color = any(v_probed)) then
    raise exception 'color_not_write_probed: % (activation requires a probe-verified Tekmetric color)', v_color;
  end if;

  if v_is_insert then
    insert into public.scheduler_appointment_types
      (shop_id, slug, label, card_title, card_description, emoji,
       tekmetric_color, requires_time_slot, is_system, active, sort, updated_by_email)
    values
      (p_shop_id, v_slug,
       coalesce(p_type->>'label', initcap(replace(v_slug, '_', ' '))),
       coalesce(p_type->>'card_title', initcap(replace(v_slug, '_', ' '))),
       p_type->>'card_description',
       p_type->>'emoji',
       v_color,
       false,   -- v1 capacity rule: custom types are never time-slotted
       false,
       v_active,
       coalesce((p_type->>'sort')::integer, 100),
       p_actor)
    returning * into v_new;
  else
    update public.scheduler_appointment_types set
      label = coalesce(p_type->>'label', label),
      card_title = coalesce(p_type->>'card_title', card_title),
      card_description = case when p_type ? 'card_description' then p_type->>'card_description' else card_description end,
      emoji = case when p_type ? 'emoji' then p_type->>'emoji' else emoji end,
      tekmetric_color = case when p_type ? 'tekmetric_color' then p_type->>'tekmetric_color' else tekmetric_color end,
      active = v_active,
      sort = coalesce((p_type->>'sort')::integer, sort),
      updated_by_email = p_actor
    where shop_id = p_shop_id and slug = v_slug
    returning * into v_new;
  end if;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'scheduler_appointment_types', 'appointment_types',
    case when v_is_insert then 1 else 0 end,
    case when v_is_insert then 0 else 1 end,
    case when not v_is_insert and v_old.active and not v_new.active then 1 else 0 end,
    jsonb_build_object('slug', v_slug, 'via', 'webform'),
    case when v_is_insert then null else to_jsonb(v_old) end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;
