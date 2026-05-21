#!/usr/bin/env node
/**
 * run-llm-test-batch.mjs — calls the llm-testing edge function N times
 * and writes a markdown report in Chris's curly-brace block format.
 *
 * Updated 2026-05-20 to consume the two-stage response shape from the
 * llm-testing edge function (v0.2.0+):
 *   - stage1: { raw, validated_category_key, ... }
 *   - stage2: { raw, validated_subcategory_slug, validated_unanswered_question_ids, ... } | null
 *   - validated: { ...combined wizard-facing state }
 *
 * Per-step labels:
 *   - matched 'X'        — successful step
 *   - LLM returned null  — LLM intentionally declined (not a failure)
 *   - hallucinated       — LLM returned a slug not in catalog; post-validation dropped it
 *   - silently_failed    — values dropped by validation without an explicit error
 *   - failed             — stage's LLM call errored or returned malformed structured output
 *   - short_circuit      — pre-LLM short-circuit (desc<3 chars)
 *   - skipped            — upstream step's outcome made this step a no-op
 *
 * Usage:
 *   ANON_KEY=<key> node scripts/run-llm-test-batch.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ════════════════════════════════════════════════════════════════════
// CONFIG (edit per batch)
// ════════════════════════════════════════════════════════════════════

const BATCH_LABEL = "llm-test-2-gemini-2stage-052026";
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
      step2: "skipped — no edge-function response",
      step3: "skipped — no edge-function response",
      step4: "skipped — no edge-function response",
      step5: "skipped — no edge-function response",
    };
  }

  const desc = call.concern.trim();
  const topErr = body.error_message;
  const stage1 = body.stage1;
  const stage2 = body.stage2;

  // STEP 1 — match category (Stage 1)
  let step1;
  if (topErr && topErr.startsWith("SHORT_CIRCUIT")) {
    step1 = `short_circuit — description was ${desc.length} chars (<3); LLM never called`;
  } else if (!stage1) {
    step1 = `failed — no stage1 block in response`;
  } else if (stage1.error_message) {
    step1 = `failed — stage1 LLM errored: ${stage1.error_message.slice(0, 120)}`;
  } else if (!stage1.raw) {
    step1 = `failed — stage1 returned no raw output`;
  } else if (stage1.raw.matched_category_key === null) {
    step1 = `LLM returned null — stage1 declined to categorize`;
  } else if (stage1.validated_category_key === null) {
    step1 = `hallucinated — stage1 returned '${stage1.raw.matched_category_key}' which is NOT in the catalog (post-validation nulled it)`;
  } else {
    step1 = `matched '${stage1.validated_category_key}'`;
  }

  // STEP 2 — vagueness check (pre-LLM)
  const step2 =
    desc.length < 3
      ? `triggered — description was ${desc.length} chars; LLM call skipped`
      : `passed — description has ${desc.length} chars (>=3)`;

  // STEP 3 — pick subcategory (Stage 2)
  let step3;
  if (!stage2) {
    step3 = `skipped — stage1 didn't produce a valid category match`;
  } else if (stage2.error_message) {
    step3 = `failed — stage2 LLM errored: ${stage2.error_message.slice(0, 120)}`;
  } else if (!stage2.raw) {
    step3 = `failed — stage2 returned no raw output`;
  } else if (stage2.raw.matched_subcategory_slug === null) {
    step3 = `LLM returned null — stage2 declined to pick a subcategory`;
  } else if (stage2.validated_subcategory_slug === null) {
    step3 = `hallucinated — stage2 returned subcategory '${stage2.raw.matched_subcategory_slug}' which is NOT in the matched category's eligible set`;
  } else {
    step3 = `matched '${stage2.validated_subcategory_slug}'`;
  }

  // STEP 4 — gap-detect questions (Stage 2)
  let step4;
  if (!stage2) {
    step4 = `skipped — stage1 didn't produce a valid category match`;
  } else if (stage2.error_message || !stage2.raw) {
    step4 = `skipped — stage2 didn't complete`;
  } else if (!stage2.validated_subcategory_slug) {
    step4 = `skipped — stage2 didn't produce a valid subcategory`;
  } else {
    const rawCount = (stage2.raw.unanswered_question_ids ?? []).length;
    const validCount = (stage2.validated_unanswered_question_ids ?? []).length;
    if (rawCount === 0) {
      step4 = `0 unanswered — stage2 said description covered all subcategory questions`;
    } else if (rawCount > validCount) {
      step4 = `silently_failed — stage2 returned ${rawCount} IDs but ${rawCount - validCount} weren't in matched subcategory; ${validCount} kept`;
    } else {
      step4 = `${validCount} unanswered IDs (all valid)`;
    }
  }

  // STEP 5 — generate reasoning (Stage 1 + Stage 2)
  let step5;
  const s1Reason = stage1?.raw?.reasoning?.trim();
  const s2Reason = stage2?.raw?.reasoning?.trim();
  if (!s1Reason && !s2Reason) {
    step5 = `missing — no reasoning returned by either stage`;
  } else if (!s1Reason) {
    step5 = `S1 missing · S2: "${s2Reason}"`;
  } else if (!s2Reason) {
    step5 = `S1: "${s1Reason}" · S2 skipped`;
  } else {
    step5 = `S1: "${s1Reason}" · S2: "${s2Reason}"`;
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
  lines.push(`  step 1 (match category, S1):       ${steps.step1}`);
  lines.push(`  step 2 (vagueness check):          ${steps.step2}`);
  lines.push(`  step 3 (pick subcategory, S2):     ${steps.step3}`);
  lines.push(`  step 4 (gap-detect questions, S2): ${steps.step4}`);
  lines.push(`  step 5 (generate reasoning):       ${steps.step5}`);

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

  // Per-stage diagnostic footer
  if (call.error) {
    lines.push(
      `<sub>HTTP ${call.httpStatus} · ERROR: ${call.error.slice(0, 120)}</sub>`,
    );
  } else {
    const b = call.body;
    const s1 = b.stage1;
    const s2 = b.stage2;
    const s1Line = s1
      ? `S1: ${s1.system_prompt_chars}ch · ${s1.latency_ms}ms · ${s1.tokens_in}/${s1.tokens_out}t${s1.error_message ? ` · err: ${s1.error_message.slice(0, 80)}` : ""}`
      : `S1: missing`;
    const s2Line = s2
      ? `S2: ${s2.system_prompt_chars}ch · ${s2.latency_ms}ms · ${s2.tokens_in}/${s2.tokens_out}t${s2.error_message ? ` · err: ${s2.error_message.slice(0, 80)}` : ""}`
      : `S2: skipped (no stage1 match)`;
    const totalLine = `Total: ${b.latency_ms}ms wall ${call.wallMs}ms · ${b.tokens_in}/${b.tokens_out}t${b.error_message ? ` · top-err: ${b.error_message.slice(0, 80)}` : ""}`;
    lines.push(`<sub>${s1Line} · ${s2Line} · ${totalLine}</sub>`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(`Running ${CONCERNS.length} concerns against ${FUNCTION_URL}\n`);
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
        `→ ${v.matched_category_key ?? "null"} / ${v.matched_subcategory_slug ?? "-"} (${call.body.latency_ms}ms)`,
      );
    }
    calls.push(call);
  }

  // Pull catalog + model info from first successful response.
  const firstOk = calls.find((c) => c.body);
  const catalogSize = firstOk?.body.catalog_size ?? "?";
  const testingCount = firstOk?.body.testing_service_count ?? "?";
  const otherCount = firstOk?.body.other_subcategory_count ?? "?";
  const stage1Model = firstOk?.body.stage1?.model ?? "?";
  const stage2Model = firstOk?.body.stage2?.model ?? stage1Model;

  // Aggregate stats.
  const stats = {
    total: calls.length,
    tsMatches: 0,
    otherMatches: 0,
    nullMatches: 0,
    s1HalCat: 0,
    s2HalSub: 0,
    s2SilentQ: 0,
    s1Failed: 0,
    s2Failed: 0,
    shortCircuit: 0,
    sumS1Latency: 0,
    sumS2Latency: 0,
    sumTokensIn: 0,
    sumTokensOut: 0,
  };

  const lines = [];
  lines.push(`# LLM diagnostic test — batch 2 (Gemini, two-stage, May 2026)`);
  lines.push("");
  lines.push(`**Ran:** ${new Date().toISOString()}`);
  lines.push(`**Architecture:** two-stage classifier (refactor 2026-05-20)`);
  lines.push(`**Stage 1 model:** \`${stage1Model}\` (category match — brief catalog)`);
  lines.push(`**Stage 2 model:** \`${stage2Model}\` (subcategory pick + gap-detect — single-category subtree)`);
  lines.push(`**Catalog at test time:** ${testingCount} testing services + ${otherCount} 'other' subcategories = ${catalogSize} entries`);
  lines.push(`**Chip hint:** Other Issue (no pre-classification — the hardest classification case)`);
  lines.push(`**Endpoint:** \`${FUNCTION_URL}\``);
  lines.push(`**Caching:** \`providerOptions.gateway.caching='auto'\` enabled on both stages.`);
  lines.push("");
  lines.push(`## Per-step labels`);
  lines.push("");
  lines.push(`- \`matched 'X'\` — successful step`);
  lines.push(`- \`LLM returned null\` — LLM intentionally declined (not a failure)`);
  lines.push(`- \`hallucinated\` — LLM returned a slug not in catalog; post-validation dropped it`);
  lines.push(`- \`silently_failed\` — values dropped by validation without an explicit error`);
  lines.push(`- \`failed\` — that stage's LLM call errored or returned malformed structured output`);
  lines.push(`- \`short_circuit\` — pre-LLM short-circuit (desc<3 chars)`);
  lines.push(`- \`skipped\` — upstream step's outcome made this step a no-op`);
  lines.push("");
  lines.push(`## Test cases`);
  lines.push("");

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const steps = analyzeSteps(call);
    lines.push(renderConcernBlock(call, i, steps));

    if (call.error) {
      stats.s1Failed += 1;
      continue;
    }
    const b = call.body;
    if (b.error_message?.startsWith("SHORT_CIRCUIT")) {
      stats.shortCircuit += 1;
    }
    const v = b.validated;
    if (v.recommended_testing_service) stats.tsMatches += 1;
    else if (v.matched_category_key !== null) stats.otherMatches += 1;
    else stats.nullMatches += 1;

    if (steps.step1.startsWith("hallucinated")) stats.s1HalCat += 1;
    if (steps.step3.startsWith("hallucinated")) stats.s2HalSub += 1;
    if (steps.step4.startsWith("silently_failed")) stats.s2SilentQ += 1;
    if (steps.step1.startsWith("failed")) stats.s1Failed += 1;
    if (steps.step3.startsWith("failed")) stats.s2Failed += 1;

    stats.sumS1Latency += b.stage1?.latency_ms ?? 0;
    stats.sumS2Latency += b.stage2?.latency_ms ?? 0;
    stats.sumTokensIn += b.tokens_in ?? 0;
    stats.sumTokensOut += b.tokens_out ?? 0;
  }

  lines.push(`## Batch summary`);
  lines.push("");
  lines.push(`| metric | value |`);
  lines.push(`|---|---|`);
  lines.push(`| total concerns | ${stats.total} |`);
  lines.push(`| matched a testing service | ${stats.tsMatches} |`);
  lines.push(`| matched an 'other' subcategory (forward-to-advisor) | ${stats.otherMatches} |`);
  lines.push(`| null match (forwarded to advisor) | ${stats.nullMatches} |`);
  lines.push(`| **stage 1** hallucinated category | ${stats.s1HalCat} |`);
  lines.push(`| **stage 1** LLM call failed | ${stats.s1Failed} |`);
  lines.push(`| **stage 2** hallucinated subcategory | ${stats.s2HalSub} |`);
  lines.push(`| **stage 2** silently filtered question IDs | ${stats.s2SilentQ} |`);
  lines.push(`| **stage 2** LLM call failed | ${stats.s2Failed} |`);
  lines.push(`| short-circuit triggered | ${stats.shortCircuit} |`);
  lines.push(`| sum stage-1 latencies | ${stats.sumS1Latency} ms |`);
  lines.push(`| sum stage-2 latencies | ${stats.sumS2Latency} ms |`);
  lines.push(`| sum input tokens | ${stats.sumTokensIn} |`);
  lines.push(`| sum output tokens | ${stats.sumTokensOut} |`);
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
    `Summary: ${stats.tsMatches} testing / ${stats.otherMatches} other / ${stats.nullMatches} null · S1 fail=${stats.s1Failed}, S2 fail=${stats.s2Failed} · S1 hal cat=${stats.s1HalCat}, S2 hal sub=${stats.s2HalSub} · S2 silent Q=${stats.s2SilentQ}`,
  );
}

void main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
