// Diagnostic Q&A specialist.
//
// Per chat-design.md §7.4 + scheduler_phase1_design_lock.md 2026-05-13.
//
// The customer's free-form concern explanation gets routed here. The
// specialist:
//   1. Pre-fetches the active concern_questions catalog (all 14 categories)
//      and the active testing_services catalog (with concern_categories
//      mapping) from Postgres — ONE Supabase round-trip per category set,
//      shared across the run.
//   2. Calls generateObject with a strict Zod schema that returns:
//        - the classified concern category
//        - the questions_to_ask (from the catalog, IDs only; the specialist
//          re-attaches question_text + options after the LLM picks IDs)
//        - the recommended_testing_services (from the catalog, service_keys
//          only; specialist re-attaches display_name + price)
//        - brief reasoning for the audit trail
//   3. Returns a structured directive the scheduler agent acts on:
//        - 'clarify_concern_question' — when there are still 1+ questions to
//          ask the customer
//        - 'propose_testing_services' — when no further clarification needed
//        - 'continue'                  — when no questions + no test recs
//          (rare; only when category='other' with no diagnostic mapping)
//
// Model: Haiku 4.5 (Chunk 4 default — fast, cheap, structured-output reliable).
// Chris's design-locked target was gpt-5.4-mini reasoning medium; switching
// requires adding @ai-sdk/openai which is a separate deployment concern.
// Env override: DIAGNOSTIC_SPECIALIST_MODEL.
//
// Why generateObject instead of generateText+tools: the diagnostic flow is
// a single-pass classify+select problem. Pre-fetching the catalog avoids
// extra LLM rounds and gives us deterministic structured output via CFG.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateObject } from "npm:ai@^5";
import { anthropic } from "npm:@ai-sdk/anthropic@^2";
import { z } from "npm:zod@^4";

import type { ToolCallRecorder } from "../orchestrator-tools.ts";
import type { CallerContext } from "../orchestrator-types.ts";

const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 1024;

// The 14 concern categories from migration 20260513000100. Kept in sync with
// the CHECK constraint on concern_questions.category.
const CONCERN_CATEGORIES = [
  "noise",
  "vibration",
  "pulling",
  "smell",
  "smoke",
  "leak",
  "warning_light",
  "performance",
  "electrical",
  "hvac",
  "brakes",
  "steering",
  "tires",
  "other",
] as const;

type ConcernCategory = (typeof CONCERN_CATEGORIES)[number];

export interface DiagnosticSpecialistArgs {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  callerContext: CallerContext;
  sessionId: string;
  /** The customer's free-form explanation of what they're noticing. */
  context: string;
  hints?: Record<string, unknown>;
  intentType?: string;
  sessionMetadata?: Record<string, unknown>;
}

export interface DiagnosticSpecialistResult {
  directive: string;
  data?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  tools_called: string[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  steps: number;
  model: string;
  agent_started_at: string;
  agent_ended_at: string;
  raw_text: string;
  parsed_ok: boolean;
}

// ─── Zod schema for the LLM's structured output ──────────────────────────────

const DiagnosticSchema = z.object({
  category: z.enum(CONCERN_CATEGORIES).describe(
    "The single best-matching concern category for the customer's explanation. " +
      "If the explanation is too vague to classify or doesn't fit any specific category, return 'other'.",
  ),
  question_ids: z.array(z.number().int().positive()).max(4).describe(
    "Up to 4 concern_questions IDs (from the supplied catalog for the chosen " +
      "category) to ask the customer NEXT. Skip questions the customer's " +
      "explanation already answers. Skip questions already in already_answered_ids. " +
      "Return [] when no further clarification is needed.",
  ),
  testing_service_keys: z.array(z.string().min(1)).max(5).describe(
    "Up to 5 testing_services service_keys (from the supplied catalog) to " +
      "recommend to the customer. Pull from the rows where concern_categories " +
      "includes the chosen category. Return [] when no testing service is " +
      "needed (e.g. customer's issue is a clear-cut routine maintenance item).",
  ),
  reasoning: z.string().max(280).describe(
    "One-sentence rationale for the audit trail. Cite the customer's actual words.",
  ),
});

// ─── Catalog row types (read from Postgres) ──────────────────────────────────

interface ConcernQuestionRow {
  id: number;
  category: string;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  display_order: number;
}

interface TestingServiceCatalogRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  starting_price_cents: number;
  notes: string | null;
  concern_categories: string[] | null;
}

