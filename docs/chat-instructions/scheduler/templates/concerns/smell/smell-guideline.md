# Smell — Diagnostic Guideline

Different smells point to different problems — the customer only needs to describe what their nose tells them. We want: WHAT THE SMELL IS LIKE (sweet, burnt, fuel/gas, rotten, electrical or plastic), WHERE they smell it (inside the cabin, only outside the car, only after parking), and WHEN they smell it (idling, after driving, only when AC is on, cold start). Map to what they recognize, not chemistry.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated smell guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='smell'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
