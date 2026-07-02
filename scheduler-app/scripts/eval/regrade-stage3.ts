/**
 * regrade-stage3 — offline Stage-3 re-grade after FP adjudication.
 *
 * Consumes:
 *   - scripts/eval/last-run.json (per-case raw_facts + expected_facts dump)
 *   - scripts/eval/stage3-adjudication.json (blind literal-judging of every
 *     FP assertion: fixture_under_labels = (id, slot) pairs where the text
 *     DID literally state the extracted value → the fixture label was the
 *     error, not the extractor)
 *
 * Re-scores Stage-3 slot precision/recall with the corrected labels — NO
 * LLM re-run needed (the extractions are already dumped). This is the
 * corrected number for the §11 "Stage-3 slot precision ≥ 0.85" bar.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/regrade-stage3.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gradeStage3Case, stage3Micro, type Stage3Counts } from "./graders.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RunRow {
  id: string;
  expected_facts?: Record<string, unknown>;
  raw_facts?: Record<string, unknown> | null;
}

const run = JSON.parse(
  readFileSync(resolve(__dirname, "last-run.json"), "utf8"),
) as { rows: RunRow[] };
const adj = JSON.parse(
  readFileSync(resolve(__dirname, "stage3-adjudication.json"), "utf8"),
) as {
  fixture_under_labels: Array<{ id: string; slot: string }>;
  extractor_over_assertions: Array<{ id: string; slot: string }>;
};

const underLabels = new Map<string, Set<string>>();
for (const u of adj.fixture_under_labels) {
  if (!underLabels.has(u.id)) underLabels.set(u.id, new Set());
  underLabels.get(u.id)!.add(u.slot);
}

const before: Stage3Counts[] = [];
const after: Stage3Counts[] = [];
for (const r of run.rows) {
  if (!r.raw_facts) continue;
  const expected = r.expected_facts ?? {};
  before.push(gradeStage3Case(expected, r.raw_facts));

  // Corrected labels: where the judge ruled the extraction LITERAL, the
  // fixture gains the extracted value (so the assertion becomes a TP).
  const corrections = underLabels.get(r.id);
  const corrected: Record<string, unknown> = { ...expected };
  if (corrections) {
    for (const slot of corrections) {
      corrected[slot] = r.raw_facts[slot];
    }
  }
  after.push(gradeStage3Case(corrected, r.raw_facts));
}

const b = stage3Micro(before);
const a = stage3Micro(after);
console.log("Stage-3 slot metrics (micro):");
console.log(
  `  as-labeled : precision ${b.precision.toFixed(3)} (tp ${b.tp} / fp ${b.fp}) · recall ${b.recall.toFixed(3)} (fn ${b.fn})`,
);
console.log(
  `  ADJUDICATED: precision ${a.precision.toFixed(3)} (tp ${a.tp} / fp ${a.fp}) · recall ${a.recall.toFixed(3)} (fn ${a.fn})`,
);
console.log(
  `  adjudication: ${adj.fixture_under_labels.length} fixture under-labels reclassified as TP; ${adj.extractor_over_assertions.length} confirmed extractor over-assertions`,
);
console.log(
  `  §11 bar (precision ≥ 0.85): ${a.precision >= 0.85 ? "✅ PASS (adjudicated)" : "❌ FAIL (adjudicated)"}`,
);
