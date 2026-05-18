# Electrical — Diagnostic Guideline

Electrical issues are about WHAT'S MISBEHAVING (won't crank, slow crank, dim lights, won't stay started, intermittent stalls, dashboard flickers, accessories dying), BATTERY AGE if they know it, RECENT JUMP-STARTS (frequency matters — once vs every morning), and OTHER WEIRDNESS happening at the same time. Battery, alternator, starter, parasitic drains, and bad grounds all live here.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated electrical guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='electrical'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
