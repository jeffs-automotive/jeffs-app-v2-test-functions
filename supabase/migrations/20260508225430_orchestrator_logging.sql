-- Orchestrator logging tables
--
-- Per project policy ("log everything"), every chat → orchestrator → tool chain
-- writes a complete audit trail. This lets us:
--   - debug bad responses (what did the orchestrator decide; which tools fired)
--   - track token spend per turn / per user / per model
--   - replay turns in dev when we change the system prompt or tool surface
--   - surface "this turn went weird" patterns over time
--
-- Tables:
--   chat_sessions      — one row per conversation (a Claude Desktop session, basically)
--   orchestrator_runs  — one row per "user said something, orchestrator answered" turn
--   agent_calls        — one row per LLM call inside a run (orchestrator + any specialists)
--   tool_calls         — one row per tool invocation inside a run (DB lookup, Tekmetric API, etc.)
--
-- service_role only. RLS is enabled with no policies for anon/authenticated, so they get nothing.
-- (We intentionally do NOT add a per-user RLS policy yet — that's a Phase 2 piece tied to
--  team_members + Supabase Auth migration. For now everything is service_role-scoped.)

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.chat_sessions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identifies the team member. For Phase 1 we use a free-form token label
  -- (e.g., "chris", "tech-bay-1"); when we wire team_members, this becomes a FK.
  user_label      text          NOT NULL,
  started_at      timestamptz   NOT NULL DEFAULT now(),
  last_active_at  timestamptz   NOT NULL DEFAULT now(),
  metadata        jsonb         NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX chat_sessions_user_label_idx   ON public.chat_sessions (user_label);
CREATE INDEX chat_sessions_last_active_idx  ON public.chat_sessions (last_active_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- orchestrator_runs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.orchestrator_runs (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid          REFERENCES public.chat_sessions(id) ON DELETE RESTRICT,

  user_intent         text          NOT NULL,        -- the verbatim "intent" arg from Claude Desktop
  user_params         jsonb,                          -- any structured params Claude Desktop passed alongside intent

  model               text,                           -- the orchestrator's model id at run time
  status              text          NOT NULL DEFAULT 'in_progress'
                                    CHECK (status IN ('in_progress', 'complete', 'error')),

  final_response      jsonb,                          -- what the orchestrator returned to Claude Desktop (curated JSON)
  total_tokens_in     bigint,
  total_tokens_out    bigint,
  total_cost_cents    bigint,                         -- BIGINT cents, never floats — project money convention

  started_at          timestamptz   NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  latency_ms          bigint,

  error_message       text
);

CREATE INDEX orchestrator_runs_session_idx   ON public.orchestrator_runs (session_id);
CREATE INDEX orchestrator_runs_started_idx   ON public.orchestrator_runs (started_at DESC);
CREATE INDEX orchestrator_runs_status_idx    ON public.orchestrator_runs (status);

ALTER TABLE public.orchestrator_runs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_calls — one row per LLM call inside a run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.agent_calls (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid          NOT NULL REFERENCES public.orchestrator_runs(id) ON DELETE RESTRICT,

  agent_name      text          NOT NULL,            -- "orchestrator" or specialist name when we add them
  model           text          NOT NULL,            -- e.g. "claude-sonnet-4-5"
  step_number     int,                                -- order within the run (orchestrator may iterate)

  input           jsonb,                              -- prompt + tools at call time (PII redacted before write)
  output          jsonb,                              -- final response text + tool_calls list

  tokens_in       bigint,
  tokens_out      bigint,
  cost_cents      bigint,

  started_at      timestamptz   NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  latency_ms      bigint,

  error_message   text
);

CREATE INDEX agent_calls_run_idx     ON public.agent_calls (run_id);
CREATE INDEX agent_calls_started_idx ON public.agent_calls (started_at DESC);

ALTER TABLE public.agent_calls ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- tool_calls — one row per non-LLM tool execution
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.tool_calls (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid          NOT NULL REFERENCES public.orchestrator_runs(id) ON DELETE RESTRICT,

  tool_name       text          NOT NULL,            -- e.g. "listWipKeyTags", "findRoByKeyTag"
  step_number     int,
  input           jsonb,
  output          jsonb,                              -- truncated to 8KB before write to keep table manageable
  output_truncated boolean      NOT NULL DEFAULT false,

  started_at      timestamptz   NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  latency_ms      bigint,

  error_message   text
);

CREATE INDEX tool_calls_run_idx     ON public.tool_calls (run_id);
CREATE INDEX tool_calls_name_idx    ON public.tool_calls (tool_name);
CREATE INDEX tool_calls_started_idx ON public.tool_calls (started_at DESC);

ALTER TABLE public.tool_calls ENABLE ROW LEVEL SECURITY;
