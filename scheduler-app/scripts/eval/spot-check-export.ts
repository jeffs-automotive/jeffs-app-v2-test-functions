/**
 * spot-check-export — build a stratified HUMAN review set for the classifier
 * eval (eval-hardening, 2026-07-19).
 *
 * The 3-family consensus labels are strong but not ground truth — all three
 * judges can be wrong together on a terse/ambiguous automotive concern. The
 * ONLY way to bound that correlated error is a human (Chris) adjudicating a
 * stratified sample. This generates that sample + a self-contained local HTML
 * review page. Chris tags each case model_correct / model_wrong / label_wrong /
 * ambiguous; spot-check-score.ts then estimates the population label-error rate
 * (with a Wilson CI) and the label-corrected model-error rate.
 *
 * Stratification (~130 cases): ALL disputes (model routed but disagreed with a
 * non-null consensus) + a sample of confirmed(3/3) + majority(2/3) + ambiguous.
 * Deterministic (sorted by id — no RNG), so re-runs are stable.
 *
 * Outputs (BOTH gitignored — they embed real customer text):
 *   spot-check-sheet.json   — machine-readable review items (verdict: null)
 *   spot-check.html         — open locally in a browser; exports the filled JSON
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types --import ./scripts/eval/register-alias.mjs \
 *     scripts/eval/spot-check-export.ts \
 *     --report <final-x.json> --labels scripts/eval/real-concerns-tekmetric-labeled-v2.json \
 *     [--corpus tekmetric] [--confirmed 40] [--majority 40] [--ambiguous 25]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : (process.argv[i + 1] ?? def);
}

interface ReportRow {
  id: string;
  text: string;
  consensus_category: string | null;
  consensus_subcategory: string | null;
  category_status: string | null;
  candidates: string[];
  routed_key: string | null;
  routed_subcategory: string | null;
  outcome: string;
  hard: boolean;
}
interface LabelRow {
  id: string;
  category_votes?: Record<string, string | null>;
  subcategory_votes?: Record<string, string | null>;
}
interface Item {
  id: string;
  stratum: "disputed" | "confirmed" | "majority" | "ambiguous";
  text: string;
  model: {
    candidates: string[];
    routed_key: string | null;
    routed_subcategory: string | null;
    outcome: string;
    hard: boolean;
  };
  consensus: {
    category: string | null;
    subcategory: string | null;
    status: string | null;
    votes: Record<string, string | null>;
  };
  verdict: null | "model_correct" | "model_wrong" | "label_wrong" | "ambiguous";
  note: string;
}

function main(): void {
  const reportPath = arg("report");
  const labelsPath = arg("labels", "scripts/eval/real-concerns-tekmetric-labeled-v2.json")!;
  if (!reportPath) throw new Error("--report <final-x.json> required");
  const corpus = arg("corpus", "tekmetric")!;
  const nConfirmed = Number(arg("confirmed", "40"));
  const nMajority = Number(arg("majority", "40"));
  const nAmbiguous = Number(arg("ambiguous", "25"));

  const report = JSON.parse(readFileSync(resolve(process.cwd(), reportPath), "utf8")) as {
    rows: Record<string, ReportRow[]>;
    catalog_hash?: string;
    tag?: string;
  };
  const labelsRaw = JSON.parse(readFileSync(resolve(process.cwd(), labelsPath), "utf8"));
  const labels: LabelRow[] = Array.isArray(labelsRaw) ? labelsRaw : (labelsRaw.rows ?? labelsRaw.cases ?? []);
  const votesById = new Map(labels.map((l) => [l.id, l.category_votes ?? {}]));

  const rows = (report.rows[corpus] ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
  if (rows.length === 0) throw new Error(`No rows for corpus "${corpus}" in report.`);

  const mk = (r: ReportRow, stratum: Item["stratum"]): Item => ({
    id: r.id,
    stratum,
    text: r.text,
    model: {
      candidates: r.candidates,
      routed_key: r.routed_key,
      routed_subcategory: r.routed_subcategory,
      outcome: r.outcome,
      hard: r.hard,
    },
    consensus: {
      category: r.consensus_category,
      subcategory: r.consensus_subcategory,
      status: r.category_status,
      votes: votesById.get(r.id) ?? {},
    },
    verdict: null,
    note: "",
  });

  const taken = new Set<string>();
  const items: Item[] = [];
  // 1. ALL disputes — model routed to a service but disagreed with a non-null consensus.
  for (const r of rows) {
    if (r.outcome === "direct_wrong" || (r.hard && r.outcome !== "null_correct_direct")) {
      items.push(mk(r, "disputed"));
      taken.add(r.id);
    }
  }
  // 2-4. Stratified samples of the rest (deterministic: id-sorted, first N).
  const sample = (status: string, n: number, stratum: Item["stratum"]) => {
    let c = 0;
    for (const r of rows) {
      if (c >= n) break;
      if (taken.has(r.id)) continue;
      const isAmb = stratum === "ambiguous"
        ? r.category_status === "ambiguous" || r.consensus_category === null
        : r.category_status === status;
      if (isAmb) {
        items.push(mk(r, stratum));
        taken.add(r.id);
        c++;
      }
    }
  };
  sample("confirmed", nConfirmed, "confirmed");
  sample("majority", nMajority, "majority");
  sample("ambiguous", nAmbiguous, "ambiguous");

  const meta = {
    generated_from: reportPath,
    tag: report.tag ?? null,
    catalog_hash: report.catalog_hash ?? null,
    corpus,
    counts: {
      total: items.length,
      disputed: items.filter((i) => i.stratum === "disputed").length,
      confirmed: items.filter((i) => i.stratum === "confirmed").length,
      majority: items.filter((i) => i.stratum === "majority").length,
      ambiguous: items.filter((i) => i.stratum === "ambiguous").length,
    },
  };

  const sheetPath = resolve(__dirname, "spot-check-sheet.json");
  writeFileSync(sheetPath, JSON.stringify({ meta, items }, null, 2));
  const htmlPath = resolve(__dirname, "spot-check.html");
  writeFileSync(htmlPath, renderHtml(meta, items));

  console.log(`Wrote ${items.length} review items:`, JSON.stringify(meta.counts));
  console.log(`  sheet: ${sheetPath}`);
  console.log(`  review page (open in a browser): ${htmlPath}`);
  console.log(`\nOpen spot-check.html, review every case, click Export → save the`);
  console.log(`downloaded file over spot-check-sheet.json, then run spot-check-score.ts.`);
}

function renderHtml(meta: unknown, items: Item[]): string {
  const data = JSON.stringify({ meta, items }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Classifier spot-check</title>
<style>
  :root{font-family:system-ui,sans-serif;line-height:1.5}
  body{max-width:820px;margin:0 auto;padding:24px;color:#111}
  .bar{position:sticky;top:0;background:#fff;padding:12px 0;border-bottom:1px solid #ddd;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .text{font-size:1.35rem;font-weight:600;background:#f6f3ee;border-left:4px solid #96003C;padding:14px 16px;border-radius:6px;margin:16px 0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}
  .card{border:1px solid #ddd;border-radius:8px;padding:12px}
  .card h3{margin:.1rem 0 .5rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:#666}
  .k{color:#96003C;font-weight:600}
  .votes{font-size:.85rem;color:#444}
  .verdicts{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
  button.v{padding:10px 14px;border:2px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;font-size:.95rem}
  button.v.sel{border-color:#96003C;background:#96003C;color:#fff}
  .stratum{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;background:#eee}
  textarea{width:100%;min-height:52px;margin-top:6px;font:inherit;padding:8px;border:1px solid #ccc;border-radius:6px}
  .nav{display:flex;justify-content:space-between;margin-top:18px}
  .nav button{padding:10px 18px;font-size:1rem}
  #export{background:#D2B487;border:0;padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer}
  .hint{font-size:.8rem;color:#777}
</style></head><body>
<div class="bar">
  <strong>Classifier spot-check</strong>
  <span id="prog"></span>
  <span style="flex:1"></span>
  <button id="export">Export filled JSON ⬇</button>
</div>
<p class="hint">Keys: <b>1</b> model correct · <b>2</b> model wrong · <b>3</b> label wrong · <b>4</b> ambiguous · <b>←/→</b> navigate. Progress auto-saves in this browser.</p>
<div id="app"></div>
<script>
const DB = ${data};
const KEY = 'spotcheck_'+(DB.meta.catalog_hash||'x')+'_'+DB.items.length;
let saved = {}; try{ saved = JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){}
DB.items.forEach(it=>{ if(saved[it.id]){ it.verdict=saved[it.id].verdict; it.note=saved[it.id].note||''; }});
let cur = DB.items.findIndex(it=>!it.verdict); if(cur<0) cur=0;
const VERD=[['model_correct','Model correct'],['model_wrong','Model wrong'],['label_wrong','Label wrong'],['ambiguous','Ambiguous']];
function persist(){ const o={}; DB.items.forEach(it=>o[it.id]={verdict:it.verdict,note:it.note}); localStorage.setItem(KEY,JSON.stringify(o)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function render(){
  const it=DB.items[cur];
  const done=DB.items.filter(x=>x.verdict).length;
  document.getElementById('prog').textContent = (cur+1)+' / '+DB.items.length+'  ('+done+' done)';
  const votes=Object.entries(it.consensus.votes).map(([m,v])=>esc(m.split('/').pop())+': <b>'+esc(v)+'</b>').join(' &nbsp; ');
  document.getElementById('app').innerHTML =
    '<span class="stratum">'+esc(it.stratum)+'</span> <span class="hint">'+esc(it.id)+'</span>'+
    '<div class="text">'+esc(it.text)+'</div>'+
    '<div class="grid"><div class="card"><h3>Model said</h3>'+
      'candidates: <span class="k">'+esc(it.model.candidates.join(', ')||'(none)')+'</span><br>'+
      'routed: <span class="k">'+esc(it.model.routed_key||'—')+'</span> / '+esc(it.model.routed_subcategory||'—')+'<br>'+
      'outcome: '+esc(it.model.outcome)+(it.model.hard?' <b style="color:#b00">HARD</b>':'')+'</div>'+
    '<div class="card"><h3>3-judge consensus ('+esc(it.consensus.status)+')</h3>'+
      'category: <span class="k">'+esc(it.consensus.category||'(none)')+'</span><br>'+
      'subcategory: '+esc(it.consensus.subcategory||'—')+'<br>'+
      '<div class="votes">'+votes+'</div></div></div>'+
    '<div class="verdicts">'+VERD.map(([v,l])=>'<button class="v'+(it.verdict===v?' sel':'')+'" data-v="'+v+'">'+l+'</button>').join('')+'</div>'+
    '<textarea id="note" placeholder="optional note">'+esc(it.note)+'</textarea>'+
    '<div class="nav"><button id="prev">← Prev</button><button id="next">Next →</button></div>';
  document.querySelectorAll('button.v').forEach(b=>b.onclick=()=>{it.verdict=b.dataset.v;persist();if(cur<DB.items.length-1){cur++;}render();});
  document.getElementById('note').oninput=e=>{it.note=e.target.value;persist();};
  document.getElementById('prev').onclick=()=>{if(cur>0)cur--;render();};
  document.getElementById('next').onclick=()=>{if(cur<DB.items.length-1)cur++;render();};
}
document.onkeydown=e=>{
  if(e.target.tagName==='TEXTAREA')return;
  if(e.key==='1'||e.key==='2'||e.key==='3'||e.key==='4'){const it=DB.items[cur];it.verdict=VERD[+e.key-1][0];persist();if(cur<DB.items.length-1)cur++;render();}
  if(e.key==='ArrowLeft'&&cur>0){cur--;render();}
  if(e.key==='ArrowRight'&&cur<DB.items.length-1){cur++;render();}
};
document.getElementById('export').onclick=()=>{
  const blob=new Blob([JSON.stringify({meta:DB.meta,items:DB.items},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spot-check-sheet.json';a.click();
};
render();
</script></body></html>`;
}

main();
