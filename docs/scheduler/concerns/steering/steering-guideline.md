# Steering — Diagnostic Guideline

Steering complaints map to: WHAT THE WHEEL DOES (hard to turn, loose or sloppy, vibrates, makes noise on turns, pulls/drifts), ONE DIRECTION OR BOTH, HOW LONG it's been happening, and any RECENT WORK (alignment, suspension, curb hit). Power-steering fluid leaks, worn tie rods, bad bushings, and alignment all surface here.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated steering guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='steering'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
