# Pulling — Diagnostic Guideline

When a car pulls to one side, we want to know: WHICH DIRECTION it pulls (left, right, or both ways at different times), UNDER WHAT CONDITION (braking, accelerating, cruising, all the time), HOW LONG it's been happening, and any RECENT WORK (tire rotation, alignment, suspension service, curb or pothole impact). Customers don't need to know whether it's alignment or brakes — just describe the behavior.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated pulling guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='pulling'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
