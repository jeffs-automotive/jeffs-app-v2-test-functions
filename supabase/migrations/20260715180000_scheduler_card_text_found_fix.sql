-- =====================================================================
-- scheduler_set_card_text — fix insert/update classification (found bug)
-- =====================================================================
-- Review finding (supabase-compliance, 2026-07-15): the original
-- scheduler_set_card_text (20260715150000) keyed its audit-row classification
-- on `found` re-read AFTER the INSERT/UPDATE ran. But per PL/pgSQL, INSERT
-- also sets FOUND=true — so on the INSERT branch (a brand-new slot) the audit
-- row was mislabeled rows_added=0/rows_modified=1 and snapshotted an
-- unassigned %rowtype instead of NULL. Data was never wrong; only audit
-- classification. App-unreachable today (setCardTextAction refuses unseeded
-- slots), but corrected here to match the appointment-types/message-templates
-- precedent (`v_is_insert := not found;` captured right after the SELECT).
--
-- CREATE OR REPLACE (the original migration is already applied); signature +
-- grants unchanged.

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
  v_is_insert boolean;
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
  -- Capture the insert-vs-update decision NOW, before any statement resets FOUND.
  v_is_insert := not found;

  if not v_is_insert then
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
    case when v_is_insert then 1 else 0 end,   -- rows_added
    case when v_is_insert then 0 else 1 end,   -- rows_modified
    0,                                          -- rows_deactivated
    jsonb_build_object('card_key', p_card_key, 'slot_key', p_slot_key, 'via', 'webform'),
    case when v_is_insert then null else to_jsonb(v_old) end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

revoke all on function public.scheduler_set_card_text(integer,text,text,text,text,text,text,text[],integer,timestamptz) from public, anon, authenticated;
grant execute on function public.scheduler_set_card_text(integer,text,text,text,text,text,text,text[],integer,timestamptz) to service_role;
