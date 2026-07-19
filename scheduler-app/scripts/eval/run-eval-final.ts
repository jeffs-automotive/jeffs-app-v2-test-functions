/**
 * run-eval-final — the FULL-CHAIN act-or-ask re-baseline driving the REAL
 * PRODUCTION diagnoseConcern path (AO5, 2026-07-03).
 *
 * Unlike run-act-or-ask.ts (a hand-rolled single-call SIMULATION of the
 * candidates contract), this runner imports the shipped
 *   diagnoseConcern()  (src/lib/scheduler/wizard/llm/diagnose-concern.ts)
 * and the shipped confidence gate + graders, so every number here is the
 * behavior production would actually produce: Stage-1 candidate ranking →
 * per-candidate Stage-2/Stage-3 precompute → deterministic mapper →
 * confidence gate. Env model defaults apply (S1/S2 gemini-3.1-flash-lite,
 * S3 haiku) unless DIAGNOSE_CONCERN_STAGE{N}_MODEL / --s3-model override.
 *
 * Three corpora:
 *   - forum      — real-concerns-labeled-v2.json  (3-family consensus labels)
 *   - tekmetric  — real-concerns-tekmetric-labeled-v2.json
 *   - synthetic  — eval-cases.json (145 authored, expected.stage1_category_key
 *                  + stage1_acceptable + stage3_facts; the ONLY corpus with
 *                  expected_facts, so the Stage-3 A/B grades here)
 *
 * Grading (real corpora — graded pool = category_status in {confirmed,
 * majority}; consensus may be null = genuinely no catalog fit → correct
 * landing is handoff):
 *   - requires_clarification (2-3 candidates): simulated tap = consensus if
 *     among stage1_candidates → clarify_resolved; else none-of-these →
 *     advisor → clarify_to_handoff.
 *   - single candidate (post-gate): direct_correct/direct_wrong vs consensus.
 *   - zero candidates: null_correct_direct when consensus null, else
 *     handoff_miss.
 *   - "hard misroute" = a direct_wrong where the model disagreed with a
 *     UNANIMOUS (confirmed, 3/3) label — the number Chris's 1-in-50 bar
 *     governs (mirrors the earlier real-data forensics).
 *
 * Grading (synthetic — acceptable-set aware via isStage1Correct):
 *   - clarify: tap lands on expected key (or an acceptable alt) if present
 *     among candidates → clarify_resolved; else clarify_to_handoff.
 *   - single: direct_correct/direct_wrong vs expected/acceptable.
 *   - zero: null_correct_direct when route==='null_match', else handoff_miss.
 *   - Stage-3 slot precision/recall via gradeStage3Case/stage3Micro over the
 *     precomputed facts (single path: extracted_facts; clarify path: the
 *     tapped candidate's extracted_facts). Reported raw AND adjudication-
 *     aware (stage3-adjudication.json fixture_under_labels → TP).
 *
 * The confidence gate (applyConfidenceGate) is applied to every NON-clarify
 * result and the gate outcomes are counted. On the real corpora a gate
 * advisor_handoff strips a testing-service match → the case lands as a
 * handoff (safe), which is exactly what production would persist.
 *
 * Metrics per corpus: final_landing_accuracy · dangerous direct misroutes
 * (+ hard-misroute split) · 1-in-N (hard) · clarification friction · advisor
 * rate · S2 subcategory accuracy (on clarify-resolved + direct-correct cases
 * that HAVE a consensus/expected subcategory) · p50/p95 chain latency · parse
 * failures.
 *
 * Run (from scheduler-app/, credentials per AO5 task):
 *   export VERCEL_OIDC_TOKEN=$(grep '^VERCEL_OIDC_TOKEN=' .env.eval-prod | cut -d= -f2- | tr -d '"')
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/run-eval-final.ts [--concurrency 6] [--limit N] \
 *     [--corpora forum,tekmetric,synthetic] [--s3-model <id>] [--tag <label>] \
 *     [--output scripts/eval/final-baseline-report.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  EvalCase,
  EvalCaseExpected,
  Stage3Counts,
} from "./graders.ts";
import {
  gradeStage3Case,
  isStage1Correct,
  percentile,
  stage3Micro,
} from "./graders.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, "..", "..");

// ─── env + args ─────────────────────────────────────────────────────────────

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
    // Skip EMPTY values — Vercel "sensitive" vars pull as '' and an empty
    // string is NOT nullish, so it defeats the AI_GATEWAY_API_KEY ??
    // VERCEL_OIDC_TOKEN fallback in diagnose-concern.
    if (v.length === 0) continue;
    process.env[key] = v;
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return process.argv[i + 1] ?? "true";
}

// ─── outcome vocabulary (mirrors run-act-or-ask.ts) ─────────────────────────

type Outcome =
  | "direct_correct"
  | "direct_wrong" // confident single answer, wrong category (DANGEROUS)
  | "clarify_resolved" // customer tap lands on consensus/expected
  | "clarify_to_handoff" // consensus not among chips → none-of-these → advisor (safe miss)
  | "null_correct_direct" // consensus null and model returned 0 candidates
  | "handoff_miss" // 0 candidates but a category existed (safe miss)
  | "error";

interface CaseRow {
  id: string;
  text: string;
  consensus_category: string | null;
  consensus_subcategory: string | null;
  category_status: string; // confirmed | majority | ambiguous
  candidates: string[];
  requires_clarification: boolean;
  gate: string; // pass | advisor_handoff | over_ask | n/a(clarify)
  routed_key: string | null; // key the case effectively landed on (post-tap/gate)
  routed_subcategory: string | null; // subcategory of the landed candidate
  outcome: Outcome;
  hard: boolean; // dangerous direct misroute vs a UNANIMOUS label
  stage3: Stage3Counts | null; // synthetic only
  /** Raw + expected facts (synthetic only) — kept so the adjudication-aware
   *  Stage-3 regrade can fold fixture_under_labels into the expected set and
   *  recompute precision precisely (same net effect as regrade-stage3.ts). */
  raw_facts: Record<string, unknown> | null;
  expected_facts: Record<string, unknown> | null;
  latency_ms: number;
  parsed_ok: boolean;
}

