// canonical-handlers — scheduler admin MD module.
// Extracted from scheduler-admin-md.ts (file-size-refactor). Mechanical split
// — no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { nullStr, nullScalar, boolStr, sortedTextArray, orderedTextArray, jsonbColumnText } from "./canonical-formatters.ts";

// ─── Canonical-state handlers (10 kinds, mirror migration lines 518-1138) ──

/** Kind 1: testing_services_v2 — mirrors migration lines 518-571. */
export async function canonicalStateTestingServicesV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("testing_services")
    .select(
      "id, service_key, display_name, abbreviation, starting_price_cents, notes, description, example_keywords, concern_categories, active",
    )
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_testing_services_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | service_key=${nullStr(r.service_key)} | display_name=${nullStr(r.display_name)} | abbreviation=${nullStr(r.abbreviation)} | starting_price_cents=${nullScalar(r.starting_price_cents)} | notes=${nullStr(r.notes)} | description=${nullStr(r.description)} | example_keywords=${sortedTextArray(r.example_keywords)} | concern_categories=${sortedTextArray(r.concern_categories)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# testing_services_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 2: routine_services_v2 — mirrors migration lines 579-632. */
export async function canonicalStateRoutineServicesV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("routine_services")
    .select(
      "id, service_key, display_name, abbreviation, display_order, wait_eligible, requires_explanation, concern_categories, starting_price_cents, price_waived_note, description, active",
    )
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_routine_services_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | service_key=${nullStr(r.service_key)} | display_name=${nullStr(r.display_name)} | abbreviation=${nullStr(r.abbreviation)} | display_order=${nullScalar(r.display_order)} | wait_eligible=${boolStr(r.wait_eligible)} | requires_explanation=${boolStr(r.requires_explanation)} | concern_categories=${sortedTextArray(r.concern_categories)} | starting_price_cents=${nullScalar(r.starting_price_cents)} | price_waived_note=${nullStr(r.price_waived_note)} | description=${nullStr(r.description)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# routine_services_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 3: concern_subcategories_descriptions_v2 — mirrors migration lines 639-689. */
export async function canonicalStateSubcategoryDescriptionsV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_subcategories")
    .select(
      "id, category, slug, description, positive_examples, negative_examples, synonyms, active",
    )
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("slug", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_subcategory_descriptions_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | category=${nullStr(r.category)} | slug=${nullStr(r.slug)} | description=${nullStr(r.description)} | positive_examples=${sortedTextArray(r.positive_examples)} | negative_examples=${sortedTextArray(r.negative_examples)} | synonyms=${sortedTextArray(r.synonyms)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_subcategories_descriptions_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 4: concern_subcategories_map_v2 — mirrors migration lines 699-739. */
export async function canonicalStateSubcategoryServiceMapV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_subcategories")
    .select("id, category, slug, eligible_testing_service_keys, active")
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("slug", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_subcategory_service_map_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | category=${nullStr(r.category)} | slug=${nullStr(r.slug)} | eligible_testing_service_keys=${sortedTextArray(r.eligible_testing_service_keys)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_subcategories_map_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 5: concern_questions_required_facts_v2 — mirrors migration lines 749-794.
 *  NOTE: `required_facts` is ORDERED (MD-order preserved); use orderedTextArray. */
export async function canonicalStateQuestionRequiredFactsV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, required_facts, active")
    .eq("shop_id", shopId)
    .order("id", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_question_required_facts_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | required_facts=${orderedTextArray(r.required_facts)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_questions_required_facts_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 6: concern_questions_flat — mirrors migration lines 805-845. */
export async function canonicalStateConcernQuestionsFlat(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, category, question_text, display_order, active, options")
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_concern_questions_flat: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  // Column order in the format() string is: id, category, display_order,
  // question_text, options, active — matches migration line 835-836.
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | category=${nullStr(r.category)} | display_order=${nullScalar(r.display_order)} | question_text=${nullStr(r.question_text)} | options=${jsonbColumnText(r.options)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_questions_flat shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 7: concern_questions_per_category (R6-B3) — mirrors migration lines 868-964.
 *  Reads BOTH concern_subcategories AND concern_questions for (shop_id, category).
 *  Category derived from snapshot: category_slug → subcategories_before first → questions_before first. */
export async function canonicalStateConcernCategoryUpload(
  sb: SupabaseClient,
  shopId: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  // Derive category per migration lines 884-905.
  let category: string | null = null;

  const directSlug = snapshot["category_slug"];
  if (typeof directSlug === "string" && directSlug.length > 0) {
    category = directSlug;
  }

  if (category === null) {
    const subsBefore = snapshot["subcategories_before"];
    if (subsBefore && typeof subsBefore === "object" && !Array.isArray(subsBefore)) {
      for (const key of Object.keys(subsBefore as Record<string, unknown>)) {
        const row = (subsBefore as Record<string, unknown>)[key];
        if (row && typeof row === "object" && !Array.isArray(row)) {
          const c = (row as Record<string, unknown>)["category"];
          if (typeof c === "string" && c.length > 0) {
            category = c;
            break;
          }
        }
      }
    }
  }

  if (category === null) {
    const qsBefore = snapshot["questions_before"];
    if (qsBefore && typeof qsBefore === "object" && !Array.isArray(qsBefore)) {
      for (const key of Object.keys(qsBefore as Record<string, unknown>)) {
        const row = (qsBefore as Record<string, unknown>)[key];
        if (row && typeof row === "object" && !Array.isArray(row)) {
          const c = (row as Record<string, unknown>)["category"];
          if (typeof c === "string" && c.length > 0) {
            category = c;
            break;
          }
        }
      }
    }
  }

  if (category === null) {
    throw new Error(
      "canonical_state_concern_category_upload: snapshot missing category_slug AND has no subcategories_before/questions_before rows to derive it from",
    );
  }

  // Subcategories block — mirrors migration lines 907-928.
  const { data: subData, error: subErr } = await sb
    .from("concern_subcategories")
    .select("id, category, slug, display_label, display_order, active")
    .eq("shop_id", shopId)
    .eq("category", category)
    .order("display_order", { ascending: true })
    .order("slug", { ascending: true });
  if (subErr) {
    throw new Error(
      `canonical_state_concern_category_upload (subcategories): ${subErr.message}`,
    );
  }
  const subs = (subData ?? []) as unknown as Array<Record<string, unknown>>;
  const subLines = subs.map((r) =>
    `| id=${nullStr(r.id)} | slug=${nullStr(r.slug)} | display_label=${nullStr(r.display_label)} | display_order=${nullScalar(r.display_order)} | active=${boolStr(r.active)} |`
  );
  const subsBlock = subLines.join("\n");

  // Questions block — mirrors migration lines 930-958. LEFT JOIN to
  // subcategories on (id, shop_id) to source sub_slug. Sort by sub_slug,
  // then display_order, then id.
  const { data: qData, error: qErr } = await sb
    .from("concern_questions")
    .select(
      "id, subcategory_id, question_text, display_order, active, multi_select, options",
    )
    .eq("shop_id", shopId)
    .eq("category", category);
  if (qErr) {
    throw new Error(
      `canonical_state_concern_category_upload (questions): ${qErr.message}`,
    );
  }
  // Build sub_slug lookup from the sub rows we already fetched (matches the
  // LEFT JOIN in plpgsql — same (id, shop_id) scoping).
  const slugById = new Map<string, string>();
  for (const s of subs) {
    if (s.id !== null && s.id !== undefined) {
      slugById.set(String(s.id), nullStr(s.slug));
    }
  }
  type QRow = Record<string, unknown>;
  type QRowWithSlug = Record<string, unknown> & { sub_slug: string };
  const qRows: QRowWithSlug[] = ((qData ?? []) as unknown as QRow[]).map(
    (r): QRowWithSlug => ({
      ...r,
      sub_slug: r.subcategory_id !== null && r.subcategory_id !== undefined
        ? slugById.get(String(r.subcategory_id)) ?? "<null>"
        : "<null>",
    }),
  );
  // Sort: COALESCE(cs.slug, '') ASC, display_order ASC, id ASC.
  // For empty/null sub_slug, the COALESCE produces empty string which
  // sorts before any actual slug — match that here by treating "<null>"
  // as the empty sort key. Plpgsql uses '' for missing slug; we use
  // empty string for ordering, "<null>" for output.
  qRows.sort((a, b) => {
    const aSlugSort = a.sub_slug === "<null>" ? "" : a.sub_slug;
    const bSlugSort = b.sub_slug === "<null>" ? "" : b.sub_slug;
    if (aSlugSort < bSlugSort) return -1;
    if (aSlugSort > bSlugSort) return 1;
    const aOrd = a.display_order === null || a.display_order === undefined
      ? Number.NEGATIVE_INFINITY
      : Number(a.display_order);
    const bOrd = b.display_order === null || b.display_order === undefined
      ? Number.NEGATIVE_INFINITY
      : Number(b.display_order);
    if (aOrd < bOrd) return -1;
    if (aOrd > bOrd) return 1;
    const aId = BigInt(String(a.id ?? "0"));
    const bId = BigInt(String(b.id ?? "0"));
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
  const qLines = qRows.map((r) =>
    `| id=${nullStr(r.id)} | sub_slug=${r.sub_slug} | subcategory_id=${nullScalar(r.subcategory_id)} | display_order=${nullScalar(r.display_order)} | question_text=${nullStr(r.question_text)} | options=${jsonbColumnText(r.options)} | multi_select=${boolStr(r.multi_select)} | active=${boolStr(r.active)} |`
  );
  const qsBlock = qLines.join("\n");

  // Final composition — mirrors migration line 960-963 format() exactly.
  return `# concern_questions_per_category shop=${shopId} category=${category}\n## subcategories rows=${subs.length}\n${subsBlock}\n## questions rows=${qRows.length}\n${qsBlock}\n`;
}

/** Kind 8: concern_category_guidelines — mirrors migration lines 975-1020.
 *  Category scope: distinct categories from snapshot.before keys + snapshot.added_keys. */
export async function canonicalStateConcernCategoryGuideline(
  sb: SupabaseClient,
  shopId: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  // Mirror plpgsql lines 989-996: union of keys + added_keys, distinct,
  // non-empty.
  const set = new Set<string>();
  const before = snapshot["before"];
  if (before && typeof before === "object" && !Array.isArray(before)) {
    for (const key of Object.keys(before as Record<string, unknown>)) {
      if (key && key.length > 0) set.add(key);
    }
  }
  const added = snapshot["added_keys"];
  if (Array.isArray(added)) {
    for (const v of added) {
      const s = String(v);
      if (s && s.length > 0) set.add(s);
    }
  }
  const categories = Array.from(set);

  // If no scope: read returns 0 rows; format() still emits the header.
  if (categories.length === 0) {
    return `# concern_category_guidelines shop=${shopId} rows=0\n\n`;
  }

  const { data, error } = await sb
    .from("concern_category_guidelines")
    .select("category, display_label, guideline_prose")
    .eq("shop_id", shopId)
    .in("category", categories)
    .order("category", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_concern_category_guideline: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| category=${nullStr(r.category)} | display_label=${nullStr(r.display_label)} | guideline_prose=${nullStr(r.guideline_prose)} |`
  );
  const body = lines.join("\n");
  return `# concern_category_guidelines shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 9: appointment_default_limits — mirrors migration lines 1030-1069.
 *  Composite PK (shop_id, day_of_week) — id column excluded (per E1cf-N1).
 *  Sort by day_of_week ASC. */
export async function canonicalStateAppointmentDefaultLimits(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("appointment_default_limits")
    .select(
      "day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes",
    )
    .eq("shop_id", shopId)
    .order("day_of_week", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_appointment_default_limits: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| day_of_week=${nullScalar(r.day_of_week)} | is_closed=${boolStr(r.is_closed)} | waiter_8am_slots=${nullScalar(r.waiter_8am_slots)} | waiter_9am_slots=${nullScalar(r.waiter_9am_slots)} | dropoff_total=${nullScalar(r.dropoff_total)} | notes=${nullStr(r.notes)} |`
  );
  const body = lines.join("\n");
  return `# appointment_default_limits shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 10: closed_dates_future — mirrors migration lines 1082-1134.
 *  Filters closed_date >= snapshot.original_today (REQUIRED snapshot field).
 *  id column INTENTIONALLY EXCLUDED per migration line 1102 comment. */
export async function canonicalStateClosedDatesFuture(
  sb: SupabaseClient,
  shopId: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const originalToday = snapshot["original_today"];
  if (
    typeof originalToday !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(originalToday)
  ) {
    throw new Error(
      "canonical_state_closed_dates_future: snapshot missing original_today (required to scope canonical read to the same forward window the uploader saw)",
    );
  }

  const { data, error } = await sb
    .from("closed_dates")
    .select("closed_date, reason, source")
    .eq("shop_id", shopId)
    .gte("closed_date", originalToday)
    .order("closed_date", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_closed_dates_future: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| closed_date=${nullStr(r.closed_date)} | reason=${nullStr(r.reason)} | source=${nullStr(r.source)} |`
  );
  const body = lines.join("\n");
  return `# closed_dates_future shop=${shopId} rows=${rows.length} original_today=${originalToday}\n${body}\n`;
}
