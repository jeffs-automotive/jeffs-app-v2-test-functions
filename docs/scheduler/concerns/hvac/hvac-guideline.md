# HVAC — Diagnostic Guideline

For heating/AC issues we want: HOT or COLD (or both not working), WHICH VENTS (all vents, just dash, just floor, just defrost), WHEN it started (today, this week, gradually over time), and any OTHER CABIN WEIRDNESS (foggy windows, noise from vents, wet floor, unusual smell). Refrigerant low, blend door, blower motor, cabin filter — all surface from these clues.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated hvac guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='hvac'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
