-- =====================================================================
-- Scheduler-app Phase 1 schema
-- =====================================================================
-- Created 2026-05-10 per appointments_design.md (APPROVED 2026-05-10).
--
-- Adds 13 tables + 1 Postgres function + initial seed data for the
-- customer-facing appointment scheduler at appointments.jeffsautomotive.com.
--
-- Design memo: dotfiles-v2-test-data/.../appointments_design.md
-- Project state snapshot: scheduler_project_state.md
--
-- Tables (in order of declaration below):
--   1.  customer_chat_sessions     — one row per conversation (web/SMS)
--   2.  customer_chat_messages     — per-turn log; v5 UIMessage parts as JSONB
--   3.  appointment_holds          — 30-min slot reservations (advisory-lock race-safe)
--   4.  service_dept_users         — OAuth client_id → display_name mapping for audit
--   5.  appointment_blocks         — admin-created day/type/time blocks
--   6.  closed_dates               — Sundays + holidays
--   7.  appointment_concerns       — concern-classifier audit log
--   8.  otp_codes                  — 5-min TTL hashed codes; web channel only
--   9.  transcript_emails          — Resend send + retry tracking
--  10.  testing_services           — diagnostic-pricing reference
--  11.  routine_services           — 10 customer-facing chips + abbreviations
--  12.  appointments               — rolling 7-day shadow of Tekmetric
--  13.  appointment_sync_state     — sync bookkeeping for appointments-sync cron
--
-- Function:
--   hold_waiter_slot — pg_advisory_xact_lock-based race-safe waiter hold
--                      (verified pattern per Postgres docs 2026-05-10)
--
-- Seed data:
--   - testing_services: 14 Phase-1 prices per Chris 2026-05-10
--   - routine_services: 10 chips with display_order; abbreviations TBD
--   - closed_dates: Sundays for next 2 years (auto-generated)
--   - appointment_sync_state: shop 7476 row
--
-- All shop_scoped tables hardcode shop_id = 7476 for Phase 1; multi-shop
-- moved to Phase 2.
--
-- All tables: RLS deny-all to public (service-role-only access via the
-- Vercel Server Action's admin client per design §15).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. customer_chat_sessions
-- ---------------------------------------------------------------------

CREATE TABLE public.customer_chat_sessions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                    INTEGER NOT NULL,
  channel                    TEXT NOT NULL CHECK (channel IN ('web','sms')),
  phone_e164                 TEXT,
  customer_self_identified   TEXT
                                CHECK (customer_self_identified IN ('returning','new','unsure')
                                       OR customer_self_identified IS NULL),
  customer_id                INTEGER,
  vehicle_id                 INTEGER,
  cookie_session             TEXT,
  status                     TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','idle','ended','escalated','timed_out')),
  outcome                    TEXT
                                CHECK (outcome IN ('scheduled','info_only','escalation','incomplete')
                                       OR outcome IS NULL),
  appointment_id             INTEGER,
  opted_out_at               TIMESTAMPTZ,
  sentiment                  TEXT
                                CHECK (sentiment IN ('positive','neutral','negative')
                                       OR sentiment IS NULL),
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                   TIMESTAMPTZ
);

CREATE INDEX customer_chat_sessions_phone_active_idx
  ON public.customer_chat_sessions(phone_e164, last_active_at DESC)
  WHERE status = 'active';

CREATE INDEX customer_chat_sessions_cookie_idx
  ON public.customer_chat_sessions(cookie_session)
  WHERE cookie_session IS NOT NULL;

ALTER TABLE public.customer_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.customer_chat_sessions FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 2. customer_chat_messages
-- ---------------------------------------------------------------------

CREATE TABLE public.customer_chat_messages (
  id              UUID PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  shop_id         INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  parts           JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customer_chat_messages_session_chrono_idx
  ON public.customer_chat_messages(session_id, created_at);
CREATE INDEX customer_chat_messages_shop_chrono_idx
  ON public.customer_chat_messages(shop_id, created_at DESC);

ALTER TABLE public.customer_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.customer_chat_messages FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 3. appointment_holds
-- ---------------------------------------------------------------------

CREATE TABLE public.appointment_holds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         INTEGER NOT NULL,
  session_id      UUID NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  customer_id     INTEGER,
  vehicle_id      INTEGER,
  scheduled_date  DATE NOT NULL,
  scheduled_time  TIME NOT NULL,
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('waiter','dropoff')),
  service_summary TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index — predicate is `released_at IS NULL` only (Postgres rejects
-- volatile expressions like `expires_at > now()` in partial-index predicates).
-- Application filters expires_at > now() at query time.
CREATE INDEX appointment_holds_active_idx
  ON public.appointment_holds(shop_id, scheduled_date, scheduled_time, appointment_type)
  WHERE released_at IS NULL;

