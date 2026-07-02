-- =====================================================================
-- scheduler admin DIRECT-WRITE RPCs (sub-feature A foundation)
-- =====================================================================
-- Plan: docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md §3.
-- The schedulerconfig webforms replace the MD-upload/Pattern-S/orchestrator
-- pipeline. Per the cross-verify amendments (§9.9): ONE SECURITY DEFINER RPC
-- per write surface — the config mutation and its `manual_change` audit row
-- commit in the SAME transaction; the server recomputes diffs from trusted
-- reads; optimistic concurrency via updated_at staleness checks (the tables'
-- updated_at columns are maintained by these RPCs).
--
-- Every RPC:
--   * validates p_shop_id > 0 and scopes every statement by it (the caller —
--     admin-app requireAdmin — is the tenant trust boundary per ADR-016;
--     these RPCs still never cross shops within a call),
--   * REVOKEs PUBLIC/anon/authenticated; service_role EXECUTE only,
--   * raises 'stale_write: …' when p_expected_updated_at is provided and
--     the live row's updated_at differs (last-write-wins is NOT silent),
--   * writes the audit row via scheduler_admin_direct_log(...) with
--     diff_summary.surfaces so the ADR-021 surface filter keeps working.
--
-- The legacy apply_*_upload RPCs + Pattern S machinery stay in place for
-- reading/reverting HISTORICAL uploads only (30-day window), then prune.

-- ─── audit helper ──────────────────────────────────────────────────────────
create or replace function public.scheduler_admin_direct_log(
  p_shop_id integer,
  p_actor text,
  p_table_name text,
  p_surface text,
  p_added integer,
  p_modified integer,
  p_deactivated integer,
  p_diff jsonb,
  p_snapshot jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_shop_id is null or p_shop_id <= 0 then
    raise exception 'invalid_shop_id';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'invalid_actor';
  end if;
  insert into public.scheduler_admin_audit_log
    (shop_id, oauth_client_id, user_label, table_name, operation,
     rows_added, rows_modified, rows_deactivated, diff_summary, pre_state_snapshot)
  values
    (p_shop_id, 'admin_app_direct', p_actor, p_table_name, 'manual_change',
     coalesce(p_added, 0), coalesce(p_modified, 0), coalesce(p_deactivated, 0),
     jsonb_set(coalesce(p_diff, '{}'::jsonb), '{surfaces}',
               coalesce(p_diff->'surfaces', to_jsonb(array[p_surface]))),
     p_snapshot)
  returning id into v_id;
  return v_id;
end;
$$;

-- ─── 1+2. routine / testing service upsert ─────────────────────────────────
create or replace function public.scheduler_admin_upsert_routine_service(
  p_shop_id integer, p_actor text, p_service jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_service->>'service_key', ''));
  v_old public.routine_services%rowtype;
  v_new public.routine_services%rowtype;
  v_is_insert boolean;
begin
  if v_key = '' then raise exception 'service_key_required'; end if;

  select * into v_old from public.routine_services
   where shop_id = p_shop_id and service_key = v_key
   for update;
  v_is_insert := not found;

  if not v_is_insert and p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  insert into public.routine_services as rs
    (shop_id, service_key, display_name, abbreviation, display_order, active,
     wait_eligible, requires_explanation, concern_categories,
     starting_price_cents, price_waived_note, description,
     updated_at, updated_by_oauth_client_id, updated_by_name)
  values
    (p_shop_id, v_key,
     coalesce(p_service->>'display_name', v_key),
     coalesce(p_service->>'abbreviation', upper(left(v_key, 4))),
     coalesce((p_service->>'display_order')::integer, 0),
     coalesce((p_service->>'active')::boolean, true),
     coalesce((p_service->>'wait_eligible')::boolean, false),
     coalesce((p_service->>'requires_explanation')::boolean, false),
     case when p_service ? 'concern_categories'
          then (select array_agg(x) from jsonb_array_elements_text(p_service->'concern_categories') x)
          else null end,
     (p_service->>'starting_price_cents')::integer,
     p_service->>'price_waived_note',
     p_service->>'description',
     now(), 'admin_app_direct', p_actor)
  on conflict (shop_id, service_key) do update set
     display_name = coalesce(excluded.display_name, rs.display_name),
     abbreviation = coalesce(excluded.abbreviation, rs.abbreviation),
     display_order = excluded.display_order,
     active = excluded.active,
     wait_eligible = excluded.wait_eligible,
     requires_explanation = excluded.requires_explanation,
     concern_categories = case when p_service ? 'concern_categories'
                               then excluded.concern_categories else rs.concern_categories end,
     starting_price_cents = case when p_service ? 'starting_price_cents'
                                 then excluded.starting_price_cents else rs.starting_price_cents end,
     price_waived_note = case when p_service ? 'price_waived_note'
                              then excluded.price_waived_note else rs.price_waived_note end,
     description = case when p_service ? 'description'
                        then excluded.description else rs.description end,
     updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'routine_services', 'routine_services',
    case when v_is_insert then 1 else 0 end,
    case when v_is_insert then 0 else 1 end,
    case when not v_is_insert and v_old.active and not v_new.active then 1 else 0 end,
    jsonb_build_object('service_key', v_key, 'via', 'webform'),
    case when v_is_insert then null else to_jsonb(v_old) end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

