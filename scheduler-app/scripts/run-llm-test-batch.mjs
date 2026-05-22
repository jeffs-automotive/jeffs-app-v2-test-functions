#!/usr/bin/env node
/**
 * run-llm-test-batch.mjs — calls the llm-testing edge function N times
 * and writes a markdown report in Chris's curly-brace block format.
 *
 * Updated 2026-05-21 to consume the THREE-STAGE response shape from the
 * llm-testing edge function (v0.3.0+):
 *   - stage1: { raw: { matched_category_key, confidence, reasoning }, validated_category_key, ... }
 *   - stage2: { raw: { matched_subcategory_slug, confidence, reasoning }, validated_subcategory_slug, ... } | null
 *   - stage3: { raw: { extracted_facts, confidence, reasoning }, extracted_facts, ... } | null
 *   - mapper: { answered_ids, unanswered_ids, ambiguous_ids } | null
 *   - validated: { ...combined wizard-facing state, including recommended_testing_service }
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
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ════════════════════════════════════════════════════════════════════
// CONFIG (edit per batch OR pass --config <path-to-json> at CLI)
// ════════════════════════════════════════════════════════════════════

// When invoked with `--config <path>`, BATCH_LABEL + CONCERNS are read
// from the JSON file (shape: { label: string, concerns: string[] }).
// Otherwise the in-file defaults below are used.

let BATCH_LABEL = "llm-test-17-batch10-post-repair-obd-codes-technical-v1-052126";
const OUTPUT_DIR_RELATIVE = "docs/chat-instructions/diagnostic-llm-tests";
const FUNCTION_URL =
  "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/llm-testing";

let CONCERNS = [
  // ── Post-repair (8) ─────────────────────────────────────────────────
  "Just had brakes replaced two days ago and now there's a grinding noise",
  "Got an alignment done last week and now the steering wheel is off-center",
  "New tires installed yesterday and my TPMS light is on",
  "Mechanic flushed my coolant a week ago and now it's leaking from somewhere",
  "I had spark plugs replaced and now my car runs rougher than before",
  "Replaced battery last month and now my car won't start in cold weather",
  "Just got the timing belt done and engine sounds different",
  "Oil change last week and now there's an oil spot on the driveway",
  // ── OBD codes (7) ───────────────────────────────────────────────────
  "Got a P0420 code at autozone, what does that mean",
  "Check engine light on with P0301 P0302 P0303 - they said misfires",
  "Scanner showed P0171 lean condition",
  "Multiple codes - P0128 thermostat and P0440 evap",
  "P0455 large evap leak detected",
  "Got code P0700 transmission control system",
  "Reader says U0100 lost communication with ECM",
  // ── Technical descriptions (10) ─────────────────────────────────────
  "I think my catalytic converter is shot, the car is sluggish",
  "Pretty sure it's the alternator going bad",
  "Might be the throttle position sensor",
  "I read online it could be the mass air flow sensor",
  "Mechanic friend said it sounds like the harmonic balancer",
  "I think the wheel bearings are bad on the front passenger",
  "Sounds like exhaust manifold gasket leak",
  "Probably the IAC valve based on idle behavior",
  "Might need a new fuel pump - cranks but won't start sometimes",
  "Could be a vacuum leak somewhere in the intake",
];

// Optional CLI override: --config <path-to-json>
{
  const argv = process.argv.slice(2);
  const cfgIdx = argv.indexOf("--config");
  if (cfgIdx !== -1 && argv[cfgIdx + 1]) {
    const cfgPath = argv[cfgIdx + 1];
    const raw = readFileSync(cfgPath, "utf-8");
    const cfg = JSON.parse(raw);
    if (typeof cfg.label !== "string" || !Array.isArray(cfg.concerns)) {
      console.error(`--config ${cfgPath}: expected { label: string, concerns: string[] }`);
      process.exit(1);
    }
    BATCH_LABEL = cfg.label;
    CONCERNS = cfg.concerns;
  }
}

// ════════════════════════════════════════════════════════════════════

// Accept either ANON_KEY or SUPABASE_ANON_KEY. The latter matches the name
// in scheduler-app/.env.local so we can run via:
//   node --env-file=.env.local scripts/run-llm-test-batch.mjs --config ...
// without inlining the JWT in the shell command (keeps the key out of
// transcripts / shell history per Chris's secrets-handling rule).
const ANON_KEY = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!ANON_KEY) {
  console.error("Set ANON_KEY (or SUPABASE_ANON_KEY) env var — the Supabase anon/publishable key.");
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

/**
 * Count non-null slots in an ExtractedFacts object. Empty strings count as
 * null (mirrors the deterministic mapper's "presence" rule).
 */
