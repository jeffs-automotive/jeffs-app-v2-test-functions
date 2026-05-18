# Vibration — Diagnostic Guideline

Vibrations narrow down quickly with three pieces: WHERE the customer feels it (steering wheel, seat, pedals, the whole car), WHEN it shows up (only above a certain speed, only when braking, idling, accelerating, all the time), and any recent IMPACT or work (curb hit, pothole, alignment, new tires). Tire balance, warped rotors, and suspension wear are common drivers but we don't need the customer to guess — just describe what they feel and when.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated vibration guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='vibration'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