create or replace function public.scheduler_admin_upsert_testing_service(
  p_shop_id integer, p_actor text, p_service jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_service->>'service_key', ''));
  v_old public.testing_services%rowtype;
  v_new public.testing_services%rowtype;
  v_is_insert boolean;
begin
  if v_key = '' then raise exception 'service_key_required'; end if;

  select * into v_old from public.testing_services
   where shop_id = p_shop_id and service_key = v_key
   for update;
  v_is_insert := not found;

  if v_is_insert and (p_service->>'starting_price_cents') is null then
    raise exception 'starting_price_cents_required';
  end if;
  if not v_is_insert and p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  insert into public.testing_services as ts
    (shop_id, service_key, display_name, abbreviation, starting_price_cents,
     notes, concern_categories, active, description, example_keywords,
     updated_at, updated_by_oauth_client_id, updated_by_name)
  values
    (p_shop_id, v_key,
     coalesce(p_service->>'display_name', v_key),
     coalesce(p_service->>'abbreviation', upper(left(v_key, 4))),
     (p_service->>'starting_price_cents')::integer,
     p_service->>'notes',
     case when p_service ? 'concern_categories'
          then (select array_agg(x) from jsonb_array_elements_text(p_service->'concern_categories') x)
          else null end,
     coalesce((p_service->>'active')::boolean, true),
     p_service->>'description',
     case when p_service ? 'example_keywords'
          then (select array_agg(x) from jsonb_array_elements_text(p_service->'example_keywords') x)
          else null end,
     now(), 'admin_app_direct', p_actor)
  on conflict (shop_id, service_key) do update set
     display_name = coalesce(excluded.display_name, ts.display_name),
     abbreviation = coalesce(excluded.abbreviation, ts.abbreviation),
     starting_price_cents = case when p_service ? 'starting_price_cents'
                                 then excluded.starting_price_cents else ts.starting_price_cents end,
     notes = case when p_service ? 'notes' then excluded.notes else ts.notes end,
     concern_categories = case when p_service ? 'concern_categories'
                               then excluded.concern_categories else ts.concern_categories end,
     active = excluded.active,
     description = case when p_service ? 'description' then excluded.description else ts.description end,
     example_keywords = case when p_service ? 'example_keywords'
                             then excluded.example_keywords else ts.example_keywords end,
     updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'testing_services', 'testing_services',
    case when v_is_insert then 1 else 0 end,
    case when v_is_insert then 0 else 1 end,
    case when not v_is_insert and v_old.active and not v_new.active then 1 else 0 end,
    jsonb_build_object('service_key', v_key, 'via', 'webform'),
    case when v_is_insert then null else to_jsonb(v_old) end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── 3. subcategory enrichment (descriptions/examples/synonyms) ────────────
