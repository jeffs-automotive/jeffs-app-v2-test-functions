# Smoke — Diagnostic Guideline

Smoke color and source narrow it down fast: WHAT COLOR (white, blue, black, gray), WHERE it comes from (tailpipe, under the hood, inside the cabin, from a wheel), WHEN it happens (cold start, accelerating, after driving warm, always), and any SMELL or WARNING LIGHTS with it. Customers may not know coolant smoke from oil smoke — let them describe what they see in their own words.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated smoke guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='smoke'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
