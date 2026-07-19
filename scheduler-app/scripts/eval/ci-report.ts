/**
 * ci-report — honest, interval-aware read of a run-eval-final.ts report
 * (eval-hardening, 2026-07-19; GPT/Gemini cross-verify follow-up).
 *
 * Bare point estimates on ~250-500 samples over-claim. This prints every
 * headline rate with a Wilson 95% CI, reports the AUTOMATION FLOOR (direct
 * routes) alongside safety (so a "punt everything" run can't look good), and
 * states whether the sample can even CERTIFY a ≤1% hard-misroute bar.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/ci-report.ts --report <final-x.json> [--baseline <final-y.json>]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  wilsonInterval,
  errorRateUpperBound,
  minNForZeroErrorBar,
} from "./graders.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

interface Row {
  outcome: string;
  hard: boolean;
  candidates: string[];
}
interface Report {
  tag?: string;
  ran_at?: string;
  models?: Record<string, string>;
  rows: Record<string, Row[]>;
  per_corpus?: Record<string, { final_landing_accuracy?: number }>;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function analyzeCorpus(rows: Row[], reportedLanding?: number): void {
  const n = rows.length;
  const direct = rows.filter((r) => r.outcome === "direct_correct").length;
  const hard = rows.filter((r) => r.hard).length;

  // Use the runner's AUTHORITATIVE final-landing rate for the point estimate
  // (it encodes the correct-handoff-when-ambiguous rules); the Wilson CI is
  // computed from the implied count so the interval matches the reported number.
  const landed =
    reportedLanding !== undefined
      ? Math.round(reportedLanding * n)
      : rows.filter((r) =>
          ["direct_correct", "clarify_resolved", "null_correct_direct"].includes(
            r.outcome,
          ),
        ).length;

  const land = wilsonInterval(landed, n);
  const auto = wilsonInterval(direct, n);
  const hardUB = errorRateUpperBound(hard, n);

  console.log(`  n = ${n}`);
  console.log(
    `  final-landing : ${pct(land.p)}  (95% CI ${pct(land.lo)}–${pct(land.hi)})`,
  );
  console.log(
    `  AUTOMATION floor (direct routes): ${pct(auto.p)}  (95% CI ${pct(auto.lo)}–${pct(auto.hi)})`,
  );
  console.log(
    `  hard-misroutes: ${hard}/${n} = ${pct(hard / n)}  (95% upper bound ${pct(hardUB)}, 1-in-${(1 / Math.max(hardUB, 1e-9)).toFixed(0)})`,
  );
  const certifies1pct = hardUB <= 0.01;
  console.log(
    `  → certifies ≤1-in-100 hard-misroute?  ${certifies1pct ? "YES" : "NO — need a bigger sealed set"}`,
  );
}

function main(): void {
  const reportArg = arg("report");
  if (!reportArg) throw new Error("--report <path> required");
  const report = JSON.parse(
    readFileSync(resolve(process.cwd(), reportArg), "utf8"),
  ) as Report;

  console.log(`# CI-aware read — tag=${report.tag ?? "?"} ran_at=${report.ran_at ?? "?"}`);
  console.log(`models: ${JSON.stringify(report.models ?? {})}`);
  console.log(
    `\nSample-size note: certifying a ≤1% (1-in-100) hard-misroute bar at 95% needs ` +
      `${minNForZeroErrorBar(0.01)} zero-error cases; a ≤0.5% bar needs ${minNForZeroErrorBar(0.005)}.`,
  );

  for (const corpus of Object.keys(report.rows)) {
    console.log(`\n== ${corpus} ==`);
    analyzeCorpus(
      report.rows[corpus] as Row[],
      report.per_corpus?.[corpus]?.final_landing_accuracy,
    );
  }
}

main();
