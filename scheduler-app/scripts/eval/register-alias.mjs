/**
 * register-alias — maps the app's "@/..." tsconfig path alias onto src/
 * for bare `node --experimental-strip-types` script runs (Next resolves
 * the alias at build time; plain node does not).
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs <script.ts>
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = resolve(appRoot, "src", specifier.slice(2));
      for (const cand of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        resolve(base, "index.ts"),
      ]) {
        if (existsSync(cand)) {
          return { url: pathToFileURL(cand).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
