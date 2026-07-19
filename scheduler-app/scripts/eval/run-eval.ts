/**
 * run-eval — auto-graded diagnose-concern eval under PRODUCTION config
 * (llm-launch-gate plan 2026-07-02; REVAMP-PLAN §11 launch bars).
 *
 * Replaces the legacy scripts/eval-diagnose-concern.ts, which (a) never
 * graded (descriptive stats only) and (b) deliberately bypassed the
 * Vercel AI Gateway. This runner:
 *   - loads .env.local WITHOUT stripping AI_GATEWAY_API_KEY / VERCEL_* —
 *     diagnoseConcern constructs the exact gateway-routed client
 *     production uses;
 *   - loads the labeled fixture (eval-cases.json) and validates every
 *     label against the LIVE catalog before spending tokens;
 *   - runs diagnoseConcern per case (bounded concurrency), applies the
 *     production confidence gate, and grades per §11:
 *       Stage-1 accuracy + macro-F1 · Stage-2 accuracy on S1-correct ·
 *       Stage-3 slot precision/recall (micro) · misroute-safety landing ·
 *       ask-delta vs a perfect run · p50/p95 latency · gate-fire rate;
 *   - writes docs/scheduler/diagnose-eval-<ts>.md + scripts/eval/last-run.json
 *     with an explicit PASS/FAIL verdict per bar.
 *
 * Run (from scheduler-app/):
 *   npm run eval:diagnose
 *   npm run eval:diagnose -- --limit 20 --concurrency 2 --filter brakes
 *   npm run eval:diagnose -- --strict   # exit 1 when a bar fails
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AskDelta,
  EvalCase,
  GradableResult,
  SafetyLanding,
  Stage3Counts,
} from "./graders.ts";
import {
  classifySafetyLanding,
  computeAskDelta,
  computeStage1Metrics,
  computeStage2Metrics,
  gradeStage3Case,
  isStage1Correct,
  percentile,
  stage3Micro,
} from "./graders.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, "..", "..");

// §11 launch bars.
const BARS = {
  stage1_accuracy: 0.9,
  stage1_macro_f1: 0.85,
  stage2_accuracy: 0.85,
  stage3_slot_precision: 0.85,
  confident_misroutes_max: 0,
};

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
    // Skip EMPTY values — Vercel "sensitive" env vars pull as '' and an
    // empty string is NOT nullish, so it would defeat diagnose-concern's
    // `AI_GATEWAY_API_KEY ?? VERCEL_OIDC_TOKEN` fallback.
    if (v.length === 0) continue;
    process.env[key] = v;
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return process.argv[i + 1] ?? "true";
}

interface PerCaseRow {
  id: string;
  tags: string[];
  expected: EvalCase["expected"];
  raw: GradableResult;
  gated: GradableResult;
  gate: string;
  landing: SafetyLanding;
  stage3: Stage3Counts | null;
  askDelta: AskDelta | null;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error(
      "Production config requires AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) — refusing to run off-config.",
    );
  }

  // Dynamic imports AFTER env load — diagnose-concern captures env at
  // module scope when constructing the gateway client.
  const { createClient } = await import("@supabase/supabase-js");
  const { diagnoseConcern } = await import(
    "../../src/lib/scheduler/wizard/llm/diagnose-concern.ts"
  );
  const { loadDiagnosticCatalog, isTestingService } = await import(
    "../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts"
  );
  const { EXTRACTED_FACTS_JSON_SCHEMA } = await import(
    "../../src/lib/scheduler/wizard/llm/extracted-facts.ts"
  );
  const { matchQuestionsToFacts } = await import(
    "../../src/lib/scheduler/wizard/llm/question-fact-mapper.ts"
  );
  const { applyConfidenceGate, overAskQuestionIds } = await import(
    "../../src/lib/scheduler/wizard/confidence-gate.ts"
  );
  const { resolveServiceRoleKey, resolveSupabaseUrl } = await import(
    "../../src/lib/supabase/resolve-keys.ts"
  );

  const url = resolveSupabaseUrl(process.env);
  const key = resolveServiceRoleKey(process.env);
  if (!url || !key) throw new Error("Missing Supabase URL or service key.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Loading live diagnostic catalog…");
  const catalog = await loadDiagnosticCatalog(supabase);

  // ── Fixture load + label validation ──────────────────────────────────
  // --fixture <path> overrides the default 145-case eval-cases.json (e.g. to
  // baseline the 272-case KB golden set). Accepts either the wrapped
  // {cases:[...]} shape or a bare JSON array (the golden set ships bare).
  const fixtureArg = arg("fixture");
  const fixturePath = fixtureArg
    ? resolve(process.cwd(), fixtureArg)
    : resolve(__dirname, "eval-cases.json");
  const fixtureRaw = JSON.parse(readFileSync(fixturePath, "utf8")) as
    | { cases: EvalCase[] }
    | EvalCase[];
  let cases = Array.isArray(fixtureRaw) ? fixtureRaw : fixtureRaw.cases;

  const filter = arg("filter");
  if (filter) {
    cases = cases.filter(
      (c) => c.id.includes(filter) || (c.tags ?? []).includes(filter),
    );
  }
  const limit = arg("limit");
  if (limit) cases = cases.slice(0, Number(limit));
  if (cases.length === 0) throw new Error("No cases after filter/limit.");

  const categoryKeys = new Set<string>();
  const slugsByKey = new Map<string, Set<string>>();
  const questionsBySlug = new Map<
    string,
    Array<{ id: number; required_facts: string[] }>
  >();
  for (const c of catalog.categories) {
    if (isTestingService(c)) {
      categoryKeys.add(c.service_key);
      const set = new Set<string>();
      for (const s of c.subcategories) {
        set.add(s.slug);
        questionsBySlug.set(
          `${c.service_key}::${s.slug}`,
          s.questions.map((q) => ({
            id: q.id,
            required_facts: q.required_facts ?? [],
          })),
        );
      }
      slugsByKey.set(c.service_key, set);
    } else {
      categoryKeys.add(c.subcategory_slug);
    }
  }
  const slotSchema =
    (EXTRACTED_FACTS_JSON_SCHEMA as {
      properties?: Record<string, { enum?: unknown[]; type?: unknown }>;
    }).properties ?? {};
  const slotNames = new Set(Object.keys(slotSchema));

  const labelErrors: string[] = [];
  for (const c of cases) {
    const e = c.expected;
    for (const k of [e.stage1_category_key, ...(e.stage1_acceptable ?? [])]) {
      if (k !== null && !categoryKeys.has(k)) {
        labelErrors.push(`${c.id}: unknown stage1 key "${k}"`);
      }
    }
    if (e.stage2_subcategory_slug !== null) {
      const set = e.stage1_category_key
        ? slugsByKey.get(e.stage1_category_key)
        : undefined;
      if (!set || !set.has(e.stage2_subcategory_slug)) {
        labelErrors.push(
          `${c.id}: slug "${e.stage2_subcategory_slug}" not under "${e.stage1_category_key}"`,
        );
      }
    }
    for (const [slot, v] of Object.entries(e.stage3_facts)) {
      if (!slotNames.has(slot)) {
        labelErrors.push(`${c.id}: unknown fact slot "${slot}"`);
        continue;
      }
      const en = slotSchema[slot]?.enum;
      if (v !== "*" && Array.isArray(en)) {
        const allowed = en.filter((x) => x !== null);
        if (!allowed.includes(v)) {
          labelErrors.push(`${c.id}: slot ${slot} value "${String(v)}" not in enum`);
        }
      }
    }
  }
  if (labelErrors.length > 0) {
    console.error(`FIXTURE INVALID — ${labelErrors.length} label error(s):`);
    for (const e of labelErrors.slice(0, 50)) console.error("  " + e);
    process.exit(2);
  }
  console.log(`Fixture valid: ${cases.length} cases. Running…`);

  // ── Run with bounded concurrency ─────────────────────────────────────
  const concurrency = Number(arg("concurrency") ?? 4);
  const rows: PerCaseRow[] = [];
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < cases.length) {
      const idx = next++;
      const c = cases[idx] as EvalCase;
      const res = await diagnoseConcern({
        catalog,
        customer_description: c.text,
        customer_chip_hint: c.chip_hint ?? null,
        vehicle_notes: null,
      });
      const gatedOut = applyConfidenceGate(res);
      let gated = gatedOut.result;
      if (gatedOut.gate === "over_ask" && gated.matched_category_key) {
        const cat = catalog.categories.find(
          (k) =>
            isTestingService(k) && k.service_key === gated.matched_category_key,
        );
        const ids = overAskQuestionIds(
          cat ?? null,
          gated.matched_subcategory_slug,
        );
        if (ids) gated = { ...gated, unanswered_question_ids: ids };
      }

      // Stage-3 grading only when Stage 3 actually ran.
      const stage3 =
        res.extracted_facts !== null
          ? gradeStage3Case(
              c.expected.stage3_facts,
              res.extracted_facts as unknown as Record<string, unknown>,
            )
          : null;

      // Ask-delta only when the GATED run landed on the expected subcat.
      let askDelta: AskDelta | null = null;
      if (
        c.expected.route === "testing_service" &&
        c.expected.stage1_category_key &&
        c.expected.stage2_subcategory_slug &&
        gated.matched_category_key === c.expected.stage1_category_key &&
        gated.matched_subcategory_slug === c.expected.stage2_subcategory_slug
      ) {
        const qs =
          questionsBySlug.get(
            `${c.expected.stage1_category_key}::${c.expected.stage2_subcategory_slug}`,
          ) ?? [];
        const perfect = matchQuestionsToFacts({
          extracted_facts: Object.fromEntries(
            Object.entries(c.expected.stage3_facts).map(([k, v]) => [
              k,
              v === "*" ? "present" : v,
            ]),
          ) as never,
          questions: qs.map((q) => ({
            id: q.id,
            required_facts: q.required_facts,
          })),
        });
        const perfectAsk = [
          ...perfect.unanswered_ids,
          ...perfect.ambiguous_ids,
        ];
        askDelta = computeAskDelta(perfectAsk, gated.unanswered_question_ids);
      }

      rows.push({
        id: c.id,
        tags: c.tags ?? [],
        expected: c.expected,
        raw: res as unknown as GradableResult,
        gated: gated as unknown as GradableResult,
        gate: gatedOut.gate,
        landing: classifySafetyLanding(
          c.expected,
          gated as unknown as GradableResult,
        ),
        stage3,
        askDelta,
        latency_ms: res.latency_ms,
        tokens_in: res.tokens_in,
        tokens_out: res.tokens_out,
      });
      done += 1;
      if (done % 10 === 0) console.log(`  ${done}/${cases.length}`);
    }
  }
  const started = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, worker),
  );
  const wallMs = Date.now() - started;

  // ── Aggregate ─────────────────────────────────────────────────────────
  const s1 = computeStage1Metrics(
    rows.map((r) => ({
      expected: r.expected,
      actualKey: r.raw.matched_category_key,
    })),
  );
  const s2 = computeStage2Metrics(
    rows.map((r) => ({
      expected: r.expected,
      actualKey: r.raw.matched_category_key,
      actualSlug: r.raw.matched_subcategory_slug,
    })),
  );
  const s3 = stage3Micro(rows.map((r) => r.stage3).filter(Boolean) as Stage3Counts[]);

  const landings = new Map<SafetyLanding, number>();
  for (const r of rows) landings.set(r.landing, (landings.get(r.landing) ?? 0) + 1);
  const dangerous = rows.filter(
    (r) => r.landing === "confident_misroute_no_questions",
  );

  const deltas = rows.map((r) => r.askDelta).filter(Boolean) as AskDelta[];
  const overAskTotal = deltas.reduce((s, d) => s + d.overAsked, 0);
  const underAskTotal = deltas.reduce((s, d) => s + d.underAsked, 0);
  const underAskCases = rows.filter((r) => (r.askDelta?.underAsked ?? 0) > 0);

  const latencies = rows.map((r) => r.latency_ms);
  const gateFires = rows.filter((r) => r.gate !== "pass").length;
  const parseFails = rows.filter((r) => !r.raw.parsed_ok).length;

  const verdicts = {
    stage1_accuracy: s1.accuracy >= BARS.stage1_accuracy,
    stage1_macro_f1: s1.macroF1 >= BARS.stage1_macro_f1,
    stage2_accuracy: s2.accuracy >= BARS.stage2_accuracy,
    stage3_slot_precision: s3.precision >= BARS.stage3_slot_precision,
    misroute_safety: dangerous.length <= BARS.confident_misroutes_max,
  };
  const allPass = Object.values(verdicts).every(Boolean);

  // ── Report ────────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const bar = (ok: boolean) => (ok ? "✅ PASS" : "❌ FAIL");
  const md = `# diagnose-concern eval — ${ts}

Production config (Vercel AI Gateway). ${rows.length} cases, concurrency ${concurrency}, wall ${(wallMs / 1000).toFixed(0)}s.
Models: stage1 ${process.env.DIAGNOSE_CONCERN_STAGE1_MODEL ?? process.env.DIAGNOSE_CONCERN_MODEL ?? "anthropic/claude-haiku-4-5"} (stage2/3 analogous).
Catalog: ${catalog.categories.length} categories (live at run time).

## §11 launch-bar verdict — ${allPass ? "✅ ALL BARS PASS" : "❌ BAR(S) FAILED"}

| Bar | Threshold | Measured | Verdict |
|---|---|---|---|
| Stage-1 accuracy | ≥ ${pct(BARS.stage1_accuracy)} | ${pct(s1.accuracy)} (${s1.correct}/${s1.total}) | ${bar(verdicts.stage1_accuracy)} |
| Stage-1 macro-F1 | ≥ ${BARS.stage1_macro_f1} | ${s1.macroF1.toFixed(3)} | ${bar(verdicts.stage1_macro_f1)} |
| Stage-2 accuracy (S1-correct) | ≥ ${pct(BARS.stage2_accuracy)} | ${pct(s2.accuracy)} (${s2.correct}/${s2.graded}) | ${bar(verdicts.stage2_accuracy)} |
| Stage-3 slot precision (micro) | ≥ ${BARS.stage3_slot_precision} | ${s3.precision.toFixed(3)} (tp ${s3.tp} / fp ${s3.fp}) | ${bar(verdicts.stage3_slot_precision)} |
| Confident misroutes w/ zero questions | ≤ ${BARS.confident_misroutes_max} | ${dangerous.length} | ${bar(verdicts.misroute_safety)} |

Stage-3 recall (informational — misses just over-ask): ${s3.recall.toFixed(3)} (fn ${s3.fn}); value mismatches ${s3.valueMismatch}.

## Safety landings (post-gate)

${(["correct", "handoff", "over_ask", "confident_misroute_no_questions"] as SafetyLanding[])
  .map((l) => `- ${l}: ${landings.get(l) ?? 0}`)
  .join("\n")}
${dangerous.length > 0 ? `\n**Dangerous cases:** ${dangerous.map((d) => d.id).join(", ")}\n` : ""}
## Ask behavior (cases landing on expected subcategory: ${deltas.length})

- Over-asked questions (cheap): ${overAskTotal}
- **Under-asked questions (expensive — skipped when they should be asked): ${underAskTotal}**${underAskCases.length > 0 ? ` — cases: ${underAskCases.map((r) => r.id).join(", ")}` : ""}

## Latency + ops

- p50 ${percentile(latencies, 50)}ms · p95 ${percentile(latencies, 95)}ms · max ${Math.max(0, ...latencies)}ms
- Confidence-gate fires: ${gateFires}/${rows.length}; parse failures: ${parseFails}
- Tokens: in ${rows.reduce((s, r) => s + r.tokens_in, 0)} / out ${rows.reduce((s, r) => s + r.tokens_out, 0)}

## Per-class Stage-1 (expected classes)

| class | tp | fp | fn | P | R | F1 |
|---|---|---|---|---|---|---|
${s1.perClass
  .filter((p) => rows.some((r) => (r.expected.stage1_category_key ?? "(null)") === p.cls))
  .map(
    (p) =>
      `| ${p.cls} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.precision.toFixed(2)} | ${p.recall.toFixed(2)} | ${p.f1.toFixed(2)} |`,
  )
  .join("\n")}

## Mismatches (Stage 1)

${rows
  .filter((r) => !isStage1Correct(r.expected, r.raw.matched_category_key))
  .map(
    (r) =>
      `- ${r.id}: expected ${r.expected.stage1_category_key ?? "null"} → got ${r.raw.matched_category_key ?? "null"} (s1conf ${r.raw.stage1_confidence}, landing ${r.landing})`,
  )
  .join("\n") || "(none)"}
`;

  const reportPath = resolve(appRoot, "..", "docs", "scheduler", `diagnose-eval-${ts}.md`);
  writeFileSync(reportPath, md);
  writeFileSync(
    resolve(__dirname, "last-run.json"),
    JSON.stringify(
      { ts, verdicts, allPass, s1: { accuracy: s1.accuracy, macroF1: s1.macroF1 }, s2, s3, landings: Object.fromEntries(landings), overAskTotal, underAskTotal, gateFires, parseFails, latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) }, rows: rows.map((r) => ({ id: r.id, gate: r.gate, landing: r.landing, raw_key: r.raw.matched_category_key, raw_slug: r.raw.matched_subcategory_slug, latency_ms: r.latency_ms, expected_facts: r.expected.stage3_facts, raw_facts: r.raw.extracted_facts, stage3: r.stage3, askDelta: r.askDelta })) },
      null,
      2,
    ) + "\n",
  );
  console.log(md.split("\n").slice(0, 30).join("\n"));
  console.log(`\nFull report: ${reportPath}`);

  if (arg("strict") && !allPass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
