# Tires — Diagnostic Guideline

For tire concerns: WHICH WHEEL the customer thinks is affected (or all), VISIBLE DAMAGE (nail in tread, sidewall bulge, cuts, separating tread, low pressure light only), RECENT TIRE WORK (rotation, patch, new set), and any RELATED SYMPTOMS (vibration, pulling, noise). Customer doesn't need to know plies and load ratings — just what they see and feel.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated tires guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='tires'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
