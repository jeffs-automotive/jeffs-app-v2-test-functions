# ADR-005: Outer-only service_role entry point (inner RPC + 10 revert handlers + 4 helper families have NO service_role grant)

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 canonical security block that said EVERY SECURITY DEFINER function gets `GRANT EXECUTE TO service_role`. Distilled from X-FIX-#19 + cross-verify round 2 GPT chunk 2 IMPORTANT + ADR-Fix #21 + #22 (2026-05-26 — extended the no-grant pattern from inner RPC alone to the full set of internal SECURITY DEFINER surfaces: inner RPC + 10 revert handlers + 4 helper families. Round-5 cross-verify flagged that handlers callable by service_role would let callers bypass the outer attempt-row insert + eligibility + token + staleness checks, breaking the audit invariant the inner-RPC no-grant was supposed to protect).
**Superseded by:** (none)

## Context

The revert pipeline splits into an outer RPC (`revert_md_upload_attempt`) and an inner RPC (`revert_md_upload_apply`) per ADR-001. The outer runs a STEP 0 pre-INSERT into `scheduler_admin_revert_attempts` BEFORE delegating into the inner; that pre-INSERT is the audit-trail keystone documented in ADR-002 — every reachable revert attempt with valid parameters writes a row, providing the failure-trail observability operators need to investigate crashed/rejected calls.

The canonical multi-tenant security setup (see §4.4 of the archived plan) wraps every SECURITY DEFINER function with `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`. Applied uniformly to the inner RPC, however, this opens a bypass surface: any caller with the service_role key (orchestrator-mcp, an ad-hoc edge function, a psql session, supabase-js with the service key) could `SELECT * FROM public.revert_md_upload_apply(...)` directly — running the dispatch + handlers + audit-log revert-row write + parent-pointer UPDATE while skipping the outer's pre-INSERT entirely. The attempt row would never exist; the failure-trail invariant breaks silently.

A round-3 cross-verify follow-up (GPT chunk 2 IMPORTANT) further found that `CREATE OR REPLACE FUNCTION` preserves all existing function privileges. If any prior partial migration ever granted service_role on this function — even one applied and rolled back during dev — the new CREATE OR REPLACE will silently retain that grant. Withholding `GRANT` is necessary but not sufficient; the migration must explicitly `REVOKE`.

## Decision

The OUTER-CALLABLE entry-point set carries the canonical `REVOKE PUBLIC/anon/authenticated + GRANT service_role` triple. The INTERNAL set carries the NO-GRANT variant: same REVOKE triple PLUS explicit `REVOKE EXECUTE … FROM service_role` (to defend against stale grants preserved across `CREATE OR REPLACE`).

**Outer-callable entry-point set (7 functions — full triple `REVOKE PUBLIC/anon/authenticated; GRANT TO service_role`):**

