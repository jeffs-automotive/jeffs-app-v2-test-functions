// Inspects the ANTHROPIC_API_KEY line in .env.local without printing the
// secret. Reports things that would break Node's --env-file parser:
// surrounding quotes, inline #-comments, hidden characters, whitespace
// around `=`, missing newline, etc.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");
const raw = readFileSync(target, "utf8");
const lines = raw.split(/\r?\n/);

const idx = lines.findIndex((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
if (idx === -1) {
  console.log("ANTHROPIC_API_KEY line NOT FOUND in .env.local");
  process.exit(0);
}

const line = lines[idx];
const eqIdx = line.indexOf("=");
const valuePart = line.slice(eqIdx + 1);

// Build a "shape" view that hides the secret but reveals structure.
const shape = valuePart
  .split("")
  .map((c, i) => {
    if (/[A-Za-z0-9]/.test(c)) return "·"; // hide alphanumerics
    if (c === "-" || c === "_") return c; // hyphens/underscores are non-secret
    if (c === " ") return "␣";
    if (c === "\t") return "→TAB";
    if (c === "\r") return "→CR";
    if (c === '"') return "→DOUBLE_QUOTE";
    if (c === "'") return "→SINGLE_QUOTE";
    if (c === "#") return "→HASH(inline-comment-start)";
    return `→0x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  })
  .join("");

console.log(`Line index (0-based): ${idx}`);
console.log(`Line (1-based): ${idx + 1}`);
console.log(`Total bytes on line: ${Buffer.byteLength(line, "utf8")}`);
console.log(`Spaces around =: leading=${/^\s*ANTHROPIC_API_KEY\s+=/.test(line)}, trailing=${/=\s/.test(line)}`);
console.log(`Value length (chars): ${valuePart.length}`);
console.log(`Value starts with quote: ${valuePart.startsWith('"') || valuePart.startsWith("'")}`);
console.log(`Value ends with quote: ${valuePart.endsWith('"') || valuePart.endsWith("'")}`);
console.log(`Value contains '#' (would be inline-comment-start): ${valuePart.includes("#")}`);
console.log(`Value contains whitespace: ${/\s/.test(valuePart)}`);
console.log();
console.log(`Value shape (alphanumerics hidden as '·', special chars revealed):`);
console.log(`  ${shape}`);
console.log();
console.log(`Expected shape for a valid Anthropic key:`);
console.log(`  ·······-······-···-·························-·····-·······-························-············-····················`);
console.log(`  (starts with 'sk-ant-api…', mix of alphanumerics + hyphens + underscores, no quotes/spaces/hashes)`);
