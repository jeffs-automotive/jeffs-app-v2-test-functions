/**
 * summarize-final — render the compact MD summary for the act-or-ask AO5
 * full-chain re-baseline from the JSON reports run-eval-final.ts produced.
 *
 * Inputs (from scripts/eval/):
 *   - final-baseline-report.json      (all 3 corpora, default models; its
 *                                      synthetic block IS the S3=haiku A/B arm)
 *   - final-s3-gpt54mini-report.json  (synthetic only, S3=openai/gpt-5.4-mini)
 *
 * Output: docs/scheduler/act-or-ask-final-baseline-2026-07-03.md
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/summarize-final.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..", "..");

interface CorpusMetrics {
  corpus: string;
  graded: number;
  final_landing_accuracy: number;
  direct_correct: number;
  clarify_resolved: number;
  null_correct_direct: number;
  dangerous_direct_misroutes: number;
  hard_misroutes: number;
  misroute_rate: number;
  hard_misroute_rate: number;
  one_in_n_misroute: number | null;
  one_in_n_hard: number | null;
  clarification_friction: number;
  clarify_to_handoff_count: number;
  safe_miss_to_advisor: number;
  advisor_handoff_rate: number;
  gate_advisor_handoff: number;
  gate_over_ask: number;
  s2_subcategory_accuracy: number | null;
  s2_graded: number;
  s2_correct: number;
  stage3_precision_raw: number | null;
  stage3_recall_raw: number | null;
  stage3_tp: number | null;
  stage3_fp: number | null;
  stage3_precision_adjudicated: number | null;
  stage3_recall_adjudicated: number | null;
  stage3_tp_adjudicated: number | null;
  stage3_fp_adjudicated: number | null;
  stage3_cases_graded: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  max_latency_ms: number;
  parse_failures: number;
  ambiguous_cases: number;
  ambiguous_handled_safely: number;
  errors: number;
}

interface Report {
  ran_at: string;
  tag: string;
  models: { stage1: string; stage2: string; stage3: string };
  catalog_categories: number;
  per_corpus: Record<string, CorpusMetrics>;
}

function load(rel: string): Report | null {
  const p = resolve(appRoot, rel);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Report;
}

const pct = (x: number | null | undefined) =>
  x == null ? "—" : `${(x * 100).toFixed(1)}%`;
const oneIn = (n: number | null | undefined) => (n == null ? "∞ (0)" : `1-in-${n}`);
const num = (x: number | null | undefined) => (x == null ? "—" : String(x));

const baseline = load("scripts/eval/final-baseline-report.json");
const gpt = load("scripts/eval/final-s3-gpt54mini-report.json");
if (!baseline) throw new Error("Missing final-baseline-report.json.");

const corpora = ["forum", "tekmetric", "synthetic"].filter(
  (c) => baseline.per_corpus[c],
);

const HARD_BAR = 50; // 1-in-50 hard-misroute bar (Chris)
const S3_BAR = 0.85;

// ── S3 A/B verdict ──────────────────────────────────────────────────────────
const haikuSyn = baseline.per_corpus.synthetic;
const gptSyn = gpt?.per_corpus.synthetic;
let s3Verdict = "";
let s3Recommended = baseline.models.stage3;
if (haikuSyn && gptSyn) {
  const hAdj = haikuSyn.stage3_precision_adjudicated ?? 0;
  const gAdj = gptSyn.stage3_precision_adjudicated ?? 0;
  const hPass = hAdj >= S3_BAR;
  const gPass = gAdj >= S3_BAR;
  if (gPass && (!hPass || gAdj >= hAdj)) {
    s3Recommended = gpt!.models.stage3;
    s3Verdict = `**${gpt!.models.stage3}** — adjudicated slot precision ${gAdj.toFixed(3)} ${gPass ? "clears" : "misses"} the ${S3_BAR} bar${hPass ? `; haiku also clears at ${hAdj.toFixed(3)} but gpt-5.4-mini is at least as precise` : `, and haiku does NOT clear (${hAdj.toFixed(3)})`}.`;
  } else if (hPass) {
    s3Recommended = baseline.models.stage3;
    s3Verdict = `**${baseline.models.stage3}** — adjudicated slot precision ${hAdj.toFixed(3)} clears the ${S3_BAR} bar${gPass ? ` and edges gpt-5.4-mini (${gAdj.toFixed(3)})` : `; gpt-5.4-mini does NOT clear (${gAdj.toFixed(3)})`}.`;
  } else {
    s3Recommended = gAdj >= hAdj ? gpt!.models.stage3 : baseline.models.stage3;
    s3Verdict = `**${s3Recommended}** — NEITHER arm clears the ${S3_BAR} bar (haiku ${hAdj.toFixed(3)} / gpt-5.4-mini ${gAdj.toFixed(3)} adjudicated); pick the higher of the two and flag for prompt iteration.`;
  }
}

// ── hard-misroute bar summary (real corpora combined) ───────────────────────
const realCorpora = corpora.filter((c) => c !== "synthetic");
let combinedGraded = 0;
let combinedHard = 0;
for (const c of realCorpora) {
  combinedGraded += baseline.per_corpus[c]!.graded;
  combinedHard += baseline.per_corpus[c]!.hard_misroutes;
}
const combinedOneIn =
  combinedHard > 0 ? Math.round(combinedGraded / combinedHard) : null;

function corpusTable(m: CorpusMetrics): string {
  return [
    `| Final-landing accuracy | ${pct(m.final_landing_accuracy)} (${m.direct_correct + m.clarify_resolved + m.null_correct_direct}/${m.graded}) |`,
    `| Dangerous direct misroutes (all) | ${num(m.dangerous_direct_misroutes)} → ${oneIn(m.one_in_n_misroute)} |`,
    `| **Hard misroutes (vs unanimous / no-judge)** | **${num(m.hard_misroutes)} → ${oneIn(m.one_in_n_hard)}** ${m.one_in_n_hard == null || m.one_in_n_hard >= HARD_BAR ? "✅" : "❌"} (bar 1-in-${HARD_BAR}) |`,
    `| Clarification friction | ${pct(m.clarification_friction)} (resolved ${m.clarify_resolved} + none-of-these ${m.clarify_to_handoff_count}) |`,
    `| Advisor-handoff rate | ${pct(m.advisor_handoff_rate)} |`,
    `| Confidence-gate fires | advisor_handoff ${num(m.gate_advisor_handoff)} · over_ask ${num(m.gate_over_ask)} |`,
    `| S2 subcategory accuracy | ${pct(m.s2_subcategory_accuracy)} (${m.s2_correct}/${m.s2_graded}) |`,
    `| S3 slot precision (raw / adjudicated) | ${m.stage3_precision_raw == null ? "— (no expected_facts)" : `${m.stage3_precision_raw.toFixed(3)} / ${(m.stage3_precision_adjudicated ?? 0).toFixed(3)}`} |`,
    `| Chain latency p50 / p95 / max | ${m.p50_latency_ms} / ${m.p95_latency_ms} / ${m.max_latency_ms} ms |`,
    `| Parse failures | ${num(m.parse_failures)} |`,
    `| Ambiguous (handled safely) | ${m.ambiguous_cases} (${m.ambiguous_handled_safely} clarified/handed off) |`,
    `| Errors | ${num(m.errors)} |`,
  ].join("\n");
}

const md = `# act-or-ask full-chain re-baseline (AO5) — 2026-07-03

> Full production-chain eval driving the SHIPPED \`diagnoseConcern\` (Stage-1
> candidates → per-candidate Stage-2/Stage-3 precompute → deterministic mapper
> → confidence gate). Env model defaults: **S1/S2 \`${baseline.models.stage1}\`**,
> **S3 \`${baseline.models.stage3}\`** (baseline). Catalog: ${baseline.catalog_categories} categories
> (tire_repair now present). Grading labels = the v2 consensus files (re-labeled
> against the tire_repair catalog); graded pool excludes \`ambiguous\`/\`unjudged\`.
> Runner: \`scripts/eval/run-eval-final.ts\`. Ran ${baseline.ran_at}.

## Verdict at a glance

- **Hard-misroute bar (1-in-${HARD_BAR}):** combined real corpora = **${combinedHard} hard / ${combinedGraded} graded → ${oneIn(combinedOneIn)}** ${combinedOneIn == null || combinedOneIn >= HARD_BAR ? "✅ PASS" : "❌ FAIL"}.
- **Stage-3 model (A/B):** recommend \`DIAGNOSE_CONCERN_STAGE3_MODEL=${s3Recommended}\`. ${s3Verdict}
- **Parse failures:** ${corpora.reduce((s, c) => s + baseline.per_corpus[c]!.parse_failures, 0)} across ${corpora.map((c) => baseline.per_corpus[c]!.graded).reduce((a, b) => a + b, 0)} baseline cases.

## Per-corpus metrics

${corpora
  .map(
    (c) => `### ${c}${c === "synthetic" ? " (145 authored fixture — the only corpus with expected_facts)" : ""}

| Metric | Value |
|---|---|
${corpusTable(baseline.per_corpus[c]!)}`,
  )
  .join("\n\n")}

## Stage-3 model A/B (synthetic fixture only — has \`expected_facts\`)

Both arms run the SAME tightened Stage-3 literal-only prompt; only
\`DIAGNOSE_CONCERN_STAGE3_MODEL\` differs. Slot precision is the expensive-error
metric (a wrongly asserted fact SKIPS a question). Old baselines for reference:
0.606 (as-labeled) / 0.434 pre-tightening → adjudicated is the fair number
(fixture under-labels reclassified as TP via \`stage3-adjudication.json\`).

| Arm | S3 model | Slot precision (raw) | Slot precision (adjudicated) | Recall (adj) | vs ${S3_BAR} bar |
|---|---|---|---|---|---|
| A | ${haikuSyn?.stage3_precision_raw != null ? baseline.models.stage3 : "—"} | ${haikuSyn?.stage3_precision_raw?.toFixed(3) ?? "—"} | ${haikuSyn?.stage3_precision_adjudicated?.toFixed(3) ?? "—"} | ${haikuSyn?.stage3_recall_adjudicated?.toFixed(3) ?? "—"} | ${haikuSyn && (haikuSyn.stage3_precision_adjudicated ?? 0) >= S3_BAR ? "✅" : "❌"} |
| B | ${gptSyn ? gpt!.models.stage3 : "(not run)"} | ${gptSyn?.stage3_precision_raw?.toFixed(3) ?? "—"} | ${gptSyn?.stage3_precision_adjudicated?.toFixed(3) ?? "—"} | ${gptSyn?.stage3_recall_adjudicated?.toFixed(3) ?? "—"} | ${gptSyn && (gptSyn.stage3_precision_adjudicated ?? 0) >= S3_BAR ? "✅" : "❌"} |

**Recommendation:** \`DIAGNOSE_CONCERN_STAGE3_MODEL=${s3Recommended}\`. ${s3Verdict}

## Reproduce

\`\`\`bash
cd scheduler-app
vercel env pull --environment=production .env.eval-prod --yes
export VERCEL_OIDC_TOKEN=$(grep '^VERCEL_OIDC_TOKEN=' .env.eval-prod | cut -d= -f2- | tr -d '"')

# Step 1 — re-label the two real corpora against the tire_repair catalog
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/label-real-concerns.ts \\
  --input scripts/eval/real-concerns-forums.json    --output scripts/eval/real-concerns-labeled-v2.json
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/label-real-concerns.ts \\
  --input scripts/eval/real-concerns-tekmetric.json --output scripts/eval/real-concerns-tekmetric-labeled-v2.json

# Step 2 — full-chain baseline (all 3 corpora, default models)
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/run-eval-final.ts \\
  --concurrency 6 --output scripts/eval/final-baseline-report.json

# Step 3 — Stage-3 A/B (synthetic only): gpt-5.4-mini arm (haiku arm = baseline synthetic)
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/run-eval-final.ts \\
  --corpora synthetic --s3-model openai/gpt-5.4-mini --output scripts/eval/final-s3-gpt54mini-report.json

# Render this summary
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/summarize-final.ts
\`\`\`

Per-case rows + full metrics: \`scripts/eval/final-baseline-report.json\`,
\`scripts/eval/final-s3-gpt54mini-report.json\`.
`;

const outPath = resolve(
  appRoot,
  "..",
  "docs",
  "scheduler",
  "act-or-ask-final-baseline-2026-07-03.md",
);
writeFileSync(outPath, md);
console.log(`Wrote ${outPath}`);
