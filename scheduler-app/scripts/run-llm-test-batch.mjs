#!/usr/bin/env node
/**
 * run-llm-test-batch.mjs — calls the llm-testing edge function N times
 * and writes a markdown report in Chris's curly-brace block format.
 *
 * Usage:
 *   ANON_KEY=<key> node scripts/run-llm-test-batch.mjs
 *
 * Per-step failure detection compares the raw LLM output against the
 * post-validated state returned by llm-testing:
 *   - hallucinated category : raw.matched_category_key set, validated null
 *   - hallucinated subcategory: raw.matched_subcategory_slug set,
 *                                validated.matched_subcategory_slug null
 *   - silently_failed IDs : raw count > validated count
 *   - failed              : error_message present (not SHORT_CIRCUIT)
 *   - short_circuit       : desc<3 chars (no LLM call)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ════════════════════════════════════════════════════════════════════
// CONFIG (edit per batch)
// ════════════════════════════════════════════════════════════════════

const BATCH_LABEL = "llm-test-1-052026";
const OUTPUT_DIR_RELATIVE = "docs/chat-instructions/diagnostic-llm-tests";
const FUNCTION_URL =
  "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/llm-testing";

const CONCERNS = [
  // ── Common single-symptom (10) ──────────────────────────────────────
  "My car makes a loud knocking noise when I first start it in the morning but it stops after about a minute",
  "Brakes squeak really bad when I'm coming to a stop especially at slow speeds",
  "AC blows hot air on the driver side but cold on the passenger side",
  "When I turn the steering wheel all the way left I hear a clicking noise",
  "Battery keeps dying overnight even though it's only 2 years old",
  "There's a sweet syrupy smell coming from under the hood after driving for a while",
  "White smoke coming out the tailpipe when I accelerate hard",
  "Brake pedal goes almost to the floor before the brakes engage",
  "Steering wheel pulls hard to the right whenever I let go on the highway",
  "Tires wearing unevenly on the front passenger side, looks like cupping",
  // ── Warning lights (4) ─────────────────────────────────────────────
  "Check engine light came on yesterday but car drives normal",
  "ABS light just turned on a few minutes ago and stayed on",
  "Airbag light is flashing intermittently",
  "Oil pressure light flickers when I come to a stop at idle",
  // ── Edge cases — 'other' situations (6) ────────────────────────────
  "Car has been sitting in my driveway for 8 months, want to make sure it's road ready before driving it",
  "Just got rear-ended last week and now the car pulls left, want to make sure suspension is OK",
  "Going on a 1500 mile road trip next weekend, want a complete check before I go",
  "Just had new tires installed at Discount Tire yesterday and now I feel a vibration at 65mph",
  "Engine bay smells like burning oil after I drive for like 20 minutes",
  "Squealing high-pitched noise from the front right wheel when I brake but only sometimes",
  // ── Vague / multi-symptom (5) ──────────────────────────────────────
  "Something just feels off, can't really describe it",
  "Car shakes when braking at highway speeds AND the check engine light is on AND it pulls left",
  "It's making a weird noise",
  "I think my transmission is slipping but I'm not really sure",
  "The car just isn't right anymore",
];

// ════════════════════════════════════════════════════════════════════

const ANON_KEY = process.env.ANON_KEY;
if (!ANON_KEY) {
  console.error("Set ANON_KEY env var (Supabase anon/publishable key).");
  process.exit(1);
}

async function callLlm(concernText) {
  const t0 = Date.now();
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ concern_text: concernText }),
  });
  const wall = Date.now() - t0;
  if (!res.ok) {
    return {
      concern: concernText,
      wallMs: wall,
      httpStatus: res.status,
      body: null,
      error: `HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`,
    };
  }
  const body = await res.json();
  return { concern: concernText, wallMs: wall, httpStatus: 200, body, error: null };
}

function analyzeSteps(call) {
  const { body, error } = call;
  if (error) {
    return {
      step1: `failed — request errored: ${error.slice(0, 120)}`,
      step2: "skipped — no LLM response",
      step3: "skipped — no LLM response",
      step4: "skipped — no LLM response",
      step5: "skipped — no LLM response",
    };
  }

  const desc = call.concern.trim();
  const raw = body.raw;
  const validated = body.validated;
  const errMsg = body.error_message;

  // STEP 1 — match category
  let step1;
  if (errMsg && errMsg.startsWith("SHORT_CIRCUIT")) {
    step1 = `short_circuit — description was ${desc.length} chars (<3); LLM call skipped`;
  } else if (errMsg) {
    step1 = `failed — LLM call errored: ${errMsg.slice(0, 120)}`;
  } else if (!raw) {
    step1 = `failed — no raw LLM output`;
  } else if (raw.matched_category_key === null) {
    step1 = `LLM returned null — declined to categorize`;
  } else if (validated.matched_category_key === null) {
    step1 = `hallucinated — LLM returned '${raw.matched_category_key}' which is NOT in the catalog (post-validation nulled it)`;
  } else {
    step1 = `matched '${validated.matched_category_key}'`;
  }

  // STEP 2 — vagueness check
  const step2 =
    desc.length < 3
      ? `triggered — description was ${desc.length} chars; LLM call skipped`
      : `passed — description has ${desc.length} chars (>=3)`;

  // STEP 3 — pick subcategory
  let step3;
  if (!validated || validated.matched_category_key === null) {
    step3 = `skipped — no matched category from step 1`;
  } else if (!raw) {
    step3 = `skipped — no LLM output`;
  } else if (raw.matched_subcategory_slug === null) {
    step3 = `LLM returned null — no subcategory picked`;
  } else if (validated.matched_subcategory_slug === null) {
    step3 = `hallucinated — LLM returned subcategory '${raw.matched_subcategory_slug}' which is NOT in the matched category's eligible set`;
  } else {
    step3 = `matched '${validated.matched_subcategory_slug}'`;
  }

  // STEP 4 — gap-detect questions
  let step4;
  if (!validated || !validated.matched_subcategory_slug) {
    step4 = `skipped — no valid subcategory from step 3`;
  } else if (!raw) {
    step4 = `skipped — no LLM output`;
  } else {
    const rawCount = (raw.unanswered_question_ids ?? []).length;
    const validCount = (validated.unanswered_question_ids ?? []).length;
    if (rawCount === 0) {
      step4 = `0 unanswered — LLM said description covered all subcategory questions`;
    } else if (rawCount > validCount) {
      step4 = `silently_failed — LLM returned ${rawCount} IDs but ${rawCount - validCount} weren't in matched subcategory; ${validCount} kept`;
    } else {
      step4 = `${validCount} unanswered IDs (all valid)`;
    }
  }

  // STEP 5 — generate reasoning
  let step5;
  if (!raw) {
    step5 = `skipped — no LLM output`;
  } else if (!raw.reasoning || raw.reasoning.trim().length === 0) {
    step5 = `failed — reasoning missing or empty`;
  } else {
    step5 = `"${raw.reasoning.trim()}"`;
  }

  return { step1, step2, step3, step4, step5 };
}

function renderConcernBlock(call, i, steps) {
  const lines = [];
  lines.push(`### Test ${i + 1}`);
  lines.push("");
  lines.push("```");
  lines.push("{");
  lines.push(`concern: ${call.concern}`);
  lines.push("LLM decision tree:");
  lines.push(`  step 1 (match category):       ${steps.step1}`);
  lines.push(`  step 2 (vagueness check):      ${steps.step2}`);
  lines.push(`  step 3 (pick subcategory):     ${steps.step3}`);
  lines.push(`  step 4 (gap-detect questions): ${steps.step4}`);
  lines.push(`  step 5 (generate reasoning):   ${steps.step5}`);

  const v = call.body?.validated;
  lines.push(`matched category key: ${v?.matched_category_key ?? "null"}`);
  lines.push(`matched sub category slug: ${v?.matched_subcategory_slug ?? "null"}`);
  lines.push(
    `unanswered question ids: [${(v?.unanswered_question_ids ?? []).join(", ")}]`,
  );
  const ts = v?.recommended_testing_service;
  lines.push(
    `testing service recommended: ${ts ? `${ts.service_key} — ${ts.display_name} ($${(ts.starting_price_cents / 100).toFixed(2)})` : "none (forwarded to advisor)"}`,
  );
  lines.push("}");
  lines.push("```");
  lines.push("");
  const httpInfo = call.error
    ? `HTTP ${call.httpStatus} · ERROR: ${call.error.slice(0, 120)}`
    : `Latency: ${call.body.latency_ms}ms (wall ${call.wallMs}ms) · Tokens in/out: ${call.body.tokens_in}/${call.body.tokens_out}${call.body.error_message ? ` · err: ${call.body.error_message.slice(0, 120)}` : ""}`;
  lines.push(`<sub>${httpInfo}</sub>`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(
    `Running ${CONCERNS.length} concerns against ${FUNCTION_URL}\n`,
  );
  const calls = [];
  for (let i = 0; i < CONCERNS.length; i++) {
    process.stdout.write(
      `[${String(i + 1).padStart(2, "0")}/${CONCERNS.length}] "${CONCERNS[i].slice(0, 60)}…" `,
    );
    const call = await callLlm(CONCERNS[i]);
    if (call.error) {
      console.log(`✗ ${call.error.slice(0, 80)}`);
    } else {
      const v = call.body.validated;
      console.log(
        `→ ${v.matched_category_key ?? "null"} (${call.body.latency_ms}ms)`,
      );
    }
    calls.push(call);
  }

  // Pull catalog stats from the first successful response
  const firstOk = calls.find((c) => c.body);
  const catalogSize = firstOk?.body.catalog_size ?? "?";
  const testingCount = firstOk?.body.testing_service_count ?? "?";
  const otherCount = firstOk?.body.other_subcategory_count ?? "?";
  const model = firstOk?.body.model ?? "?";

  // Aggregate stats for summary
  const stats = {
    total: calls.length,
    tsMatches: 0,
    otherMatches: 0,
    nullMatches: 0,
    halCat: 0,
    halSub: 0,
    silentQ: 0,
    failed: 0,
    shortCircuit: 0,
  };

  const lines = [];
  lines.push(`# LLM diagnostic test — batch 1 (May 2026)`);
  lines.push("");
  lines.push(`**Ran:** ${new Date().toISOString()}`);
  lines.push(`**Model:** \`${model}\``);
  lines.push(
    `**Catalog at test time:** ${testingCount} active testing services + ${otherCount} 'other' subcategories = ${catalogSize} entries`,
  );
  lines.push(
    `**Chip hint:** Other Issue (no pre-classification — the hardest classification case for the LLM)`,
  );
  lines.push(`**Endpoint:** \`${FUNCTION_URL}\``);
  lines.push("");
  lines.push(`## Per-step labels`);
  lines.push("");
  lines.push(`- \`matched 'X'\` — successful step`);
  lines.push(`- \`LLM returned null\` — LLM intentionally declined (not a failure)`);
  lines.push(
    `- \`hallucinated\` — LLM returned a slug not in the catalog; post-validation dropped it`,
  );
  lines.push(
    `- \`silently_failed\` — values dropped by validation without an explicit error (e.g. question IDs not in the matched subcategory)`,
  );
  lines.push(
    `- \`failed\` — LLM call itself errored or returned malformed structured output`,
  );
  lines.push(`- \`short_circuit\` — pre-LLM short-circuit (desc<3 chars)`);
  lines.push(`- \`skipped\` — upstream step's outcome made this step a no-op`);
  lines.push("");
  lines.push(`## Test cases`);
  lines.push("");

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const steps = analyzeSteps(call);
    lines.push(renderConcernBlock(call, i, steps));

    // tally stats
    if (call.error) {
      stats.failed += 1;
      continue;
    }
    const v = call.body.validated;
    if (call.body.error_message?.startsWith("SHORT_CIRCUIT")) {
      stats.shortCircuit += 1;
    } else if (call.body.error_message) {
      stats.failed += 1;
    }
    if (v.recommended_testing_service) stats.tsMatches += 1;
    else if (v.matched_category_key !== null) stats.otherMatches += 1;
    else stats.nullMatches += 1;
    if (steps.step1.startsWith("hallucinated")) stats.halCat += 1;
    if (steps.step3.startsWith("hallucinated")) stats.halSub += 1;
    if (steps.step4.startsWith("silently_failed")) stats.silentQ += 1;
  }

  // Summary table
  const totalLatency = calls.reduce(
    (sum, c) => sum + (c.body?.latency_ms ?? 0),
    0,
  );
  const totalTokens = calls.reduce(
    (sum, c) => sum + (c.body?.tokens_in ?? 0) + (c.body?.tokens_out ?? 0),
    0,
  );
  lines.push(`## Batch summary`);
  lines.push("");
  lines.push(`| metric | value |`);
  lines.push(`|---|---|`);
  lines.push(`| total concerns | ${stats.total} |`);
  lines.push(`| matched a testing service | ${stats.tsMatches} |`);
  lines.push(
    `| matched an 'other' subcategory (forward-to-advisor) | ${stats.otherMatches} |`,
  );
  lines.push(`| null match (forwarded to advisor) | ${stats.nullMatches} |`);
  lines.push(`| hallucinated category (step 1) | ${stats.halCat} |`);
  lines.push(`| hallucinated subcategory (step 3) | ${stats.halSub} |`);
  lines.push(
    `| silently filtered question IDs (step 4) | ${stats.silentQ} |`,
  );
  lines.push(`| LLM call failed (step 1 failed) | ${stats.failed} |`);
  lines.push(`| short-circuit triggered (step 2) | ${stats.shortCircuit} |`);
  lines.push(`| sum of LLM latencies | ${totalLatency} ms |`);
  lines.push(`| sum of tokens (in + out) | ${totalTokens} |`);
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const repoRoot = resolve(__dirname, "..", "..");
  const outDir = resolve(repoRoot, OUTPUT_DIR_RELATIVE);
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${BATCH_LABEL}.md`);
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(
    `Summary: ${stats.tsMatches} testing / ${stats.otherMatches} other / ${stats.nullMatches} null · hallucinated cat=${stats.halCat}, sub=${stats.halSub} · silently-filtered Qs=${stats.silentQ} · failed=${stats.failed}`,
  );
}

void main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
