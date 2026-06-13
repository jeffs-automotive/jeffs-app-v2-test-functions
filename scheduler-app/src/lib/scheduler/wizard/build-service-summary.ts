/**
 * buildServiceSummary — assemble the appointment-description string sent
 * to Tekmetric (and used as the staff-notification email body).
 *
 * Phase 11 (2026-05-15): extracted from session-actions.ts so the V2
 * wizard's submitDateV2 / submitWaiterTimeV2 / submitSummaryConfirmV2
 * (Phase 12) can reuse the exact same shape.
 *
 * 2026-05-18 rewrite (per Chris's directive — verified via PATCH probes on
 * appointment 62409644):
 *   - Each fragment is **newline-separated** (`\n`). Tekmetric's appointment
 *     description UI renders `\n` as a line break — each fragment becomes
 *     its own concern line. The literal `\n` characters do NOT appear in
 *     the rendered UI.
 *   - Other formats tested + rejected: (a) comma-separated → collapsed to
 *     one line; (b) quoted-and-comma-separated → stored verbatim with
 *     visible double-quote characters; (c) JSON array `description: [...]`
 *     → Tekmetric returned 200 SUCCESS but silently stored an empty string.
 *   - Customer-friendly display names (NOT service_keys). Resolves
 *     routine_services.display_name + testing_services.display_name via
 *     a single IN-clause query per table.
 *   - Replaces the raw "Concern: <explanation_text>" line with the
 *     synthesized "Customer states ..." paragraph from
 *     explanation_required_items[i].summary (produced by
 *     ensureConcernSummaries at clarification-queue-drain). Falls back
 *     to the raw explanation_text when summary is missing (e.g., the
 *     LLM was unavailable or the customer is on a stale session).
 *   - Approved testing services render with their price: "Brake
 *     inspection approved $39.99". Free services render "(free)".
 *
 * Example output (literal `\n` shown as ↵ for readability):
 *
 *   State Inspection and Emissions ↵
 *   Customer states there is a thumping noise coming from the front-right
 *   of the vehicle when going over bumps. ↵
 *   Suspension check approved $89.95
 *
 * Empty pick set yields "General appointment" so the edge function's
 * service_summary NOT-NULL check still passes.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

interface ExplanationItem {
  service_key: string;
  display_name?: string;
  explanation_text?: string;
  summary?: string;
}

function parseExplanationItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const service_key =
      typeof obj.service_key === "string" ? obj.service_key : null;
    if (!service_key) continue;
    const item: ExplanationItem = { service_key };
    if (typeof obj.display_name === "string") {
      item.display_name = obj.display_name;
    }
    if (typeof obj.explanation_text === "string") {
      item.explanation_text = obj.explanation_text;
    }
    if (typeof obj.summary === "string" && obj.summary.length > 0) {
      item.summary = obj.summary;
    }
    out.push(item);
  }
  return out;
}

function fmtPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  if (cents === 0) return "(free)";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Sanitize a single description fragment so it joins cleanly into the
 *  newline-separated summary: collapses whitespace and drops a trailing
 *  comma that would dangle at a line end. Preserves periods at sentence
 *  ends (so the customer-summary paragraph stays readable). */
function cleanFragment(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    // strip a trailing comma so a fragment doesn't dangle at a line end;
    // keep periods, which the LLM uses to end summary sentences.
    .replace(/[,]+$/g, "")
    .trim();
}

export async function buildServiceSummary(args: {
  chatId: string;
}): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = rowRaw as Record<string, unknown> | null;

  const routine = Array.isArray(row?.selected_simple_services)
    ? (row?.selected_simple_services as string[])
    : [];
  const additional = Array.isArray(row?.additional_routine_services_round2)
    ? (row?.additional_routine_services_round2 as string[])
    : [];
  const allRoutine = [...routine, ...additional];

  const approvedTesting = Array.isArray(row?.approved_testing_services)
    ? (row?.approved_testing_services as string[])
    : [];
  const explanations = parseExplanationItems(row?.explanation_required_items);

  // Resolve display names + prices in parallel single-IN-clause queries.
  const [routineLookup, testingLookup] = await Promise.all([
    loadRoutineLookup(supabase, allRoutine),
    loadTestingLookup(supabase, approvedTesting),
  ]);

  const fragments: string[] = [];

  // Routine services first — friendly display name, deduped (preserves
  // pick order).
  const seenRoutine = new Set<string>();
  for (const key of allRoutine) {
    if (seenRoutine.has(key)) continue;
    seenRoutine.add(key);
    const display = routineLookup.get(key) ?? key;
    fragments.push(cleanFragment(display));
  }

  // Concern summaries (or raw text when summary unavailable).
  for (const ex of explanations) {
    const body = ex.summary ?? ex.explanation_text ?? "";
    const trimmed = cleanFragment(body);
    if (trimmed.length > 0) {
      // Always end with a period so each concern reads as a complete
      // sentence on its own line in Tekmetric.
      const withPeriod = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
      fragments.push(withPeriod);
    }
  }

  // Approved testing services with their price.
  for (const key of approvedTesting) {
    const t = testingLookup.get(key);
    const display = t?.display_name ?? key;
    const price = fmtPrice(t?.starting_price_cents);
    const fragment = price.length > 0
      ? `${cleanFragment(display)} approved ${price}`
      : `${cleanFragment(display)} approved`;
    fragments.push(fragment);
  }

  if (fragments.length === 0) {
    return "General appointment";
  }
  // Newline-separated — Tekmetric renders `\n` as line breaks in the
  // appointment description UI. Verified 2026-05-18 via PATCH probes on
  // appointment 62409644 (Chris confirmed visually: "three separate
  // concerns and no visible line break characters"). Other separators
  // tested + rejected — see the file header for the full matrix.
  return fragments.join("\n");
}

// ─── Lookup helpers ─────────────────────────────────────────────────────────

async function loadRoutineLookup(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  keys: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(keys.filter((k) => k.length > 0)));
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("routine_services")
    .select("service_key, display_name")
    .eq("shop_id", SHOP_ID)
    .in("service_key", unique);
  if (error) return out;
  for (const row of (data ?? []) as Array<{
    service_key: string;
    display_name: string | null;
  }>) {
    out.set(row.service_key, row.display_name ?? row.service_key);
  }
  return out;
}

interface TestingLookupEntry {
  display_name: string;
  starting_price_cents: number | null;
}
async function loadTestingLookup(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  keys: string[],
): Promise<Map<string, TestingLookupEntry>> {
  const out = new Map<string, TestingLookupEntry>();
  const unique = Array.from(new Set(keys.filter((k) => k.length > 0)));
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("testing_services")
    .select("service_key, display_name, starting_price_cents")
    .eq("shop_id", SHOP_ID)
    .in("service_key", unique);
  if (error) return out;
  for (const row of (data ?? []) as Array<{
    service_key: string;
    display_name: string | null;
    starting_price_cents: number | null;
  }>) {
    out.set(row.service_key, {
      display_name: row.display_name ?? row.service_key,
      starting_price_cents: row.starting_price_cents,
    });
  }
  return out;
}
