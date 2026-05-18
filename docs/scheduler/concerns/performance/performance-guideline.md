# Performance — Diagnostic Guideline

When a car isn't performing right, we want: WHAT IT'S DOING (hesitating, stalling, low power, surging, hard to start, won't start), UNDER WHAT CONDITIONS (uphill, accelerating from a stop, cruising, in a specific gear, cold vs warm), HOW LONG it's been happening, and any WARNING LIGHTS on. Bonus context: any recent fuel station, jump-start, or aftermarket parts.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated performance guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='performance'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
