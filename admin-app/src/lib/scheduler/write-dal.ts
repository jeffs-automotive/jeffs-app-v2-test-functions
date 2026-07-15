/**
 * Direct-write DAL for /schedulerconfig (sub-feature A of
 * docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md).
 *
 * Replaces the orchestrator-mcp transport: every mutation calls ONE
 * SECURITY DEFINER RPC (migration 20260702041000 / 20260702042000) that
 * commits the config change + its `manual_change` audit row atomically and
 * enforces `updated_at` staleness. The service-role client lives strictly
 * server-side (`server-only` guard); shop_id comes from SHOP_ID config and
 * the actor from requireAdmin() — never from the client.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";

const SHOP_ID = resolveAdminShopId();

export type DirectWriteResult =
  | { ok: true; id?: string | number; updated_at?: string }
  | { ok: false; code: "stale_write" | "rpc_error"; error: string };

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<DirectWriteResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const msg = error.message ?? "unknown rpc error";
    return {
      ok: false,
      code: msg.startsWith("stale_write") ? "stale_write" : "rpc_error",
      error: msg,
    };
  }
  const row = (data ?? {}) as { id?: string | number; updated_at?: string };
  return { ok: true, id: row.id, updated_at: row.updated_at };
}

// ─── services ────────────────────────────────────────────────────────────────

export interface ServicePatch {
  service_key: string;
  display_name?: string;
  abbreviation?: string;
  display_order?: number;
  active?: boolean;
  starting_price_cents?: number | null;
  description?: string | null;
  // routine-only
  wait_eligible?: boolean;
  requires_explanation?: boolean;
  price_waived_note?: string | null;
  // testing-only
  notes?: string | null;
}

export function upsertRoutineService(
  actor: string,
  service: ServicePatch,
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_upsert_routine_service", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_service: service,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function upsertTestingService(
  actor: string,
  service: ServicePatch,
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_upsert_testing_service", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_service: service,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

// ─── concern catalog ─────────────────────────────────────────────────────────

export function updateSubcategoryEnrichment(
  actor: string,
  subcategoryId: number,
  patch: {
    description?: string;
    display_label?: string;
    display_order?: number;
    active?: boolean;
    positive_examples?: string[];
    negative_examples?: string[];
    synonyms?: string[];
  },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_update_subcategory_enrichment", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_subcategory_id: subcategoryId,
    p_patch: patch,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function updateSubcategoryServiceMap(
  actor: string,
  subcategoryId: number,
  eligibleKeys: string[],
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_update_subcategory_service_map", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_subcategory_id: subcategoryId,
    p_eligible_keys: eligibleKeys,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function updateQuestionRequiredFacts(
  actor: string,
  questionId: number,
  requiredFacts: string[],
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_update_question_required_facts", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_question_id: questionId,
    p_required_facts: requiredFacts,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function upsertConcernQuestion(
  actor: string,
  question: {
    id?: number;
    subcategory_id: number;
    question_text: string;
    options: Array<{ label: string; value: string }>;
    display_order?: number;
    active?: boolean;
    multi_select?: boolean;
    required_facts?: string[];
  },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_upsert_concern_question", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_question: question,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function updateCategoryGuideline(
  actor: string,
  category: string,
  displayLabel: string | null,
  guidelineProse: string,
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_update_category_guideline", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_category: category,
    p_display_label: displayLabel,
    p_guideline_prose: guidelineProse,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

// ─── capacity ────────────────────────────────────────────────────────────────

export function setAppointmentLimits(
  actor: string,
  dayOfWeek: number,
  patch: {
    is_closed?: boolean;
    waiter_8am_slots?: number;
    waiter_9am_slots?: number;
    dropoff_total?: number;
    notes?: string | null;
  },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_set_appointment_limits", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_day_of_week: dayOfWeek,
    p_patch: patch,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function addClosedDate(
  actor: string,
  closedDate: string,
  reason: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_add_closed_date", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_closed_date: closedDate,
    p_reason: reason,
  });
}

export function removeClosedDate(
  actor: string,
  closedDate: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_admin_remove_closed_date", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_closed_date: closedDate,
  });
}

/** Direct port of the edge blockAppointmentCapacity helper (table write). */
export async function blockCapacity(
  actor: string,
  args: { date: string; type?: "waiter" | "dropoff"; time?: string; reason?: string },
): Promise<DirectWriteResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("appointment_blocks")
    .insert({
      shop_id: SHOP_ID,
      blocked_date: args.date,
      blocked_type: args.type ?? null,
      blocked_time: args.time ?? null,
      reason: args.reason ?? null,
      created_by_oauth_client_id: "admin_app_direct",
      created_by_name: actor,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, code: "rpc_error", error: error?.message ?? "no row returned" };
  }
  return { ok: true, id: data.id as string };
}