function countExtractedFactSlots(facts) {
  if (!facts || typeof facts !== "object") return 0;
  let count = 0;
  for (const value of Object.values(facts)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    count += 1;
  }
  return count;
}

/**
 * Render the non-null slots from an ExtractedFacts object as `key: value`
 * lines. Skips null / empty-string slots. Returns an array of lines (without
 * trailing newlines) ready to be joined.
 */
function renderExtractedFactLines(facts) {
  if (!facts || typeof facts !== "object") return [];
  const lines = [];
  for (const [key, value] of Object.entries(facts)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    lines.push(`  ${key}: ${JSON.stringify(value)}`);
  }
  return lines;
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
      step7: "skipped — no edge-function response",
      step8: "skipped — no edge-function response",
      stage1Confidence: null,
      stage2Confidence: null,
      stage3Confidence: null,
      stage3SlotCount: 0,
      stage3Failed: true,
      mapperAnswered: 0,
      mapperUnanswered: 0,
      mapperAmbiguous: 0,
      extractedFactLines: [],
    };
  }

  const desc = call.concern.trim();
  const topErr = body.error_message;
  const stage1 = body.stage1;
  const stage2 = body.stage2;
  const stage3 = body.stage3;
  const mapper = body.mapper;

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

  // STEP 4 — extract facts (Stage 3)
  let step4;
  let stage3SlotCount = 0;
  let stage3Failed = false;
  if (!stage3) {
    step4 = `skipped — no S2 match (stage3 didn't run)`;
    stage3Failed = false; // Not a failure if S2 had no match
  } else if (stage3.error_message) {
    step4 = `failed — stage3 LLM errored: ${stage3.error_message.slice(0, 120)}`;
    stage3Failed = true;
  } else if (!stage3.raw) {
    step4 = `failed — stage3 returned no raw output (parse_error)`;
    stage3Failed = true;
  } else {
    const facts = stage3.raw.extracted_facts ?? stage3.extracted_facts ?? null;
    stage3SlotCount = countExtractedFactSlots(facts);
    step4 = `extracted ${stage3SlotCount} non-null slots`;
  }

  // STEP 5 — deterministic mapper
  let step5;
  let mapperAnswered = 0;
  let mapperUnanswered = 0;
  let mapperAmbiguous = 0;
  if (!mapper) {
    step5 = `skipped — no mapper output (no S2 match or stage3 failed)`;
  } else {
    mapperAnswered = (mapper.answered_ids ?? []).length;
    mapperUnanswered = (mapper.unanswered_ids ?? []).length;
    mapperAmbiguous = (mapper.ambiguous_ids ?? []).length;
    step5 = `answered=${mapperAnswered} unanswered=${mapperUnanswered} ambiguous=${mapperAmbiguous} (from mapper)`;
  }

  // STEP 6 — gap-detect questions (FINAL unanswered_ids from validated)
  const validatedUnanswered = body.validated?.unanswered_question_ids ?? [];
  let step6;
  if (validatedUnanswered.length === 0 && !stage2) {
    step6 = `skipped — no subcategory matched`;
  } else if (validatedUnanswered.length === 0) {
    step6 = `0 unanswered — every question covered (or no questions on matched subcategory)`;
  } else {
    step6 = `${validatedUnanswered.length} unanswered IDs: [${validatedUnanswered.join(", ")}]`;
  }

  // STEP 7 — confidence per stage
  const s1Conf = stage1?.raw?.confidence ?? null;
  const s2Conf = stage2?.raw?.confidence ?? null;
  const s3Conf = stage3?.raw?.confidence ?? null;
  const confParts = [];
  confParts.push(s1Conf ? `S1: ${s1Conf}` : `S1 missing`);
  if (stage2) {
    confParts.push(s2Conf ? `S2: ${s2Conf}` : `S2 missing`);
  } else {
    confParts.push(`S2 skipped`);
  }
  if (stage3) {
    confParts.push(s3Conf ? `S3: ${s3Conf}` : `S3 missing`);
  } else {
    confParts.push(`S3 skipped`);
  }
  const step7 = confParts.join(" · ");

  // STEP 8 — reasoning per stage
  const s1Reason = stage1?.raw?.reasoning?.trim();
  const s2Reason = stage2?.raw?.reasoning?.trim();
  const s3Reason = stage3?.raw?.reasoning?.trim();
  const reasonParts = [];
  reasonParts.push(s1Reason ? `S1: "${s1Reason}"` : `S1 missing`);
  if (stage2) {
    reasonParts.push(s2Reason ? `S2: "${s2Reason}"` : `S2 missing`);
  } else {
    reasonParts.push(`S2 skipped`);
  }
  if (stage3) {
    reasonParts.push(s3Reason ? `S3: "${s3Reason}"` : `S3 missing`);
  } else {
    reasonParts.push(`S3 skipped`);
  }
  const step8 = reasonParts.join(" · ");

  // Extracted facts block — non-null slots only
  const extractedFactsRaw =
    stage3?.raw?.extracted_facts ?? stage3?.extracted_facts ?? null;
  const extractedFactLines = renderExtractedFactLines(extractedFactsRaw);

  return {
    step1,
    step2,
    step3,
    step4,
    step5,
    step6,
    step7,
    step8,
    stage1Confidence: s1Conf,
    stage2Confidence: s2Conf,
    stage3Confidence: s3Conf,
    stage3SlotCount,
    stage3Failed,
    mapperAnswered,
    mapperUnanswered,
    mapperAmbiguous,
    extractedFactLines,
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
  lines.push(`  step 4 (extract facts, S3):        ${steps.step4}`);
  lines.push(`  step 5 (deterministic mapper):     ${steps.step5}`);
  lines.push(`  step 6 (gap-detect questions):     ${steps.step6}`);
  lines.push(`  step 7 (confidence per stage):     ${steps.step7}`);
  lines.push(`  step 8 (reasoning):                ${steps.step8}`);

  // extracted_facts block — only render the non-null slots
  if (steps.extractedFactLines.length > 0) {
    lines.push(`extracted_facts:`);
    for (const factLine of steps.extractedFactLines) {
      lines.push(factLine);
    }
  } else {
    lines.push(`extracted_facts: (none — S3 did not run, failed, or extracted zero slots)`);
  }

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
    const s3 = b.stage3;
    const s1Line = s1
      ? `S1: ${s1.system_prompt_chars}ch · ${s1.latency_ms}ms · ${s1.tokens_in}/${s1.tokens_out}t${s1.error_message ? ` · err: ${s1.error_message.slice(0, 80)}` : ""}`
      : `S1: missing`;
    const s2Line = s2
      ? `S2: ${s2.system_prompt_chars}ch · ${s2.latency_ms}ms · ${s2.tokens_in}/${s2.tokens_out}t${s2.error_message ? ` · err: ${s2.error_message.slice(0, 80)}` : ""}`
      : `S2: skipped (no stage1 match)`;
    const s3Line = s3
      ? `S3: ${s3.system_prompt_chars}ch · ${s3.latency_ms}ms · ${s3.tokens_in}/${s3.tokens_out}t${s3.error_message ? ` · err: ${s3.error_message.slice(0, 80)}` : ""}`
      : `S3: skipped (no stage2 match)`;
    const totalLine = `Total: ${b.latency_ms}ms wall ${call.wallMs}ms · ${b.tokens_in}/${b.tokens_out}t${b.error_message ? ` · top-err: ${b.error_message.slice(0, 80)}` : ""}`;
    lines.push(`<sub>${s1Line} · ${s2Line} · ${s3Line} · ${totalLine}</sub>`);
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
  const stage3Model = firstOk?.body.stage3?.model ?? stage1Model;

  // Aggregate stats.
  const stats = {
    total: calls.length,
    tsMatches: 0,
    otherMatches: 0,
    nullMatches: 0,
    s1HalCat: 0,
    s2HalSub: 0,
    s1Failed: 0,
    s2Failed: 0,
    s3Failed: 0,
    shortCircuit: 0,
    sumS1Latency: 0,
    sumS2Latency: 0,
    sumS3Latency: 0,
    sumTokensIn: 0,
    sumTokensOut: 0,
    // Confidence buckets (S1, S2, S3)
    s1ConfHigh: 0,
    s1ConfMedium: 0,
    s1ConfLow: 0,
    s1ConfMissing: 0,
    s2ConfHigh: 0,
    s2ConfMedium: 0,
    s2ConfLow: 0,
    s2ConfMissing: 0,
    s3ConfHigh: 0,
    s3ConfMedium: 0,
    s3ConfLow: 0,
    s3ConfMissing: 0,
    // Mapper totals — summed across all tests
    mapperAnsweredTotal: 0,
    mapperUnansweredTotal: 0,
    mapperAmbiguousTotal: 0,
    // Stage 3 slot-extraction stats
    s3SlotCountTotal: 0,
    s3SlotCountSamples: 0, // count of tests where S3 actually ran successfully
  };

  const lines = [];
  lines.push(
    `# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)`,
  );
  lines.push("");
  lines.push(`**Ran:** ${new Date().toISOString()}`);
  lines.push(
    `**Architecture:** three-stage classifier (Stage 1 category → Stage 2 subcategory → Stage 3 fact extraction → deterministic mapper) (refactor 2026-05-21)`,
  );
  lines.push(
    `**Stage 1 model:** \`${stage1Model}\` (category match — brief catalog)`,
  );
  lines.push(
    `**Stage 2 model:** \`${stage2Model}\` (subcategory pick — single-category subtree with enriched descriptions + positive/negative examples + synonyms)`,
  );
  lines.push(
    `**Stage 3 model:** \`${stage3Model}\` (fact extraction — ~29 typed slots; no question text)`,
  );
  lines.push(
    `**Catalog at test time:** ${testingCount} testing services + ${otherCount} 'other' subcategories = ${catalogSize} entries`,
  );
  lines.push(
    `**Chip hint:** Other Issue (no pre-classification — the hardest classification case)`,
  );
  lines.push(`**Endpoint:** \`${FUNCTION_URL}\``);
  lines.push(
    `**Caching:** \`providerOptions.gateway.caching='auto'\` enabled on all three stages.`,
  );
  lines.push("");
  lines.push(`## Per-step labels`);
  lines.push("");
  lines.push(`- \`matched 'X'\` — successful step`);
  lines.push(
    `- \`LLM returned null\` — LLM intentionally declined (not a failure)`,
  );
  lines.push(
    `- \`hallucinated\` — LLM returned a slug not in catalog; post-validation dropped it`,
  );
  lines.push(
    `- \`silently_failed\` — values dropped by validation without an explicit error`,
  );
  lines.push(
    `- \`failed\` — that stage's LLM call errored or returned malformed structured output`,
  );
  lines.push(`- \`short_circuit\` — pre-LLM short-circuit (desc<3 chars)`);
  lines.push(
    `- \`skipped\` — upstream step's outcome made this step a no-op`,
  );
  lines.push(
    `- step 4 (extract facts, S3): Stage 3 extracts ~29 typed slots (location_side, speed_band, noise_descriptor, etc.) from the customer's literal description. Reports the count of non-null slots extracted.`,
  );
  lines.push(
    `- step 5 (deterministic mapper): pure-TS mapper that partitions the matched subcategory's questions into answered / ambiguous / unanswered buckets based on each question's \`required_facts[]\` vs the slots extracted by S3. No LLM in the loop here.`,
  );
  lines.push(
    `- step 6 (gap-detect questions): the FINAL \`unanswered_question_ids\` the wizard will surface to the customer (= mapper unanswered ∪ ambiguous, since v1 treats ambiguous as unanswered for safe over-ask).`,
  );
  lines.push(
    `- step 7 (confidence per stage): self-reported \`high\` / \`medium\` / \`low\` per stage. 'high' = clear single fit; 'medium' = best of 2-3 plausible; 'low' = vague / forced match. Used downstream to route low-confidence picks to advisor review.`,
  );
  lines.push(
    `- step 8 (reasoning): one-sentence audit-log rationale from each stage (≤280 chars).`,
  );
  lines.push(
    `- \`extracted_facts\` block: lists the non-null slots Stage 3 extracted from the customer description. Null/empty slots are omitted to reduce noise.`,
  );
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
    if (steps.step1.startsWith("failed")) stats.s1Failed += 1;
    if (steps.step3.startsWith("failed")) stats.s2Failed += 1;
    if (steps.stage3Failed) stats.s3Failed += 1;

    stats.sumS1Latency += b.stage1?.latency_ms ?? 0;
    stats.sumS2Latency += b.stage2?.latency_ms ?? 0;
    stats.sumS3Latency += b.stage3?.latency_ms ?? 0;
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
    const s3c = steps.stage3Confidence;
    if (s3c === "high") stats.s3ConfHigh += 1;
    else if (s3c === "medium") stats.s3ConfMedium += 1;
    else if (s3c === "low") stats.s3ConfLow += 1;
    else stats.s3ConfMissing += 1;

    // Mapper totals
    stats.mapperAnsweredTotal += steps.mapperAnswered;
    stats.mapperUnansweredTotal += steps.mapperUnanswered;
    stats.mapperAmbiguousTotal += steps.mapperAmbiguous;

    // Stage 3 slot extraction — only count tests where S3 actually ran
    // (not skipped, not failed). Use stage3 presence + non-failed as the
    // proxy: a successful S3 produced a slot count we should average over.
    if (b.stage3 && !steps.stage3Failed) {
      stats.s3SlotCountTotal += steps.stage3SlotCount;
      stats.s3SlotCountSamples += 1;
    }
  }

  const avgSlotsPerS3 =
    stats.s3SlotCountSamples > 0
      ? (stats.s3SlotCountTotal / stats.s3SlotCountSamples).toFixed(2)
      : "n/a";

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
  lines.push(`| **stage 1** hallucinated category | ${stats.s1HalCat} |`);
  lines.push(`| **stage 1** LLM call failed | ${stats.s1Failed} |`);
  lines.push(`| **stage 2** hallucinated subcategory | ${stats.s2HalSub} |`);
  lines.push(`| **stage 2** LLM call failed | ${stats.s2Failed} |`);
  lines.push(`| **stage 3** LLM call failed | ${stats.s3Failed} |`);
  lines.push(`| short-circuit triggered | ${stats.shortCircuit} |`);
  lines.push(`| sum stage-1 latencies | ${stats.sumS1Latency} ms |`);
  lines.push(`| sum stage-2 latencies | ${stats.sumS2Latency} ms |`);
  lines.push(`| sum stage-3 latencies | ${stats.sumS3Latency} ms |`);
  lines.push(`| sum input tokens | ${stats.sumTokensIn} |`);
  lines.push(`| sum output tokens | ${stats.sumTokensOut} |`);
  lines.push(
    `| **stage 1** confidence: high / medium / low / missing | ${stats.s1ConfHigh} / ${stats.s1ConfMedium} / ${stats.s1ConfLow} / ${stats.s1ConfMissing} |`,
  );
  lines.push(
    `| **stage 2** confidence: high / medium / low / missing | ${stats.s2ConfHigh} / ${stats.s2ConfMedium} / ${stats.s2ConfLow} / ${stats.s2ConfMissing} |`,
  );
  lines.push(
    `| **stage 3** confidence: high / medium / low / missing | ${stats.s3ConfHigh} / ${stats.s3ConfMedium} / ${stats.s3ConfLow} / ${stats.s3ConfMissing} |`,
  );
  lines.push(
    `| mapper totals: answered / unanswered / ambiguous (sum across all tests) | ${stats.mapperAnsweredTotal} / ${stats.mapperUnansweredTotal} / ${stats.mapperAmbiguousTotal} |`,
  );
  lines.push(
    `| stage 3 avg non-null slots extracted (per successful S3 run) | ${avgSlotsPerS3} (n=${stats.s3SlotCountSamples}) |`,
  );
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
    `Summary: ${stats.tsMatches} testing / ${stats.otherMatches} other / ${stats.nullMatches} null · S1 fail=${stats.s1Failed}, S2 fail=${stats.s2Failed}, S3 fail=${stats.s3Failed} · S1 hal cat=${stats.s1HalCat}, S2 hal sub=${stats.s2HalSub} · mapper answered/unanswered/ambiguous=${stats.mapperAnsweredTotal}/${stats.mapperUnansweredTotal}/${stats.mapperAmbiguousTotal} · S3 avg slots=${avgSlotsPerS3}`,
  );
}

void main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
