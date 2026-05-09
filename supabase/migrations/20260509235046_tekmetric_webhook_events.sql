-- General-purpose Tekmetric webhook event log.
--
-- Tekmetric posts every webhook (RO updates, appointments, payments, customer
-- changes, etc.) to ONE URL. The receiving edge function (tekmetric-webhook)
-- writes into this table, no exceptions, then optionally dispatches to inline
-- processors. Downstream subscribers (appointment handler, future systems)
-- can either be called inline by the receiver or watch the table.
--
-- This is DIFFERENT from keytag_webhook_events (created earlier for the
-- existing keytag-tekmetric-webhook URL). Until/unless we consolidate, the
-- two systems run in parallel — Tekmetric admin can configure both webhook
-- destinations and either gets all events or a subset.
--
-- Idempotency: not enforced at the table level. The receiver logs every
-- inbound webhook, including duplicates from Tekmetric retries. Processors
-- that act on these events MUST handle replays themselves (e.g. via the
-- existing webhook_events idempotency convention from
-- .claude/rules/observability.md — keyed on (provider, event_id) where
-- Tekmetric supplies an event_id, or a synthetic key otherwise).

CREATE TABLE public.tekmetric_webhook_events (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at                 timestamptz   NOT NULL DEFAULT now(),

  -- Event classification
  event_type                  text,         -- top-level event_type if Tekmetric supplies one (e.g. "repair_order.status_updated")
  event_text                  text,         -- human-readable event description ("Repair Order #123 status updated by ...")
  event_kind_inferred         text,         -- our heuristic bucket: ro_status_updated | ro_posted | ro_created |
                                            -- payment_made | appointment_created | appointment_updated |
                                            -- appointment_cancelled | unknown

  -- Common entity IDs extracted from common payload shapes
  tekmetric_ro_id             bigint,
  tekmetric_appointment_id    bigint,
  tekmetric_customer_id       bigint,
  tekmetric_vehicle_id        bigint,
  tekmetric_payment_id        bigint,
  tekmetric_shop_id           bigint,
  status_id                   int,          -- repairOrderStatus.id when present

  -- Raw payload — kept for replay, debugging, and future processors that
  -- want fields we didn't extract upfront.
  raw_body                    jsonb,
  raw_headers                 jsonb,        -- Authorization + Cookie headers redacted by the receiver before write
  raw_query_string            text,         -- URL query, with `token` stripped before write

  -- Processing tracking. Multiple subscribers can run against the same row;
  -- they should each write their result key into processing_results so a row
  -- can carry results from N processors without overwriting one another.
  -- Example shape:
  --   { "appointment": { "ok": true, "action": "created", "appointment_id": 123 },
  --     "keytag":      { "ok": true, "action": "skipped_self_authored" } }
  processed_at                timestamptz,
  processing_results          jsonb,
  error_message               text
);

CREATE INDEX tekmetric_webhook_events_received_idx
  ON public.tekmetric_webhook_events (received_at DESC);

CREATE INDEX tekmetric_webhook_events_event_type_idx
  ON public.tekmetric_webhook_events (event_type)
  WHERE event_type IS NOT NULL;

CREATE INDEX tekmetric_webhook_events_event_kind_inferred_idx
  ON public.tekmetric_webhook_events (event_kind_inferred);

CREATE INDEX tekmetric_webhook_events_ro_idx
  ON public.tekmetric_webhook_events (tekmetric_ro_id)
  WHERE tekmetric_ro_id IS NOT NULL;

CREATE INDEX tekmetric_webhook_events_appointment_idx
  ON public.tekmetric_webhook_events (tekmetric_appointment_id)
  WHERE tekmetric_appointment_id IS NOT NULL;

CREATE INDEX tekmetric_webhook_events_customer_idx
  ON public.tekmetric_webhook_events (tekmetric_customer_id)
  WHERE tekmetric_customer_id IS NOT NULL;

ALTER TABLE public.tekmetric_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tekmetric_webhook_events IS
  'Firehose log of every Tekmetric webhook received at /functions/v1/tekmetric-webhook. service_role only. Subscribers (appointment handler, future systems) read from here or are dispatched inline by the receiver.';