export async function unblockCapacity(
  _actor: string,
  args: { date: string; type?: "waiter" | "dropoff"; time?: string },
): Promise<DirectWriteResult> {
  const supabase = createSupabaseAdminClient();
  let q = supabase
    .from("appointment_blocks")
    .delete()
    .eq("shop_id", SHOP_ID)
    .eq("blocked_date", args.date);
  q = args.type === undefined ? q.is("blocked_type", null) : q.eq("blocked_type", args.type);
  q = args.time === undefined ? q.is("blocked_time", null) : q.eq("blocked_time", args.time);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, code: "rpc_error", error: error.message };
  return { ok: true, id: (data ?? []).length };
}

// ─── appointment types + message templates ──────────────────────────────────

export function setAppointmentType(
  actor: string,
  type: {
    slug: string;
    label?: string;
    card_title?: string;
    card_description?: string | null;
    emoji?: string | null;
    tekmetric_color?: string;
    active?: boolean;
    sort?: number;
  },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_set_appointment_type", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_type: type,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

export function deactivateAppointmentType(
  actor: string,
  id: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_deactivate_appointment_type", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_id: id,
  });
}

export function setMessageTemplate(
  actor: string,
  args: {
    type_id: string | null;
    kind: "confirmation" | "reminder_24h" | "reminder_2h";
    channel: "sms" | "email";
    subject: string | null;
    body: string;
  },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_set_message_template", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_type_id: args.type_id,
    p_kind: args.kind,
    p_channel: args.channel,
    p_subject: args.subject,
    p_body: args.body,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

// ─── ops ─────────────────────────────────────────────────────────────────────

/** Direct invoke of the appointments-sync edge fn (was run_appointments_sync). */
export async function runAppointmentsSyncDirect(args: {
  full_backfill?: boolean;
}): Promise<{ ok: boolean; status: number; summary: unknown }> {
  const { resolveServiceRoleKey } = await import("@/lib/supabase/resolve-keys");
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")}/functions/v1/appointments-sync`;
  const key = resolveServiceRoleKey();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args.full_backfill ? { full_backfill: true } : {}),
  });
  let summary: unknown = null;
  try {
    summary = await res.json();
  } catch {
    summary = null;
  }
  return { ok: res.ok, status: res.status, summary };
}

// ─── card text (card-text-editor) ──────────────────────────────────────────

/** Upsert one card-copy slot's body. Structural fields ride along so a
 *  not-yet-seeded slot still persists (cross-verify §12.1). */
export function setCardText(
  actor: string,
  args: {
    card_key: string;
    slot_key: string;
    body: string;
    label: string;
    default_body: string;
    allowed_merge_fields: string[];
    sort: number;
  },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_set_card_text", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_card_key: args.card_key,
    p_slot_key: args.slot_key,
    p_body: args.body,
    p_label: args.label,
    p_default_body: args.default_body,
    p_allowed_merge_fields: args.allowed_merge_fields,
    p_sort: args.sort,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

/** Restore one card-copy slot's body to its default_body. */
export function resetCardText(
  actor: string,
  args: { card_key: string; slot_key: string },
  expectedUpdatedAt?: string,
): Promise<DirectWriteResult> {
  return callRpc("scheduler_reset_card_text", {
    p_shop_id: SHOP_ID,
    p_actor: actor,
    p_card_key: args.card_key,
    p_slot_key: args.slot_key,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}