// Row shape shared by the real-corpus labeled files and (adapted) the
// synthetic fixture.
interface GradingCase {
  id: string;
  text: string;
  consensus_category: string | null;
  consensus_subcategory: string | null;
  category_status: string;
  chip_hint?: EvalCase["chip_hint"];
  /** synthetic acceptable-set aware grading uses the full expected block. */
  expected?: EvalCaseExpected;
  /** The set of category keys ANY of the 3 judge families voted (real
   *  corpora only) — used for the "hard misroute" split: a direct_wrong to a
   *  key NO judge gave, OR a direct_wrong against a UNANIMOUS (confirmed)
   *  label, is a HARD misroute (mirrors the earlier real-data forensics).
   *  Undefined on the synthetic fixture (no judge votes). */
  judge_voted_keys?: Set<string>;
}

// ─── corpus loaders ─────────────────────────────────────────────────────────

interface LabeledRealRow {
  id: string;
  text: string;
  consensus_category: string | null;
  category_status: "confirmed" | "majority" | "ambiguous" | "unjudged";
  consensus_subcategory: string | null;
  subcategory_status: string | null;
  category_votes?: Record<string, string | null>;
}

function loadRealCorpus(relPath: string): GradingCase[] {
  const raw = JSON.parse(readFileSync(resolve(appRoot, relPath), "utf8")) as {
    cases: LabeledRealRow[];
  };
  return raw.cases
    .filter((c) => c.category_status !== "unjudged")
    .map((c) => ({
      id: c.id,
      text: c.text,
      consensus_category: c.consensus_category,
      consensus_subcategory: c.consensus_subcategory,
      category_status: c.category_status,
      judge_voted_keys: new Set(
        Object.values(c.category_votes ?? {}).filter(
          (v): v is string => typeof v === "string",
        ),
      ),
    }));
}

function loadSyntheticCorpus(): GradingCase[] {
  const raw = JSON.parse(
    readFileSync(resolve(__dirname, "eval-cases.json"), "utf8"),
  ) as { cases: EvalCase[] };
  return raw.cases.map((c) => ({
    id: c.id,
    text: c.text,
    // For the synthetic fixture the "consensus" IS the authored expected
    // key; grading routes through isStage1Correct via `expected`.
    consensus_category: c.expected.stage1_category_key,
    consensus_subcategory: c.expected.stage2_subcategory_slug,
    // Fixture labels are authored ground truth → treat as unanimous for the
    // hard-misroute split (there is no separate confidence signal).
    category_status: "confirmed",
    chip_hint: c.chip_hint ?? null,
    expected: c.expected,
  }));
}

