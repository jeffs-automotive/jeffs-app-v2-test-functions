-- =====================================================================
-- scheduler_card_text — seed the REMAINING wizard cards (card-text-editor)
-- =====================================================================
-- Follow-on to 20260715150000 (greeting) + 20260715160000 (completed).
-- Seeds every remaining in-scope (card_key, slot_key) for shop 7476 in one
-- batch. Each body is BYTE-IDENTICAL to the current component literal (JSX
-- &apos;->'  &quot;->"  em-dashes/bullets/emoji preserved), so the payload-
-- driven cards render IDENTICALLY on day one. body = default_body at seed;
-- editing changes body, "Reset to default" restores default_body.
--
-- Scope = "main copy" only: eyebrow / title / description / footnote + in-body
-- prose (headings, notes, helper sentences). Buttons, form field labels,
-- placeholders, validation/error messages, aria-labels, and DB-driven text
-- (question text, service names, appointment-type option copy) are NOT seeded
-- and stay hardcoded in the components.
--
-- allowed_merge_fields is a subset of the global card-copy token set
-- (agent_name / shop_name / shop_phone / first_name / appointment_label /
-- vehicle — admin-app card-merge-fields.ts). Only {first_name} and
-- {shop_phone} are used here.

insert into public.scheduler_card_text
  (shop_id, card_key, slot_key, label, body, default_body, allowed_merge_fields, sort)
values
  -- ─── phone_name (PhoneNameCard) — eyebrow stays dynamic (step_label) ──────
  (7476, 'phone_name', 'title', 'Title',
   'Let''s grab a few quick details.', 'Let''s grab a few quick details.', '{}', 10),
  (7476, 'phone_name', 'description', 'Description',
   'We''ll send a one-time code to your phone to verify it''s really you. 📲',
   'We''ll send a one-time code to your phone to verify it''s really you. 📲', '{}', 20),
  (7476, 'phone_name', 'footnote', 'Footnote',
   'By continuing, you agree this conversation may be recorded and reviewed by our team to help us serve you better.',
   'By continuing, you agree this conversation may be recorded and reviewed by our team to help us serve you better.',
   '{}', 30),

  -- ─── partial_verification_gate (PartialVerificationGateCard) ──────────────
  (7476, 'partial_verification_gate', 'eyebrow', 'Eyebrow',
   'Quick check', 'Quick check', '{}', 10),
  (7476, 'partial_verification_gate', 'title_name', 'Title (name matched)',
   'Found your name{{first_name}} — but the phone doesn''t match what we have on file.',
   'Found your name{{first_name}} — but the phone doesn''t match what we have on file.',
   '{first_name}', 20),
  (7476, 'partial_verification_gate', 'description_name', 'Description (name matched)',
   'Want to try the number we''d have on file, or set up a fresh record with this number?',
   'Want to try the number we''d have on file, or set up a fresh record with this number?',
   '{}', 30),
  (7476, 'partial_verification_gate', 'body_name_note', 'Merge-later note',
   'We''ll keep your old account on file — the service team can merge them later if needed.',
   'We''ll keep your old account on file — the service team can merge them later if needed.',
   '{}', 40),
  (7476, 'partial_verification_gate', 'title_phone', 'Title (phone matched)',
   'We can''t fully verify this combination from here.',
   'We can''t fully verify this combination from here.', '{}', 50),

  -- ─── multi_account_disambiguation (MultiAccountDisambiguationCard) ────────
  --     description stays dynamic (account count + phone last-four).
  (7476, 'multi_account_disambiguation', 'eyebrow', 'Eyebrow',
   'Which one are you?', 'Which one are you?', '{}', 10),
  (7476, 'multi_account_disambiguation', 'title', 'Title',
   'Looks like more than one account on this phone 📱',
   'Looks like more than one account on this phone 📱', '{}', 20),
  (7476, 'multi_account_disambiguation', 'footnote', 'Footnote',
   'We''ll only show your own appointments + history once we know which one you are. Your privacy matters.',
   'We''ll only show your own appointments + history once we know which one you are. Your privacy matters.',
   '{}', 30),

  -- ─── no_match_choose_path (NoMatchChoosePathCard) ─────────────────────────
  --     description stays dynamic (phone last-four).
  (7476, 'no_match_choose_path', 'eyebrow', 'Eyebrow',
   'One quick fork', 'One quick fork', '{}', 10),
  (7476, 'no_match_choose_path', 'title', 'Title',
   'Hmm{{first_name}} — I''m not finding you in our records 🤔',
   'Hmm{{first_name}} — I''m not finding you in our records 🤔', '{first_name}', 20),
  (7476, 'no_match_choose_path', 'body_reason_new', 'Reason — new here',
   '• You''re new here — we''ll set you up in a few quick steps.',
   '• You''re new here — we''ll set you up in a few quick steps.', '{}', 30),
  (7476, 'no_match_choose_path', 'body_reason_moved', 'Reason — moved',
   '• You moved or changed your number — try the one we''d have on file.',
   '• You moved or changed your number — try the one we''d have on file.', '{}', 40),
  (7476, 'no_match_choose_path', 'body_reason_guest', 'Reason — guest',
   '• You''ve been here as someone else''s guest (a friend or family member). Continue as new and we''ll sort it.',
   '• You''ve been here as someone else''s guest (a friend or family member). Continue as new and we''ll sort it.',
   '{}', 50),

  -- ─── new_customer_info (NewCustomerInfoCard) — light-touch (form body fixed)
  (7476, 'new_customer_info', 'eyebrow', 'Eyebrow',
   'Set up your account', 'Set up your account', '{}', 10),
  (7476, 'new_customer_info', 'title', 'Title',
   'Welcome to Jeff''s, {{first_name}}! 👋', 'Welcome to Jeff''s, {{first_name}}! 👋',
   '{first_name}', 20),
  (7476, 'new_customer_info', 'description', 'Description',
   'Just a few details so we can build your record. We''ll save everything when you confirm the appointment.',
   'Just a few details so we can build your record. We''ll save everything when you confirm the appointment.',
   '{}', 30),

  -- ─── new_vehicle_form (NewVehicleCard) — form body stays fixed ────────────
  (7476, 'new_vehicle_form', 'eyebrow', 'Eyebrow',
   'Add your vehicle', 'Add your vehicle', '{}', 10),
  (7476, 'new_vehicle_form', 'title', 'Title',
   'Now tell me about your ride! 🚗', 'Now tell me about your ride! 🚗', '{}', 20),
  (7476, 'new_vehicle_form', 'description', 'Description',
   'Just the basics — we''ll add it to your account.',
   'Just the basics — we''ll add it to your account.', '{}', 30),

  -- ─── customer_info_edit (CustomerInfoEditCard) — light-touch ──────────────
  (7476, 'customer_info_edit', 'eyebrow', 'Eyebrow',
   'Confirm your info', 'Confirm your info', '{}', 10),
  (7476, 'customer_info_edit', 'title', 'Title',
   'Welcome back, {{first_name}}.', 'Welcome back, {{first_name}}.', '{first_name}', 20),
  (7476, 'customer_info_edit', 'description', 'Description',
   'Quick check that we''ve got your contact info right. Update anything that''s changed.',
   'Quick check that we''ve got your contact info right. Update anything that''s changed.',
   '{}', 30),

  -- ─── concern_explanation (ConcernExplanationCard) ─────────────────────────
  --     eyebrow (service name) + title (lead-in prompt) stay dynamic.
  (7476, 'concern_explanation', 'description', 'Description',
   'Even rough details help — when it started, what it sounds or feels like, where in the car you notice it. You don''t need to know the cause.',
   'Even rough details help — when it started, what it sounds or feels like, where in the car you notice it. You don''t need to know the cause.',
   '{}', 10),

  -- ─── diagnostic_loading (DiagnosticLoadingCard) — error body stays fixed ──
  (7476, 'diagnostic_loading', 'eyebrow', 'Eyebrow',
   'Thinking through your concerns', 'Thinking through your concerns', '{}', 10),
  (7476, 'diagnostic_loading', 'title_running', 'Title (running)',
   'One moment...', 'One moment...', '{}', 20),
  (7476, 'diagnostic_loading', 'title_slow', 'Title (slow)',
   'Still thinking...', 'Still thinking...', '{}', 30),
  (7476, 'diagnostic_loading', 'title_very_slow', 'Title (very slow)',
   'Still working on this...', 'Still working on this...', '{}', 40),
  (7476, 'diagnostic_loading', 'body_running', 'Body (running)',
   'I''m thinking through what testing might be needed based on what you described.',
   'I''m thinking through what testing might be needed based on what you described.', '{}', 50),
  (7476, 'diagnostic_loading', 'body_slow', 'Body (slow)',
   'Almost there — pulling together the right questions for you.',
   'Almost there — pulling together the right questions for you.', '{}', 60),
  (7476, 'diagnostic_loading', 'body_very_slow', 'Body (very slow)',
   'This is taking a little longer than usual. Feel free to call us at {{shop_phone}} if you''d rather skip ahead.',
   'This is taking a little longer than usual. Feel free to call us at {{shop_phone}} if you''d rather skip ahead.',
   '{shop_phone}', 70),

  -- ─── clarification_question (ClarificationQuestionCard) — title is DB text
  (7476, 'clarification_question', 'eyebrow_base', 'Eyebrow (base)',
   'A few details', 'A few details', '{}', 10),
  (7476, 'clarification_question', 'description_single', 'Helper (single-select)',
   'Tap whichever feels closest. If you''re unsure, that''s OK — skip it. 🤔',
   'Tap whichever feels closest. If you''re unsure, that''s OK — skip it. 🤔', '{}', 20),
  (7476, 'clarification_question', 'description_multi', 'Helper (multi-select)',
   'Tap all that apply, then Continue. If you''re unsure, that''s OK — skip it. 🤔',
   'Tap all that apply, then Continue. If you''re unsure, that''s OK — skip it. 🤔', '{}', 30),
  (7476, 'clarification_question', 'footnote', 'Footnote',
   'Your service advisor will see your answers — these help us spot the right thing faster.',
   'Your service advisor will see your answers — these help us spot the right thing faster.', '{}', 40),

  -- ─── concern_clarify (ConcernClarifyCard) ─────────────────────────────────
  (7476, 'concern_clarify', 'eyebrow', 'Eyebrow',
   'A quick check', 'A quick check', '{}', 10),
  (7476, 'concern_clarify', 'title', 'Title',
   'Which of these sounds closest?', 'Which of these sounds closest?', '{}', 20),
  (7476, 'concern_clarify', 'body_concern_label', 'Echoed-concern label',
   'Here''s what you told me', 'Here''s what you told me', '{}', 30),
  (7476, 'concern_clarify', 'description', 'Description',
   'A couple of these could fit. Tap whichever feels closest — or if none quite match, that''s OK, I''ll pass your note to one of our advisors. 🙂',
   'A couple of these could fit. Tap whichever feels closest — or if none quite match, that''s OK, I''ll pass your note to one of our advisors. 🙂',
   '{}', 40),
  (7476, 'concern_clarify', 'footnote', 'Footnote',
   'Not sure? No problem — pick "None of these" and a Jeff''s advisor will read your note and sort it out. You can keep booking either way.',
   'Not sure? No problem — pick "None of these" and a Jeff''s advisor will read your note and sort it out. You can keep booking either way.',
   '{}', 50),

  -- ─── testing_service_approval (TestingServiceApprovalCard) ────────────────
  --     eyebrow_base gets an optional dynamic " · <category>" suffix in-code.
  (7476, 'testing_service_approval', 'eyebrow_base', 'Eyebrow (base)',
   'Testing we''d recommend', 'Testing we''d recommend', '{}', 10),
  (7476, 'testing_service_approval', 'title', 'Title',
   'We''d like to look at a couple of things.',
   'We''d like to look at a couple of things.', '{}', 20),
  (7476, 'testing_service_approval', 'description', 'Description',
   'Based on what you described, here''s what our techs would test to narrow it down. Starting prices below — we''ll send a final estimate before any work begins.',
   'Based on what you described, here''s what our techs would test to narrow it down. Starting prices below — we''ll send a final estimate before any work begins.',
   '{}', 30),
  (7476, 'testing_service_approval', 'body_pricing_note', 'Pricing note',
   'Starting prices — additional testing may be needed if our techs find something extra. We''ll always send an updated estimate before doing any extra work.',
   'Starting prices — additional testing may be needed if our techs find something extra. We''ll always send an updated estimate before doing any extra work.',
   '{}', 40),

  -- ─── second_routine_pass (SecondRoutinePassCard) ──────────────────────────
  (7476, 'second_routine_pass', 'eyebrow', 'Eyebrow',
   'Anything else?', 'Anything else?', '{}', 10),
  (7476, 'second_routine_pass', 'title', 'Title',
   'Want to add anything else while you''re here?',
   'Want to add anything else while you''re here?', '{}', 20),
  (7476, 'second_routine_pass', 'description', 'Description',
   'Tap any of these to add them on. The ones you''ve already picked are marked.',
   'Tap any of these to add them on. The ones you''ve already picked are marked.', '{}', 30),
  (7476, 'second_routine_pass', 'body_describe_prompt', 'Describe-issue prompt',
   'Noticing something that isn''t on the list — a noise, a leak, a warning light?',
   'Noticing something that isn''t on the list — a noise, a leak, a warning light?', '{}', 40),

  -- ─── summary (SummaryCard) — hold-id footnote + countdown stay dynamic ────
  (7476, 'summary', 'eyebrow', 'Eyebrow',
   'Review before confirming', 'Review before confirming', '{}', 10),
  (7476, 'summary', 'title', 'Title',
   'Quick look — does this all look right? ✅', 'Quick look — does this all look right? ✅', '{}', 20),
  (7476, 'summary', 'body_appointment_label', 'Section — Appointment',
   'Appointment', 'Appointment', '{}', 30),
  (7476, 'summary', 'body_type_waiter', 'Type line — waiter',
   'Waiter ☕', 'Waiter ☕', '{}', 40),
  (7476, 'summary', 'body_type_dropoff_sameday', 'Type line — dropoff (same day)',
   'Dropoff 🚗 — drop off as soon as you can today',
   'Dropoff 🚗 — drop off as soon as you can today', '{}', 41),
  (7476, 'summary', 'body_type_dropoff', 'Type line — dropoff',
   'Dropoff 🚗 — please drop off before 10 AM',
   'Dropoff 🚗 — please drop off before 10 AM', '{}', 42),
  (7476, 'summary', 'body_for_label', 'Section — For',
   'For', 'For', '{}', 50),
  (7476, 'summary', 'body_services_label', 'Section — Services',
   'Services', 'Services', '{}', 60),
  (7476, 'summary', 'body_routine_label', 'Group — Routine',
   'Routine', 'Routine', '{}', 61),
  (7476, 'summary', 'body_concerns_label', 'Group — Concerns',
   'Concerns to investigate', 'Concerns to investigate', '{}', 62),
  (7476, 'summary', 'body_testing_label', 'Group — Testing',
   'Testing', 'Testing', '{}', 63),
  (7476, 'summary', 'body_reminders_label', 'Section — Please bring',
   'Please bring', 'Please bring', '{}', 70),
  (7476, 'summary', 'footnote', 'Footnote',
   'We''ll only use your info to schedule and remind you about this visit.',
   'We''ll only use your info to schedule and remind you about this visit.', '{}', 80),

  -- ─── summary_edit_hub (SummaryEditHubCard) — empty-state fallbacks fixed ──
  (7476, 'summary_edit_hub', 'eyebrow', 'Eyebrow',
   'Edit your appointment', 'Edit your appointment', '{}', 10),
  (7476, 'summary_edit_hub', 'title', 'Title',
   'What would you like to change?', 'What would you like to change?', '{}', 20),
  (7476, 'summary_edit_hub', 'description', 'Description',
   'Tap Edit on any section. Everything else stays exactly as you left it — nothing is lost.',
   'Tap Edit on any section. Everything else stays exactly as you left it — nothing is lost.', '{}', 30),
  (7476, 'summary_edit_hub', 'body_section_contact', 'Section — Contact',
   'Contact', 'Contact', '{}', 40),
  (7476, 'summary_edit_hub', 'body_section_vehicle', 'Section — Vehicle',
   'Vehicle', 'Vehicle', '{}', 50),
  (7476, 'summary_edit_hub', 'body_section_services', 'Section — Services',
   'Services & concerns', 'Services & concerns', '{}', 60),
  (7476, 'summary_edit_hub', 'body_routine_label', 'Group — Routine',
   'Routine', 'Routine', '{}', 61),
  (7476, 'summary_edit_hub', 'body_concerns_label', 'Group — Concerns',
   'Concerns to investigate', 'Concerns to investigate', '{}', 62),
  (7476, 'summary_edit_hub', 'body_testing_label', 'Group — Testing',
   'Testing', 'Testing', '{}', 63),
  (7476, 'summary_edit_hub', 'body_section_time', 'Section — Appointment time',
   'Appointment time', 'Appointment time', '{}', 70),
  (7476, 'summary_edit_hub', 'body_type_waiter', 'Type line — waiter',
   'Waiter ☕', 'Waiter ☕', '{}', 71),
  (7476, 'summary_edit_hub', 'body_type_dropoff', 'Type line — dropoff',
   'Dropoff 🚗 — before 10 AM', 'Dropoff 🚗 — before 10 AM', '{}', 72),
  (7476, 'summary_edit_hub', 'body_hold_caution', 'Slot-release caution',
   'Editing your time releases the slot we''re holding. You''ll pick a fresh time and we''ll hold that one.',
   'Editing your time releases the slot we''re holding. You''ll pick a fresh time and we''ll hold that one.', '{}', 80),
  (7476, 'summary_edit_hub', 'footnote', 'Footnote',
   'Changes you don''t touch stay saved. Nothing here is submitted until you confirm on the summary.',
   'Changes you don''t touch stay saved. Nothing here is submitted until you confirm on the summary.', '{}', 90),

  -- ─── customer_notes (CustomerNotesCard) — input + approval modes ──────────
  (7476, 'customer_notes', 'input_eyebrow', 'Input eyebrow',
   'One more thing (optional)', 'One more thing (optional)', '{}', 10),
  (7476, 'customer_notes', 'input_title', 'Input title',
   'Anything else our team should know? 🛠️', 'Anything else our team should know? 🛠️', '{}', 20),
  (7476, 'customer_notes', 'input_description', 'Input description',
   'Quirks, preferences, that one weird thing — whatever helps us take good care of your car. Or skip — it''s up to you.',
   'Quirks, preferences, that one weird thing — whatever helps us take good care of your car. Or skip — it''s up to you.',
   '{}', 30),
  (7476, 'customer_notes', 'approval_eyebrow', 'Approval eyebrow',
   'Sound right?', 'Sound right?', '{}', 40),
  (7476, 'customer_notes', 'approval_title', 'Approval title',
   'I''ll write this down 📝', 'I''ll write this down 📝', '{}', 50),
  (7476, 'customer_notes', 'approval_description', 'Approval description',
   'Here''s the cleaned-up version of your note. Save it if it captures what you meant, or hit Edit to send your original wording.',
   'Here''s the cleaned-up version of your note. Save it if it captures what you meant, or hit Edit to send your original wording.',
   '{}', 60),
  (7476, 'customer_notes', 'approval_last_try', 'Approval last-try note',
   'Last try — if this still isn''t quite right, hit Edit and we''ll pass your original note straight to the team.',
   'Last try — if this still isn''t quite right, hit Edit and we''ll pass your original note straight to the team.',
   '{}', 70),

  -- ─── customer_question (CustomerQuestionCard) ─────────────────────────────
  (7476, 'customer_question', 'eyebrow', 'Eyebrow',
   'Last bit (optional)', 'Last bit (optional)', '{}', 10),
  (7476, 'customer_question', 'title', 'Title',
   'Got a question for our team? 🤔', 'Got a question for our team? 🤔', '{}', 20),
  (7476, 'customer_question', 'description', 'Description',
   'I''ll pass it along — your advisor will text or call to follow up. Or skip if you''re all set.',
   'I''ll pass it along — your advisor will text or call to follow up. Or skip if you''re all set.', '{}', 30),

  -- ─── appointment_type (AppointmentTypeCard) — CHROME ONLY ─────────────────
  --     Per-option copy (title/description/emoji) lives on the Appointment
  --     Types tab (scheduler_appointment_types); only the card chrome here.
  (7476, 'appointment_type', 'eyebrow', 'Eyebrow',
   'How would you like to come in?', 'How would you like to come in?', '{}', 10),
  (7476, 'appointment_type', 'title', 'Title',
   'Waiter or dropoff?', 'Waiter or dropoff?', '{}', 20),
  (7476, 'appointment_type', 'footnote', 'Footnote',
   'Tap a card to continue. You''ll pick the date next.',
   'Tap a card to continue. You''ll pick the date next.', '{}', 30);