ALTER TABLE public.appointment_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.appointment_holds FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 4. service_dept_users
-- ---------------------------------------------------------------------

CREATE TABLE public.service_dept_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         INTEGER NOT NULL,
  oauth_client_id TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  email           TEXT,
  role            TEXT NOT NULL DEFAULT 'service-advisor'
                    CHECK (role IN ('service-advisor','service-manager','technician','owner')),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, oauth_client_id)
);

CREATE INDEX service_dept_users_active_idx
  ON public.service_dept_users(shop_id) WHERE active = TRUE;

ALTER TABLE public.service_dept_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.service_dept_users FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 5. appointment_blocks
-- ---------------------------------------------------------------------

CREATE TABLE public.appointment_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         INTEGER NOT NULL,
  blocked_date    DATE NOT NULL,
  blocked_type    TEXT CHECK (blocked_type IN ('waiter','dropoff') OR blocked_type IS NULL),
  blocked_time    TIME,
  reason          TEXT,
  created_by_oauth_client_id  TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX appointment_blocks_lookup_idx
  ON public.appointment_blocks(shop_id, blocked_date);

ALTER TABLE public.appointment_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.appointment_blocks FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 6. closed_dates
-- ---------------------------------------------------------------------

CREATE TABLE public.closed_dates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         INTEGER NOT NULL,
  closed_date     DATE NOT NULL,
  reason          TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'admin'
                    CHECK (source IN ('admin','default-sunday','holiday-import')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, closed_date)
);

ALTER TABLE public.closed_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.closed_dates FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 7. appointment_concerns
-- ---------------------------------------------------------------------

CREATE TABLE public.appointment_concerns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  appointment_id  INTEGER,
  category        TEXT NOT NULL,    -- one of 14 concern categories or 'routine-only'
  raw_text        TEXT NOT NULL,
  prose_summary   TEXT NOT NULL,
  classified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX appointment_concerns_session_idx
  ON public.appointment_concerns(session_id);

ALTER TABLE public.appointment_concerns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.appointment_concerns FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 8. otp_codes
-- ---------------------------------------------------------------------

CREATE TABLE public.otp_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         INTEGER NOT NULL,
  phone_e164      TEXT NOT NULL,
  code_hash       BYTEA NOT NULL,                   -- sha256(salt || code)
  salt            BYTEA NOT NULL,                   -- 16 random bytes
  expires_at      TIMESTAMPTZ NOT NULL,             -- typically now() + 5 minutes
  attempts        INT NOT NULL DEFAULT 0,
  consumed_at     TIMESTAMPTZ,                      -- non-null = used (single-use)
  ip_addr         INET,                             -- web only
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_active_idx
  ON public.otp_codes(phone_e164, created_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.otp_codes FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 9. transcript_emails
-- ---------------------------------------------------------------------

CREATE TABLE public.transcript_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.customer_chat_sessions(id),
  resend_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','retry')),
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transcript_emails_pending_idx
  ON public.transcript_emails(status) WHERE status IN ('pending','retry');

ALTER TABLE public.transcript_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.transcript_emails FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 10. testing_services
-- ---------------------------------------------------------------------

CREATE TABLE public.testing_services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             INTEGER NOT NULL,
  service_key         TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  abbreviation        TEXT NOT NULL,                       -- shop-shorthand for Tekmetric appt title
  starting_price_cents INTEGER NOT NULL,
  notes               TEXT,
  concern_categories  TEXT[],
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_oauth_client_id  TEXT,
  updated_by_name             TEXT,
  UNIQUE (shop_id, service_key)
);

CREATE INDEX testing_services_active_idx
  ON public.testing_services(shop_id, service_key) WHERE active = TRUE;
CREATE INDEX testing_services_categories_idx
  ON public.testing_services USING GIN (concern_categories);

ALTER TABLE public.testing_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.testing_services FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 11. routine_services
-- ---------------------------------------------------------------------

CREATE TABLE public.routine_services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         INTEGER NOT NULL,
  service_key     TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  abbreviation    TEXT NOT NULL,                   -- Tekmetric title shorthand
  display_order   INTEGER NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_oauth_client_id  TEXT,
  updated_by_name             TEXT,
  UNIQUE (shop_id, service_key)
);

CREATE INDEX routine_services_active_idx
  ON public.routine_services(shop_id, display_order) WHERE active = TRUE;

ALTER TABLE public.routine_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.routine_services FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 12. appointments (rolling 7-day shadow of Tekmetric)
-- ---------------------------------------------------------------------

