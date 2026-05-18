# Other — Diagnostic Guideline

When a customer's concern doesn't fit a clear category, dig for SPECIFIC SYMPTOMS (any smell, sound, vibration, warning light, fluid leak — anything they've noticed even peripherally), RECENT WORK or unusual events (oil change, body shop, hit something, tow), and DRIVING SAFETY (does the car feel safe to drive in, or are they worried). Goal is to narrow into one of the other categories or escalate to a tech for diagnosis.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated other guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='other'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
