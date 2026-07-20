# Base validation — embedding retrieval POC

> Proof that the knowledge-seeded embedding approach works on the anchor bank, before we build any module
> code. `build-anchor-bank.mjs` ingests the 8 anchor YAMLs → `anchor-bank.json`; `scheduler-app/scripts/
> rebuild-embed-poc.mjs` embeds it and measures held-out retrieval. Run 2026-07-19, `openai/text-embedding-3-small`.

## Result

Held out every 6th anchor (358 test / 1,792 train customer phrasings; 213 subcats, 25 categories). For each
held-out phrasing, embed it and retrieve nearest train anchors:

| Metric | Score |
|---|---|
| **Category recall@3** (right category in top-3 shortlist) | **94.7%** |
| **Category recall@5** | **98.3%** |
| Category recall@1 (pure embedding top pick) | 71.2% |
| Subcategory top-1 (nearest single anchor) | 43.6% |

**Read:** recall@3/@5 is the design target — the embedding front end shortlists the top-k categories, then
the LLM extracts + picks from that shortlist. A 94.7% top-3 / 98.3% top-5 means the correct category is
almost always on the table for the LLM. recall@1 (71%) and subcategory top-1 (43.6%) are *not* the design
metrics: we never ask the embedding to make the final call — the LLM picks the subcategory within the
chosen category (a small choice set), aided by the retrieved example anchors. And this is the **cold-start
floor** — pure knowledge seed, zero real customer data. Every resolved real concern adds an anchor and
raises these numbers with no retraining.

## What this validates

The core mechanism of the rebuild is sound: `customer text → embed → top-k category shortlist (≈95–98%
contains the right one) → LLM extract+pick`. The knowledge-first seed means it works on day one.

## Base status

- ✅ Architecture (`00-ARCHITECTURE.md`)
- ✅ Anchor knowledge base — 8 files, 213 entries (post-merge), 2,150 customer-voice anchors
- ✅ Machine bank (`anchor-bank.json`) + ingest (`build-anchor-bank.mjs`)
- ✅ Taxonomy (`01-taxonomy.md`), confusable matrix, safety flags
- ✅ **Embedding retrieval proven** (this doc)

## Reconciliation punch-list (before the question-policy layer — NOT blocking the embedding front end)

1. **Confusable references** — 136 `vs:` references across ~93 alias names don't resolve to a canonical
   subcategory (7+ agents free-texted the `vs:` slugs). Extend the `ALIAS` map in `build-anchor-bank.mjs`
   to canonicalize them (its validation report lists the exact missing targets), collapsing 213 → ~199
   canonical subcategories. This graph feeds the clarifying-question policy, so it matters at that build
   step, not for embed+retrieve.
2. **Safety-flags.md** — add the 3 gap flags: `burning_electrical_plastic_smell`, `battery_overcharging_smell`,
   `milky_oil_coolant_mix` (already `advise_immediately` in `anchor-bank.json`; the .md synthesis is behind).
3. **Taxonomy.md** — fold in the 13 gap subcategories (in the bank + POC already).
4. **2 proposed-new slots** from gaps — `gear_position_effect`, `brake_lights_working`.

## Next build step (when the taxonomy is blessed)

The embed + retrieve front end is proven; the module version wraps `anchor-bank.json` + the embedding call
into the shortlister, then the single extract+pick LLM call reads the shortlist. Then the decision layer +
the review console (schedulerconfig) that turns real concerns into new anchors.
