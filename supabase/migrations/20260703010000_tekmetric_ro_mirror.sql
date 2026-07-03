-- Tekmetric RO mirror (2026-07-03)
--
-- Mirrors Tekmetric repair orders into Postgres with a column for EVERY field
-- the API actually returns ("maximum filterization" — Chris, 2026-07-03), so we
-- can filter ROs on parameters Tekmetric's API doesn't expose. Schema derived
-- from a 2,500-RO field census (178 paths), not from the API docs — the census
-- found ~15 real fields the docs never mention. Plan: docs/tekmetric/ro-mirror-plan.md.
--
-- Conventions: Tekmetric BIGINT ids as natural PKs (mirror tables upsert by
-- provider id — intentional departure from app-table UUID PKs), shop_id INTEGER,
-- money BIGINT cents with _cents suffix, TIMESTAMPTZ, TEXT, NUMERIC where the
-- provider can send fractions. RLS enabled with NO policies: service-role-only
-- internal analysis surface (anon/authenticated denied).
--
-- Fallback layers for fields we missed (locked decision #2):
--   1. tekmetric_ros.raw keeps the complete payload verbatim (JSONB).
--   2. The ingest runner diffs every object's keys against per-level whitelists
--      and records unknowns via record_tekmetric_ingest_alert() below.

-- ─── parent ──────────────────────────────────────────────────────────────────

CREATE TABLE public.tekmetric_ros (
  id                        BIGINT PRIMARY KEY,
  shop_id                   INTEGER NOT NULL,
  repair_order_number       BIGINT,
  appointment_id            BIGINT,
  customer_id               BIGINT,
  vehicle_id                BIGINT,
  technician_id             BIGINT,
  service_writer_id         BIGINT,
  keytag                    TEXT,
  color                     TEXT,
  miles_in                  NUMERIC,
  miles_out                 NUMERIC,
  lead_source               TEXT,
  -- repairOrderStatus{}
  status_id                 INTEGER,
  status_code               TEXT,
  status_name               TEXT,
  status_posted_or_accrecv  BOOLEAN,
  -- repairOrderLabel{} (+ its nested status{})
  label_id                  INTEGER,
  label_code                TEXT,
  label_name                TEXT,
  label_status_id           INTEGER,
  label_status_code         TEXT,
  label_status_name         TEXT,
  label_status_posted_or_accrecv BOOLEAN,
  -- repairOrderCustomLabel{}
  custom_label_name         TEXT,
  -- money (cents)
  labor_sales_cents         BIGINT,
  parts_sales_cents         BIGINT,
  sublet_sales_cents        BIGINT,
  discount_total_cents      BIGINT,
  fee_total_cents           BIGINT,
  taxes_cents               BIGINT,
  amount_paid_cents         BIGINT,
  total_sales_cents         BIGINT,
  -- dates
  created_date              TIMESTAMPTZ,
  updated_date              TIMESTAMPTZ,
  completed_date            TIMESTAMPTZ,
  posted_date               TIMESTAMPTZ,
  deleted_date              TIMESTAMPTZ,
  customer_time_out         TIMESTAMPTZ,
  estimate_share_date       TIMESTAMPTZ,
  inspection_share_date     TIMESTAMPTZ,
  invoice_share_date        TIMESTAMPTZ,
  -- share urls
  estimate_url              TEXT,
  inspection_url            TEXT,
  invoice_url               TEXT,
  -- fallback layer 1 + sync bookkeeping
  raw                       JSONB NOT NULL,
  synced_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tekmetric_ros IS
  'Raw Tekmetric repair-order mirror (one column per API field; raw JSONB is the loss-proof fallback). Ingest: scheduler-app/scripts/tekmetric/sync-ros.mjs';

CREATE INDEX tekmetric_ros_shop_posted_idx   ON public.tekmetric_ros (shop_id, posted_date);
CREATE INDEX tekmetric_ros_updated_idx       ON public.tekmetric_ros (updated_date);
CREATE INDEX tekmetric_ros_created_idx       ON public.tekmetric_ros (created_date);
CREATE INDEX tekmetric_ros_customer_idx      ON public.tekmetric_ros (customer_id);
CREATE INDEX tekmetric_ros_vehicle_idx       ON public.tekmetric_ros (vehicle_id);
CREATE INDEX tekmetric_ros_appointment_idx   ON public.tekmetric_ros (appointment_id);
CREATE INDEX tekmetric_ros_status_code_idx   ON public.tekmetric_ros (status_code);

-- ─── jobs + job children ─────────────────────────────────────────────────────

CREATE TABLE public.tekmetric_ro_jobs (
  id                    BIGINT PRIMARY KEY,
  ro_id                 BIGINT NOT NULL REFERENCES public.tekmetric_ros(id) ON DELETE CASCADE,
  shop_id               INTEGER NOT NULL,
  customer_id           BIGINT,
  vehicle_id            BIGINT,
  name                  TEXT,
  note                  TEXT,
  canned_job_id         BIGINT,
  job_category_name     TEXT,
  technician_id         BIGINT,
  authorized            BOOLEAN,
  authorized_date       TIMESTAMPTZ,
  selected              BOOLEAN,
  archived              BOOLEAN,
  sort                  INTEGER,
  labor_hours           NUMERIC,
  logged_hours          NUMERIC,
  parts_total_cents     BIGINT,
  labor_total_cents     BIGINT,
  discount_total_cents  BIGINT,
  fee_total_cents       BIGINT,
  subtotal_cents        BIGINT,
  created_date          TIMESTAMPTZ,
  updated_date          TIMESTAMPTZ,
  completed_date        TIMESTAMPTZ
);

CREATE INDEX tekmetric_ro_jobs_ro_idx        ON public.tekmetric_ro_jobs (ro_id);
CREATE INDEX tekmetric_ro_jobs_canned_idx    ON public.tekmetric_ro_jobs (canned_job_id);
CREATE INDEX tekmetric_ro_jobs_category_idx  ON public.tekmetric_ro_jobs (job_category_name);

CREATE TABLE public.tekmetric_ro_job_labor (
  id             BIGINT PRIMARY KEY,
  job_id         BIGINT NOT NULL REFERENCES public.tekmetric_ro_jobs(id) ON DELETE CASCADE,
  ro_id          BIGINT NOT NULL,
  name           TEXT,
  rate_cents     BIGINT,
  hours          NUMERIC,
  complete       BOOLEAN,
  technician_id  BIGINT
);

CREATE INDEX tekmetric_ro_job_labor_job_idx ON public.tekmetric_ro_job_labor (job_id);
CREATE INDEX tekmetric_ro_job_labor_ro_idx  ON public.tekmetric_ro_job_labor (ro_id);

CREATE TABLE public.tekmetric_ro_job_parts (
  id                 BIGINT PRIMARY KEY,
  job_id             BIGINT NOT NULL REFERENCES public.tekmetric_ro_jobs(id) ON DELETE CASCADE,
  ro_id              BIGINT NOT NULL,
  quantity           NUMERIC,
  brand              TEXT,
  name               TEXT,
  part_number        TEXT,
  description        TEXT,
  cost_cents         BIGINT,
  retail_cents       BIGINT,
  model              TEXT,
  width              TEXT,
  ratio              NUMERIC,
  diameter           NUMERIC,
  construction_type  TEXT,
  load_index         TEXT,
  load_range         TEXT,
  speed_rating       TEXT,
  mileage_warranty   TEXT,
  run_flat           BOOLEAN,
  side_wall_style    TEXT,
  temperature        TEXT,
  tire_category      TEXT,
  tire_type          TEXT,
  traction           TEXT,
  treadwear          TEXT,
  dot_numbers        TEXT[],
  part_type_id       INTEGER,
  part_type_code     TEXT,
  part_type_name     TEXT,
  part_status_id     INTEGER,
  part_status_code   TEXT,
  part_status_name   TEXT
);

CREATE INDEX tekmetric_ro_job_parts_job_idx ON public.tekmetric_ro_job_parts (job_id);
CREATE INDEX tekmetric_ro_job_parts_ro_idx  ON public.tekmetric_ro_job_parts (ro_id);

CREATE TABLE public.tekmetric_ro_job_fees (
  id           BIGINT PRIMARY KEY,
  job_id       BIGINT NOT NULL REFERENCES public.tekmetric_ro_jobs(id) ON DELETE CASCADE,
  ro_id        BIGINT NOT NULL,
  name         TEXT,
  total_cents  BIGINT
);

CREATE INDEX tekmetric_ro_job_fees_job_idx ON public.tekmetric_ro_job_fees (job_id);

CREATE TABLE public.tekmetric_ro_job_discounts (
  id           BIGINT PRIMARY KEY,
  job_id       BIGINT NOT NULL REFERENCES public.tekmetric_ro_jobs(id) ON DELETE CASCADE,
  ro_id        BIGINT NOT NULL,
  name         TEXT,
  total_cents  BIGINT
);

CREATE INDEX tekmetric_ro_job_discounts_job_idx ON public.tekmetric_ro_job_discounts (job_id);

-- ─── RO-level children ───────────────────────────────────────────────────────

CREATE TABLE public.tekmetric_ro_fees (
  id           BIGINT PRIMARY KEY,
  ro_id        BIGINT NOT NULL REFERENCES public.tekmetric_ros(id) ON DELETE CASCADE,
  name         TEXT,
  total_cents  BIGINT
);

CREATE INDEX tekmetric_ro_fees_ro_idx ON public.tekmetric_ro_fees (ro_id);

CREATE TABLE public.tekmetric_ro_discounts (
  id           BIGINT PRIMARY KEY,
  ro_id        BIGINT NOT NULL REFERENCES public.tekmetric_ros(id) ON DELETE CASCADE,
  name         TEXT,
  total_cents  BIGINT
);

CREATE INDEX tekmetric_ro_discounts_ro_idx ON public.tekmetric_ro_discounts (ro_id);

CREATE TABLE public.tekmetric_ro_customer_concerns (
  id            BIGINT PRIMARY KEY,
  ro_id         BIGINT NOT NULL REFERENCES public.tekmetric_ros(id) ON DELETE CASCADE,
  concern       TEXT,
  tech_comment  TEXT
);

COMMENT ON TABLE public.tekmetric_ro_customer_concerns IS
  'Verbatim advisor-transcribed customer concern lines per RO — the real-concern corpus for the diagnose-concern eval.';

CREATE INDEX tekmetric_ro_customer_concerns_ro_idx ON public.tekmetric_ro_customer_concerns (ro_id);

CREATE TABLE public.tekmetric_ro_sublets (
  id                    BIGINT PRIMARY KEY,
  ro_id                 BIGINT NOT NULL REFERENCES public.tekmetric_ros(id) ON DELETE CASCADE,
  name                  TEXT,
  note                  TEXT,
  price_cents           BIGINT,
  cost_cents            BIGINT,
  authorized            BOOLEAN,
  authorized_date       TIMESTAMPTZ,
  selected              BOOLEAN,
  sort                  INTEGER,
  feeable               BOOLEAN,
  tax_sublet            BOOLEAN,
  -- vendor{}
  vendor_id             BIGINT,
  vendor_name           TEXT,
  vendor_nickname       TEXT,
  vendor_phone          TEXT,
  vendor_website        TEXT,
  -- accountsPayable{} (paymentType/paymentDetails were null-only in the census;
  -- JSONB so an unexpected object shape lands instead of erroring)
  ap_id                 BIGINT,
  ap_amount_cents       BIGINT,
  ap_amount_paid_cents  BIGINT,
  ap_payment_type       JSONB,
  ap_payment_details    JSONB
);

CREATE INDEX tekmetric_ro_sublets_ro_idx ON public.tekmetric_ro_sublets (ro_id);

CREATE TABLE public.tekmetric_ro_sublet_items (
  id           BIGINT PRIMARY KEY,
  sublet_id    BIGINT NOT NULL REFERENCES public.tekmetric_ro_sublets(id) ON DELETE CASCADE,
  ro_id        BIGINT NOT NULL,
  name         TEXT,
  cost_cents   BIGINT,
  price_cents  BIGINT,
  complete     BOOLEAN
);

CREATE INDEX tekmetric_ro_sublet_items_sublet_idx ON public.tekmetric_ro_sublet_items (sublet_id);

-- ─── fallback layer 2: unknown-field alerts ──────────────────────────────────

CREATE TABLE public.tekmetric_ro_ingest_alerts (
  id            BIGSERIAL PRIMARY KEY,
  level         TEXT NOT NULL,        -- ro | job | labor | part | fee | ... | insert_error
  unknown_keys  TEXT[] NOT NULL,      -- sorted, so UNIQUE dedupes recurrences
  ro_id         BIGINT,               -- first RO that exhibited it (no FK: RO row may have failed)
  sample        JSONB,                -- offending object excerpt / error detail
  occurrences   BIGINT NOT NULL DEFAULT 1,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (level, unknown_keys)
);

COMMENT ON TABLE public.tekmetric_ro_ingest_alerts IS
  'Ingest alarm: fields Tekmetric sent that the mirror has no column for (or rows that failed to insert). Non-empty table = add columns / fix ingest.';

CREATE OR REPLACE FUNCTION public.record_tekmetric_ingest_alert(
  p_level TEXT,
  p_unknown_keys TEXT[],
  p_ro_id BIGINT,
  p_sample JSONB
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.tekmetric_ro_ingest_alerts (level, unknown_keys, ro_id, sample)
  VALUES (p_level, p_unknown_keys, p_ro_id, p_sample)
  ON CONFLICT (level, unknown_keys) DO UPDATE
    SET occurrences = tekmetric_ro_ingest_alerts.occurrences + 1,
        last_seen   = now();
$$;

REVOKE EXECUTE ON FUNCTION public.record_tekmetric_ingest_alert(TEXT, TEXT[], BIGINT, JSONB) FROM anon, authenticated;

-- ─── RLS: deny-all (service-role-only internal surface) ──────────────────────

ALTER TABLE public.tekmetric_ros                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_job_labor          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_job_parts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_job_fees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_job_discounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_fees               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_discounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_customer_concerns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_sublets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_sublet_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekmetric_ro_ingest_alerts      ENABLE ROW LEVEL SECURITY;
