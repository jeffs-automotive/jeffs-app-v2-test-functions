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

const BATCH_LABEL = "llm-test-10-anthropic-sdk-confidence-smoke-052126";
const OUTPUT_DIR_RELATIVE = "docs/chat-instructions/diagnostic-llm-tests";
const FUNCTION_URL =
  "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/llm-testing";

const CONCERNS = [
  // ── Multi-symptom (10) ──────────────────────────────────────────────
  "Brakes squeal AND my steering wheel shakes when I stop hard",
  "Engine runs rough AND my heat is barely working",
  "Battery dies overnight AND I hear a clicking sound when I try to start",
  "AC stopped working AND I smell coolant",
  "Car pulls to the right AND the brakes feel spongy",
  "Loud thump from rear when I brake AND I see fluid spots on my driveway",
  "Check engine light came on AND the gas mileage tanked",
  "Car shakes at highway speeds AND tires look fine",
  "Hesitates on acceleration AND I hear a popping sound",
  "Idles rough AND smells like gas inside the cabin",
  // ── Borderline-vague (10) ───────────────────────────────────────────
  "Sometimes it does this thing where it kinda jerks",
  "Acts weird in the morning before warming up",
  "Maintenance light is something I should probably get checked",
  "I think I need an inspection",
  "Im not really sure but it feels off",
  "Want to make sure everything is good before a road trip",
  "I bought this car used and want a complete check",
  "Lights look different than they used to be",
  "Car is making a noise I cant describe",
  "I just want it looked at",
  // ── Advisor handoff / service request (5) ───────────────────────────
  "Buddy of mine said I need a head gasket",
  "The other shop said I need brakes",
  "Want a second opinion on what my dealer told me",
  "Need an oil change and tire rotation",
  "Need a state inspection",
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
      step6: "skipped — no edge-function response",
      stage1Confidence: null,
      stage2Confidence: null,
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

  // STEP 5 — confidence (added 2026-05-21)
  const s1Conf = stage1?.raw?.confidence ?? null;
  const s2Conf = stage2?.raw?.confidence ?? null;
  let step5;
  if (!s1Conf && !s2Conf) {
    step5 = `missing — no confidence returned by either stage`;
  } else if (!s1Conf) {
    step5 = `S1 missing · S2: ${s2Conf}`;
  } else if (!s2Conf) {
    step5 = `S1: ${s1Conf} · S2 skipped`;
  } else {
    step5 = `S1: ${s1Conf} · S2: ${s2Conf}`;
  }

  // STEP 6 — reasoning (Stage 1 + Stage 2)
  let step6;
  const s1Reason = stage1?.raw?.reasoning?.trim();
  const s2Reason = stage2?.raw?.reasoning?.trim();
  if (!s1Reason && !s2Reason) {
    step6 = `missing — no reasoning returned by either stage`;
  } else if (!s1Reason) {
    step6 = `S1 missing · S2: "${s2Reason}"`;
  } else if (!s2Reason) {
    step6 = `S1: "${s1Reason}" · S2 skipped`;
  } else {
    step6 = `S1: "${s1Reason}" · S2: "${s2Reason}"`;
  }

  return {
    step1,
    step2,
    step3,
    step4,
    step5,
    step6,
    stage1Confidence: s1Conf,
    stage2Confidence: s2Conf,
  };
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
  lines.push(`  step 5 (confidence):               ${steps.step5}`);
  lines.push(`  step 6 (reasoning):                ${steps.step6}`);

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
    // Confidence buckets (added 2026-05-21)
    s1ConfHigh: 0,
    s1ConfMedium: 0,
    s1ConfLow: 0,
    s1ConfMissing: 0,
    s2ConfHigh: 0,
    s2ConfMedium: 0,
    s2ConfLow: 0,
    s2ConfMissing: 0,
  };

  const lines = [];
  lines.push(`# LLM diagnostic test — batch 10 (Haiku, Path C, confidence + subcategory-mapping smoke, May 2026)`);
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
  lines.push(`- step 5 (confidence): self-reported \`high\` / \`medium\` / \`low\` per stage. 'high' = clear single fit; 'medium' = best of 2-3 plausible; 'low' = vague / forced match. Used downstream to route low-confidence picks to advisor review.`);
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

    // Confidence buckets
    const s1c = steps.stage1Confidence;
    if (s1c === "high") stats.s1ConfHigh += 1;
    else if (s1c === "medium") stats.s1ConfMedium += 1;
    else if (s1c === "low") stats.s1ConfLow += 1;
    else stats.s1ConfMissing += 1;
    const s2c = steps.stage2Confidence;
    if (s2c === "high") stats.s2ConfHigh += 1;
    else if (s2c === "medium") stats.s2ConfMedium += 1;
    else if (s2c === "low") stats.s2ConfLow += 1;
    else stats.s2ConfMissing += 1;
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
  lines.push(`| **stage 1** confidence: high / medium / low / missing | ${stats.s1ConfHigh} / ${stats.s1ConfMedium} / ${stats.s1ConfLow} / ${stats.s1ConfMissing} |`);
  lines.push(`| **stage 2** confidence: high / medium / low / missing | ${stats.s2ConfHigh} / ${stats.s2ConfMedium} / ${stats.s2ConfLow} / ${stats.s2ConfMissing} |`);
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
