/**
 * run-act-or-ask — simulate the CANDIDATES-then-CLARIFY Stage-1 workflow
 * (Chris, 2026-07-03) on REAL customer concern texts with consensus labels.
 *
 * Contract under test (one LLM call per concern):
 *   - model returns 0-3 RANKED category candidates;
 *   - 1 candidate  -> direct route (today's behavior);
 *   - 2-3          -> the wizard shows ONE choice-chip clarification question;
 *                     the customer's tap resolves it DETERMINISTICALLY
 *                     (simulated: tap = consensus label if present among the
 *                     candidates, else "none of these" -> advisor handoff);
 *   - 0 candidates -> advisor handoff.
 *
 * Grading vs 3-family consensus labels (label-real-concerns.ts output):
 *   - graded pool = category_status != ambiguous (consensus may be null =
 *     genuinely no catalog fit -> correct landing is handoff);
 *   - final-landing accuracy, DANGEROUS misroutes (direct route to the wrong
 *     category — what Chris's 1-in-50 bar is about), clarification friction,
 *     advisor-handoff rate;
 *   - the ambiguous cases are reported separately: desired behavior there is
 *     clarify-or-handoff, NOT a confident single answer.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/run-act-or-ask.ts [--models a,b] [--limit N] [--concurrency 6]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
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
}

interface LabeledCase {
  id: string;
  text: string;
  consensus_category: string | null;
  category_status: "confirmed" | "majority" | "ambiguous" | "unjudged";
}

interface CaseResult {
  id: string;
  text: string;
  consensus: string | null;
  status: string;
  candidates: string[];
  outcome:
    | "direct_correct"
    | "direct_wrong" // DANGEROUS: confident single answer, wrong category
    | "clarify_resolved" // customer tap lands on consensus
    | "clarify_to_handoff" // consensus not among chips -> none-of-these -> advisor (safe miss)
    | "handoff_correct" // no candidates, consensus null
    | "handoff_miss" // no candidates but a category existed (safe miss)
    | "null_correct_direct" // consensus null and model returned 0 candidates
    | "error";
  latency_ms: number;
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
  const labeled = JSON.parse(
    readFileSync(resolve(appRoot, arg("input") ?? "scripts/eval/real-concerns-labeled.json"), "utf8"),
  ) as { cases: LabeledCase[] };

  let cases = labeled.cases.filter((c) => c.category_status !== "unjudged");
  const limit = arg("limit");
  if (limit) cases = cases.slice(0, Number(limit));

  const catBrief = snapshot.categories
    .map((c) =>
      c.kind === "testing_service"
        ? `- key="${c.service_key}" (testing service) — ${c.display_name}. ${(c.description ?? "").slice(0, 220)}`
        : `- key="${c.subcategory_slug}" (advisor-handoff situation) — ${c.display_label}`,
    )
    .join("\n");
  const validKeys = new Set(
    snapshot.categories.map((c) =>
      c.kind === "testing_service" ? c.service_key! : c.subcategory_slug!,
    ),
  );

  const CANDIDATES_SCHEMA = jsonSchema<{ candidates: string[] }>({
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
      },
    },
  });

  const promptFor = (text: string) =>
    `You are the intake classifier for an auto-repair shop's appointment scheduler. A customer typed this concern:

"""${text}"""

CATALOG — the only valid category keys:
${catBrief}

Return RANKED candidate category keys under this contract:
- Exactly ONE key when the text clearly points to a single category. Do not hedge on clear cases — a second candidate has a real cost (the customer gets an extra question).
- TWO or THREE ranked keys when the text is GENUINELY consistent with more than one category and picking one would be a guess. The customer will be shown the options and asked which fits.
- An EMPTY list when the text is not a vehicle concern, is too vague to produce candidates, or no catalog key fits (the customer goes to a service advisor).
- Keys VERBATIM from the catalog.`;

  const models = (arg("models") ?? "google/gemini-3.1-flash-lite,anthropic/claude-haiku-4-5,openai/gpt-5.4-mini").split(",");
  const concurrency = Number(arg("concurrency") ?? "6");

  const report: Record<string, unknown> = {};
  const allRows: Record<string, CaseResult[]> = {};

  for (const model of models) {
    console.log(`\n=== ${model} ===`);
    const rows: CaseResult[] = new Array(cases.length);
    let next = 0;
    async function worker(): Promise<void> {
      while (next < cases.length) {
        const idx = next++;
        const c = cases[idx]!;
        const t0 = Date.now();
        let cands: string[] = [];
        let outcome: CaseResult["outcome"];
        try {
          const { object } = await generateObject({
            model: gateway(model),
            schema: CANDIDATES_SCHEMA,
            prompt: promptFor(c.text),
            temperature: 0,
          });
          cands = object.candidates.filter((k) => validKeys.has(k));
          const consensus = c.consensus_category;
          if (cands.length === 0) {
            outcome = consensus === null ? "null_correct_direct" : "handoff_miss";
          } else if (cands.length === 1) {
            outcome = cands[0] === consensus ? "direct_correct" : "direct_wrong";
          } else {
            outcome = consensus !== null && cands.includes(consensus)
              ? "clarify_resolved"
              : "clarify_to_handoff";
          }
        } catch (e) {
          outcome = "error";
          console.error(`  ${c.id} ERROR: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
        }
        rows[idx] = {
          id: c.id,
          text: c.text.slice(0, 90),
          consensus: c.consensus_category,
          status: c.category_status,
          candidates: cands,
          outcome,
          latency_ms: Date.now() - t0,
        };
        if (idx % 25 === 24) console.log(`  ${idx + 1}/${cases.length}`);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    // ── metrics ──────────────────────────────────────────────────────────
    const graded = rows.filter((r) => r.status !== "ambiguous" && r.outcome !== "error");
    const amb = rows.filter((r) => r.status === "ambiguous" && r.outcome !== "error");
    const count = (o: CaseResult["outcome"], set: CaseResult[]) => set.filter((r) => r.outcome === o).length;

    const directCorrect = count("direct_correct", graded);
    const directWrong = count("direct_wrong", graded);
    const clarifyResolved = count("clarify_resolved", graded);
    const clarifyToHandoff = count("clarify_to_handoff", graded);
    const handoffMiss = count("handoff_miss", graded);
    const nullCorrect = count("null_correct_direct", graded);

    const finalCorrect = directCorrect + clarifyResolved + nullCorrect;
    const friction = clarifyResolved + clarifyToHandoff;
    const handoffs = clarifyToHandoff + handoffMiss + nullCorrect;

    // ambiguous cases: desired behavior = clarify or handoff, NOT one confident answer
    const ambConfidentSingle = amb.filter((r) => r.candidates.length === 1).length;

    const m = {
      graded: graded.length,
      final_landing_accuracy: +(finalCorrect / graded.length).toFixed(4),
      dangerous_direct_misroutes: directWrong,
      misroute_rate: +(directWrong / graded.length).toFixed(4),
      one_in_n_misroute: directWrong > 0 ? Math.round(graded.length / directWrong) : null,
      clarification_friction: +(friction / graded.length).toFixed(4),
      safe_miss_to_advisor: clarifyToHandoff + handoffMiss,
      advisor_handoff_rate: +(handoffs / graded.length).toFixed(4),
      p50_latency_ms: [...rows.map((r) => r.latency_ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
      ambiguous_cases: amb.length,
      ambiguous_handled_safely: amb.length - ambConfidentSingle,
      ambiguous_confident_single: ambConfidentSingle,
      errors: rows.filter((r) => r.outcome === "error").length,
    };
    report[model] = m;
    allRows[model] = rows;
    console.log(JSON.stringify(m, null, 1));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  writeFileSync(
    resolve(appRoot, `scripts/eval/act-or-ask-report.json`),
    JSON.stringify({ ran_at: stamp, prompt_contract: "ranked 0-3 candidates", models: report, rows: allRows }, null, 1),
  );
  console.log(`\nWrote scripts/eval/act-or-ask-report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