// ─── Pre-fetch helpers ──────────────────────────────────────────────────────

/**
 * Fetch the full concern_questions catalog for the shop, grouped by category.
 * One trip; the LLM sees ALL categories so it can shift category if its first
 * read disagrees with where the questions point.
 */
async function fetchConcernQuestionCatalog(
  sb: SupabaseClient,
  shopId: number,
): Promise<Map<ConcernCategory, ConcernQuestionRow[]>> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, category, question_text, options, display_order")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });
  if (error) {
    throw new Error(`concern_questions catalog fetch failed: ${error.message}`);
  }
  const grouped = new Map<ConcernCategory, ConcernQuestionRow[]>();
  for (const cat of CONCERN_CATEGORIES) grouped.set(cat, []);
  for (const row of (data ?? []) as ConcernQuestionRow[]) {
    const list = grouped.get(row.category as ConcernCategory);
    if (list) list.push(row);
  }
  return grouped;
}

/**
 * Fetch the testing-service catalog with concern_categories mapping. The
 * LLM matches each testing service to the chosen category via the
 * concern_categories array.
 */
async function fetchTestingServiceCatalog(
  sb: SupabaseClient,
  shopId: number,
): Promise<TestingServiceCatalogRow[]> {
  const { data, error } = await sb
    .from("testing_services")
    .select(
      "service_key, display_name, abbreviation, starting_price_cents, notes, concern_categories",
    )
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("service_key", { ascending: true });
  if (error) {
    throw new Error(`testing_services catalog fetch failed: ${error.message}`);
  }
  return (data ?? []) as TestingServiceCatalogRow[];
}

// ─── System prompt builder ──────────────────────────────────────────────────

