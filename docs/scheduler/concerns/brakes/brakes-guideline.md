# Brakes — Diagnostic Guideline

Brakes are about FEEL plus SOUND plus DISTANCE. We want: WHAT THE CUSTOMER NOTICES (squealing, grinding, pedal goes soft, pedal feels hard, pedal pulses, takes longer to stop, pulls one way when braking), WHEN it shows up (hard stops, light stops, only when cold, only when hot), and any WARNING LIGHT on. Last brake service date helps if they remember it.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated brakes guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='brakes'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
