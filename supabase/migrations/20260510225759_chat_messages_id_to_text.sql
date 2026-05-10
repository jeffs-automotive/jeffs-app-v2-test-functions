-- =====================================================================
-- customer_chat_messages.id: UUID → TEXT
-- =====================================================================
-- Created 2026-05-10 — Phase 1 smoke-test failure root cause.
--
-- Symptom: chat agent loops the first-turn disclosure forever; messages
-- never persist. Postgres logs show:
--
--   ERROR: invalid input syntax for type uuid: "zJi56CYEkKg3aXBy"
--   ERROR: invalid input syntax for type uuid: "UfNR0lpVOqObcumR"
--   (etc — every saveChat call)
--
-- Cause: AI SDK v5's useChat / DefaultChatTransport generates 16-char
-- nanoid-style IDs for messages, not UUIDs. The route handler's
-- toUIMessageStreamResponse({ generateMessageId }) only affects NEW
-- assistant messages the server generates — user-message IDs come from
-- the client's nanoid generator. saveChat tries to upsert with those
-- nanoid IDs into a UUID column → invalid syntax → silent fail in
-- onFinish → next request's loadChat() returns empty → model has no
-- history → repeats the disclosure.
--
-- Fix: change customer_chat_messages.id from UUID to TEXT. Both UUIDs
-- and nanoid IDs are valid TEXT values, so this works regardless of
-- which AI SDK generator we use. No data migration concerns (the table
-- is empty — saveChat has never successfully inserted a row).
--
-- Note: customer_chat_sessions.id stays UUID — those IDs come from
-- ChatBootstrap.tsx → crypto.randomUUID() which generates real UUIDs.
-- =====================================================================

ALTER TABLE public.customer_chat_messages
  ALTER COLUMN id TYPE TEXT;

-- The FK on session_id is unchanged (still UUID → customer_chat_sessions(id))

COMMENT ON COLUMN public.customer_chat_messages.id IS
  'AI SDK v5 client-generated message ID (nanoid-style, ~16 chars). NOT a UUID. Stored as TEXT so any AI SDK ID format works.';
