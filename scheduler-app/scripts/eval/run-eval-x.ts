/**
 * run-eval-x — CROSS-PROVIDER head-to-head eval (llm-model-benchmark,
 * 2026-07-02). Runs the SAME three-stage diagnostic pipeline on any model
 * the Vercel AI Gateway routes (OpenAI / Google / Anthropic), using the
 * production prompts + JSON schemas + post-validation semantics + the
 * deterministic mapper, graded by the same graders as run-eval.ts —
 * so numbers are directly comparable to the Haiku 4.5 baseline.
 *
 * Differences from production diagnose-concern.ts (unavoidable and
 * DOCUMENTED so comparisons stay honest):
 *   - Transport is AI SDK generateObject (gateway-translated structured
 *     outputs: OpenAI strict json_schema / Gemini responseSchema) instead
 *     of the Anthropic SDK's output_config.format.
 *   - One retry per stage on transport error (same retry budget as prod).
 *   - Prompt-cache markers are Anthropic-only and are flattened away here.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/run-eval-x.ts --model openai/gpt-5.4-nano [--limit N] [--concurrency N]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  EvalCase,
  GradableResult,
  SafetyLanding,
  Stage3Counts,
} from "./graders.ts";
import {
  classifySafetyLanding,
  computeStage1Metrics,
  computeStage2Metrics,
  gradeStage3Case,
  isStage1Correct,
  percentile,
  stage3Micro,
} from "./graders.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..", "..");

function loadEnvLocal(): void {
  const p = resolve(appRoot, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    if (process.env[key] !== undefined) continue;
    let v = (m[2] as string).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v.length === 0) continue;
    process.env[key] = v;
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return process.argv[i + 1] ?? "true";
}

function flatten(blocks: Array<{ text: string }>): string {
  return blocks.map((b) => b.text).join("\n\n");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) throw new Error("No AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN.");
  const model = arg("model");
  if (!model) throw new Error("--model required (e.g. openai/gpt-5.4-nano)");

  const { createGateway } = await import("@ai-sdk/gateway");
  const { generateObject, jsonSchema } = await import("ai");
  const { createClient } = await import("@supabase/supabase-js");
  const diag = await import(
    "../../src/lib/scheduler/wizard/llm/diagnose-concern.ts"
  );
  const { loadDiagnosticCatalog, isTestingService, isOtherSubcategory } =
    await import("../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts");
  const { matchQuestionsToFacts } = await import(
    "../../src/lib/scheduler/wizard/llm/question-fact-mapper.ts"
  );
  const { applyConfidenceGate, overAskQuestionIds } = await import(
    "../../src/lib/scheduler/wizard/confidence-gate.ts"
  );
  const { resolveServiceRoleKey, resolveSupabaseUrl } = await import(
    "../../src/lib/supabase/resolve-keys.ts"
  );

  const gateway = createGateway({ apiKey });
  const sb = createClient(resolveSupabaseUrl(process.env)!, resolveServiceRoleKey(process.env)!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log("Loading live diagnostic catalog…");
  const catalog = await loadDiagnosticCatalog(sb);

  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, "eval-cases.json"), "utf8"),
  ) as { cases: EvalCase[] };
  let cases = fixture.cases;
  const limit = arg("limit");
  if (limit) cases = cases.slice(0, Number(limit));

  // Same per-stage generateObject wrapper: 2 attempts, temperature 0
  // (dropped automatically if the target model rejects it).
  let totalIn = 0, totalOut = 0;
  async function callStage<T>(schemaObj: Record<string, unknown>, system: string, prompt: string): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await generateObject({
          model: gateway(model!),
          schema: jsonSchema<T>(schemaObj as never),
          system,
          prompt,
          ...(attempt === 0 ? { temperature: 0 } : {}),
        });
        const u = res.usage as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined;
        totalIn += u?.inputTokens ?? u?.promptTokens ?? 0;
        totalOut += u?.outputTokens ?? u?.completionTokens ?? 0;
        return res.object;
      } catch (e) {
        if (attempt === 1) {
          console.error(`  stage call failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
        }
      }
    }
    return null;
  }

  interface Row {
    id: string;
    expected: EvalCase["expected"];
    raw: GradableResult;
    gated: GradableResult;
    gate: string;
    landing: SafetyLanding;
    stage3: Stage3Counts | null;
    latency_ms: number;
  }
  const rows: Row[] = [];
  const concurrency = Number(arg("concurrency") ?? 4);
  let next = 0, done = 0;

  async function worker(): Promise<void> {
    while (next < cases.length) {
      const c = cases[next++] as EvalCase;
      const t0 = Date.now();
      const args = {
        catalog,
        customer_description: c.text,
        customer_chip_hint: c.chip_hint ?? null,
        vehicle_notes: null,
      };
      const userPrompt = diag.buildUserPrompt(args as never);

      // ── Stage 1 (same prompt/schema/validation as production) ─────
      const s1 = await callStage<{ matched_category_key: string | null; confidence: "high" | "medium" | "low"; reasoning: string }>(
        diag.STAGE1_JSON_SCHEMA as never,
        flatten(diag.buildStage1SystemPrompt(args as never)),
        userPrompt,
      );
      let matchedCat = null as ReturnType<typeof catalog.categories.find> | null;
      let matchedKey: string | null = null;
      if (s1?.matched_category_key) {
        for (const cat of catalog.categories) {
          if (
            (isTestingService(cat) && cat.service_key === s1.matched_category_key) ||
            (isOtherSubcategory(cat) && cat.subcategory_slug === s1.matched_category_key)
          ) {
            matchedCat = cat;
            matchedKey = s1.matched_category_key;
            break;
          }
        }
      }

      // ── Stage 2 + 3 (testing-service path only, like production) ──
      let slug: string | null = null;
      let s2conf: "high" | "medium" | "low" = "low";
      let facts: Record<string, unknown> | null = null;
      let s3conf: "high" | "medium" | "low" = "low";
      let unanswered: number[] = [];

      if (matchedCat && isTestingService(matchedCat)) {
        const s2 = await callStage<{ matched_subcategory_slug: string | null; confidence: "high" | "medium" | "low"; reasoning: string }>(
          diag.STAGE2_JSON_SCHEMA as never,
          flatten(diag.buildStage2SystemPrompt(matchedCat, null)),
          userPrompt,
        );
        const sub = s2?.matched_subcategory_slug
          ? matchedCat.subcategories.find((s) => s.slug === s2.matched_subcategory_slug) ?? null
          : null;
        slug = sub?.slug ?? null;
        s2conf = s2?.confidence ?? "low";

        if (sub) {
          const s3 = await callStage<{ extracted_facts: Record<string, unknown>; confidence: "high" | "medium" | "low"; reasoning: string }>(
            diag.STAGE3_JSON_SCHEMA as never,
            flatten(diag.buildStage3SystemPrompt(sub, diag.categoryHeaderForStage3(matchedCat))),
            userPrompt,
          );
          if (s3?.extracted_facts) {
            facts = s3.extracted_facts;
            s3conf = s3.confidence;
            const mapped = matchQuestionsToFacts({
              extracted_facts: facts as never,
              questions: sub.questions.map((q) => ({ id: q.id, required_facts: q.required_facts ?? [] })),
            });
            unanswered = [...mapped.unanswered_ids, ...mapped.ambiguous_ids];
          } else {
            // Stage-3 failure → safe over-ask (production semantics).
            unanswered = sub.questions.map((q) => q.id);
          }
        }
      }

      const raw: GradableResult = {
        matched_category_key: matchedKey,
        matched_kind: matchedCat ? (isTestingService(matchedCat) ? "testing_service" : "other_subcategory") : null,
        matched_subcategory_slug: slug,
        recommended_testing_service:
          matchedCat && isTestingService(matchedCat)
            ? { service_key: matchedCat.service_key }
            : null,
        unanswered_question_ids: unanswered,
        extracted_facts: facts,
        stage1_confidence: s1?.confidence ?? "low",
        stage2_confidence: s2conf,
        stage3_confidence: s3conf,
        parsed_ok: s1 !== null,
        error_message: s1 === null ? "stage1_failed" : "",
      };

      const gatedOut = applyConfidenceGate(raw as never);
      let gated = gatedOut.result as unknown as GradableResult;
      if (gatedOut.gate === "over_ask" && gated.matched_category_key) {
        const cat = catalog.categories.find(
          (k) => isTestingService(k) && k.service_key === gated.matched_category_key,
        );
        const ids = overAskQuestionIds(cat ?? null, gated.matched_subcategory_slug);
        if (ids) gated = { ...gated, unanswered_question_ids: ids };
      }

      rows.push({
        id: c.id,
        expected: c.expected,
        raw,
        gated,
        gate: gatedOut.gate,
        landing: classifySafetyLanding(c.expected, gated),
        stage3: facts ? gradeStage3Case(c.expected.stage3_facts, facts) : null,
        latency_ms: Date.now() - t0,
      });
      done += 1;
      if (done % 10 === 0) console.log(`  ${done}/${cases.length}`);
    }
  }
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  const wallMs = Date.now() - started;

  // ── Aggregate (same math as run-eval) ─────────────────────────────
  const s1m = computeStage1Metrics(rows.map((r) => ({ expected: r.expected, actualKey: r.raw.matched_category_key })));
  const s2m = computeStage2Metrics(rows.map((r) => ({ expected: r.expected, actualKey: r.raw.matched_category_key, actualSlug: r.raw.matched_subcategory_slug })));
  const s3m = stage3Micro(rows.map((r) => r.stage3).filter(Boolean) as Stage3Counts[]);
  const landings = new Map<SafetyLanding, number>();
  for (const r of rows) landings.set(r.landing, (landings.get(r.landing) ?? 0) + 1);
  const dangerous = rows.filter((r) => r.landing === "confident_misroute_no_questions");
  const latencies = rows.map((r) => r.latency_ms);
  const parseFails = rows.filter((r) => !r.raw.parsed_ok).length;

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const md = `# CROSS-PROVIDER eval — ${model} — ${new Date().toISOString().slice(0, 19)}

Same prompts/schemas/validation/mapper/graders as the Haiku 4.5 baseline; transport = AI SDK
generateObject via Vercel AI Gateway (structured outputs translated per provider). ${rows.length} cases,
concurrency ${concurrency}, wall ${(wallMs / 1000).toFixed(0)}s. Tokens: in ${totalIn} / out ${totalOut}.

| Metric | ${model} | Haiku 4.5 baseline |
|---|---|---|
| Stage-1 accuracy | ${pct(s1m.accuracy)} (${s1m.correct}/${s1m.total}) | 89.0% |
| Stage-1 macro-F1 | ${s1m.macroF1.toFixed(3)} | 0.886 |
| Stage-2 accuracy (S1-correct) | ${pct(s2m.accuracy)} (${s2m.correct}/${s2m.graded}) | 98.1% |
| Stage-3 slot precision (vs as-authored labels) | ${s3m.precision.toFixed(3)} (tp ${s3m.tp} / fp ${s3m.fp}) | 0.434 |
| Stage-3 recall | ${s3m.recall.toFixed(3)} | 0.954 |
| Confident misroutes (zero questions) | ${dangerous.length} | 0 |
| Landings | ${["correct", "handoff", "over_ask", "confident_misroute_no_questions"].map((l) => `${l}:${landings.get(l as SafetyLanding) ?? 0}`).join(" · ")} | correct:127 · handoff:12 · over_ask:6 |
| p50 / p95 chain latency | ${percentile(latencies, 50)}ms / ${percentile(latencies, 95)}ms | 6986ms / 8888ms |
| Stage-1 parse failures | ${parseFails} | 0 |

## Stage-1 mismatches

${rows.filter((r) => !isStage1Correct(r.expected, r.raw.matched_category_key)).map((r) => `- ${r.id}: expected ${r.expected.stage1_category_key ?? "null"} → got ${r.raw.matched_category_key ?? "null"}`).join("\n") || "(none)"}
`;

  const safeModel = model.replace(/[^a-z0-9.-]/gi, "_");
  const reportPath = resolve(appRoot, "..", "docs", "scheduler", `diagnose-eval-x-${safeModel}.md`);
  writeFileSync(reportPath, md);
  writeFileSync(
    resolve(__dirname, `last-run-x-${safeModel}.json`),
    JSON.stringify({ model, s1: { accuracy: s1m.accuracy, macroF1: s1m.macroF1 }, s2: s2m, s3: s3m, dangerous: dangerous.length, tokens: { in: totalIn, out: totalOut }, latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) }, rows: rows.map((r) => ({ id: r.id, raw_key: r.raw.matched_category_key, raw_slug: r.raw.matched_subcategory_slug, landing: r.landing, expected_facts: r.expected.stage3_facts, raw_facts: r.raw.extracted_facts, latency_ms: r.latency_ms })) }, null, 1) + "\n",
  );
  console.log(md.split("\n").slice(0, 24).join("\n"));
  console.log(`\nFull report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
