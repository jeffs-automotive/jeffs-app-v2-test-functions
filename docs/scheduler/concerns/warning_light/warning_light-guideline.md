# Warning light — Diagnostic Guideline

For warning lights we need: WHICH LIGHT (check engine, ABS, airbag, oil pressure, temperature, battery, TPMS — customers can usually identify by color or shape), BEHAVIOR (steady on, flashing, comes and goes), HOW THE CAR IS DRIVING (normally, sluggish, hesitating, stalling), and any OTHER SYMPTOMS (smell, sound, vibration, smoke). A flashing check engine light is more urgent than a steady one.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated warning_light guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='warning_light'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