function buildSystemPrompt(
  questionCatalog: Map<ConcernCategory, ConcernQuestionRow[]>,
  testingCatalog: TestingServiceCatalogRow[],
  alreadyAnsweredIds: number[],
): string {
  const catalogSummary = CONCERN_CATEGORIES.map((cat) => {
    const rows = questionCatalog.get(cat) ?? [];
    if (rows.length === 0) return `${cat}: (no questions seeded)`;
    const lines = rows.map((r) => `  - id=${r.id}: ${r.question_text}`);
    return `${cat}:\n${lines.join("\n")}`;
  }).join("\n\n");

  const testingSummary = testingCatalog
    .map(
      (s) =>
        `  - ${s.service_key} ($${(s.starting_price_cents / 100).toFixed(2)}+): ${s.display_name}${s.concern_categories && s.concern_categories.length > 0 ? ` [categories: ${s.concern_categories.join(", ")}]` : ""}`,
    )
    .join("\n");

  return `You are the diagnostic Q&A specialist for Jeff's Automotive. The
customer just described what they're noticing about their vehicle in free
form. Your job: classify the concern, decide which clarification questions
to ask next, and recommend any testing services that match.

# What you return (strict Zod schema)
- category: one of the 14 categories
- question_ids: 0-4 IDs from the catalog below, for the chosen category, that
  the customer hasn't already answered AND the customer's explanation doesn't
  already answer
- testing_service_keys: 0-5 service_keys from the testing catalog whose
  concern_categories include your chosen category
- reasoning: one sentence citing the customer's words

# Concern-question catalog (id → question)

${catalogSummary}

# Testing-service catalog

${testingSummary}

# Decision rules

1. **Classify FIRST.** Pick the best-matching category from the explanation.
   When the customer mentions multiple symptoms (e.g. "the brakes squeal AND
   the wheel shakes"), pick the MORE diagnostic one for category (brakes >
   noise for that combo). If ambiguous, use 'other'.

2. **Pick questions intentionally.** Don't dump every question for the
   category — skim the catalog and pick the 2-4 most informative ones for
   THIS customer's situation. If their explanation already answers a question
   (e.g. they said "front of the car", skip "where on the car"), skip it.
   Already-answered question IDs: ${JSON.stringify(alreadyAnsweredIds)}.

3. **Recommend testing services that match the category.** Each testing
   service has a concern_categories array — only recommend services whose
   array INCLUDES your chosen category. Don't invent service_keys.

4. **Empty arrays are fine.** If the customer's explanation is so complete
   that no further questions are needed, return question_ids=[]. If their
   concern is clearly routine maintenance and needs no testing, return
   testing_service_keys=[].

5. **Customer is non-technical.** When the catalog has 'noise' questions
   like "where on the car", they expect plain-language options like "front",
   "rear", "passenger side". Don't second-guess the catalog text — the
   chat agent renders the catalog's question_text + options verbatim.

6. **Output is for the SCHEDULER specialist, not the customer.** The
   scheduler will compose the customer-facing card; you just return the
   structured data.`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runDiagnosticSpecialist(
  args: DiagnosticSpecialistArgs,
): Promise<DiagnosticSpecialistResult> {
  const startedAt = new Date();
  const model = Deno.env.get("DIAGNOSTIC_SPECIALIST_MODEL") || DEFAULT_MODEL;

  // ── 1. Read already-answered question IDs from hints (if any) ────────────
  const alreadyAnsweredIds = Array.isArray(args.hints?.already_answered_ids)
    ? (args.hints.already_answered_ids as unknown[]).filter(
      (x): x is number => typeof x === "number" && Number.isInteger(x),
    )
    : [];

  // ── 2. Pre-fetch catalogs in parallel ────────────────────────────────────
  const recorderQuestionId = await args.recorder.recordStart({
    toolName: "diagnostic.fetch_concern_questions_catalog",
    input: {},
    stepNumber: 0,
  });
  const recorderTestingId = await args.recorder.recordStart({
    toolName: "diagnostic.fetch_testing_services_catalog",
    input: {},
    stepNumber: 0,
  });

  let questionCatalog: Map<ConcernCategory, ConcernQuestionRow[]>;
  let testingCatalog: TestingServiceCatalogRow[];
  try {
    [questionCatalog, testingCatalog] = await Promise.all([
      fetchConcernQuestionCatalog(args.sb, args.shopId),
      fetchTestingServiceCatalog(args.sb, args.shopId),
    ]);
    await args.recorder.recordEnd({
      toolCallId: recorderQuestionId,
      output: { categories: questionCatalog.size, total_questions: [...questionCatalog.values()].reduce((n, r) => n + r.length, 0) },
    });
    await args.recorder.recordEnd({
      toolCallId: recorderTestingId,
      output: { services: testingCatalog.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await args.recorder.recordEnd({ toolCallId: recorderQuestionId, error: msg });
    await args.recorder.recordEnd({ toolCallId: recorderTestingId, error: msg });
    const endedAt = new Date();
    return {
      directive: "tool_error",
      data: { message: `diagnostic_catalog_fetch_failed: ${msg.slice(0, 200)}` },
      flags: { internal_error: true },
      tools_called: [
        "diagnostic.fetch_concern_questions_catalog",
        "diagnostic.fetch_testing_services_catalog",
      ],
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: endedAt.getTime() - startedAt.getTime(),
      steps: 0,
      model,
      agent_started_at: startedAt.toISOString(),
      agent_ended_at: endedAt.toISOString(),
      raw_text: "",
      parsed_ok: false,
    };
  }

  // ── 3. Compose prompt + call generateObject ──────────────────────────────
  const promptParts: string[] = [
    `# Customer's concern explanation\n${args.context}`,
  ];
  if (args.hints && Object.keys(args.hints).length > 0) {
    const safeHints = { ...args.hints };
    // Strip already_answered_ids from hints — already incorporated into system prompt
    delete (safeHints as Record<string, unknown>).already_answered_ids;
    if (Object.keys(safeHints).length > 0) {
      promptParts.push(`# Hints\n${JSON.stringify(safeHints, null, 2)}`);
    }
  }
  if (args.sessionMetadata) {
    promptParts.push(
      `# Session metadata\n${JSON.stringify(args.sessionMetadata, null, 2)}`,
    );
  }

  const agentStartedAt = new Date();
  let parsed: z.infer<typeof DiagnosticSchema>;
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const result = await generateObject({
      model: anthropic(model),
      system: buildSystemPrompt(questionCatalog, testingCatalog, alreadyAnsweredIds),
      prompt: promptParts.join("\n\n"),
      schema: DiagnosticSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    parsed = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn = Number(usage.inputTokens ?? 0);
    tokensOut = Number(usage.outputTokens ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const endedAt = new Date();
    return {
      directive: "tool_error",
      data: { message: `diagnostic_llm_failed: ${msg.slice(0, 200)}` },
      flags: { llm_error: true },
      tools_called: [
        "diagnostic.fetch_concern_questions_catalog",
        "diagnostic.fetch_testing_services_catalog",
      ],
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: endedAt.getTime() - startedAt.getTime(),
      steps: 0,
      model,
      agent_started_at: agentStartedAt.toISOString(),
      agent_ended_at: endedAt.toISOString(),
      raw_text: "",
      parsed_ok: false,
    };
  }
  const agentEndedAt = new Date();

  // ── 4. Re-attach question_text + options + service display_name + price ──
  const categoryRows = questionCatalog.get(parsed.category) ?? [];
  const questionsToAsk = parsed.question_ids
    .map((qid) => categoryRows.find((r) => r.id === qid))
    .filter((r): r is ConcernQuestionRow => !!r)
    .map((r) => ({
      id: r.id,
      question_text: r.question_text,
      options: r.options,
    }));

  const testingServicesToRecommend = parsed.testing_service_keys
    .map((sk) => testingCatalog.find((s) => s.service_key === sk))
    .filter((s): s is TestingServiceCatalogRow => !!s)
    // Defensive: only keep services whose concern_categories actually include
    // the chosen category — guards against hallucinated mappings.
    .filter(
      (s) =>
        s.concern_categories && s.concern_categories.includes(parsed.category),
    )
    .map((s) => ({
      service_key: s.service_key,
      display_name: s.display_name,
      abbreviation: s.abbreviation,
      starting_price_cents: s.starting_price_cents,
      notes: s.notes,
    }));

  // ── 5. Pick directive based on what's remaining ─────────────────────────
  let directive: string;
  let data: Record<string, unknown>;
  if (questionsToAsk.length > 0) {
    directive = "clarify_concern_question";
    data = {
      category: parsed.category,
      questions: questionsToAsk,
      recommended_testing_services: testingServicesToRecommend,
      reasoning: parsed.reasoning,
    };
  } else if (testingServicesToRecommend.length > 0) {
    directive = "propose_testing_services";
    data = {
      category: parsed.category,
      recommended_testing_services: testingServicesToRecommend,
      reasoning: parsed.reasoning,
    };
  } else {
    directive = "continue";
    data = {
      category: parsed.category,
      message:
        "Diagnostic classified the concern but found no remaining questions or testing recommendations.",
      reasoning: parsed.reasoning,
    };
  }

  const endedAt = new Date();
  return {
    directive,
    data,
    flags: {
      category_classified: parsed.category,
      questions_remaining: questionsToAsk.length,
      testing_services_recommended: testingServicesToRecommend.length,
    },
    tools_called: [
      "diagnostic.fetch_concern_questions_catalog",
      "diagnostic.fetch_testing_services_catalog",
    ],
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: endedAt.getTime() - startedAt.getTime(),
    steps: 1, // single generateObject call
    model,
    agent_started_at: agentStartedAt.toISOString(),
    agent_ended_at: agentEndedAt.toISOString(),
    raw_text: JSON.stringify(parsed),
    parsed_ok: true,
  };
}
