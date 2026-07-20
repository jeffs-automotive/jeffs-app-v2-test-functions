/**
 * build-anchor-bank — normalize the 8 domain anchor YAMLs into ONE clean,
 * machine-usable bank (anchor-bank.json) and validate cross-references.
 *
 * The 8 anchors/*.yaml files are the SOURCE OF TRUTH for the embedding seed.
 * This flattens them (handling the one file that wraps entries under `anchors:`),
 * canonicalizes known alias slugs, and reports every confusable `vs:` that does
 * not resolve to a real subcategory (the reconciliation punch-list).
 *
 * Run:  node docs/scheduler/rebuild/build-anchor-bank.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const ANCHORS = resolve(HERE, "anchors");

// Alias → canonical subcategory map (from the gap-fill reconciliation notes +
// the taxonomy). Extend as more aliases surface from the validation report.
const ALIAS = {
  belt_squeal_under_hood: "belt_squeal_underhood_whine",
  high_pitched_whining_under_the_hood: "belt_squeal_underhood_whine",
  serpentine_belt_squeal: "belt_squeal_underhood_whine",
  accessory_belt_noise: "belt_squeal_underhood_whine",
  shaking_at_idle_motor_mounts: "shaking_at_idle_while_stopped",
  rattle_underneath_heat_shield: "rattling_underneath_the_car",
  burning_electrical_smell: "burning_electrical_plastic_smell",
  headlights_cloudy_or_always_dim: "cloudy_headlight_lenses",
  burning_rubber_hot_brake_smell: "smoke_or_burning_smell_from_a_wheel",
};
const canon = (s) => ALIAS[s] ?? s;

function entriesOf(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  }
  return [];
}

const bank = [];
for (const f of readdirSync(ANCHORS).filter((x) => x.endsWith(".yaml")).sort()) {
  const d = yaml.load(readFileSync(resolve(ANCHORS, f), "utf8"));
  for (const e of entriesOf(d)) {
    if (!e || !e.subcategory) continue;
    bank.push({
      category: e.category,
      subcategory: canon(e.subcategory),
      display: e.display ?? e.subcategory,
      anchors: e.customer_voice_anchors ?? [],
      required_slots: e.required_slots ?? [],
      confusables: (e.confusables ?? []).map((c) => ({
        vs: canon(c.vs),
        q: c.discriminator_question ?? c.q ?? "",
      })),
      safety_flag: e.safety_flag ?? "none",
      notes: e.notes ?? "",
      source_file: f,
    });
  }
}

// Merge entries that canonicalized to the same subcategory (union anchors).
const bySub = new Map();
for (const e of bank) {
  const prev = bySub.get(e.subcategory);
  if (!prev) { bySub.set(e.subcategory, e); continue; }
  prev.anchors = [...new Set([...prev.anchors, ...e.anchors])];
  prev.confusables = [...prev.confusables, ...e.confusables];
  if (e.safety_flag !== "none") prev.safety_flag = e.safety_flag;
}
const merged = [...bySub.values()];
const subs = new Set(merged.map((e) => e.subcategory));

// Validate confusable references.
const unresolved = [];
for (const e of merged)
  for (const c of e.confusables)
    if (c.vs && !subs.has(c.vs)) unresolved.push(`${e.subcategory} -> vs: ${c.vs}`);

writeFileSync(resolve(HERE, "anchor-bank.json"), JSON.stringify(merged, null, 2) + "\n");

const cats = new Set(merged.map((e) => e.category));
console.log("anchor-bank.json written.");
console.log("categories:", cats.size, "| subcategories:", subs.size, "| entries:", merged.length);
console.log("total anchors:", merged.reduce((s, e) => s + e.anchors.length, 0));
console.log("safety-flagged:", merged.filter((e) => e.safety_flag !== "none").length);
console.log("unresolved confusable refs:", unresolved.length);
if (unresolved.length) {
  const uniq = [...new Set(unresolved.map((u) => u.split("vs: ")[1]))].sort();
  console.log("  distinct missing targets (" + uniq.length + "):", uniq.slice(0, 40).join(", "));
}
