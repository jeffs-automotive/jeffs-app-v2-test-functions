/**
 * label-real-concerns — consensus ground truth for REAL customer concern texts
 * (forum harvest + Tekmetric RO concerns; Chris 2026-07-03: "I don't want you
 * coming up with the customer concerns").
 *
 * Three judge FAMILIES label every text independently (default: openai/gpt-5.4,
 * google/gemini-3.5-flash, anthropic/claude-sonnet-5 — deliberately NOT the
 * head-to-head candidates haiku-4-5 / gemini-3.1-flash-lite, so candidate scores
 * stay unbiased). Consensus = >=2 families agree exactly.
 *
 *   Pass 1: Stage-1 category (or null = no catalog fit).
 *   Pass 2: Stage-2 subcategory within the consensus category (testing services
 *           only), options taken from catalog-snapshot.json.
 *
 * Output per case: votes per family, consensus_category, consensus_subcategory,
 * status: confirmed (3/3) | majority (2/3) | ambiguous (no 2-of-3) — ambiguous
 * cases are exactly the act-or-ask clarification material, not graded singles.
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/label-real-concerns.ts --input scripts/eval/real-concerns-forums.json \
 *     --output scripts/eval/real-concerns-labeled.json [--limit N]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..", "..");

function loadEnvLocal(): void {
  const p = resolve(appRoot, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    if (process.env[key] !== undefined) continue;
    let v = (m[2] as string).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v.length === 0) continue;
    process.env[key] = v;
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return process.argv[i + 1] ?? "true";
}

interface SnapshotSubcategory {
  slug: string;
  display_label: string;
  description?: string | null;
  eligible_testing_service_keys?: string[];
}

interface SnapshotCategory {
  kind: "testing_service" | "other_subcategory";
  service_key?: string;
  subcategory_slug?: string;
  display_name?: string;
  display_label?: string;
  description?: string | null;
  subcategories?: SnapshotSubcategory[];
}

interface InputConcern {
  id?: string;
  text: string;
  domain?: string;
  source_url?: string;
  source_site?: string;
  vehicle_context?: string;
  tekmetric_ro_id?: number;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) throw new Error("No AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN.");

  const { createGateway } = await import("@ai-sdk/gateway");
  const { generateObject, jsonSchema } = await import("ai");
  const gateway = createGateway({ apiKey });

  const snapshot = JSON.parse(
    readFileSync(resolve(__dirname, "catalog-snapshot.json"), "utf8"),
  ) as { categories: SnapshotCategory[] };

  const inputPath = arg("input") ?? "scripts/eval/real-concerns-forums.json";
  const outputPath = arg("output") ?? "scripts/eval/real-concerns-labeled.json";
  const inputRaw = JSON.parse(readFileSync(resolve(appRoot, inputPath), "utf8")) as
    | { concerns: InputConcern[] }
    | InputConcern[];
  let concerns = Array.isArray(inputRaw) ? inputRaw : inputRaw.concerns;
  const limit = arg("limit");
  if (limit) concerns = concerns.slice(0, Number(limit));

  const cases = concerns.map((c, i) => ({
    id: c.id ?? `real-${String(i).padStart(3, "0")}`,
    text: c.text,
    meta: c,
  }));

  // ── catalog briefs ──────────────────────────────────────────────────────
  const catBrief = snapshot.categories
    .map((c) =>
      c.kind === "testing_service"
        ? `- key="${c.service_key}" (testing service) — ${c.display_name}. ${(c.description ?? "").slice(0, 220)}`
        : `- key="${c.subcategory_slug}" (advisor-handoff situation) — ${c.display_label}`,
    )
    .join("\n");
  const validKeys = new Set(
    snapshot.categories.map((c) =>
      c.kind === "testing_service" ? c.service_key! : c.subcategory_slug!,
    ),
  );

  // subcategory options per testing-service key
  const subsByService = new Map<string, SnapshotSubcategory[]>();
  for (const c of snapshot.categories) {
    if (c.kind !== "testing_service" || !c.service_key) continue;
    const subs: SnapshotSubcategory[] = [];
    const seen = new Set<string>();
    for (const cat of snapshot.categories) {
      for (const s of cat.subcategories ?? []) {
        if (!seen.has(s.slug) && (s.eligible_testing_service_keys ?? []).includes(c.service_key)) {
          seen.add(s.slug);
          subs.push(s);
        }
      }
    }
    subsByService.set(c.service_key, subs);
  }

  const MODELS = (arg("models") ?? "openai/gpt-5.4,google/gemini-3.5-flash,anthropic/claude-sonnet-5").split(",");

  const VERDICTS_SCHEMA = jsonSchema<{
    verdicts: Array<{ id: string; key: string | null }>;
  }>({
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "key"],
          properties: {
            id: { type: "string" },
            key: { type: ["string", "null"] },
          },
        },
      },
    },
  });

  async function judgeBatches(
    model: string,
    items: Array<{ id: string; text: string }>,
    promptFor: (batch: Array<{ id: string; text: string }>) => string,
    valid: Set<string>,
  ): Promise<Map<string, string | null>> {
    const byId = new Map<string, string | null>();
    for (let i = 0; i < items.length; i += 10) {
      const batch = items.slice(i, i + 10);
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const { object } = await generateObject({
            model: gateway(model),
            schema: VERDICTS_SCHEMA,
            prompt: promptFor(batch),
            temperature: 0,
          });
          for (const v of object.verdicts) {
            byId.set(v.id, v.key !== null && valid.has(v.key) ? v.key : null);
          }
          ok = true;
        } catch (e) {
          if (attempt === 3) {
            console.error(`  batch@${i} FAILED on ${model}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
          } else {
            await new Promise((r) => setTimeout(r, attempt * 3000));
          }
        }
      }
    }
    return byId;
  }

  // ── pass 1: category ────────────────────────────────────────────────────
  const catPrompt = (batch: Array<{ id: string; text: string }>) =>
    `You are an expert automotive service advisor classifying customer concern texts for an auto-repair shop's scheduler.

CATALOG — the only valid category keys (pick EXACTLY one key per case, or null):
${catBrief}

RULES:
- Pick the single best key for each text, judged from the text alone.
- Use null when the text is too vague, not a vehicle concern, gibberish, or fits nothing.
- Use an advisor-handoff key when the text describes that situation (multiple unrelated symptoms, recent accident, recent repair work elsewhere, safety fear, general checkup request, car sitting unused).
- Return the key VERBATIM from the catalog.

CASES:
${JSON.stringify(batch.map((c) => ({ id: c.id, text: c.text })), null, 1)}

Return one verdict per case (key = category key or null).`;

  const catVotes: Record<string, Map<string, string | null>> = {};
  for (const model of MODELS) {
    console.log(`[pass 1 — category] judging with ${model}…`);
    catVotes[model] = await judgeBatches(model, cases, catPrompt, validKeys);
    console.log(`  done (${catVotes[model].size}/${cases.length} verdicts)`);
  }

  function consensusOf(votes: Array<string | null | undefined>): { value: string | null; strength: "confirmed" | "majority" | "ambiguous" | "unjudged" } {
    // undefined = judge never returned a verdict (batch failure) — NOT a null vote.
    const present = votes.filter((v): v is string | null => v !== undefined);
    if (present.length < 2) return { value: null, strength: "unjudged" };
    const counts = new Map<string, number>();
    for (const v of present) {
      const k = v === null ? " null" : v;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    if (!top || top[1] < 2) return { value: null, strength: "ambiguous" };
    const value = top[0] === " null" ? null : top[0];
    return { value, strength: top[1] === present.length && present.length === votes.length ? "confirmed" : "majority" };
  }

  // ── pass 2: subcategory (grouped by consensus category) ────────────────
  const catConsensus = new Map<string, { value: string | null; strength: string }>();
  for (const c of cases) {
    catConsensus.set(c.id, consensusOf(MODELS.map((m) => catVotes[m]?.get(c.id))));
  }

  const byService = new Map<string, Array<{ id: string; text: string }>>();
  for (const c of cases) {
    const cc = catConsensus.get(c.id)!;
    if (cc.strength === "ambiguous" || cc.value === null) continue;
    if (!subsByService.has(cc.value)) continue; // advisor-handoff keys have no subcategories
    if (!byService.has(cc.value)) byService.set(cc.value, []);
    byService.get(cc.value)!.push({ id: c.id, text: c.text });
  }

  const subVotes: Record<string, Map<string, string | null>> = {};
  for (const model of MODELS) subVotes[model] = new Map();
  for (const [serviceKey, items] of byService) {
    const subs = subsByService.get(serviceKey)!;
    if (subs.length === 0) continue;
    const subBrief = subs
      .map((s) => `- slug="${s.slug}" — ${s.display_label}. ${(s.description ?? "").slice(0, 200)}`)
      .join("\n");
    const validSlugs = new Set(subs.map((s) => s.slug));
    const subPrompt = (batch: Array<{ id: string; text: string }>) =>
      `These customer concerns were all classified as "${serviceKey}". Pick the single best SUBCATEGORY slug for each, or null if none fits well.

SUBCATEGORIES:
${subBrief}

CASES:
${JSON.stringify(batch.map((c) => ({ id: c.id, text: c.text })), null, 1)}

Return one verdict per case (key = subcategory slug or null), slug VERBATIM.`;
    for (const model of MODELS) {
      const got = await judgeBatches(model, items, subPrompt, validSlugs);
      for (const [id, v] of got) subVotes[model].set(id, v);
    }
    console.log(`[pass 2 — subcategory] ${serviceKey}: ${items.length} cases judged by ${MODELS.length} families`);
  }

  // ── assemble output ─────────────────────────────────────────────────────
  let confirmed = 0, majority = 0, ambiguous = 0, unjudged = 0;
  const rows = cases.map((c) => {
    const cc = catConsensus.get(c.id)!;
    const catVoteRow: Record<string, string | null> = {};
    for (const m of MODELS) catVoteRow[m] = catVotes[m]?.get(c.id) ?? null;
    let subConsensus: { value: string | null; strength: string } | null = null;
    const subVoteRow: Record<string, string | null> = {};
    if (cc.value && subsByService.has(cc.value) && cc.strength !== "ambiguous") {
      for (const m of MODELS) subVoteRow[m] = subVotes[m]?.get(c.id) ?? null;
      subConsensus = consensusOf(MODELS.map((m) => subVotes[m]?.get(c.id)));
    }
    if (cc.strength === "confirmed") confirmed += 1;
    else if (cc.strength === "majority") majority += 1;
    else if (cc.strength === "unjudged") unjudged += 1;
    else ambiguous += 1;
    return {
      id: c.id,
      text: c.text,
      source: {
        domain: c.meta.domain ?? null,
        site: c.meta.source_site ?? null,
        url: c.meta.source_url ?? null,
        tekmetric_ro_id: c.meta.tekmetric_ro_id ?? null,
        vehicle_context: c.meta.vehicle_context || null,
      },
      category_votes: catVoteRow,
      consensus_category: cc.value,
      category_status: cc.strength,
      subcategory_votes: subVoteRow,
      consensus_subcategory: subConsensus?.value ?? null,
      subcategory_status: subConsensus?.strength ?? null,
    };
  });

  writeFileSync(
    resolve(appRoot, outputPath),
    JSON.stringify(
      {
        labeled_at: new Date().toISOString(),
        judges: MODELS,
        input: inputPath,
        totals: { cases: rows.length, confirmed, majority, ambiguous, unjudged },
        cases: rows,
      },
      null,
      1,
    ),
  );
  console.log(`\nDONE: ${rows.length} cases — ${confirmed} confirmed (3/3), ${majority} majority (2/3), ${ambiguous} ambiguous, ${unjudged} unjudged.`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