create or replace function public.scheduler_admin_update_subcategory_enrichment(
  p_shop_id integer, p_actor text, p_subcategory_id bigint, p_patch jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.concern_subcategories%rowtype;
  v_new public.concern_subcategories%rowtype;
begin
  select * into v_old from public.concern_subcategories
   where id = p_subcategory_id and shop_id = p_shop_id
   for update;
  if not found then raise exception 'subcategory_not_found'; end if;
  if p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  update public.concern_subcategories set
    description = case when p_patch ? 'description' then coalesce(p_patch->>'description', '') else description end,
    display_label = case when p_patch ? 'display_label' then coalesce(p_patch->>'display_label', display_label) else display_label end,
    display_order = case when p_patch ? 'display_order' then (p_patch->>'display_order')::integer else display_order end,
    active = case when p_patch ? 'active' then (p_patch->>'active')::boolean else active end,
    positive_examples = case when p_patch ? 'positive_examples'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'positive_examples') x), '{}') else positive_examples end,
    negative_examples = case when p_patch ? 'negative_examples'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'negative_examples') x), '{}') else negative_examples end,
    synonyms = case when p_patch ? 'synonyms'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'synonyms') x), '{}') else synonyms end,
    updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  where id = p_subcategory_id and shop_id = p_shop_id
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'concern_subcategories', 'subcategory_descriptions',
    0, 1, case when v_old.active and not v_new.active then 1 else 0 end,
    jsonb_build_object('subcategory_id', p_subcategory_id, 'slug', v_old.slug, 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── 4. subcategory → testing-service map ──────────────────────────────────
create or replace function public.scheduler_admin_update_subcategory_service_map(
  p_shop_id integer, p_actor text, p_subcategory_id bigint, p_eligible_keys text[],
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.concern_subcategories%rowtype;
  v_new public.concern_subcategories%rowtype;
  v_bad text;
begin
  select * into v_old from public.concern_subcategories
   where id = p_subcategory_id and shop_id = p_shop_id
   for update;
  if not found then raise exception 'subcategory_not_found'; end if;
  if p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  select k into v_bad from unnest(coalesce(p_eligible_keys, '{}')) k
   where not exists (select 1 from public.testing_services t
                     where t.shop_id = p_shop_id and t.service_key = k)
   limit 1;
  if v_bad is not null then
    raise exception 'unknown_testing_service_key: %', v_bad;
  end if;

  update public.concern_subcategories set
    eligible_testing_service_keys = coalesce(p_eligible_keys, '{}'),
    updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  where id = p_subcategory_id and shop_id = p_shop_id
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'concern_subcategories', 'subcategory_service_map',
    0, 1, 0,
    jsonb_build_object('subcategory_id', p_subcategory_id, 'slug', v_old.slug,
                       'old_keys', to_jsonb(v_old.eligible_testing_service_keys),
                       'new_keys', to_jsonb(v_new.eligible_testing_service_keys), 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── 5+6. concern questions (required facts + full row upsert) ─────────────
create or replace function public.scheduler_admin_update_question_required_facts(
  p_shop_id integer, p_actor text, p_question_id bigint, p_required_facts text[],
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.concern_questions%rowtype;
  v_new public.concern_questions%rowtype;
begin
  select * into v_old from public.concern_questions
   where id = p_question_id and shop_id = p_shop_id
   for update;
  if not found then raise exception 'question_not_found'; end if;
  if p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;

  update public.concern_questions set
    required_facts = coalesce(p_required_facts, '{}'),
    updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  where id = p_question_id and shop_id = p_shop_id
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'concern_questions', 'question_required_facts',
    0, 1, 0,
    jsonb_build_object('question_id', p_question_id,
                       'old_facts', to_jsonb(v_old.required_facts),
                       'new_facts', to_jsonb(v_new.required_facts), 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

create or replace function public.scheduler_admin_upsert_concern_question(
  p_shop_id integer, p_actor text, p_question jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint := (p_question->>'id')::bigint;
  v_sub public.concern_subcategories%rowtype;
  v_old public.concern_questions%rowtype;
  v_new public.concern_questions%rowtype;
  v_is_insert boolean := v_id is null;
begin
  -- subcategory must belong to the shop; category is DERIVED from it
  -- (CAT-3 consistency guard — question.category always matches its
  -- subcategory's category).
  select * into v_sub from public.concern_subcategories
   where id = (p_question->>'subcategory_id')::bigint and shop_id = p_shop_id;
  if not found then raise exception 'subcategory_not_found'; end if;

  if coalesce(btrim(p_question->>'question_text'), '') = '' then
    raise exception 'question_text_required';
  end if;
  if p_question->'options' is null or jsonb_typeof(p_question->'options') <> 'array'
     or jsonb_array_length(p_question->'options') < 2 then
    raise exception 'options_min_two_required';
  end if;

  if not v_is_insert then
    select * into v_old from public.concern_questions
     where id = v_id and shop_id = p_shop_id for update;
    if not found then raise exception 'question_not_found'; end if;
    if p_expected_updated_at is not null
       and v_old.updated_at is distinct from p_expected_updated_at then
      raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
    end if;
    update public.concern_questions set
      subcategory_id = v_sub.id,
      category = v_sub.category,
      question_text = p_question->>'question_text',
      options = p_question->'options',
      display_order = coalesce((p_question->>'display_order')::integer, display_order),
      active = coalesce((p_question->>'active')::boolean, active),
      multi_select = coalesce((p_question->>'multi_select')::boolean, multi_select),
      required_facts = case when p_question ? 'required_facts'
          then coalesce((select array_agg(x) from jsonb_array_elements_text(p_question->'required_facts') x), '{}')
          else required_facts end,
      updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
    where id = v_id and shop_id = p_shop_id
    returning * into v_new;
  else
    insert into public.concern_questions
      (shop_id, category, subcategory_id, question_text, options, display_order,
       active, multi_select, required_facts,
       updated_at, updated_by_oauth_client_id, updated_by_name)
    values
      (p_shop_id, v_sub.category, v_sub.id,
       p_question->>'question_text', p_question->'options',
       coalesce((p_question->>'display_order')::integer, 0),
       coalesce((p_question->>'active')::boolean, true),
       coalesce((p_question->>'multi_select')::boolean, false),
       coalesce((select array_agg(x) from jsonb_array_elements_text(p_question->'required_facts') x), '{}'),
       now(), 'admin_app_direct', p_actor)
    returning * into v_new;
  end if;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'concern_questions', 'concern_questions',
    case when v_is_insert then 1 else 0 end,
    case when v_is_insert then 0 else 1 end,
    case when not v_is_insert and v_old.active and not v_new.active then 1 else 0 end,
    jsonb_build_object('question_id', v_new.id, 'subcategory', v_sub.slug, 'via', 'webform'),
    case when v_is_insert then null else to_jsonb(v_old) end);

  return jsonb_build_object('ok', true, 'id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── 7. category guideline prose ───────────────────────────────────────────
create or replace function public.scheduler_admin_update_category_guideline(
  p_shop_id integer, p_actor text, p_category text,
  p_display_label text, p_guideline_prose text,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.concern_category_guidelines%rowtype;
  v_new public.concern_category_guidelines%rowtype;
begin
  select * into v_old from public.concern_category_guidelines
   where shop_id = p_shop_id and category = p_category
   for update;
  if not found then raise exception 'category_not_found: %', p_category; end if;
  if p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;
  if coalesce(btrim(p_guideline_prose), '') = '' then
    raise exception 'guideline_prose_required';
  end if;

  update public.concern_category_guidelines set
    display_label = coalesce(nullif(btrim(p_display_label), ''), display_label),
    guideline_prose = p_guideline_prose,
    updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  where shop_id = p_shop_id and category = p_category
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'concern_category_guidelines', 'concern_category_guidelines',
    0, 1, 0,
    jsonb_build_object('category', p_category, 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── 8. appointment default limits (per day-of-week) ───────────────────────
create or replace function public.scheduler_admin_set_appointment_limits(
  p_shop_id integer, p_actor text, p_day_of_week integer, p_patch jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.appointment_default_limits%rowtype;
  v_new public.appointment_default_limits%rowtype;
begin
  if p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'invalid_day_of_week';
  end if;
  select * into v_old from public.appointment_default_limits
   where shop_id = p_shop_id and day_of_week = p_day_of_week
   for update;
  if not found then raise exception 'day_row_not_found'; end if;
  if p_expected_updated_at is not null
     and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_write: row changed at % (expected %)', v_old.updated_at, p_expected_updated_at;
  end if;
  if coalesce((p_patch->>'waiter_8am_slots')::integer, 0) < 0
     or coalesce((p_patch->>'waiter_9am_slots')::integer, 0) < 0
     or coalesce((p_patch->>'dropoff_total')::integer, 0) < 0 then
    raise exception 'limits_must_be_nonnegative';
  end if;

  update public.appointment_default_limits set
    is_closed = case when p_patch ? 'is_closed' then (p_patch->>'is_closed')::boolean else is_closed end,
    waiter_8am_slots = case when p_patch ? 'waiter_8am_slots' then (p_patch->>'waiter_8am_slots')::integer else waiter_8am_slots end,
    waiter_9am_slots = case when p_patch ? 'waiter_9am_slots' then (p_patch->>'waiter_9am_slots')::integer else waiter_9am_slots end,
    dropoff_total = case when p_patch ? 'dropoff_total' then (p_patch->>'dropoff_total')::integer else dropoff_total end,
    notes = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
    updated_at = now(), updated_by_oauth_client_id = 'admin_app_direct', updated_by_name = p_actor
  where shop_id = p_shop_id and day_of_week = p_day_of_week
  returning * into v_new;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'appointment_default_limits', 'appointment_default_limits',
    0, 1, 0,
    jsonb_build_object('day_of_week', p_day_of_week, 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true, 'updated_at', v_new.updated_at);
end;
$$;

-- ─── 9. closed dates (per-date advisory lock per ADR-013) ──────────────────
create or replace function public.scheduler_admin_add_closed_date(
  p_shop_id integer, p_actor text, p_closed_date date, p_reason text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_closed_date is null then raise exception 'closed_date_required'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  perform pg_advisory_xact_lock(p_shop_id, hashtext(p_closed_date::text));

  insert into public.closed_dates (shop_id, closed_date, reason, source)
  values (p_shop_id, p_closed_date, btrim(p_reason), 'admin')
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'closed_date_exists: %', p_closed_date;
  end if;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'closed_dates', 'closed_dates',
    1, 0, 0,
    jsonb_build_object('closed_date', p_closed_date, 'reason', btrim(p_reason), 'via', 'webform'),
    null);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.scheduler_admin_remove_closed_date(
  p_shop_id integer, p_actor text, p_closed_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.closed_dates%rowtype;
begin
  perform pg_advisory_xact_lock(p_shop_id, hashtext(p_closed_date::text));

  delete from public.closed_dates
   where shop_id = p_shop_id and closed_date = p_closed_date
  returning * into v_old;
  if not found then raise exception 'closed_date_not_found: %', p_closed_date; end if;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'closed_dates', 'closed_dates',
    0, 0, 1,
    jsonb_build_object('closed_date', p_closed_date, 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true);
end;
$$;

-- ─── 10. appointment types (sub-feature B's admin write surface) ───────────
-- In-place edits (stable id — templates FK it); slug immutable + system
-- protections enforced by the B1 triggers. ACTIVATION requires a
-- write-probe-verified Tekmetric color (D8): yellow joins after the probe.
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
  v_probed constant text[] := array['red','navy','orange'];
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

create or replace function public.scheduler_deactivate_appointment_type(
  p_shop_id integer, p_actor text, p_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.scheduler_appointment_types%rowtype;
begin
  select * into v_old from public.scheduler_appointment_types
   where id = p_id and shop_id = p_shop_id
   for update;
  if not found then raise exception 'type_not_found'; end if;
  -- is_system deactivation is refused by the B1 protection trigger; let it
  -- surface its own message.
  update public.scheduler_appointment_types
     set active = false, updated_by_email = p_actor
   where id = p_id and shop_id = p_shop_id;

  perform public.scheduler_admin_direct_log(
    p_shop_id, p_actor, 'scheduler_appointment_types', 'appointment_types',
    0, 0, 1,
    jsonb_build_object('slug', v_old.slug, 'via', 'webform'),
    to_jsonb(v_old));

  return jsonb_build_object('ok', true);
end;
$$;

-- ─── grants: service_role EXECUTE only ─────────────────────────────────────
-- the audit helper is INTERNAL (ADR-005 style): callable only inside the
-- SECURITY DEFINER ownership chain, no service_role grant.
revoke all on function public.scheduler_admin_direct_log(integer,text,text,text,integer,integer,integer,jsonb,jsonb) from public;
revoke all on function public.scheduler_admin_direct_log(integer,text,text,text,integer,integer,integer,jsonb,jsonb) from anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'scheduler_admin_upsert_routine_service(integer,text,jsonb,timestamptz)',
    'scheduler_admin_upsert_testing_service(integer,text,jsonb,timestamptz)',
    'scheduler_admin_update_subcategory_enrichment(integer,text,bigint,jsonb,timestamptz)',
    'scheduler_admin_update_subcategory_service_map(integer,text,bigint,text[],timestamptz)',
    'scheduler_admin_update_question_required_facts(integer,text,bigint,text[],timestamptz)',
    'scheduler_admin_upsert_concern_question(integer,text,jsonb,timestamptz)',
    'scheduler_admin_update_category_guideline(integer,text,text,text,text,timestamptz)',
    'scheduler_admin_set_appointment_limits(integer,text,integer,jsonb,timestamptz)',
    'scheduler_admin_add_closed_date(integer,text,date,text)',
    'scheduler_admin_remove_closed_date(integer,text,date)',
    'scheduler_set_appointment_type(integer,text,jsonb,timestamptz)',
    'scheduler_deactivate_appointment_type(integer,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
