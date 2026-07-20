/**
 * rebuild-embed-poc — PROOF that knowledge-seeded embedding retrieval works on
 * the anchor bank. Embeds all anchors, holds out a test slice, and measures
 * whether a held-out CUSTOMER PHRASING retrieves the right category/subcategory.
 *
 * The real target is recall@k for CATEGORY: the front end shortlists top-k, the
 * LLM picks. High recall@3/@5 => the approach is sound.
 *
 * Run (from scheduler-app/, with a fresh VERCEL_OIDC_TOKEN exported):
 *   node scripts/rebuild-embed-poc.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bank = JSON.parse(
  readFileSync(resolve(process.cwd(), "..", "docs/scheduler/rebuild/anchor-bank.json"), "utf8"),
);

// Flatten to (text, subcategory, category); deterministic hold-out: every 6th anchor.
const rows = [];
for (const e of bank)
  for (const a of e.anchors)
    rows.push({ text: a, sub: e.subcategory, cat: e.category });
const train = [], test = [];
rows.forEach((r, i) => (i % 6 === 2 ? test : train).push(r));
console.log(`anchors: ${rows.length} (train ${train.length} / test ${test.length}); subcats ${new Set(rows.map(r=>r.sub)).size}, cats ${new Set(rows.map(r=>r.cat)).size}`);

const { createGateway } = await import("@ai-sdk/gateway");
const { embedMany } = await import("ai");
const gw = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN });
const model = gw.textEmbeddingModel("openai/text-embedding-3-small");

async function embedAll(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 256) {
    const { embeddings } = await embedMany({ model, values: texts.slice(i, i + 256) });
    out.push(...embeddings);
    process.stdout.write(`  embedded ${Math.min(i + 256, texts.length)}/${texts.length}\r`);
  }
  return out;
}

console.log("embedding train…");
const trainVecs = await embedAll(train.map((r) => r.text));
console.log("\nembedding test…");
const testVecs = await embedAll(test.map((r) => r.text));

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
// (text-embedding-3 vectors are ~unit norm; cosine ≈ dot)

let c1 = 0, c3 = 0, c5 = 0, s1 = 0;
for (let t = 0; t < test.length; t++) {
  const q = testVecs[t];
  const sims = trainVecs.map((v, i) => ({ i, s: dot(q, v) }));
  sims.sort((a, b) => b.s - a.s);
  const topSubs = [], topCats = [];
  for (const { i } of sims) {
    if (!topSubs.includes(train[i].sub)) topSubs.push(train[i].sub);
    if (!topCats.includes(train[i].cat)) topCats.push(train[i].cat);
    if (topCats.length >= 5) break;
  }
  const trueCat = test[t].cat, trueSub = test[t].sub;
  if (topSubs[0] === trueSub) s1++;
  if (topCats[0] === trueCat) c1++;
  if (topCats.slice(0, 3).includes(trueCat)) c3++;
  if (topCats.slice(0, 5).includes(trueCat)) c5++;
}
const pct = (n) => `${((n / test.length) * 100).toFixed(1)}%`;
console.log("\n=== retrieval on held-out customer phrasings ===");
console.log(`  category  recall@1: ${pct(c1)}   recall@3: ${pct(c3)}   recall@5: ${pct(c5)}`);
console.log(`  subcategory top-1 (nearest anchor): ${pct(s1)}`);
console.log(`  (recall@3/@5 category is the real number — the front end shortlists, the LLM picks)`);
