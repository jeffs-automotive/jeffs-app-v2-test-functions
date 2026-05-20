# Leak — Diagnostic Guideline

Leaks are mostly about the fluid: WHAT COLOR or texture (red, green, brown, black, clear, oily, watery), WHERE on the ground they see it (under the engine, under the rear, in the middle), HOW BIG the puddle is (slow drips vs running stream), and WHEN they first noticed it (today, this week, only when parked overnight, only after driving). AC condensation under the dash on a hot day is normal — most everything else is worth a look.

---

## How to update

Edit the prose above, then ask Claude: *"Upload the updated leak guideline."*

Claude calls `upload_concern_category_guideline_md` with `category_slug='leak'`. The upload is a single-row upsert keyed on `(shop_id, category)`; re-uploading identical content is a no-op (hash check). Audit-logged.

**This prose is read by the diagnostic LLM BEFORE the per-subcategory questions** for this category. It shapes how the LLM phrases follow-up questions and what facets it prioritizes. Keep it customer-language, not mechanic-jargon — the LLM uses it to bridge between what the customer says and the questionnaire below it.
