-- =====================================================================
-- scheduler_card_text — seed the `completed` card (card-text-editor)
-- =====================================================================
-- Follow-on to 20260715150000. Seeds the terminal CompletedCard's editable
-- "main copy". Byte-identical to the current CompletedCard.tsx literals so the
-- payload-driven card renders IDENTICALLY on day one.
--
-- Rich-content slots (proves the node-interpolation path): the title has a
-- named/anon variant pair (grammar branch on first_name), {{appointment_label}}
-- renders as a bold label or "soon", {{shop_phone}} renders as the tel: link,
-- and the reminders line has a consent/no-consent variant pair.

insert into public.scheduler_card_text
  (shop_id, card_key, slot_key, label, body, default_body, allowed_merge_fields, sort)
values
  (7476, 'completed', 'eyebrow', 'Eyebrow',
   'All done', 'All done', '{}', 10),
  (7476, 'completed', 'title_named', 'Title (with name)',
   'You''re all set, {{first_name}}.', 'You''re all set, {{first_name}}.', '{first_name}', 20),
  (7476, 'completed', 'title_anon', 'Title (no name)',
   'You''re all set.', 'You''re all set.', '{}', 21),
  (7476, 'completed', 'description', 'Description',
   'We''ll see you {{appointment_label}}. If anything comes up, text or call us at {{shop_phone}} and someone on our team will help you out.',
   'We''ll see you {{appointment_label}}. If anything comes up, text or call us at {{shop_phone}} and someone on our team will help you out.',
   '{appointment_label,shop_phone}', 30),
  (7476, 'completed', 'next_label', 'What-happens-next heading',
   'What happens next', 'What happens next', '{}', 40),
  (7476, 'completed', 'next_booked', 'Step — booked',
   'We''ve booked it in our system', 'We''ve booked it in our system', '{}', 50),
  (7476, 'completed', 'next_reminders_consent', 'Step — reminders (opted in)',
   'We''ll text and email your confirmation and a reminder before your visit.',
   'We''ll text and email your confirmation and a reminder before your visit.',
   '{}', 60),
  (7476, 'completed', 'next_reminders_noconsent', 'Step — reminders (not opted in)',
   'Your confirmation and summary are saved right here in this chat. Want text + email reminders? Just tell us at your visit and we''ll turn them on.',
   'Your confirmation and summary are saved right here in this chat. Want text + email reminders? Just tell us at your visit and we''ll turn them on.',
   '{}', 61),
  (7476, 'completed', 'next_keys', 'Step — bring keys',
   'Bring your keys and we''ll take it from here', 'Bring your keys and we''ll take it from here', '{}', 70),
  (7476, 'completed', 'thanks', 'Thanks line',
   'Thanks for choosing {{shop_name}} — we appreciate it. A confirmation summary stays in this chat for your reference.',
   'Thanks for choosing {{shop_name}} — we appreciate it. A confirmation summary stays in this chat for your reference.',
   '{shop_name}', 80),
  (7476, 'completed', 'footnote', 'Footnote',
   'Family-owned since 1976 · Questions? {{shop_phone}}',
   'Family-owned since 1976 · Questions? {{shop_phone}}',
   '{shop_phone}', 90);
