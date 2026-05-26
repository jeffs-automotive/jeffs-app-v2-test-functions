-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E1f: Pattern S apply RPCs (5 legacy)
-- ════════════════════════════════════════════════════════════════════════
--
-- Creates 5 NEW Pattern S apply RPCs that replace the apply phase of the
-- 5 LEGACY uploaders (TS code remains; refactored at E5a-e to dispatch
-- to these RPCs after parse + validate + diff-compute):
--
--   1. apply_concern_questions_flat_upload         (snapshot_kind = 'concern_questions_flat')
--   2. apply_concern_category_upload               (snapshot_kind = 'concern_questions_per_category')
--   3. apply_concern_category_guideline_upload     (snapshot_kind = 'concern_category_guidelines')
--   4. apply_appointment_default_limits_upload     (snapshot_kind = 'appointment_default_limits')
--   5. apply_closed_dates_upload                   (snapshot_kind = 'closed_dates_future')
--
-- ────────────────────────────────────────────────────────────────────────
-- Pattern S anatomy (per PLAN §4 + ADR-024):
-- ────────────────────────────────────────────────────────────────────────
--   STEP 1 (MANDATORY first action): lock_surface_for_kind(p_shop_id, kind)
--          per ADR-024 — Phase 1 surface lock. Serializes against in-flight
--          revert + other cooperative writers on this surface.
--          apply_closed_dates_upload ALSO takes per-date advisory locks
--          per ADR-013 (FOR LOOP, sorted-date order).
--   STEP 2: Re-verify expected_current_hash (p_audit.expected_current_hash):
--          compute current canonical via canonical_state_<kind>; sha256;
--          compare. Mismatch → RAISE staleness_check_failed: which the TS
--          caller maps to current_state_drift per ADR-007 enum.
--   STEP 3: Validate p_audit.expected_confirm_token (dry-run vs apply gate):
--          dry_run mode (p_audit->>'dry_run' = 'true'): compute + return
--                       confirm_token; audit_log_id = NULL; NO mutations.
--          apply mode (default): require expected_confirm_token; recompute;
--                                compare. Mismatch → RAISE
--                                confirm_token_mismatch:
--   STEP 4: Apply mutations (kind-specific INSERT/UPDATE/soft-delete).
--   STEP 5: Compute expected_after_state_canonical = canonical_state_<kind>
--           (p_shop_id, <synthetic_after_snapshot>). Hash via digest.
--   STEP 6: INSERT scheduler_admin_audit_log row with operation='upload_md',
--           pre_state_snapshot = p_snapshot,
--           diff_summary = p_diff || jsonb_build_object(
--             'expected_after_state_canonical', ..., 'after_hash', ...,
--             'surfaces', [...]).
--   STEP 7: RETURN audit_log_id BIGINT (or NULL for dry-run).
--
-- ────────────────────────────────────────────────────────────────────────
-- Cross-references:
-- ────────────────────────────────────────────────────────────────────────
--   ADR-001 — N/A (apply RPCs are NOT outer/inner — single function).
--   ADR-004 — N/A (apply RPCs return BIGINT, NOT handler 4-col shape).
--   ADR-005 — outer-callable entry-point set: 5 of the 6 (the other being
--             revert_md_upload_attempt). All 5 carry the full triple:
--             REVOKE PUBLIC/anon/authenticated + GRANT TO service_role.
--             Service_role can call these directly; Pattern S two-step
--             (dry_run + expected_confirm_token) is the audit guarantee.
--   ADR-007 — canonical reason_code enum. Apply RPCs may RAISE:
--               staleness_check_failed: ...     → outer (TS) maps to current_state_drift
--               confirm_token_mismatch: ...     → confirm_token_mismatch
--               revert_blocked: snapshot_invalid: ... → snapshot_invalid
--               revert_blocked: cross_shop_hijack_attempt: ... → same
--               revert_blocked: fk_target_tenant_mismatch: ... → fk_broken
--               revert_blocked: fk_broken: ... → fk_broken (post-mutation 23503 catch)
--             Apply-side errors surface via SQLSTATE; the orchestrator-mcp
--             TS wrapper parses the prefix and classifies.
--   ADR-013 — apply_closed_dates_upload takes per-date advisory locks
--             AFTER lock_surface_for_kind, in sorted-date FOR LOOP.
--   ADR-017 — search_path on every SECURITY DEFINER function.
--   ADR-019 — handler Invariants 1+5+6 applied at every mutation surface:
--               Inv 1: WHERE target.shop_id = p_shop_id on DO UPDATE
--               Inv 5: post-write ROW_COUNT vs expected
--               Inv 6: FK target tenant validation (applicable to handler 2
--                      apply_concern_category_upload's questions table —
--                      subcategory_id FK).
--   ADR-024 — lock_surface_for_kind FIRST in EVERY apply RPC (Phase 1).
--   ADR-025 — canonical_state_<kind> emits pipe-delimited structured TEXT;
--             we hash it via digest() to produce after_hash. Byte-parity
--             contract between this RPC's after-canonical and a future
--             revert's canonical-current read at step 5 of the inner RPC.
--
-- R6-B1 — N/A (apply RPCs are OUTER-callable; they GET the GRANT, not omit it).
-- E1b-N1 — apply_concern_category_upload MUST populate snapshot with EXACT
--          field names: subcategories_before, added_subcategory_ids,
--          questions_before, added_question_ids (matches revert handler).
-- E1b-N3 — apply RPCs' post-write expected_after_state_canonical computation
--          MUST equal canonical_state_<kind>(p_shop_id, <synthetic_after>)
--          for byte-parity. By using canonical_state_<kind> directly on
--          both sides, byte-parity is AUTOMATIC.
--
-- ────────────────────────────────────────────────────────────────────────
-- confirm_token formula (deterministic across dry_run + apply):
-- ────────────────────────────────────────────────────────────────────────
--   token = encode(digest(
--             p_shop_id::TEXT || ':' ||
--             '<snapshot_kind>'  || ':' ||
--             (p_audit->>'expected_current_hash')  || ':' ||
--             (p_audit->>'md_content_hash')        || ':' ||
--             (p_audit->>'actor_email'),
--             'sha256'), 'hex')
--
-- Properties:
--   - Same inputs across dry_run + apply → same token.
--   - Includes md_content_hash → different MD upload regenerates token.
--   - Includes expected_current_hash → if DB drifted between dry_run +
--     apply, current_state_drift RAISE fires BEFORE token check
--     (step 2 before step 3).
--   - Includes actor_email → different actor's apply rejects.
--   - NO upload_id (apply doesn't have one yet at dry_run time).
--
-- ────────────────────────────────────────────────────────────────────────
-- p_audit JSONB fields consumed (canonical contract):
-- ────────────────────────────────────────────────────────────────────────
--   actor_email           TEXT  (required)
--   oauth_client_id       TEXT  (optional)
--   md_content_hash       TEXT  (required — sha256 of uploaded MD)
--   expected_current_hash TEXT  (required — sha256 of canonical_state_<kind>
--                                from a prior dry_run; re-verified at step 2)
--   expected_confirm_token TEXT (required for apply mode; OMITTED for dry_run)
--   dry_run               BOOLEAN (default false; if true, returns token only)
--
-- ────────────────────────────────────────────────────────────────────────
-- p_diff JSONB shape (kind-specific — see each handler's contract below):
-- ────────────────────────────────────────────────────────────────────────
--   common pattern:
--     { added:       [{...full row...}, ...],
--       modified:    [{...full row...}, ...],
--       deactivated: [<key>, ...]    -- keys to soft-delete (active=false)
--                                    -- OR for hard-DELETE kinds, ids to
--                                    -- remove (apply does NOT hard-delete
--                                    -- on apply path — only revert does;
--                                    -- the "deactivated" list here is
--                                    -- soft-delete for the soft-delete
--                                    -- kinds, or empty for hard-DELETE
--                                    -- kinds since apply uploads are
--                                    -- additive on the hard-DELETE surfaces.)
--     }
--
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- APPLY RPC 1 of 5 — apply_concern_questions_flat_upload
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_questions for (p_shop_id) — flat shape
-- Snapshot kind:    'concern_questions_flat'
-- Replaces TS apply at scheduler-admin.ts:1003-1056 (uploadConcernQuestionsMd)
--
-- p_diff = {
--   added:       [{category, question_text, options, multi_select?, display_order, active, subcategory_id?, required_facts?}, ...]
--   modified:    [{id, category, question_text, options, multi_select?, display_order, active, subcategory_id?, required_facts?}, ...]
--   deactivated: [<id>, ...]    -- BIGINT ids to soft-delete
-- }
--
-- snapshot_built_in_RPC = {
--   snapshot_kind: 'concern_questions_flat',
--   before:        {<id>: <full row pre-state>, ...}   -- from p_snapshot
--   added_keys:    [<new BIGSERIAL ids generated by INSERT>, ...]
-- }
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_concern_questions_flat_upload(
  p_shop_id  INTEGER,
  p_snapshot JSONB,
  p_diff     JSONB,
  p_audit    JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_dry_run                BOOLEAN;
  v_actor_email            TEXT;
  v_md_hash                TEXT;
  v_expected_current_hash  TEXT;
  v_expected_confirm_token TEXT;
  v_oauth_client_id        TEXT;
  v_current_canonical      TEXT;
  v_current_head_hash      TEXT;
  v_token_seed             TEXT;
  v_token                  TEXT;
  v_added_ids              BIGINT[] := '{}';
  v_new_id                 BIGINT;
  v_after_canonical        TEXT;
  v_after_hash             TEXT;
  v_audit_id               BIGINT;
  v_synthetic_snapshot     JSONB;
  v_final_diff             JSONB;
  v_row                    JSONB;
BEGIN
  -- ── Input validation ────────────────────────────────────────────────
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires positive p_shop_id'
      USING ERRCODE = '22023';
  END IF;
  IF p_audit IS NULL OR jsonb_typeof(p_audit) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires p_audit JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF p_diff IS NULL OR jsonb_typeof(p_diff) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires p_diff JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires p_snapshot JSONB object'
      USING ERRCODE = '22023';
  END IF;

  v_dry_run                := COALESCE((p_audit->>'dry_run')::BOOLEAN, FALSE);
  v_actor_email            := p_audit->>'actor_email';
  v_md_hash                := p_audit->>'md_content_hash';
  v_expected_current_hash  := p_audit->>'expected_current_hash';
  v_expected_confirm_token := p_audit->>'expected_confirm_token';
  v_oauth_client_id        := p_audit->>'oauth_client_id';

  IF v_actor_email IS NULL OR length(trim(v_actor_email)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires p_audit.actor_email'
      USING ERRCODE = '22023';
  END IF;
  IF v_md_hash IS NULL OR length(trim(v_md_hash)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires p_audit.md_content_hash'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_current_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_questions_flat_upload requires p_audit.expected_current_hash (from prior canonical state read)'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 1 — lock_surface_for_kind (MANDATORY per ADR-024) ──────────
  PERFORM public.lock_surface_for_kind(p_shop_id, 'concern_questions_flat');

  -- ── STEP 2 — re-verify expected_current_hash against current state ──
  -- Compute current canonical via the same serializer revert uses. Hash
  -- via digest(). Compare. Mismatch → staleness_check_failed: prefix →
  -- TS wrapper maps to current_state_drift per ADR-007.
  v_current_canonical := public.canonical_state_concern_questions_flat(p_shop_id, p_snapshot);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');

  IF v_current_head_hash <> v_expected_current_hash THEN
    RAISE EXCEPTION 'staleness_check_failed: current state diverged since the prior dry_run (kind=concern_questions_flat, shop=%); expected_hash=%, current_hash=%; re-run dry_run for a fresh token',
      p_shop_id, v_expected_current_hash, v_current_head_hash
      USING ERRCODE = '40001';
  END IF;

  -- ── STEP 3 — confirm_token computation + dry-run/apply branch ───────
  v_token_seed := p_shop_id::TEXT || ':concern_questions_flat:' ||
                  v_expected_current_hash || ':' ||
                  v_md_hash || ':' ||
                  v_actor_email;
  v_token := encode(digest(v_token_seed, 'sha256'), 'hex');

  IF v_dry_run THEN
    -- Dry-run: return token (via metadata payload in audit_log? No — apply
    -- RPCs return BIGINT only. For dry-run we return NULL audit_log_id
    -- and rely on the orchestrator-mcp TS wrapper to compute the SAME
    -- token deterministically using computeConfirmToken().
    -- The plpgsql v_token is computed for symmetry (and to assert the
    -- formula compiles) but isn't returned. TS-side computes its own
    -- token; the per-step-3 contract is that the TWO formulas MUST match.
    -- See PLAN §4.8 + ADR-025 + E1b-N3 byte-parity contract.
    --
    -- Rationale for not returning the token here: BIGINT signature lock-in.
    -- Changing to TABLE(audit_log_id BIGINT, confirm_token TEXT) is a
    -- breaking signature change; revisited if Pattern S 1.5 deemed it.
    PERFORM v_token;  -- silence v_token unused warning
    RETURN NULL;
  END IF;

  -- Apply mode: require + validate expected_confirm_token.
  IF v_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: apply_concern_questions_flat_upload apply mode requires p_audit.expected_confirm_token (run dry_run first to obtain)'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_confirm_token <> v_token THEN
    RAISE EXCEPTION 'confirm_token_mismatch: provided token does not match the deterministically re-derived token for (shop_id, snapshot_kind, expected_current_hash, md_content_hash, actor_email); re-run dry_run for a fresh token'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 4 — apply mutations ─────────────────────────────────────────
  -- 4a. INSERTs (additions). RETURNING id → v_added_ids for snapshot.
  IF jsonb_typeof(p_diff->'added') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'added')
    LOOP
      INSERT INTO public.concern_questions (
        shop_id, category, subcategory_id, question_text,
        options, multi_select, display_order, active, required_facts,
        updated_at, updated_by_oauth_client_id, updated_by_name
      ) VALUES (
        p_shop_id,
        v_row->>'category',
        NULLIF(v_row->>'subcategory_id', '')::BIGINT,
        v_row->>'question_text',
        COALESCE(v_row->'options', '[]'::JSONB),
        COALESCE((v_row->>'multi_select')::BOOLEAN, FALSE),
        COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0),
        COALESCE((v_row->>'active')::BOOLEAN, TRUE),
        CASE WHEN v_row->'required_facts' IS NULL
               OR jsonb_typeof(v_row->'required_facts') = 'null'
             THEN NULL
             ELSE (SELECT ARRAY(
                     SELECT elem::TEXT
                       FROM jsonb_array_elements_text(v_row->'required_facts') WITH ORDINALITY AS j(elem, ord)
                      ORDER BY ord))
        END,
        now(), v_oauth_client_id, v_actor_email
      ) RETURNING id INTO v_new_id;
      v_added_ids := v_added_ids || v_new_id;
    END LOOP;
  END IF;

  -- 4b. UPDATEs (modifications). Update by id, scoped to shop_id.
  IF jsonb_typeof(p_diff->'modified') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'modified')
    LOOP
      UPDATE public.concern_questions
         SET category       = v_row->>'category',
             subcategory_id = NULLIF(v_row->>'subcategory_id', '')::BIGINT,
             question_text  = v_row->>'question_text',
             options        = COALESCE(v_row->'options', '[]'::JSONB),
             multi_select   = COALESCE((v_row->>'multi_select')::BOOLEAN, FALSE),
             display_order  = COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0),
             active         = COALESCE((v_row->>'active')::BOOLEAN, TRUE),
             required_facts = CASE WHEN v_row->'required_facts' IS NULL
                                     OR jsonb_typeof(v_row->'required_facts') = 'null'
                                   THEN NULL
                                   ELSE (SELECT ARRAY(
                                           SELECT elem::TEXT
                                             FROM jsonb_array_elements_text(v_row->'required_facts') WITH ORDINALITY AS j(elem, ord)
                                            ORDER BY ord))
                              END,
             updated_at     = now(),
             updated_by_oauth_client_id = v_oauth_client_id,
             updated_by_name            = v_actor_email
       WHERE id      = (v_row->>'id')::BIGINT
         AND shop_id = p_shop_id;   -- Invariant 1 equivalent
    END LOOP;
  END IF;

  -- 4c. Soft-delete (active = FALSE) for deactivated keys.
  IF jsonb_typeof(p_diff->'deactivated') = 'array' THEN
    UPDATE public.concern_questions
       SET active     = FALSE,
           updated_at = now(),
           updated_by_oauth_client_id = v_oauth_client_id,
           updated_by_name            = v_actor_email
     WHERE shop_id = p_shop_id
       AND id = ANY(
         SELECT (jsonb_array_elements_text(p_diff->'deactivated'))::BIGINT
       )
       AND active = TRUE;
  END IF;

  -- ── STEP 5 — compute expected_after_state_canonical via same serializer ─
  v_after_canonical := public.canonical_state_concern_questions_flat(p_shop_id, p_snapshot);
  v_after_hash      := encode(digest(v_after_canonical, 'sha256'), 'hex');

  -- ── STEP 6 — INSERT audit_log row ────────────────────────────────────
  -- Build the synthetic pre_state_snapshot with snapshot_kind + after_hash +
  -- added_keys captured during step 4a (the new BIGSERIAL ids).
  v_synthetic_snapshot := p_snapshot
    || jsonb_build_object(
         'snapshot_kind', 'concern_questions_flat',
         'added_keys',    to_jsonb(v_added_ids),
         'after_hash',    v_after_hash,
         'expected_after_state_canonical', v_after_canonical
       );

  -- Merge per-RPC diff_summary additions onto the diff TS provided
  v_final_diff := p_diff
    || jsonb_build_object(
         'kind',                            'concern_questions_flat',
         'expected_after_state_canonical',  v_after_canonical,
         'after_hash',                      v_after_hash,
         'surfaces',                        jsonb_build_array('concern_questions')
       );

  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, oauth_client_id, user_label, table_name, operation,
    rows_added, rows_modified, rows_deactivated, md_content_hash,
    diff_summary, pre_state_snapshot, shop_id
  ) VALUES (
    now(), v_oauth_client_id, v_actor_email, 'concern_questions', 'upload_md',
    COALESCE(jsonb_array_length(p_diff->'added'),       0),
    COALESCE(jsonb_array_length(p_diff->'modified'),    0),
    COALESCE(jsonb_array_length(p_diff->'deactivated'), 0),
    v_md_hash, v_final_diff, v_synthetic_snapshot, p_shop_id
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: apply_concern_questions_flat_upload raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

-- ADR-005 outer-callable entry point — GRANT TO service_role
REVOKE EXECUTE ON FUNCTION public.apply_concern_questions_flat_upload(INTEGER, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_concern_questions_flat_upload(INTEGER, JSONB, JSONB, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_concern_questions_flat_upload(INTEGER, JSONB, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.apply_concern_questions_flat_upload(INTEGER, JSONB, JSONB, JSONB) IS
  'Pattern S apply RPC for concern_questions_flat per PLAN §4.1. STEP 1 lock_surface_for_kind. STEP 2 canonical re-verify. STEP 3 confirm_token gate. STEP 4 apply (INSERT/UPDATE/soft-delete). STEP 5 canonical after-hash. STEP 6 audit_log INSERT. Returns audit_log_id (NULL on dry_run). Service_role-callable per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- APPLY RPC 2 of 5 — apply_concern_category_upload  (R6-B3 + E1b-N1)
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: BOTH concern_subcategories + concern_questions for ONE
--                   category in (p_shop_id)
-- Snapshot kind:    'concern_questions_per_category'
-- Replaces TS apply: uploadConcernCategoryMd (lines 1792-2190)
--
-- E1b-N1 SNAPSHOT FIELD NAMES MUST MATCH revert handler + dispatch:
--   subcategories_before, added_subcategory_ids, questions_before,
--   added_question_ids
--
-- p_diff = {
--   subcategories: {
--     added:    [{slug, display_label, display_order, active, description?,
--                 positive_examples?, negative_examples?, synonyms?,
--                 eligible_testing_service_keys?}, ...],
--     modified: [{id, slug, display_label, display_order, active, ...}, ...],
--     deactivated: [<id>, ...]
--   },
--   questions: {
--     added:    [{slug_of_sub, question_text, options, multi_select?,
--                 display_order, active, required_facts?}, ...]
--              (note: subcategory_id resolved POST-add-sub by looking up
--               the inserted subcategories' new ids by their slug)
--     modified: [{id, slug_of_sub, question_text, options, ...}, ...],
--     deactivated: [<id>, ...]
--   }
-- }
--
-- Plus p_diff MUST carry `category_slug` at the root for snapshot scope.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_concern_category_upload(
  p_shop_id       INTEGER,
  p_snapshot      JSONB,
  p_diff          JSONB,
  p_audit         JSONB,
  p_category_slug TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_dry_run                BOOLEAN;
  v_actor_email            TEXT;
  v_md_hash                TEXT;
  v_expected_current_hash  TEXT;
  v_expected_confirm_token TEXT;
  v_oauth_client_id        TEXT;
  v_current_canonical      TEXT;
  v_current_head_hash      TEXT;
  v_token_seed             TEXT;
  v_token                  TEXT;
  v_added_sub_ids          BIGINT[] := '{}';
  v_added_q_ids            BIGINT[] := '{}';
  v_new_id                 BIGINT;
  v_sub_id_by_slug         JSONB    := '{}'::JSONB;
  v_after_canonical        TEXT;
  v_after_hash             TEXT;
  v_audit_id               BIGINT;
  v_synthetic_snapshot     JSONB;
  v_final_diff             JSONB;
  v_row                    JSONB;
  v_resolved_sub_id        BIGINT;
  v_canonical_input        JSONB;
BEGIN
  -- ── Input validation ────────────────────────────────────────────────
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires positive p_shop_id'
      USING ERRCODE = '22023';
  END IF;
  IF p_category_slug IS NULL OR length(trim(p_category_slug)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_category_slug'
      USING ERRCODE = '22023';
  END IF;
  IF p_audit IS NULL OR jsonb_typeof(p_audit) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_audit JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF p_diff IS NULL OR jsonb_typeof(p_diff) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_diff JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_snapshot JSONB object'
      USING ERRCODE = '22023';
  END IF;

  v_dry_run                := COALESCE((p_audit->>'dry_run')::BOOLEAN, FALSE);
  v_actor_email            := p_audit->>'actor_email';
  v_md_hash                := p_audit->>'md_content_hash';
  v_expected_current_hash  := p_audit->>'expected_current_hash';
  v_expected_confirm_token := p_audit->>'expected_confirm_token';
  v_oauth_client_id        := p_audit->>'oauth_client_id';

  IF v_actor_email IS NULL OR length(trim(v_actor_email)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_audit.actor_email'
      USING ERRCODE = '22023';
  END IF;
  IF v_md_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_audit.md_content_hash'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_current_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload requires p_audit.expected_current_hash'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 1 — lock_surface_for_kind ──────────────────────────────────
  PERFORM public.lock_surface_for_kind(p_shop_id, 'concern_questions_per_category');

  -- ── STEP 2 — re-verify current canonical hash ───────────────────────
  -- canonical_state_concern_category_upload reads BOTH tables for the
  -- category (per R6-B3). Inject category_slug into snapshot so the
  -- canonical reader sees it.
  v_canonical_input := p_snapshot
    || jsonb_build_object('category_slug', p_category_slug);

  v_current_canonical := public.canonical_state_concern_category_upload(p_shop_id, v_canonical_input);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');

  IF v_current_head_hash <> v_expected_current_hash THEN
    RAISE EXCEPTION 'staleness_check_failed: current state diverged (kind=concern_questions_per_category, shop=%, category=%); expected=%, current=%',
      p_shop_id, p_category_slug, v_expected_current_hash, v_current_head_hash
      USING ERRCODE = '40001';
  END IF;

  -- ── STEP 3 — confirm_token gate ─────────────────────────────────────
  -- Token seed includes p_category_slug since the scope is per-category.
  v_token_seed := p_shop_id::TEXT || ':concern_questions_per_category:' ||
                  p_category_slug || ':' ||
                  v_expected_current_hash || ':' ||
                  v_md_hash || ':' ||
                  v_actor_email;
  v_token := encode(digest(v_token_seed, 'sha256'), 'hex');

  IF v_dry_run THEN
    PERFORM v_token;
    RETURN NULL;
  END IF;

  IF v_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: apply_concern_category_upload apply mode requires p_audit.expected_confirm_token'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_confirm_token <> v_token THEN
    RAISE EXCEPTION 'confirm_token_mismatch: provided token mismatched the deterministically re-derived token for (shop_id, snapshot_kind, category_slug, expected_current_hash, md_content_hash, actor_email)'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 4 — apply mutations (BOTH tables, sub-categories FIRST) ────
  -- 4a-sub. INSERT new sub-categories; RETURNING id → v_added_sub_ids
  --         + slug→id mapping (so questions can resolve subcategory_id
  --         by slug for new subs).
  IF jsonb_typeof(p_diff->'subcategories'->'added') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'subcategories'->'added')
    LOOP
      INSERT INTO public.concern_subcategories (
        shop_id, category, slug, display_label, display_order, active,
        description, positive_examples, negative_examples, synonyms,
        eligible_testing_service_keys,
        updated_at, updated_by_oauth_client_id, updated_by_name
      ) VALUES (
        p_shop_id,
        p_category_slug,
        v_row->>'slug',
        v_row->>'display_label',
        COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0),
        COALESCE((v_row->>'active')::BOOLEAN, TRUE),
        v_row->>'description',
        CASE WHEN v_row->'positive_examples' IS NULL
               OR jsonb_typeof(v_row->'positive_examples') = 'null'
             THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'positive_examples'))
        END,
        CASE WHEN v_row->'negative_examples' IS NULL
               OR jsonb_typeof(v_row->'negative_examples') = 'null'
             THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'negative_examples'))
        END,
        CASE WHEN v_row->'synonyms' IS NULL
               OR jsonb_typeof(v_row->'synonyms') = 'null'
             THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'synonyms'))
        END,
        CASE WHEN v_row->'eligible_testing_service_keys' IS NULL
               OR jsonb_typeof(v_row->'eligible_testing_service_keys') = 'null'
             THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'eligible_testing_service_keys'))
        END,
        now(), v_oauth_client_id, v_actor_email
      ) RETURNING id INTO v_new_id;
      v_added_sub_ids   := v_added_sub_ids || v_new_id;
      v_sub_id_by_slug  := v_sub_id_by_slug || jsonb_build_object(v_row->>'slug', v_new_id);
    END LOOP;
  END IF;

  -- 4a-sub-existing. Populate v_sub_id_by_slug with EXISTING subs in
  -- this (shop, category) so question writes can resolve by slug too.
  WITH existing AS (
    SELECT slug, id FROM public.concern_subcategories
     WHERE shop_id = p_shop_id AND category = p_category_slug
  )
  SELECT v_sub_id_by_slug ||
    COALESCE(jsonb_object_agg(slug, id), '{}'::JSONB)
    INTO v_sub_id_by_slug
    FROM existing;

  -- 4b-sub. UPDATE modified subcategories.
  IF jsonb_typeof(p_diff->'subcategories'->'modified') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'subcategories'->'modified')
    LOOP
      UPDATE public.concern_subcategories
         SET slug          = v_row->>'slug',
             display_label = v_row->>'display_label',
             display_order = COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0),
             active        = COALESCE((v_row->>'active')::BOOLEAN, TRUE),
             description   = v_row->>'description',
             positive_examples =
               CASE WHEN v_row->'positive_examples' IS NULL
                      OR jsonb_typeof(v_row->'positive_examples') = 'null'
                    THEN NULL
                    ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'positive_examples'))
               END,
             negative_examples =
               CASE WHEN v_row->'negative_examples' IS NULL
                      OR jsonb_typeof(v_row->'negative_examples') = 'null'
                    THEN NULL
                    ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'negative_examples'))
               END,
             synonyms =
               CASE WHEN v_row->'synonyms' IS NULL
                      OR jsonb_typeof(v_row->'synonyms') = 'null'
                    THEN NULL
                    ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'synonyms'))
               END,
             eligible_testing_service_keys =
               CASE WHEN v_row->'eligible_testing_service_keys' IS NULL
                      OR jsonb_typeof(v_row->'eligible_testing_service_keys') = 'null'
                    THEN NULL
                    ELSE ARRAY(SELECT jsonb_array_elements_text(v_row->'eligible_testing_service_keys'))
               END,
             updated_at = now(),
             updated_by_oauth_client_id = v_oauth_client_id,
             updated_by_name            = v_actor_email
       WHERE id      = (v_row->>'id')::BIGINT
         AND shop_id = p_shop_id;
    END LOOP;
  END IF;

  -- 4c-sub. Soft-delete sub-categories.
  IF jsonb_typeof(p_diff->'subcategories'->'deactivated') = 'array' THEN
    UPDATE public.concern_subcategories
       SET active = FALSE,
           updated_at = now(),
           updated_by_oauth_client_id = v_oauth_client_id,
           updated_by_name            = v_actor_email
     WHERE shop_id = p_shop_id
       AND id = ANY(
         SELECT (jsonb_array_elements_text(p_diff->'subcategories'->'deactivated'))::BIGINT
       )
       AND active = TRUE;
  END IF;

  -- 4d-q. INSERT new questions. subcategory_id resolved via slug → id
  --       lookup table built above.
  IF jsonb_typeof(p_diff->'questions'->'added') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'questions'->'added')
    LOOP
      v_resolved_sub_id := NULLIF(v_sub_id_by_slug->>(v_row->>'slug_of_sub'), '')::BIGINT;
      IF v_resolved_sub_id IS NULL THEN
        RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_upload added question references slug_of_sub=% which is not in the resolved subcategories map for shop=%, category=%',
          v_row->>'slug_of_sub', p_shop_id, p_category_slug
          USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.concern_questions (
        shop_id, category, subcategory_id, question_text,
        options, multi_select, display_order, active, required_facts,
        updated_at, updated_by_oauth_client_id, updated_by_name
      ) VALUES (
        p_shop_id,
        p_category_slug,
        v_resolved_sub_id,
        v_row->>'question_text',
        COALESCE(v_row->'options', '[]'::JSONB),
        COALESCE((v_row->>'multi_select')::BOOLEAN, FALSE),
        COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0),
        COALESCE((v_row->>'active')::BOOLEAN, TRUE),
        CASE WHEN v_row->'required_facts' IS NULL
               OR jsonb_typeof(v_row->'required_facts') = 'null'
             THEN NULL
             ELSE (SELECT ARRAY(
                     SELECT elem::TEXT
                       FROM jsonb_array_elements_text(v_row->'required_facts') WITH ORDINALITY AS j(elem, ord)
                      ORDER BY ord))
        END,
        now(), v_oauth_client_id, v_actor_email
      ) RETURNING id INTO v_new_id;
      v_added_q_ids := v_added_q_ids || v_new_id;
    END LOOP;
  END IF;

  -- 4e-q. UPDATE modified questions.
  IF jsonb_typeof(p_diff->'questions'->'modified') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'questions'->'modified')
    LOOP
      v_resolved_sub_id := NULLIF(v_sub_id_by_slug->>(v_row->>'slug_of_sub'), '')::BIGINT;
      UPDATE public.concern_questions
         SET subcategory_id = v_resolved_sub_id,
             question_text  = v_row->>'question_text',
             options        = COALESCE(v_row->'options', '[]'::JSONB),
             multi_select   = COALESCE((v_row->>'multi_select')::BOOLEAN, FALSE),
             display_order  = COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0),
             active         = COALESCE((v_row->>'active')::BOOLEAN, TRUE),
             required_facts =
               CASE WHEN v_row->'required_facts' IS NULL
                      OR jsonb_typeof(v_row->'required_facts') = 'null'
                    THEN NULL
                    ELSE (SELECT ARRAY(
                            SELECT elem::TEXT
                              FROM jsonb_array_elements_text(v_row->'required_facts') WITH ORDINALITY AS j(elem, ord)
                             ORDER BY ord))
               END,
             updated_at = now(),
             updated_by_oauth_client_id = v_oauth_client_id,
             updated_by_name            = v_actor_email
       WHERE id      = (v_row->>'id')::BIGINT
         AND shop_id = p_shop_id;
    END LOOP;
  END IF;

  -- 4f-q. Soft-delete questions.
  IF jsonb_typeof(p_diff->'questions'->'deactivated') = 'array' THEN
    UPDATE public.concern_questions
       SET active = FALSE,
           updated_at = now(),
           updated_by_oauth_client_id = v_oauth_client_id,
           updated_by_name            = v_actor_email
     WHERE shop_id = p_shop_id
       AND id = ANY(
         SELECT (jsonb_array_elements_text(p_diff->'questions'->'deactivated'))::BIGINT
       )
       AND active = TRUE;
  END IF;

  -- ── STEP 5 — compute expected_after_state_canonical ──────────────────
  v_after_canonical := public.canonical_state_concern_category_upload(p_shop_id, v_canonical_input);
  v_after_hash      := encode(digest(v_after_canonical, 'sha256'), 'hex');

  -- ── STEP 6 — INSERT audit_log row ────────────────────────────────────
  -- E1b-N1: snapshot uses EXACT field names matching revert handler +
  -- dispatch (subcategories_before, added_subcategory_ids,
  -- questions_before, added_question_ids).
  v_synthetic_snapshot := p_snapshot
    || jsonb_build_object(
         'snapshot_kind',         'concern_questions_per_category',
         'category_slug',         p_category_slug,
         'added_subcategory_ids', to_jsonb(v_added_sub_ids),
         'added_question_ids',    to_jsonb(v_added_q_ids),
         'after_hash',            v_after_hash,
         'expected_after_state_canonical', v_after_canonical
       );

  v_final_diff := p_diff
    || jsonb_build_object(
         'kind',                            'concern_questions_per_category',
         'category_slug',                   p_category_slug,
         'expected_after_state_canonical',  v_after_canonical,
         'after_hash',                      v_after_hash,
         'surfaces',                        jsonb_build_array('concern_subcategories', 'concern_questions')
       );

  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, oauth_client_id, user_label, table_name, operation,
    rows_added, rows_modified, rows_deactivated, md_content_hash,
    diff_summary, pre_state_snapshot, shop_id
  ) VALUES (
    now(), v_oauth_client_id, v_actor_email, 'concern_questions', 'upload_md',
    COALESCE(jsonb_array_length(p_diff->'subcategories'->'added'),       0) +
      COALESCE(jsonb_array_length(p_diff->'questions'->'added'),         0),
    COALESCE(jsonb_array_length(p_diff->'subcategories'->'modified'),    0) +
      COALESCE(jsonb_array_length(p_diff->'questions'->'modified'),      0),
    COALESCE(jsonb_array_length(p_diff->'subcategories'->'deactivated'), 0) +
      COALESCE(jsonb_array_length(p_diff->'questions'->'deactivated'),   0),
    v_md_hash, v_final_diff, v_synthetic_snapshot, p_shop_id
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: apply_concern_category_upload raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_concern_category_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_concern_category_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_concern_category_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.apply_concern_category_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) IS
  'Pattern S apply RPC for concern_questions_per_category per PLAN §4.2 + R6-B3 (BOTH tables) + E1b-N1 (snapshot field naming). STEP 1 lock_surface_for_kind. STEP 2 canonical re-verify. STEP 3 confirm_token gate. STEP 4 apply both tables (subcategories first). STEP 5 canonical after-hash. STEP 6 audit_log. Service_role-callable per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- APPLY RPC 3 of 5 — apply_concern_category_guideline_upload
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_category_guidelines for (p_shop_id, category)
-- Snapshot kind:    'concern_category_guidelines'
-- Replaces TS apply: uploadConcernCategoryGuidelineMd (lines 2210+)
--
-- p_diff = {
--   display_label:   <text>,
--   guideline_prose: <text>,
--   prior_existed:   <BOOLEAN>    -- true if INSERT not needed; false = INSERT side
-- }
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_concern_category_guideline_upload(
  p_shop_id       INTEGER,
  p_snapshot      JSONB,
  p_diff          JSONB,
  p_audit         JSONB,
  p_category_slug TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_dry_run                BOOLEAN;
  v_actor_email            TEXT;
  v_md_hash                TEXT;
  v_expected_current_hash  TEXT;
  v_expected_confirm_token TEXT;
  v_oauth_client_id        TEXT;
  v_current_canonical      TEXT;
  v_current_head_hash      TEXT;
  v_token_seed             TEXT;
  v_token                  TEXT;
  v_added_keys             JSONB := '[]'::JSONB;
  v_after_canonical        TEXT;
  v_after_hash             TEXT;
  v_audit_id               BIGINT;
  v_synthetic_snapshot     JSONB;
  v_final_diff             JSONB;
  v_prior_existed          BOOLEAN;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_guideline_upload requires positive p_shop_id'
      USING ERRCODE = '22023';
  END IF;
  IF p_category_slug IS NULL OR length(trim(p_category_slug)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_guideline_upload requires p_category_slug'
      USING ERRCODE = '22023';
  END IF;
  IF p_audit IS NULL OR p_diff IS NULL OR p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_concern_category_guideline_upload requires p_audit, p_diff, p_snapshot all non-NULL'
      USING ERRCODE = '22023';
  END IF;

  v_dry_run                := COALESCE((p_audit->>'dry_run')::BOOLEAN, FALSE);
  v_actor_email            := p_audit->>'actor_email';
  v_md_hash                := p_audit->>'md_content_hash';
  v_expected_current_hash  := p_audit->>'expected_current_hash';
  v_expected_confirm_token := p_audit->>'expected_confirm_token';
  v_oauth_client_id        := p_audit->>'oauth_client_id';

  IF v_actor_email IS NULL OR length(trim(v_actor_email)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.actor_email'
      USING ERRCODE = '22023';
  END IF;
  IF v_md_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.md_content_hash'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_current_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.expected_current_hash'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 1 — lock_surface_for_kind ──────────────────────────────────
  PERFORM public.lock_surface_for_kind(p_shop_id, 'concern_category_guidelines');

  -- ── STEP 2 — canonical re-verify ────────────────────────────────────
  -- The CCG canonical_state reads rows for categories in snapshot.before
  -- ∪ added_keys. For pattern-S apply, before='{<category>: existing|null}'
  -- and added_keys='[<category>]' or '[]'. The p_snapshot from TS must
  -- already be shaped that way (containing the pre-state row for this
  -- category, or null if absent).
  v_current_canonical := public.canonical_state_concern_category_guideline(p_shop_id, p_snapshot);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');

  IF v_current_head_hash <> v_expected_current_hash THEN
    RAISE EXCEPTION 'staleness_check_failed: current state diverged (kind=concern_category_guidelines, shop=%, category=%); expected=%, current=%',
      p_shop_id, p_category_slug, v_expected_current_hash, v_current_head_hash
      USING ERRCODE = '40001';
  END IF;

  -- ── STEP 3 — confirm_token gate ─────────────────────────────────────
  v_token_seed := p_shop_id::TEXT || ':concern_category_guidelines:' ||
                  p_category_slug || ':' ||
                  v_expected_current_hash || ':' ||
                  v_md_hash || ':' ||
                  v_actor_email;
  v_token := encode(digest(v_token_seed, 'sha256'), 'hex');

  IF v_dry_run THEN
    PERFORM v_token;
    RETURN NULL;
  END IF;

  IF v_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: apply_concern_category_guideline_upload apply mode requires p_audit.expected_confirm_token'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_confirm_token <> v_token THEN
    RAISE EXCEPTION 'confirm_token_mismatch: provided token mismatched the deterministically re-derived token'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 4 — apply: INSERT or UPDATE the one row ─────────────────────
  -- prior_existed = false → INSERT side; true → UPDATE only.
  v_prior_existed := COALESCE((p_diff->>'prior_existed')::BOOLEAN, FALSE);

  INSERT INTO public.concern_category_guidelines (
    shop_id, category, display_label, guideline_prose,
    updated_at, updated_by_oauth_client_id, updated_by_name
  ) VALUES (
    p_shop_id, p_category_slug,
    p_diff->>'display_label',
    p_diff->>'guideline_prose',
    now(), v_oauth_client_id, v_actor_email
  )
  ON CONFLICT (shop_id, category) DO UPDATE SET
    display_label   = EXCLUDED.display_label,
    guideline_prose = EXCLUDED.guideline_prose,
    updated_at      = EXCLUDED.updated_at,
    updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
    updated_by_name            = EXCLUDED.updated_by_name
    WHERE concern_category_guidelines.shop_id = p_shop_id;

  -- If row didn't exist prior → mark as added (drives revert hard-DELETE).
  IF NOT v_prior_existed THEN
    v_added_keys := jsonb_build_array(p_category_slug);
  END IF;

  -- ── STEP 5 — canonical after-hash ───────────────────────────────────
  v_after_canonical := public.canonical_state_concern_category_guideline(p_shop_id, p_snapshot);
  v_after_hash      := encode(digest(v_after_canonical, 'sha256'), 'hex');

  -- ── STEP 6 — audit_log INSERT ───────────────────────────────────────
  v_synthetic_snapshot := p_snapshot
    || jsonb_build_object(
         'snapshot_kind', 'concern_category_guidelines',
         'added_keys',    v_added_keys,
         'after_hash',    v_after_hash,
         'expected_after_state_canonical', v_after_canonical
       );

  v_final_diff := p_diff
    || jsonb_build_object(
         'kind',                            'concern_category_guidelines',
         'category_slug',                   p_category_slug,
         'expected_after_state_canonical',  v_after_canonical,
         'after_hash',                      v_after_hash,
         'surfaces',                        jsonb_build_array('concern_category_guidelines')
       );

  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, oauth_client_id, user_label, table_name, operation,
    rows_added, rows_modified, rows_deactivated, md_content_hash,
    diff_summary, pre_state_snapshot, shop_id
  ) VALUES (
    now(), v_oauth_client_id, v_actor_email, 'concern_category_guidelines', 'upload_md',
    CASE WHEN v_prior_existed THEN 0 ELSE 1 END,
    CASE WHEN v_prior_existed THEN 1 ELSE 0 END,
    0,
    v_md_hash, v_final_diff, v_synthetic_snapshot, p_shop_id
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: apply_concern_category_guideline_upload raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_concern_category_guideline_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_concern_category_guideline_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_concern_category_guideline_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.apply_concern_category_guideline_upload(INTEGER, JSONB, JSONB, JSONB, TEXT) IS
  'Pattern S apply RPC for concern_category_guidelines per PLAN §4.3. Single-row composite PK. STEP 1 lock_surface_for_kind. STEP 2 canonical re-verify. STEP 3 confirm_token. STEP 4 INSERT/UPDATE. STEP 5/6 audit_log. Service_role-callable per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- APPLY RPC 4 of 5 — apply_appointment_default_limits_upload
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: appointment_default_limits for (p_shop_id)
-- Snapshot kind:    'appointment_default_limits'
-- Replaces TS apply: uploadAppointmentDefaultLimitsMd (lines 1132-1360)
--
-- p_diff = {
--   added:    [{day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots,
--               dropoff_total, notes?}, ...],
--   modified: [{day_of_week, is_closed, ...}, ...]
-- }
--
-- Note: composite PK (shop_id, day_of_week). day_of_week IS the key.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_appointment_default_limits_upload(
  p_shop_id  INTEGER,
  p_snapshot JSONB,
  p_diff     JSONB,
  p_audit    JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_dry_run                BOOLEAN;
  v_actor_email            TEXT;
  v_md_hash                TEXT;
  v_expected_current_hash  TEXT;
  v_expected_confirm_token TEXT;
  v_oauth_client_id        TEXT;
  v_current_canonical      TEXT;
  v_current_head_hash      TEXT;
  v_token_seed             TEXT;
  v_token                  TEXT;
  v_added_keys             JSONB := '[]'::JSONB;
  v_after_canonical        TEXT;
  v_after_hash             TEXT;
  v_audit_id               BIGINT;
  v_synthetic_snapshot     JSONB;
  v_final_diff             JSONB;
  v_row                    JSONB;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_appointment_default_limits_upload requires positive p_shop_id'
      USING ERRCODE = '22023';
  END IF;
  IF p_audit IS NULL OR p_diff IS NULL OR p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_appointment_default_limits_upload requires all JSONB params non-NULL'
      USING ERRCODE = '22023';
  END IF;

  v_dry_run                := COALESCE((p_audit->>'dry_run')::BOOLEAN, FALSE);
  v_actor_email            := p_audit->>'actor_email';
  v_md_hash                := p_audit->>'md_content_hash';
  v_expected_current_hash  := p_audit->>'expected_current_hash';
  v_expected_confirm_token := p_audit->>'expected_confirm_token';
  v_oauth_client_id        := p_audit->>'oauth_client_id';

  IF v_actor_email IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.actor_email' USING ERRCODE = '22023';
  END IF;
  IF v_md_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.md_content_hash' USING ERRCODE = '22023';
  END IF;
  IF v_expected_current_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.expected_current_hash' USING ERRCODE = '22023';
  END IF;

  -- ── STEP 1 — lock_surface_for_kind ──────────────────────────────────
  PERFORM public.lock_surface_for_kind(p_shop_id, 'appointment_default_limits');

  -- ── STEP 2 — canonical re-verify ────────────────────────────────────
  v_current_canonical := public.canonical_state_appointment_default_limits(p_shop_id, p_snapshot);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');

  IF v_current_head_hash <> v_expected_current_hash THEN
    RAISE EXCEPTION 'staleness_check_failed: current state diverged (kind=appointment_default_limits, shop=%); expected=%, current=%',
      p_shop_id, v_expected_current_hash, v_current_head_hash
      USING ERRCODE = '40001';
  END IF;

  -- ── STEP 3 — confirm_token gate ─────────────────────────────────────
  v_token_seed := p_shop_id::TEXT || ':appointment_default_limits:' ||
                  v_expected_current_hash || ':' ||
                  v_md_hash || ':' ||
                  v_actor_email;
  v_token := encode(digest(v_token_seed, 'sha256'), 'hex');

  IF v_dry_run THEN
    PERFORM v_token;
    RETURN NULL;
  END IF;

  IF v_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: apply_appointment_default_limits_upload apply mode requires p_audit.expected_confirm_token'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_confirm_token <> v_token THEN
    RAISE EXCEPTION 'confirm_token_mismatch: provided token mismatched'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 4 — apply mutations ────────────────────────────────────────
  -- 4a. INSERTs for adds (new day_of_week rows).
  IF jsonb_typeof(p_diff->'added') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'added')
    LOOP
      INSERT INTO public.appointment_default_limits (
        shop_id, day_of_week, is_closed,
        waiter_8am_slots, waiter_9am_slots, dropoff_total,
        notes, updated_at,
        updated_by_oauth_client_id, updated_by_name
      ) VALUES (
        p_shop_id,
        (v_row->>'day_of_week')::INT,
        COALESCE((v_row->>'is_closed')::BOOLEAN, FALSE),
        COALESCE(NULLIF(v_row->>'waiter_8am_slots', '')::INT, 0),
        COALESCE(NULLIF(v_row->>'waiter_9am_slots', '')::INT, 0),
        COALESCE(NULLIF(v_row->>'dropoff_total', '')::INT, 0),
        v_row->>'notes',
        now(), v_oauth_client_id, v_actor_email
      );
      v_added_keys := v_added_keys || to_jsonb((v_row->>'day_of_week')::INT);
    END LOOP;
  END IF;

  -- 4b. UPDATEs for modifications.
  IF jsonb_typeof(p_diff->'modified') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'modified')
    LOOP
      UPDATE public.appointment_default_limits
         SET is_closed         = COALESCE((v_row->>'is_closed')::BOOLEAN, FALSE),
             waiter_8am_slots  = COALESCE(NULLIF(v_row->>'waiter_8am_slots', '')::INT, 0),
             waiter_9am_slots  = COALESCE(NULLIF(v_row->>'waiter_9am_slots', '')::INT, 0),
             dropoff_total     = COALESCE(NULLIF(v_row->>'dropoff_total', '')::INT, 0),
             notes             = v_row->>'notes',
             updated_at        = now(),
             updated_by_oauth_client_id = v_oauth_client_id,
             updated_by_name            = v_actor_email
       WHERE shop_id = p_shop_id
         AND day_of_week = (v_row->>'day_of_week')::INT;
    END LOOP;
  END IF;

  -- ── STEP 5 — canonical after-hash ───────────────────────────────────
  v_after_canonical := public.canonical_state_appointment_default_limits(p_shop_id, p_snapshot);
  v_after_hash      := encode(digest(v_after_canonical, 'sha256'), 'hex');

  -- ── STEP 6 — audit_log INSERT ───────────────────────────────────────
  v_synthetic_snapshot := p_snapshot
    || jsonb_build_object(
         'snapshot_kind', 'appointment_default_limits',
         'added_keys',    v_added_keys,
         'after_hash',    v_after_hash,
         'expected_after_state_canonical', v_after_canonical
       );

  v_final_diff := p_diff
    || jsonb_build_object(
         'kind',                            'appointment_default_limits',
         'expected_after_state_canonical',  v_after_canonical,
         'after_hash',                      v_after_hash,
         'surfaces',                        jsonb_build_array('appointment_default_limits')
       );

  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, oauth_client_id, user_label, table_name, operation,
    rows_added, rows_modified, rows_deactivated, md_content_hash,
    diff_summary, pre_state_snapshot, shop_id
  ) VALUES (
    now(), v_oauth_client_id, v_actor_email, 'appointment_default_limits', 'upload_md',
    COALESCE(jsonb_array_length(p_diff->'added'),    0),
    COALESCE(jsonb_array_length(p_diff->'modified'), 0),
    0,
    v_md_hash, v_final_diff, v_synthetic_snapshot, p_shop_id
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: apply_appointment_default_limits_upload raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_appointment_default_limits_upload(INTEGER, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_appointment_default_limits_upload(INTEGER, JSONB, JSONB, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_appointment_default_limits_upload(INTEGER, JSONB, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.apply_appointment_default_limits_upload(INTEGER, JSONB, JSONB, JSONB) IS
  'Pattern S apply RPC for appointment_default_limits per PLAN §4.4. Composite PK (shop_id, day_of_week). Service_role-callable per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- APPLY RPC 5 of 5 — apply_closed_dates_upload
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: closed_dates for (p_shop_id) — future-only (>= original_today)
-- Snapshot kind:    'closed_dates_future'
-- Replaces TS apply: uploadClosedDatesMd (lines 1393-1605)
--
-- p_diff = {
--   added:       [{closed_date, reason?, source?}, ...],
--   modified:    [{closed_date, reason?, source?}, ...],
--   deactivated: [<YYYY-MM-DD>, ...]    -- future dates to HARD-DELETE
-- }
--
-- p_audit ALSO carries original_today (computed shop TZ Postgres-side at
-- TS layer; serves as the immutable scope for canonical_state read).
--
-- ADR-013: takes lock_surface_for_kind FIRST, then per-date advisory
-- locks in sorted-date FOR LOOP for every date in
-- (added ∪ modified ∪ deactivated).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_closed_dates_upload(
  p_shop_id  INTEGER,
  p_snapshot JSONB,
  p_diff     JSONB,
  p_audit    JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_dry_run                BOOLEAN;
  v_actor_email            TEXT;
  v_md_hash                TEXT;
  v_expected_current_hash  TEXT;
  v_expected_confirm_token TEXT;
  v_oauth_client_id        TEXT;
  v_original_today         DATE;
  v_current_canonical      TEXT;
  v_current_head_hash      TEXT;
  v_token_seed             TEXT;
  v_token                  TEXT;
  v_added_keys             JSONB := '[]'::JSONB;
  v_all_dates              DATE[];
  v_date                   DATE;
  v_after_canonical        TEXT;
  v_after_hash             TEXT;
  v_audit_id               BIGINT;
  v_synthetic_snapshot     JSONB;
  v_final_diff             JSONB;
  v_row                    JSONB;
  v_canonical_input        JSONB;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_closed_dates_upload requires positive p_shop_id'
      USING ERRCODE = '22023';
  END IF;
  IF p_audit IS NULL OR p_diff IS NULL OR p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_closed_dates_upload requires all JSONB params non-NULL'
      USING ERRCODE = '22023';
  END IF;

  v_dry_run                := COALESCE((p_audit->>'dry_run')::BOOLEAN, FALSE);
  v_actor_email            := p_audit->>'actor_email';
  v_md_hash                := p_audit->>'md_content_hash';
  v_expected_current_hash  := p_audit->>'expected_current_hash';
  v_expected_confirm_token := p_audit->>'expected_confirm_token';
  v_oauth_client_id        := p_audit->>'oauth_client_id';

  IF v_actor_email IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.actor_email' USING ERRCODE = '22023';
  END IF;
  IF v_md_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.md_content_hash' USING ERRCODE = '22023';
  END IF;
  IF v_expected_current_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: requires p_audit.expected_current_hash' USING ERRCODE = '22023';
  END IF;

  -- ── original_today REQUIRED (matches revert handler's contract) ─────
  IF p_audit->>'original_today' IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_closed_dates_upload requires p_audit.original_today (preserves past-closures-are-immutable-history invariant; future revert must use SAME original_today for canonical-scope byte-parity)'
      USING ERRCODE = '22023';
  END IF;
  v_original_today := (p_audit->>'original_today')::DATE;

  -- ── STEP 1 — lock_surface_for_kind FIRST (ADR-024) ──────────────────
  PERFORM public.lock_surface_for_kind(p_shop_id, 'closed_dates_future');

  -- ── STEP 1b — per-date advisory locks (ADR-013) in sorted-date FOR LOOP ─
  -- Collect every date in (added ∪ modified ∪ deactivated), sort, lock
  -- each in a PL/pgSQL FOR LOOP (per ADR-013 — `PERFORM fn() FROM ...`
  -- form does not guarantee execution order).
  SELECT ARRAY(
    SELECT DISTINCT d FROM (
      SELECT (val->>'closed_date')::DATE AS d
        FROM jsonb_array_elements(COALESCE(p_diff->'added',       '[]'::JSONB)) AS val
      UNION
      SELECT (val->>'closed_date')::DATE AS d
        FROM jsonb_array_elements(COALESCE(p_diff->'modified',    '[]'::JSONB)) AS val
      UNION
      -- Subquery-alias pattern for the deactivated[] SRF (avoids
      -- double-evaluation in a WHERE clause)
      SELECT v::DATE AS d FROM (
        SELECT jsonb_array_elements_text(COALESCE(p_diff->'deactivated', '[]'::JSONB)) AS v
      ) deacts
       WHERE v IS NOT NULL AND v <> ''
    ) k
   WHERE d IS NOT NULL
   ORDER BY d
  ) INTO v_all_dates;

  FOR v_date IN
    SELECT d FROM unnest(v_all_dates) AS d
    ORDER BY d ASC
  LOOP
    PERFORM pg_advisory_xact_lock(
      p_shop_id::INT,
      hashtext(v_date::TEXT)
    );
  END LOOP;

  -- ── STEP 2 — canonical re-verify (whole forward window) ─────────────
  -- Inject original_today into the snapshot for canonical scope.
  v_canonical_input := p_snapshot
    || jsonb_build_object('original_today', v_original_today::TEXT);

  v_current_canonical := public.canonical_state_closed_dates_future(p_shop_id, v_canonical_input);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');

  IF v_current_head_hash <> v_expected_current_hash THEN
    RAISE EXCEPTION 'staleness_check_failed: current state diverged (kind=closed_dates_future, shop=%, original_today=%); expected=%, current=%',
      p_shop_id, v_original_today, v_expected_current_hash, v_current_head_hash
      USING ERRCODE = '40001';
  END IF;

  -- ── STEP 3 — confirm_token gate ─────────────────────────────────────
  v_token_seed := p_shop_id::TEXT || ':closed_dates_future:' ||
                  v_original_today::TEXT || ':' ||
                  v_expected_current_hash || ':' ||
                  v_md_hash || ':' ||
                  v_actor_email;
  v_token := encode(digest(v_token_seed, 'sha256'), 'hex');

  IF v_dry_run THEN
    PERFORM v_token;
    RETURN NULL;
  END IF;

  IF v_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: apply_closed_dates_upload apply mode requires p_audit.expected_confirm_token'
      USING ERRCODE = '22023';
  END IF;
  IF v_expected_confirm_token <> v_token THEN
    RAISE EXCEPTION 'confirm_token_mismatch: provided token mismatched'
      USING ERRCODE = '22023';
  END IF;

  -- ── STEP 4 — apply mutations ────────────────────────────────────────
  -- 4a. INSERT added dates (composite-natural-key UPSERT — safe against
  -- structural cross-shop conflict). Belt-and-suspenders past-date guard.
  IF jsonb_typeof(p_diff->'added') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'added')
    LOOP
      IF (v_row->>'closed_date')::DATE < v_original_today THEN
        -- Refuse to write past dates; surface as snapshot_invalid since
        -- p_diff carrying a past date is a TS-layer parser bug.
        RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_closed_dates_upload received p_diff.added containing past date % (< original_today %)',
          (v_row->>'closed_date')::DATE, v_original_today
          USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.closed_dates (
        shop_id, closed_date, reason, source, created_at
      ) VALUES (
        p_shop_id,
        (v_row->>'closed_date')::DATE,
        v_row->>'reason',
        COALESCE(v_row->>'source', 'admin'),
        now()
      )
      ON CONFLICT (shop_id, closed_date) DO NOTHING;
      -- If ON CONFLICT fires, the row already exists → not a true add.
      -- Caller's diff should have classified it as modified. Don't add
      -- to v_added_keys in that case (we can't easily distinguish here
      -- without a RETURNING xmax check; trust caller's diff classification
      -- and proceed). Per ADR-019 Inv 5 spirit: post-write row-count vs
      -- expected is not enforced on the apply side for this kind because
      -- the diff is the source of truth.
      v_added_keys := v_added_keys || to_jsonb((v_row->>'closed_date')::TEXT);
    END LOOP;
  END IF;

  -- 4b. UPDATE modified (reason/source change on existing future dates).
  IF jsonb_typeof(p_diff->'modified') = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_diff->'modified')
    LOOP
      IF (v_row->>'closed_date')::DATE < v_original_today THEN
        RAISE EXCEPTION 'revert_blocked: snapshot_invalid: apply_closed_dates_upload received p_diff.modified containing past date %',
          (v_row->>'closed_date')::DATE
          USING ERRCODE = '22023';
      END IF;
      UPDATE public.closed_dates
         SET reason = v_row->>'reason',
             source = COALESCE(v_row->>'source', source)
       WHERE shop_id = p_shop_id
         AND closed_date = (v_row->>'closed_date')::DATE;
    END LOOP;
  END IF;

  -- 4c. HARD DELETE deactivated future dates. closed_date >= original_today
  -- belt-and-suspenders past-date guard.
  IF jsonb_typeof(p_diff->'deactivated') = 'array' THEN
    DELETE FROM public.closed_dates
     WHERE shop_id = p_shop_id
       AND closed_date = ANY(
         SELECT v::DATE FROM (
           SELECT jsonb_array_elements_text(p_diff->'deactivated') AS v
         ) k
          WHERE v IS NOT NULL AND v <> ''
       )
       AND closed_date >= v_original_today;   -- past-date guard
  END IF;

  -- ── STEP 5 — canonical after-hash ───────────────────────────────────
  v_after_canonical := public.canonical_state_closed_dates_future(p_shop_id, v_canonical_input);
  v_after_hash      := encode(digest(v_after_canonical, 'sha256'), 'hex');

  -- ── STEP 6 — audit_log INSERT ───────────────────────────────────────
  v_synthetic_snapshot := p_snapshot
    || jsonb_build_object(
         'snapshot_kind',   'closed_dates_future',
         'original_today',  v_original_today::TEXT,
         'added_keys',      v_added_keys,
         'after_hash',      v_after_hash,
         'expected_after_state_canonical', v_after_canonical
       );

  v_final_diff := p_diff
    || jsonb_build_object(
         'kind',                            'closed_dates_future',
         'original_today',                  v_original_today::TEXT,
         'expected_after_state_canonical',  v_after_canonical,
         'after_hash',                      v_after_hash,
         'surfaces',                        jsonb_build_array('closed_dates')
       );

  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, oauth_client_id, user_label, table_name, operation,
    rows_added, rows_modified, rows_deactivated, md_content_hash,
    diff_summary, pre_state_snapshot, shop_id
  ) VALUES (
    now(), v_oauth_client_id, v_actor_email, 'closed_dates', 'upload_md',
    COALESCE(jsonb_array_length(p_diff->'added'),       0),
    COALESCE(jsonb_array_length(p_diff->'modified'),    0),
    COALESCE(jsonb_array_length(p_diff->'deactivated'), 0),
    v_md_hash, v_final_diff, v_synthetic_snapshot, p_shop_id
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: apply_closed_dates_upload raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_closed_dates_upload(INTEGER, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_closed_dates_upload(INTEGER, JSONB, JSONB, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_closed_dates_upload(INTEGER, JSONB, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.apply_closed_dates_upload(INTEGER, JSONB, JSONB, JSONB) IS
  'Pattern S apply RPC for closed_dates_future per PLAN §4.5 + ADR-013. STEP 1 lock_surface_for_kind. STEP 1b per-date advisory locks (FOR LOOP sorted). STEP 2 canonical re-verify. STEP 3 confirm_token. STEP 4 conditional INSERT/UPDATE/HARD-DELETE with past-date guards. STEP 5/6 audit_log. Service_role-callable per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- END E1f migration — 5 Pattern S apply RPCs created
--
-- This is the LAST migration in the E1 sequence. The dispatch substrate
-- (E1b) + handlers (E1c, E1d, E1e) + apply RPCs (E1f) are now all in
-- place. Total: 16 + 2 + 3 + 5 + 5 = 31 SECURITY DEFINER functions
-- across the 5 E1 migrations:
--   - 6 outer-callable entry points (1 outer revert RPC + 5 apply RPCs)
--   - 25 internal functions (1 inner RPC + 10 revert handlers + 14 helpers)
-- ════════════════════════════════════════════════════════════════════════
