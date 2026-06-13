// fix-env-encoding — detects UTF-16 LE BOM at the start of .env.local and
// rewrites the file as UTF-8 without BOM. Safe no-op if the file is already
// UTF-8.
//
// PowerShell's default `>` redirect writes UTF-16, and the Vercel CLI's
// output on Windows sometimes inherits that — so any env-pull may land
// as UTF-16. Node's --env-file loader only understands UTF-8, hence the
// "all keys missing" symptom.
//
// Run: node scripts/fix-env-encoding.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");
if (!existsSync(target)) {
  console.error(`No .env.local at ${target}`);
  process.exit(1);
}

const bytes = readFileSync(target);
let text;
let detected;

if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
  // UTF-16 LE BOM
  text = bytes.subarray(2).toString("utf16le");
  detected = "UTF-16 LE (with BOM)";
} else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
  // UTF-16 BE BOM
  const swapped = Buffer.alloc(bytes.length - 2);
  for (let i = 2; i < bytes.length; i += 2) {
    swapped[i - 2] = bytes[i + 1] ?? 0;
    swapped[i - 1] = bytes[i] ?? 0;
  }
  text = swapped.toString("utf16le");
  detected = "UTF-16 BE (with BOM)";
} else if (
  bytes.length >= 3 &&
  bytes[0] === 0xef &&
  bytes[1] === 0xbb &&
  bytes[2] === 0xbf
) {
  // UTF-8 with BOM — strip the BOM
  text = bytes.subarray(3).toString("utf8");
  detected = "UTF-8 with BOM";
} else {
  // Heuristic: if every other byte is 0x00 (and there's no BOM), it's
  // likely UTF-16 LE without BOM
  let zeroAlternates = 0;
  const sampleEnd = Math.min(bytes.length, 200);
  for (let i = 1; i < sampleEnd; i += 2) {
    if (bytes[i] === 0x00) zeroAlternates += 1;
  }
  if (zeroAlternates > sampleEnd / 4) {
    text = bytes.toString("utf16le");
    detected = "UTF-16 LE (no BOM, heuristic)";
  } else {
    text = bytes.toString("utf8");
    detected = "UTF-8 (no BOM)";
  }
}

// Trim leading BOM if any leaked through, normalize line endings.
text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

writeFileSync(target, text, { encoding: "utf8" });
console.log(`Detected: ${detected}`);
console.log(`Wrote: ${target} as UTF-8 without BOM (${text.length} chars)`);