// ─── grading helpers ────────────────────────────────────────────────────────

/** Correct-key test: synthetic uses the acceptable set; real corpora use
 *  strict equality to the consensus category. */
function keyIsCorrect(gc: GradingCase, key: string | null): boolean {
  if (gc.expected) return isStage1Correct(gc.expected, key);
  return key === gc.consensus_category;
}

/** For the clarify path: does the candidate set CONTAIN a correct key? */
function candidatesContainCorrect(
  gc: GradingCase,
  candidates: string[],
): boolean {
  return candidates.some((k) => keyIsCorrect(gc, k));
}

/** The correct key present among the candidates (for subcategory alignment on
 *  clarify-resolved cases) — first one that matches. */
function correctKeyAmong(
  gc: GradingCase,
  candidates: string[],
): string | null {
  return candidates.find((k) => keyIsCorrect(gc, k)) ?? null;
}

// ─── adjudication (Stage-3 fixture under-labels → TP) ───────────────────────

function loadAdjudicationUnderLabels(): Map<string, Set<string>> {
  const p = resolve(__dirname, "stage3-adjudication.json");
  const m = new Map<string, Set<string>>();
  if (!existsSync(p)) return m;
  const adj = JSON.parse(readFileSync(p, "utf8")) as {
    fixture_under_labels?: Array<{ id: string; slot: string }>;
  };
  for (const u of adj.fixture_under_labels ?? []) {
    if (!m.has(u.id)) m.set(u.id, new Set());
    m.get(u.id)!.add(u.slot);
  }
  return m;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error(
      "Production config requires AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) — refusing to run off-config.",
    );
  }

  // Optional Stage-3 model override for the A/B (applies before the dynamic
  // import so diagnose-concern's module-scope resolvers pick it up per call
  // — resolveStage3Model reads process.env at call time, so setting it here
  // is sufficient).
  const s3Model = arg("s3-model");
  if (s3Model) process.env.DIAGNOSE_CONCERN_STAGE3_MODEL = s3Model;

  const { createClient } = await import("@supabase/supabase-js");
  const { diagnoseConcern } = await import(
    "../../src/lib/scheduler/wizard/llm/diagnose-concern.ts"
  );
  const { loadDiagnosticCatalog } = await import(
    "../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts"
  );
  const { applyConfidenceGate } = await import(
    "../../src/lib/scheduler/wizard/confidence-gate.ts"
  );
  const { resolveServiceRoleKey, resolveSupabaseUrl } = await import(
    "../../src/lib/supabase/resolve-keys.ts"
  );
  const { catalogContentHash } = await import("./catalog-hash.ts");

  const url = resolveSupabaseUrl(process.env);
  const key = resolveServiceRoleKey(process.env);
  if (!url || !key) throw new Error("Missing Supabase URL or service key.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Loading live diagnostic catalog…");
  const catalog = await loadDiagnosticCatalog(supabase);
  const catalogHash = catalogContentHash(catalog);
  console.log(
    `Catalog: ${catalog.categories.length} categories, content-hash ${catalogHash}`,
  );

  const stage1Model =
    process.env.DIAGNOSE_CONCERN_STAGE1_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    "google/gemini-3.1-flash-lite";
  const stage2Model =
    process.env.DIAGNOSE_CONCERN_STAGE2_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    "google/gemini-3.1-flash-lite";
  const stage3Model =
    process.env.DIAGNOSE_CONCERN_STAGE3_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    "anthropic/claude-haiku-4-5";
  console.log(
    `Models — S1 ${stage1Model} · S2 ${stage2Model} · S3 ${stage3Model}`,
  );

  const underLabels = loadAdjudicationUnderLabels();

  // ── corpus selection ──────────────────────────────────────────────────
  // DEFAULT DROPS tekmetric (Chris 2026-07-19): Tekmetric RO "concern" text is
  // written by a SERVICE ADVISOR — summarized shorthand ("TEST BATTERY",
  // "CHECK ALIGNMENT", "testing auth $189"), often missing the very details the
  // wizard exists to extract. It is NOT the customer-voice distribution the
  // classifier serves, so judging/training against it measures the wrong thing.
  // `forum` (real customers describing problems in their own words) is the
  // customer-voice proxy; the real target is production wizard input (flywheel).
  // tekmetric stays available via `--corpora …,tekmetric` for reference only.
  const corporaArg = (arg("corpora") ?? "forum,synthetic").split(",");
  const limit = arg("limit") ? Number(arg("limit")) : null;
  const concurrency = Number(arg("concurrency") ?? "6");

  const corpusFiles: Record<string, () => GradingCase[]> = {
    forum: () => loadRealCorpus("scripts/eval/real-concerns-labeled-v2.json"),
    // DEPRECATED — advisor shorthand, not customer voice. Not in the default set.
    tekmetric: () =>
      loadRealCorpus("scripts/eval/real-concerns-tekmetric-labeled-v2.json"),
    synthetic: () => loadSyntheticCorpus(),
  };

  const perCorpus: Record<string, unknown> = {};
  const allRows: Record<string, CaseRow[]> = {};

  for (const corpus of corporaArg) {
    const loader = corpusFiles[corpus];
    if (!loader) {
      console.warn(`Unknown corpus "${corpus}" — skipping.`);
      continue;
    }
    let cases = loader();
    if (limit) cases = cases.slice(0, limit);
    console.log(`\n=== ${corpus} (${cases.length} cases) ===`);

    const rows: CaseRow[] = new Array(cases.length);
    let next = 0;
    let done = 0;

    async function worker(): Promise<void> {
      while (next < cases.length) {
        const idx = next++;
        const gc = cases[idx] as GradingCase;
        const t0 = Date.now();
        let row: CaseRow;
        try {
          const res = await diagnoseConcern({
            catalog,
            customer_description: gc.text,
            customer_chip_hint: gc.chip_hint ?? null,
            vehicle_notes: null,
          });

          let outcome: Outcome;
          let routedKey: string | null = null;
          let routedSub: string | null = null;
          let gate = "n/a";
          let stage3: Stage3Counts | null = null;
          let rawFacts: Record<string, unknown> | null = null;

          if (res.requires_clarification) {
            // 2-3 candidates → simulated tap.
            const cands = res.stage1_candidates;
            if (candidatesContainCorrect(gc, cands)) {
              outcome = "clarify_resolved";
              routedKey = correctKeyAmong(gc, cands);
              // Pull the tapped candidate's precomputed chain.
              const cand = (res.candidate_results ?? []).find(
                (c) => c.category_key === routedKey,
              );
              routedSub = cand?.matched_subcategory_slug ?? null;
              if (gc.expected && cand) {
                rawFacts = (cand.extracted_facts ??
                  {}) as unknown as Record<string, unknown>;
                stage3 = gradeStage3Case(gc.expected.stage3_facts, rawFacts);
              }
            } else {
              outcome = "clarify_to_handoff";
            }
          } else {
            // Single / zero candidate → apply the production confidence gate.
            const gated = applyConfidenceGate(res);
            gate = gated.gate;
            const g = gated.result;
            const key = g.matched_category_key;
            routedKey = key;
            routedSub = g.matched_subcategory_slug;

            if (res.stage1_candidates.length === 0 || key === null) {
              // Zero candidates OR gate stripped the match → advisor path.
              // consensus null (real) / route null_match (synth) = correct.
              const consensusNull = gc.expected
                ? gc.expected.route === "null_match"
                : gc.consensus_category === null;
              if (res.stage1_candidates.length === 0) {
                outcome = consensusNull
                  ? "null_correct_direct"
                  : "handoff_miss";
              } else {
                // Had a candidate but the gate handed off → treat like a
                // safe advisor miss (or correct if consensus is null).
                outcome = consensusNull
                  ? "null_correct_direct"
                  : "handoff_miss";
              }
            } else {
              outcome = keyIsCorrect(gc, key)
                ? "direct_correct"
                : "direct_wrong";
              if (gc.expected && res.extracted_facts) {
                rawFacts = res.extracted_facts as unknown as Record<
                  string,
                  unknown
                >;
                stage3 = gradeStage3Case(gc.expected.stage3_facts, rawFacts);
              }
            }
          }

          // "Hard misroute" (mirrors the earlier real-data forensics): a
          // confident single-candidate route to the wrong category that CAN'T
          // be excused by a label dispute — either it disagreed with a
          // UNANIMOUS (confirmed, 3/3) consensus, OR it invented a key that NO
          // judge family voted. On the synthetic fixture (no judge votes) every
          // direct_wrong is hard (authored ground truth = unanimous).
          const hard =
            outcome === "direct_wrong" &&
            (gc.judge_voted_keys === undefined || // synthetic
              gc.category_status === "confirmed" ||
              (routedKey !== null && !gc.judge_voted_keys.has(routedKey)));

          row = {
            id: gc.id,
            text: gc.text, // FULL concern text — what the LLM actually reads (was slice(0,90); truncation hid the input from the spot-check reviewer)
            consensus_category: gc.consensus_category,
            consensus_subcategory: gc.consensus_subcategory,
            category_status: gc.category_status,
            candidates: res.stage1_candidates,
            requires_clarification: res.requires_clarification,
            gate,
            routed_key: routedKey,
            routed_subcategory: routedSub,
            outcome,
            hard,
            stage3,
            raw_facts: rawFacts,
            expected_facts: gc.expected?.stage3_facts ?? null,
            latency_ms: Date.now() - t0,
            parsed_ok: res.parsed_ok,
          };
        } catch (e) {
          row = {
            id: gc.id,
            text: gc.text, // FULL concern text — what the LLM actually reads (was slice(0,90); truncation hid the input from the spot-check reviewer)
            consensus_category: gc.consensus_category,
            consensus_subcategory: gc.consensus_subcategory,
            category_status: gc.category_status,
            candidates: [],
            requires_clarification: false,
            gate: "error",
            routed_key: null,
            routed_subcategory: null,
            outcome: "error",
            hard: false,
            stage3: null,
            raw_facts: null,
            expected_facts: gc.expected?.stage3_facts ?? null,
            latency_ms: Date.now() - t0,
            parsed_ok: false,
          };
          console.error(
            `  ${gc.id} ERROR: ${e instanceof Error ? e.message.slice(0, 160) : e}`,
          );
        }
        rows[idx] = row;
        done += 1;
        if (done % 25 === 0) console.log(`  ${done}/${cases.length}`);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, cases.length) }, worker),
    );

    // ── metrics ────────────────────────────────────────────────────────────
    const graded = rows.filter(
      (r) => r.category_status !== "ambiguous" && r.outcome !== "error",
    );
    const amb = rows.filter(
      (r) => r.category_status === "ambiguous" && r.outcome !== "error",
    );
    const nOf = (o: Outcome, set: CaseRow[]) =>
      set.filter((r) => r.outcome === o).length;

    const directCorrect = nOf("direct_correct", graded);
    const directWrong = nOf("direct_wrong", graded);
    const clarifyResolved = nOf("clarify_resolved", graded);
    const clarifyToHandoff = nOf("clarify_to_handoff", graded);
    const handoffMiss = nOf("handoff_miss", graded);
    const nullCorrect = nOf("null_correct_direct", graded);

    const hardMisroutes = graded.filter((r) => r.hard).length;

    const finalCorrect = directCorrect + clarifyResolved + nullCorrect;
    const friction = clarifyResolved + clarifyToHandoff;
    const handoffs = clarifyToHandoff + handoffMiss + nullCorrect;

    // S2 subcategory accuracy: on cases that landed correctly (direct_correct
    // or clarify_resolved) AND have a consensus/expected subcategory, is the
    // routed subcategory right?
    const s2Pool = graded.filter(
      (r) =>
        (r.outcome === "direct_correct" || r.outcome === "clarify_resolved") &&
        r.consensus_subcategory != null,
    );
    const s2Correct = s2Pool.filter(
      (r) => r.routed_subcategory === r.consensus_subcategory,
    ).length;

    // Stage-3 (synthetic only) — raw + adjudication-aware.
    // Raw: per-case Stage3Counts already graded against the as-authored
    // fixture. Adjudicated: fold stage3-adjudication.json fixture_under_labels
    // into the expected facts (each under-label was a FP the judge ruled
    // LITERAL → it becomes a TP), then re-grade from the persisted raw facts.
    // This is exactly regrade-stage3.ts's transform, inlined so the report is
    // self-contained.
    const s3rows = rows.filter((r) => r.stage3) as (CaseRow & {
      stage3: Stage3Counts;
    })[];
    const s3Raw = s3rows.length
      ? stage3Micro(s3rows.map((r) => r.stage3))
      : null;
    let s3Adj: ReturnType<typeof stage3Micro> | null = null;
    if (s3Raw) {
      const adjCounts: Stage3Counts[] = [];
      for (const r of s3rows) {
        if (!r.raw_facts) {
          adjCounts.push(r.stage3);
          continue;
        }
        const expected = { ...(r.expected_facts ?? {}) };
        const corrections = underLabels.get(r.id);
        if (corrections) {
          for (const slot of corrections) {
            // Judge ruled this extracted assertion literal → the fixture was
            // under-labeled; give it the extracted value so it grades as TP.
            expected[slot] = r.raw_facts[slot];
          }
        }
        adjCounts.push(gradeStage3Case(expected, r.raw_facts));
      }
      s3Adj = stage3Micro(adjCounts);
    }

    const latencies = graded.map((r) => r.latency_ms);
    const parseFails = rows.filter((r) => !r.parsed_ok).length;
    const ambConfidentSingle = amb.filter(
      (r) => r.candidates.length === 1 && !r.requires_clarification,
    ).length;

    const metrics = {
      corpus,
      graded: graded.length,
      final_landing_accuracy: graded.length
        ? +(finalCorrect / graded.length).toFixed(4)
        : 0,
      direct_correct: directCorrect,
      clarify_resolved: clarifyResolved,
      null_correct_direct: nullCorrect,
      dangerous_direct_misroutes: directWrong,
      hard_misroutes: hardMisroutes,
      misroute_rate: graded.length
        ? +(directWrong / graded.length).toFixed(4)
        : 0,
      hard_misroute_rate: graded.length
        ? +(hardMisroutes / graded.length).toFixed(4)
        : 0,
      one_in_n_misroute:
        directWrong > 0 ? Math.round(graded.length / directWrong) : null,
      one_in_n_hard:
        hardMisroutes > 0 ? Math.round(graded.length / hardMisroutes) : null,
      clarification_friction: graded.length
        ? +(friction / graded.length).toFixed(4)
        : 0,
      clarify_resolved_count: clarifyResolved,
      clarify_to_handoff_count: clarifyToHandoff,
      safe_miss_to_advisor: clarifyToHandoff + handoffMiss,
      advisor_handoff_rate: graded.length
        ? +(handoffs / graded.length).toFixed(4)
        : 0,
      gate_advisor_handoff: rows.filter((r) => r.gate === "advisor_handoff")
        .length,
      gate_over_ask: rows.filter((r) => r.gate === "over_ask").length,
      gate_pass: rows.filter((r) => r.gate === "pass").length,
      s2_subcategory_accuracy:
        s2Pool.length > 0 ? +(s2Correct / s2Pool.length).toFixed(4) : null,
      s2_graded: s2Pool.length,
      s2_correct: s2Correct,
      stage3_precision_raw: s3Raw ? +s3Raw.precision.toFixed(4) : null,
      stage3_recall_raw: s3Raw ? +s3Raw.recall.toFixed(4) : null,
      stage3_tp: s3Raw?.tp ?? null,
      stage3_fp: s3Raw?.fp ?? null,
      stage3_fn: s3Raw?.fn ?? null,
      stage3_precision_adjudicated: s3Adj ? +s3Adj.precision.toFixed(4) : null,
      stage3_recall_adjudicated: s3Adj ? +s3Adj.recall.toFixed(4) : null,
      stage3_tp_adjudicated: s3Adj?.tp ?? null,
      stage3_fp_adjudicated: s3Adj?.fp ?? null,
      stage3_cases_graded: s3rows.length,
      p50_latency_ms: percentile(latencies, 50),
      p95_latency_ms: percentile(latencies, 95),
      max_latency_ms: latencies.length ? Math.max(...latencies) : 0,
      parse_failures: parseFails,
      ambiguous_cases: amb.length,
      ambiguous_handled_safely: amb.length - ambConfidentSingle,
      ambiguous_confident_single: ambConfidentSingle,
      errors: rows.filter((r) => r.outcome === "error").length,
    };

    perCorpus[corpus] = metrics;
    allRows[corpus] = rows;
    console.log(JSON.stringify(metrics, null, 1));
  }

  // ── write reports ──────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tag = arg("tag") ?? (s3Model ? `s3-${s3Model.replace(/[/.]/g, "_")}` : "baseline");
  const outPath =
    arg("output") ?? "scripts/eval/final-baseline-report.json";
  writeFileSync(
    resolve(appRoot, outPath),
    JSON.stringify(
      {
        ran_at: stamp,
        tag,
        models: { stage1: stage1Model, stage2: stage2Model, stage3: stage3Model },
        catalog_categories: catalog.categories.length,
        catalog_hash: catalogHash,
        contract: "production diagnoseConcern full-chain (act-or-ask AO5)",
        per_corpus: perCorpus,
        rows: allRows,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
