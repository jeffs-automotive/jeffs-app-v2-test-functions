/**
 * Direct-read DAL for /schedulerconfig (sub-feature A).
 *
 * Server Components read the live catalog tables through the service-role
 * client (deny-all RLS is bypassed by design; requireAdmin() on the page is
 * the auth boundary). Audit history reads go through the existing outer RPC
 * `list_scheduler_admin_audit_log_filtered` (ADR-021 surface filter).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";

const SHOP_ID = resolveAdminShopId();

async function listRows<T>(
  table: string,
  select: string,
  order: { col: string; asc?: boolean }[],
  filters?: (q: ReturnType<ReturnType<typeof createSupabaseAdminClient>["from"]>["select"]) => unknown,
): Promise<T[]> {
  void filters;
  const supabase = createSupabaseAdminClient();
  let q = supabase.from(table).select(select).eq("shop_id", SHOP_ID);
  for (const o of order) q = q.order(o.col, { ascending: o.asc ?? true });
  const { data, error } = await q;
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return (data ?? []) as T[];
}

export interface RoutineServiceRow {
  id: string;
  service_key: string;
  display_name: string;
  abbreviation: string;
  display_order: number;
  active: boolean;
  wait_eligible: boolean;
  requires_explanation: boolean;
  starting_price_cents: number | null;
  price_waived_note: string | null;
  description: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

export function listRoutineServices(): Promise<RoutineServiceRow[]> {
  return listRows<RoutineServiceRow>(
    "routine_services",
    "id, service_key, display_name, abbreviation, display_order, active, wait_eligible, requires_explanation, starting_price_cents, price_waived_note, description, updated_at, updated_by_name",
    [{ col: "display_order" }],
  );
}

export interface TestingServiceRow {
  id: string;
  service_key: string;
  display_name: string;
  abbreviation: string;
  starting_price_cents: number;
  notes: string | null;
  description: string | null;
  active: boolean;
  updated_at: string;
  updated_by_name: string | null;
}

export function listTestingServices(): Promise<TestingServiceRow[]> {
  return listRows<TestingServiceRow>(
    "testing_services",
    "id, service_key, display_name, abbreviation, starting_price_cents, notes, description, active, updated_at, updated_by_name",
    [{ col: "display_name" }],
  );
}

export interface SubcategoryRow {
  id: number;
  category: string;
  slug: string;
  display_label: string;
  display_order: number;
  active: boolean;
  description: string;
  positive_examples: string[];
  negative_examples: string[];
  synonyms: string[];
  eligible_testing_service_keys: string[];
  updated_at: string;
}

export async function listSubcategories(category?: string): Promise<SubcategoryRow[]> {
  const supabase = createSupabaseAdminClient();
  let q = supabase
    .from("concern_subcategories")
    .select(
      "id, category, slug, display_label, display_order, active, description, positive_examples, negative_examples, synonyms, eligible_testing_service_keys, updated_at",
    )
    .eq("shop_id", SHOP_ID)
    .order("category")
    .order("display_order");
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw new Error(`concern_subcategories read failed: ${error.message}`);
  return (data ?? []) as SubcategoryRow[];
}

export interface QuestionRow {
  id: number;
  category: string;
  subcategory_id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  display_order: number;
  active: boolean;
  multi_select: boolean;
  required_facts: string[];
  updated_at: string;
}

export async function listQuestions(subcategoryId?: number): Promise<QuestionRow[]> {
  const supabase = createSupabaseAdminClient();
  let q = supabase
    .from("concern_questions")
    .select(
      "id, category, subcategory_id, question_text, options, display_order, active, multi_select, required_facts, updated_at",
    )
    .eq("shop_id", SHOP_ID)
    .order("subcategory_id")
    .order("display_order");
  if (subcategoryId !== undefined) q = q.eq("subcategory_id", subcategoryId);
  const { data, error } = await q;
  if (error) throw new Error(`concern_questions read failed: ${error.message}`);
  return (data ?? []) as QuestionRow[];
}

export interface GuidelineRow {
  category: string;
  display_label: string;
  guideline_prose: string;
  updated_at: string;
}

export function listGuidelines(): Promise<GuidelineRow[]> {
  return listRows<GuidelineRow>(
    "concern_category_guidelines",
    "category, display_label, guideline_prose, updated_at",
    [{ col: "category" }],
  );
}

export interface LimitsRow {
  day_of_week: number;
  is_closed: boolean;
  waiter_8am_slots: number;
  waiter_9am_slots: number;
  dropoff_total: number;
  notes: string | null;
  updated_at: string;
}

export function listAppointmentLimits(): Promise<LimitsRow[]> {
  return listRows<LimitsRow>(
    "appointment_default_limits",
    "day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes, updated_at",
    [{ col: "day_of_week" }],
  );
}

export interface ClosedDateRow {
  id: string;
  closed_date: string;
  reason: string;
  source: string;
}

export async function listClosedDates(fromDate?: string): Promise<ClosedDateRow[]> {
  const supabase = createSupabaseAdminClient();
  let q = supabase
    .from("closed_dates")
    .select("id, closed_date, reason, source")
    .eq("shop_id", SHOP_ID)
    .order("closed_date");
  if (fromDate) q = q.gte("closed_date", fromDate);
  const { data, error } = await q;
  if (error) throw new Error(`closed_dates read failed: ${error.message}`);
  return (data ?? []) as ClosedDateRow[];
}

export interface BlockRow {
  id: string;
  blocked_date: string;
  blocked_type: string | null;
  blocked_time: string | null;
  reason: string | null;
}

export async function listAppointmentBlocks(fromDate?: string): Promise<BlockRow[]> {
  const supabase = createSupabaseAdminClient();
  let q = supabase
    .from("appointment_blocks")
    .select("id, blocked_date, blocked_type, blocked_time, reason")
    .eq("shop_id", SHOP_ID)
    .order("blocked_date");
  if (fromDate) q = q.gte("blocked_date", fromDate);
  const { data, error } = await q;
  if (error) throw new Error(`appointment_blocks read failed: ${error.message}`);
  return (data ?? []) as BlockRow[];
}

export interface AppointmentTypeAdminRow {
  id: string;
  slug: string;
  label: string;
  card_title: string;
  card_description: string | null;
  emoji: string | null;
  tekmetric_color: string;
  requires_time_slot: boolean;
  is_system: boolean;
  active: boolean;
  sort: number;
  updated_at: string;
  updated_by_email: string | null;
}

export function listAppointmentTypes(): Promise<AppointmentTypeAdminRow[]> {
  return listRows<AppointmentTypeAdminRow>(
    "scheduler_appointment_types",
    "id, slug, label, card_title, card_description, emoji, tekmetric_color, requires_time_slot, is_system, active, sort, updated_at, updated_by_email",
    [{ col: "sort" }],
  );
}

export interface MessageTemplateRow {
  id: string;
  type_id: string | null;
  kind: "confirmation" | "reminder_24h" | "reminder_2h";
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  updated_at: string;
  updated_by_email: string | null;
}

export async function listMessageTemplates(): Promise<MessageTemplateRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduler_message_templates")
    .select("id, type_id, kind, channel, subject, body, updated_at, updated_by_email")
    .eq("shop_id", SHOP_ID)
    .eq("active", true)
    .order("kind")
    .order("channel");
  if (error) throw new Error(`scheduler_message_templates read failed: ${error.message}`);
  return (data ?? []) as MessageTemplateRow[];
}

// ─── audit history (existing outer RPC, ADR-021 filter semantics) ───────────

export interface AuditLogRow {
  id: number;
  occurred_at: string;
  table_name: string;
  operation: string;
  user_label: string | null;
  oauth_client_id: string | null;
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  error_message: string | null;
  diff_summary: Record<string, unknown> | null;
}

export async function listAuditLog(args: {
  surface?: string;
  limit?: number;
}): Promise<AuditLogRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("list_scheduler_admin_audit_log_filtered", {
    p_shop_id: SHOP_ID,
    p_surface_filter: args.surface ?? null,
    p_table_filter: null,
    p_only_successful: false,
    p_limit: args.limit ?? 20,
  });
  if (error) throw new Error(`audit log read failed: ${error.message}`);
  return (data ?? []) as AuditLogRow[];
}

// ─── ops: orphan finder (direct port of the edge helper) ────────────────────

export interface OrphanRow {
  customer_id: number | null;
  appointment_id: number;
  start_time: string;
  appointment_status: string;
  last_synced_at: string | null;
}

export async function findOrphans(lookbackDays = 30): Promise<{
  orphans: OrphanRow[];
  count: number;
  lookback_days: number;
}> {
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("appointments")
    .select("customer_id, tekmetric_appointment_id, start_time, appointment_status, tekmetric_synced_at")
    .eq("shop_id", SHOP_ID)
    .is("deleted_at", null)
    .gte("start_time", cutoff)
    .lt("tekmetric_synced_at", staleCutoff)
    .limit(50);
  if (error) throw new Error(`findOrphans failed: ${error.message}`);
  const orphans = (data ?? []).map((r) => ({
    customer_id: r.customer_id as number | null,
    appointment_id: r.tekmetric_appointment_id as number,
    start_time: r.start_time as string,
    appointment_status: r.appointment_status as string,
    last_synced_at: (r.tekmetric_synced_at ?? null) as string | null,
  }));
  return { orphans, count: orphans.length, lookback_days: lookbackDays };
}
