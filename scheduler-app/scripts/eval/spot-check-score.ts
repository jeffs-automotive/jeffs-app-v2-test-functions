/**
 * spot-check-score — turn Chris's human verdicts (spot-check-sheet.json) into
 * the numbers that bound the eval's trust (eval-hardening, 2026-07-19).
 *
 * Reports, overall and per stratum (with Wilson 95% CIs):
 *   - LABEL-ERROR rate  = label_wrong / reviewed — how often the 3-judge
 *     consensus was itself wrong. This is the bound on CORRELATED judge error;
 *     the confirmed(3/3) stratum's rate is the one to extrapolate.
 *   - MODEL-ERROR rate (label-corrected) = model_wrong / (model_correct +
 *     model_wrong) — the model's true error once label errors + genuinely
 *     ambiguous cases are removed from the denominator.
 *   - On the DISPUTED stratum: how many "misroutes" were actually the LABEL
 *     being wrong (model right) — i.e. how much the headline misroute count
 *     over-states real error.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/spot-check-score.ts [--sheet scripts/eval/spot-check-sheet.json]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { wilsonInterval } from "./graders.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : (process.argv[i + 1] ?? def);
}

type Verdict = "model_correct" | "model_wrong" | "label_wrong" | "ambiguous" | null;
interface Item {
  id: string;
  stratum: string;
  verdict: Verdict;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function tally(items: Item[]): void {
  const n = items.length;
  const reviewed = items.filter((i) => i.verdict);
  const c = (v: Verdict) => items.filter((i) => i.verdict === v).length;
  const mc = c("model_correct"), mw = c("model_wrong"), lw = c("label_wrong"), amb = c("ambiguous");

  const labelErr = wilsonInterval(lw, reviewed.length);
  const modelDenom = mc + mw;
  const modelErr = wilsonInterval(mw, modelDenom);

  console.log(`  reviewed ${reviewed.length}/${n}` + (reviewed.length < n ? `  (⚠ ${n - reviewed.length} unrated)` : ""));
  console.log(`  verdicts: model_correct ${mc} · model_wrong ${mw} · label_wrong ${lw} · ambiguous ${amb}`);
  console.log(`  LABEL-error rate      : ${pct(labelErr.p)}  (95% CI ${pct(labelErr.lo)}–${pct(labelErr.hi)})  ← bound on correlated judge error`);
  console.log(`  MODEL-error (corrected): ${modelDenom ? pct(modelErr.p) : "n/a"}  ${modelDenom ? `(95% CI ${pct(modelErr.lo)}–${pct(modelErr.hi)}, n=${modelDenom})` : ""}`);
}

function main(): void {
  const sheetPath = arg("sheet", resolve(__dirname, "spot-check-sheet.json"));
  const { items } = JSON.parse(readFileSync(resolve(process.cwd(), sheetPath), "utf8")) as {
    items: Item[];
  };

  console.log("# Spot-check results\n");
  console.log("== OVERALL ==");
  tally(items);

  for (const stratum of ["disputed", "confirmed", "majority", "ambiguous"]) {
    const sub = items.filter((i) => i.stratum === stratum);
    if (sub.length === 0) continue;
    console.log(`\n== ${stratum} ==`);
    tally(sub);
  }

  const disputed = items.filter((i) => i.stratum === "disputed" && i.verdict);
  if (disputed.length) {
    const labelWrong = disputed.filter((i) => i.verdict === "label_wrong").length;
    console.log(
      `\nInterpretation: of ${disputed.length} reviewed DISPUTES (model vs consensus), ` +
        `${labelWrong} were the LABEL being wrong (model actually right) → the headline ` +
        `misroute count over-states true model error by ~${pct(labelWrong / disputed.length)} of disputes.`,
    );
  }
  console.log(
    `\nUse the CONFIRMED-stratum label-error rate as the population bound on ` +
      `correlated 3-judge error when reading any headline built on confirmed labels.`,
  );
}

main();
