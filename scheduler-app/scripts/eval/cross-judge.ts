/**
 * cross-judge — NON-CLAUDE ground-truth verification (llm-model-benchmark,
 * 2026-07-02, per Chris: "did you verify the results or are you relying on
 * self-reporting?").
 *
 * The 145-case fixture was authored AND blind-verified by Claude agents —
 * a single-family truth chain. This script re-derives every case's Stage-1
 * label with judges from TWO other model families (default: OpenAI
 * gpt-5.4 + Google gemini-3.5-flash via the Vercel AI Gateway), then:
 *
 *   - classifies each case: label CONFIRMED (both judges agree with the
 *     fixture) / label SUSPECT (both judges agree on something else) /
 *     SPLIT (judges disagree with each other);
 *   - recomputes Haiku 4.5's Stage-1 accuracy against CONSENSUS ground
 *     truth (majority of {fixture label, judge A, judge B}; no-majority
 *     cases are excluded as genuinely ambiguous);
 *   - details every original Haiku miss: was the model wrong, or the label?
 *
 * This is also the empirical test of the research's unverified claim that
 * the AI Gateway passes JSON-schema structured outputs through to OpenAI
 * and Google models.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/cross-judge.ts [--limit N] [--models a,b]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EvalCase } from "./graders.ts";
import { isStage1Correct } from "./graders.ts";

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

interface SnapshotCategory {
  kind: "testing_service" | "other_subcategory";
  service_key?: string;
  subcategory_slug?: string;
  display_name?: string;
  display_label?: string;
  description?: string | null;
  concern_categories?: string[];
}

function buildBrief(categories: SnapshotCategory[]): string {
  const lines: string[] = [];
  for (const c of categories) {
    if (c.kind === "testing_service") {
      lines.push(
        `- key="${c.service_key}" (testing service) — ${c.display_name}. ${(c.description ?? "").slice(0, 220)}`,
      );
    } else {
      lines.push(
        `- key="${c.subcategory_slug}" (advisor-handoff situation) — ${c.display_label}`,
      );
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) throw new Error("No AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN.");

  const { createGateway } = await import("@ai-sdk/gateway");
  const { generateObject, jsonSchema } = await import("ai");
  const gateway = createGateway({ apiKey });

  const snapshot = JSON.parse(
    readFileSync(resolve(__dirname, "catalog-snapshot.json"), "utf8"),
  ) as { categories: SnapshotCategory[] };
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, "eval-cases.json"), "utf8"),
  ) as { cases: EvalCase[] };
  const lastRun = JSON.parse(
    readFileSync(resolve(__dirname, "last-run.json"), "utf8"),
  ) as { rows: Array<{ id: string; raw_key: string | null }> };
  const haikuById = new Map(lastRun.rows.map((r) => [r.id, r.raw_key]));

  let cases = fixture.cases;
  const limit = arg("limit");
  if (limit) cases = cases.slice(0, Number(limit));

  const brief = buildBrief(snapshot.categories);
  const validKeys = new Set(
    snapshot.categories.map((c) =>
      c.kind === "testing_service" ? c.service_key! : c.subcategory_slug!,
    ),
  );

  const models = (arg("models") ?? "openai/gpt-5.4,google/gemini-3.5-flash").split(",");

  const VERDICTS_SCHEMA = jsonSchema<{
    verdicts: Array<{ id: string; category_key: string | null }>;
  }>({
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "category_key"],
          properties: {
            id: { type: "string" },
            category_key: { type: ["string", "null"] },
          },
        },
      },
    },
  });

  function judgePrompt(batch: EvalCase[]): string {
    return `You are an expert automotive service advisor classifying customer concern texts.

CATALOG — the only valid category keys (pick EXACTLY one key per case, or null):
${brief}

RULES:
- Pick the single best key for each text, judged from the text alone.
- Use null when the text is too vague, a greeting, gibberish, or fits nothing.
- Use an advisor-handoff key when the text describes that situation (multiple unrelated symptoms, recent accident, recent repair work elsewhere, safety fear, general checkup request, car sitting unused).
- Return the key VERBATIM from the catalog.

CASES:
${JSON.stringify(batch.map((c) => ({ id: c.id, text: c.text })), null, 1)}

Return one verdict per case.`;
  }

  const perModel: Record<string, Map<string, string | null>> = {};
  for (const model of models) {
    const byId = new Map<string, string | null>();
    console.log(`Judging with ${model}…`);
    for (let i = 0; i < cases.length; i += 10) {
      const batch = cases.slice(i, i + 10);
      try {
        const { object } = await generateObject({
          model: gateway(model),
          schema: VERDICTS_SCHEMA,
          prompt: judgePrompt(batch),
          temperature: 0,
        });
        for (const v of object.verdicts) {
          // Normalize: non-catalog keys count as null (defensive).
          byId.set(v.id, v.category_key && validKeys.has(v.category_key) ? v.category_key : v.category_key === null ? null : `INVALID:${v.category_key}`);
        }
      } catch (e) {
        console.error(`  batch ${i / 10} FAILED on ${model}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      }
      if ((i / 10) % 3 === 2) console.log(`  ${Math.min(i + 10, cases.length)}/${cases.length}`);
    }
    perModel[model] = byId;
  }

  // ── Analysis ──────────────────────────────────────────────────────────
  const [ja, jb] = models;
  const rows: Array<Record<string, unknown>> = [];
  let confirmed = 0, suspect = 0, split = 0, missingVerdicts = 0;
  let haikuConsensusCorrect = 0, consensusCases = 0;
  const suspectDetails: string[] = [];
  const haikuMissDetails: string[] = [];

  for (const c of cases) {
    const label = c.expected.stage1_category_key;
    const va = perModel[ja]?.get(c.id);
    const vb = perModel[jb]?.get(c.id);
    const haiku = haikuById.get(c.id) ?? null;
    if (va === undefined || vb === undefined) { missingVerdicts += 1; continue; }

    const acceptable = new Set([label, ...(c.expected.stage1_acceptable ?? [])]);
    const aAgreesLabel = acceptable.has(va as string | null);
    const bAgreesLabel = acceptable.has(vb as string | null);

    let verdict: string;
    if (aAgreesLabel && bAgreesLabel) { verdict = "label_confirmed"; confirmed += 1; }
    else if (!aAgreesLabel && !bAgreesLabel && va === vb) {
      verdict = "label_suspect"; suspect += 1;
      suspectDetails.push(
        `${c.id}: label=${label} | both judges=${va} | haiku=${haiku} | "${c.text.slice(0, 80)}"`,
      );
    } else { verdict = "split"; split += 1; }

    // Consensus ground truth: majority of {label, va, vb}.
    const votes = [label, va, vb] as Array<string | null>;
    const counts = new Map<string | null, number>();
    for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
    let consensus: string | null | undefined;
    for (const [k, n] of counts) if (n >= 2) consensus = k;
    if (consensus !== undefined) {
      consensusCases += 1;
      // Haiku is correct vs consensus on exact match, OR when both its
      // answer and the consensus sit inside the case's acceptable set
      // (judges voting an acceptable alternate must not penalize the
      // primary label, and vice versa).
      const ok =
        haiku === consensus ||
        (acceptable.has(haiku) && acceptable.has(consensus));
      if (ok) haikuConsensusCorrect += 1;
    }

    const haikuWasWrongVsLabel = !isStage1Correct(c.expected, haiku);
    if (haikuWasWrongVsLabel) {
      haikuMissDetails.push(
        `${c.id}: label=${label} | haiku=${haiku} | ${ja}=${va} | ${jb}=${vb} | consensus=${consensus === undefined ? "NONE" : consensus} | "${c.text.slice(0, 70)}"`,
      );
    }

    rows.push({ id: c.id, label, [ja]: va, [jb]: vb, haiku, verdict, consensus: consensus === undefined ? null : consensus });
  }

  const summary = {
    models,
    cases_judged: cases.length - missingVerdicts,
    missing_verdicts: missingVerdicts,
    label_confirmed: confirmed,
    label_suspect: suspect,
    split,
    consensus_cases: consensusCases,
    haiku_stage1_accuracy_vs_consensus: consensusCases
      ? +(haikuConsensusCorrect / consensusCases).toFixed(4)
      : null,
    haiku_stage1_accuracy_vs_fixture_labels: 0.890,
  };
  console.log("\n" + JSON.stringify(summary, null, 1));
  console.log("\nLABEL-SUSPECT cases (both non-Claude judges disagree with the fixture):");
  for (const s of suspectDetails) console.log("  " + s);
  console.log("\nAll original Haiku misses, judged:");
  for (const s of haikuMissDetails) console.log("  " + s);

  writeFileSync(
    resolve(__dirname, "cross-judge-report.json"),
    JSON.stringify({ summary, rows }, null, 1) + "\n",
  );
  console.log("\nWrote scripts/eval/cross-judge-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
