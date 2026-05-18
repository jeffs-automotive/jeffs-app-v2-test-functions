// Lists every key NAME the --env-file parser pulled out of .env.local.
// Doesn't print values. Helps spot typos, key not present, or malformed
// lines that the parser silently dropped.
//
// Note: process.env is the OS env merged with --env-file. We diff against
// the keys we'd expect to ONLY come from the file to find what the file
// actually contributes.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");
const raw = readFileSync(target, "utf8");
const lines = raw.split(/\r?\n/);

console.log("=== File analysis ===");
console.log(`Total lines: ${lines.length}`);
console.log(`Bytes: ${Buffer.byteLength(raw, "utf8")}`);
console.log();

// Find KEY=VALUE lines naively (matches what Node's loader does)
const parsedKeys = [];
const malformed = [];
const blank = [];
const comments = [];
lines.forEach((line, i) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    blank.push(i + 1);
    return;
  }
  if (trimmed.startsWith("#")) {
    comments.push(i + 1);
    return;
  }
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (match) {
    parsedKeys.push({ line: i + 1, key: match[1], hasSpacesAroundEquals: /^\s*[A-Za-z_][A-Za-z0-9_]*\s+=|=\s+/.test(line) });
  } else {
    malformed.push({ line: i + 1, snippet: trimmed.length > 30 ? trimmed.slice(0, 30) + "…" : trimmed });
  }
});

console.log(`=== Lines that look like KEY=VALUE ===`);
console.log(`Count: ${parsedKeys.length}`);
for (const e of parsedKeys) {
  const flag = e.hasSpacesAroundEquals ? " ⚠️ SPACES_AROUND_EQUALS" : "";
  console.log(`  line ${String(e.line).padStart(3, " ")}: ${e.key}${flag}`);
}
console.log();
console.log(`Blank lines: ${blank.length}`);
console.log(`Comment lines: ${comments.length}`);
console.log(`Malformed lines: ${malformed.length}`);
for (const m of malformed) {
  console.log(`  line ${m.line}: "${m.snippet}"`);
}