| Function | Why service_role grant is needed | Audit guarantee |
|---|---|---|
| `revert_md_upload_attempt` (outer RPC) | orchestrator-mcp `revertMdUpload` tool invokes this via service_role bearer | ADR-002 attempt-row contract (outer pre-INSERT + EXCEPTION classifier) |
| `apply_concern_questions_flat_upload` | orchestrator-mcp `upload_concern_questions_md` tool invokes via service_role | Pattern S two-step: dry_run + expected_confirm_token guard inside the RPC |
| `apply_concern_category_upload` | same — `upload_concern_category_md` tool | Pattern S two-step |
| `apply_concern_category_guideline_upload` | same — `upload_concern_category_guideline_md` tool | Pattern S two-step |
| `apply_appointment_default_limits_upload` | same — `upload_appointment_default_limits_md` tool | Pattern S two-step + per-date advisory locks (ADR-013) + surface lock (ADR-024) |
| `apply_closed_dates_upload` | same — `upload_closed_dates_md` tool | Pattern S two-step + per-date advisory locks (ADR-013) + surface lock (ADR-024) |
| `list_scheduler_admin_audit_log_filtered` (NEW E7 2026-05-26) | orchestrator-mcp `list_scheduler_admin_audit_log` tool invokes via service_role for the audit-log read path per ADR-021 | Read-only RPC; surface_filter conditional fallback SQL + 30-day cutoff + only_successful filter inside the RPC body. No mutations, so no audit guarantee needed; service_role caller cannot bypass the shop_id scoping (RPC's WHERE clause forces shop_id = p_shop_id). |

**Internal set (15 functions — NO GRANT to service_role):**

| Function family | Functions | Migration |
|---|---|---|
| Inner RPC | `revert_md_upload_apply` | 20260526000100 |
| 10 revert handlers | `revert_testing_services_v2`, `revert_routine_services_v2`, `revert_subcategory_descriptions_v2`, `revert_subcategory_service_map_v2`, `revert_question_required_facts_v2`, `revert_concern_questions_flat`, `revert_concern_category_upload`, `revert_concern_category_guideline`, `revert_appointment_default_limits`, `revert_closed_dates_future` | 20260526000200 + 00300 + 00400 |
| 4 helper families | `lock_surface_for_kind`, `lock_targets_for_kind`, `compute_current_canonical_for_kind`, 10 × `canonical_state_<kind>` serializers, `compute_unified_diff` | 20260526000100 |

Each internal function's grant block:

```sql
REVOKE EXECUTE ON FUNCTION public.<name>(<arg list>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.<name>(<arg list>) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.<name>(<arg list>) FROM service_role;
-- NOTE: NO GRANT to service_role. Callable ONLY via SECURITY DEFINER ownership
-- chain from one of the 6 outer-callable entry points above. Future maintainers:
-- do not add the GRANT without first amending ADR-005 to document the new
-- bypass surface.
```

**Why the inner RPC + 10 handlers + 4 helpers are internal-only:** every one is reachable from an outer-callable entry point's SECURITY DEFINER context via ownership chain (the function owner — typically `postgres` — has implicit EXECUTE on everything in `public`). A direct service_role call to any of them would bypass the relevant audit guarantee:
- **Direct call to inner RPC:** bypasses outer's attempt-row pre-INSERT + STEP 0 guards + EXCEPTION classifier. No attempt row exists.
- **Direct call to a revert handler:** skips inner RPC entirely — no eligibility check, no token validation, no staleness check, no parent-row lock, no revert-audit-row INSERT.
- **Direct call to a helper (e.g., `canonical_state_<kind>`):** exposes cross-shop scheduler state read surface to service_role outside the dispatch-controlled flow.

The outer-callable entry points (outer RPC + 5 apply RPCs) call internal functions via `SELECT * INTO ... FROM public.<name>(...)` — succeeds because the SECURITY DEFINER context runs as the function owner. The same SELECT from a service_role client returns 42501 permission denied. The ONLY path to ANY internal function is via one of the 6 outer-callable entry points.

The 5 apply RPCs ARE outer-callable (the orchestrator-mcp upload tools call them directly via service_role) but their audit guarantee is Pattern S (dry_run + expected_confirm_token validation INSIDE the apply RPC), NOT "outer-only-callable". Pattern S enforcement is in the apply RPC body; service_role can call the apply RPC but cannot bypass the dry_run/token gate.

## Consequences

This preserves the audit-trail invariant from ADR-002: every revert attempt corresponds to a `scheduler_admin_revert_attempts` row, because the outer's pre-INSERT is the only entry point that can reach the dispatch + handlers. Operators investigating a missing audit-log revert row can be certain no inner execution occurred without an attempt row existing — there is no other way in. The `outcome='crashed'` and `outcome='rejected'` paths remain observable; silent inner-only execution is structurally impossible.

The cost is one documented deviation from the otherwise uniform canonical security block. Every other SECURITY DEFINER function in the feature follows the standard `REVOKE … FROM PUBLIC/anon/authenticated + GRANT … TO service_role` triple. Reviewers and future maintainers must understand that the inner RPC is intentionally different, hence the inline comment block warning against re-adding the GRANT without first amending ADR-002 + ADR-005.

Caveat: the no-grant design depends on outer + inner sharing the same function owner (typically postgres). If migrations are ever applied under a different role, OR if ownership is later transferred via `ALTER FUNCTION … OWNER TO`, the outer→inner chain begins failing with 42501 because the outer's owner no longer has implicit EXECUTE on the inner. This sensitivity is recorded in `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` and should be re-validated whenever the project moves away from the default function-ownership setup.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.4 inner RPC grant block + canonical security setup
- Related ADRs: ADR-001 (outer/inner split), ADR-002 (attempt-row contract — depends on outer being only entry), ADR-016 (4-layer multi-tenant defense)
