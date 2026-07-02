/**
 * register-alias — resolution hooks for bare `node --experimental-strip-types`
 * runs of app code (Next resolves these at build time; plain node does not):
 *   1. "@/..." tsconfig path alias → src/
 *   2. extensionless RELATIVE imports inside .ts sources → .ts/.tsx/index.ts
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs <script.ts>
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function tryCandidates(base) {
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
    if (existsSync(cand) && !cand.endsWith(appRoot)) {
      try {
        // Directories exist but aren't importable — only accept files.
        if (cand === base && !/\.[a-z]+$/i.test(cand)) continue;
      } catch {
        continue;
      }
      return pathToFileURL(cand).href;
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      // The Next bundle's exports don't fully resolve under bare node
      // (missing addBreadcrumb) — and eval runs must not report anyway.
      return {
        url: pathToFileURL(resolve(appRoot, "scripts", "eval", "sentry-stub.mjs")).href,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      const hit = tryCandidates(resolve(appRoot, "src", specifier.slice(2)));
      if (hit) return { url: hit, shortCircuit: true };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-z]+$/i.test(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const hit = tryCandidates(resolve(parentDir, specifier));
      if (hit) return { url: hit, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