CREATE TABLE public.appointments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                  INTEGER NOT NULL,
  tekmetric_appointment_id BIGINT NOT NULL,
  customer_id              BIGINT,
  vehicle_id               BIGINT,
  start_time               TIMESTAMPTZ NOT NULL,
  end_time                 TIMESTAMPTZ NOT NULL,
  appointment_type         TEXT NOT NULL CHECK (appointment_type IN ('waiter','dropoff')),
  appointment_status       TEXT NOT NULL
                              CHECK (appointment_status IN ('NONE','CONFIRMED','ARRIVED','NO_SHOW','CANCELED')),
  title                    TEXT,
  description              TEXT,
  appointment_option       TEXT,
  ride_option              TEXT,
  color                    TEXT,
  source                   TEXT NOT NULL DEFAULT 'tekmetric'
                              CHECK (source IN ('scheduler-app','tekmetric')),
  tekmetric_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, tekmetric_appointment_id)
);

CREATE INDEX appointments_slot_lookup_idx
  ON public.appointments(shop_id, start_time, appointment_type, appointment_status)
  WHERE deleted_at IS NULL;

CREATE INDEX appointments_date_scan_idx
  ON public.appointments(shop_id, start_time)
  WHERE deleted_at IS NULL AND appointment_status NOT IN ('CANCELED','NO_SHOW');

CREATE INDEX appointments_customer_idx
  ON public.appointments(shop_id, customer_id, start_time DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.appointments FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- 13. appointment_sync_state
-- ---------------------------------------------------------------------

CREATE TABLE public.appointment_sync_state (
  shop_id                INTEGER PRIMARY KEY,
  last_full_sync_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delta_sync_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delta_sync_count  INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.appointment_sync_state FOR ALL TO public USING (false);


-- ---------------------------------------------------------------------
-- hold_waiter_slot — race-safe slot hold via transaction-scoped advisory lock
--
-- Pattern verified against:
--   - https://www.postgresql.org/docs/current/explicit-locking.html § 13.3.5
--   - https://www.postgresql.org/docs/current/transaction-iso.html
--   - https://www.postgresql.org/docs/current/functions-admin.html
-- (all WebFetched 2026-05-10 + cross-checked via Context7
-- /websites/postgresql_current).
--
-- Why advisory lock vs SERIALIZABLE: simpler reasoning, no retry-on-40001
-- loop required, doesn't require system-wide isolation level changes.
-- See appointments_design.md §9 for the full rationale.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hold_waiter_slot(
  p_shop_id                INTEGER,
  p_session_id             UUID,
  p_customer_id            INTEGER,
  p_vehicle_id             INTEGER,
  p_scheduled_date         DATE,
  p_scheduled_time         TIME,
  p_service_summary        TEXT,
  p_active_tekmetric_appts INTEGER
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold_id      UUID;
  v_active_holds INTEGER;
  v_lock_key     TEXT := format('hold:%s:%s:%s:waiter',
                                p_shop_id, p_scheduled_date, p_scheduled_time);
BEGIN
  -- Take a transaction-scoped advisory lock on the logical slot.
  -- hashtextextended turns the slot key into a stable bigint.
  -- Two concurrent calls on the same slot key serialize here;
  -- different slots run in parallel.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  -- Count active holds for this slot.
  SELECT COUNT(*) INTO v_active_holds
    FROM public.appointment_holds
    WHERE shop_id = p_shop_id
      AND scheduled_date = p_scheduled_date
      AND scheduled_time = p_scheduled_time
      AND appointment_type = 'waiter'
      AND released_at IS NULL
      AND expires_at > now();

  IF v_active_holds + p_active_tekmetric_appts >= 2 THEN
    RAISE EXCEPTION 'slot_full' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.appointment_holds (
    shop_id, session_id, customer_id, vehicle_id,
    scheduled_date, scheduled_time, appointment_type,
    service_summary, expires_at
  ) VALUES (
    p_shop_id, p_session_id, p_customer_id, p_vehicle_id,
    p_scheduled_date, p_scheduled_time, 'waiter',
    p_service_summary, now() + interval '30 minutes'
  ) RETURNING id INTO v_hold_id;

  RETURN v_hold_id;
  -- Lock auto-released on transaction COMMIT
END;
$$;

REVOKE ALL ON FUNCTION public.hold_waiter_slot FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hold_waiter_slot TO service_role;


-- =====================================================================
-- SEED DATA
-- =====================================================================

-- ---------------------------------------------------------------------
-- testing_services seed (14 Phase-1 prices per Chris 2026-05-10)
-- Abbreviations marked TBD pending Chris's full list.
-- ---------------------------------------------------------------------

INSERT INTO public.testing_services
  (shop_id, service_key, display_name, abbreviation, starting_price_cents, notes, concern_categories) VALUES
  (7476, 'warning_light_general',
   'Warning light testing (non-TPMS)', 'CEL testing', 17999,
   'Starting price; further diagnostic may be needed',
   ARRAY['warning-light','performance']),
  (7476, 'tpms_testing',
   'Tire pressure (TPMS) light testing', 'TBD', 5495,
   'Starting price',
   ARRAY['warning-light','tires']),
  (7476, 'suspension_check',
   'Suspension check', 'TBD', 8995,
   'Starting price',
   ARRAY['noise','steering']),
  (7476, 'brake_inspection',
   'Brake inspection', 'TBD', 3999,
   'Waived if brake repair is approved',
   ARRAY['brakes','noise','pulling']),
  (7476, 'battery_test',
   'Battery test', 'TBD', 0,
   'Free',
   ARRAY['electrical','warning-light']),
  (7476, 'alternator_testing',
   'Alternator testing (simple electrical)', 'TBD', 8995,
   'Starting price',
   ARRAY['electrical','warning-light']),
  (7476, 'electrical_testing_general',
   'Electrical system testing (non-alternator/battery)', 'TBD', 17999,
   'Starting price',
   ARRAY['electrical']),
  (7476, 'oil_leak_testing',
   'Oil leak testing', 'TBD', 17995,
   'Starting price',
   ARRAY['leak','smell','smoke']),
  (7476, 'coolant_leak_testing',
   'Coolant leak / overheating testing', 'TBD', 10995,
   'Includes coolant',
   ARRAY['leak','smoke','smell','performance']),
  (7476, 'coolant_leak_testing_euro',
   'Coolant leak / overheating testing — Euro vehicle', 'TBD', 19995,
   'Includes coolant',
   ARRAY['leak','smoke','smell','performance']),
  (7476, 'no_start_testing',
   'No-start testing', 'TBD', 17995,
   'Starting price',
   ARRAY['performance','electrical']),
  (7476, 'transmission_testing',
   'Transmission issues testing', 'TBD', 17995,
   'Starting price',
   ARRAY['performance']),
  (7476, 'window_inop_testing',
   'Window inoperative testing', 'TBD', 12595,
   'Includes tear down',
   ARRAY['electrical','other']),
  (7476, 'windshield_inop_testing',
   'Windshield inoperative testing', 'TBD', 17995,
   'Starting price',
   ARRAY['electrical','other']);


-- ---------------------------------------------------------------------
-- routine_services seed (10 Phase-1 chips)
-- Abbreviations partially known — rest TBD pending Chris's full list.
-- ---------------------------------------------------------------------

INSERT INTO public.routine_services
  (shop_id, service_key, display_name, abbreviation, display_order) VALUES
  (7476, 'state_inspection_emissions', 'State Inspection and Emissions', 'SI IM', 1),
  (7476, 'oil_change',                  'Oil Change',                    'LOF',   2),
  (7476, 'tire_rotation',               'Tire Rotation',                 'TBD',   3),
  (7476, 'rotate_balance_tires',        'Rotate and Balance Tires',      'TBD',   4),
  (7476, 'alignment',                   'Alignment',                     'TBD',   5),
  (7476, 'brake_inspection',            'Brake Inspection',              'TBD',   6),
  (7476, 'check_battery',               'Check Battery',                 'TBD',   7),
  (7476, 'warning_lights',              'Warning Lights',                'TBD',   8),
  (7476, 'check_suspension',            'Check Suspension',              'TBD',   9),
  (7476, 'check_ac',                    'Check A/C',                     'TBD',   10);


-- ---------------------------------------------------------------------
-- closed_dates seed — every Sunday for the next 2 years
-- ---------------------------------------------------------------------

INSERT INTO public.closed_dates (shop_id, closed_date, reason, source)
SELECT
  7476,
  d::DATE,
  'sunday-default',
  'default-sunday'
FROM generate_series(
  -- Find next Sunday on or after today
  (current_date + ((7 - extract(dow from current_date)::int) % 7))::DATE,
  current_date + interval '2 years',
  interval '7 days'
) AS d;


-- ---------------------------------------------------------------------
-- appointment_sync_state seed — shop 7476 row
-- ---------------------------------------------------------------------

INSERT INTO public.appointment_sync_state (shop_id, notes)
VALUES (7476, 'Initialized at scheduler-app Phase 1 deploy 2026-05-10');


-- ---------------------------------------------------------------------
-- Note: service_dept_users seeding (Chris's row) is deferred to a
-- separate manual step at launch per design memo §17 TODOs. The OAuth
-- client_id needs to be captured from Chris's actual Claude Desktop
-- install, which only exists after the OAuth flow runs.
-- ---------------------------------------------------------------------
