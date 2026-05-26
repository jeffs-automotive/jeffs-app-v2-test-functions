# ADR-016: 4-layer multi-tenant defense for revert operations

**Status:** Accepted (2026-05-26) — Honest 4-layer model with documented limit at L1
**Supersedes:** v0.3 "shop_id enforcement is SUFFICIENT" framing. Distilled from X-FIX-AGENT-B + cross-verify rounds 2+3 (GPT chunk 3 BLOCKER: "DB layer has no tenant authorization binding for p_shop_id").
**Superseded by:** (none — when an `employees` table + `auth.uid()` integration lands, a new ADR can supersede with a true 5th-layer check)

## Context

The revert system mutates tenant-scoped rows under a SECURITY DEFINER privilege boundary. A single defensive layer is insufficient: any one layer can be bypassed by a bug, misconfiguration, or compromised credential. The system therefore stacks four orthogonal layers, each protecting against a different failure mode.

The honest LIMIT: the codebase today has no `employees` table and no `auth.uid()`-resolvable identity available inside SECURITY DEFINER RPCs. There is therefore no DB-side primitive to independently verify that the caller is AUTHORIZED for the `p_shop_id` they passed. That authorization check lives at Layer 1 (orchestrator-mcp) and is the trust boundary for the entire feature.

## Decision

**Layer 1 — Caller identity at orchestrator-mcp (TRUST BOUNDARY).**
Source: `supabase/functions/orchestrator-mcp/index.ts`. BRANCH A (admin-app path): caller presents SERVICE_ROLE bearer + `X-Actor-Email` header; orchestrator-mcp validates both; missing actor_email returns 401. BRANCH B (Claude Desktop path): caller presents OAuth bearer; orchestrator-mcp validates the OAuth token's bound shop_id; uses that as `p_shop_id`. The shop_id passed to the outer RPC is SERVER-SIDE DERIVED from the authenticated identity — clients cannot pass arbitrary shop_ids. **L1 protects against:** unauthenticated callers + client-supplied shop_id spoofing. **L1 does NOT protect against:** a compromised service-role bearer or a bug in orchestrator-mcp's authentication branch — those would let any `p_shop_id` through, and L2-L4 below DO NOT independently verify L1.

**Layer 2 — DB-layer REVOKE EXECUTE + GRANT TO service_role.**
Every SECURITY DEFINER function in the feature carries `REVOKE EXECUTE … FROM PUBLIC; REVOKE EXECUTE … FROM anon, authenticated; GRANT EXECUTE … TO service_role;`. Exception: the inner RPC `revert_md_upload_apply` has NO service_role grant (per ADR-005) — only the outer RPC is the entry point. Hardened `search_path = pg_catalog, extensions, public, pg_temp` per ADR-017 closes the SECURITY DEFINER shadow-schema escalation surface (pg_temp explicit-last forces explicit ordering — without it PostgreSQL searches pg_temp implicitly FIRST and a session-created TEMP TABLE can shadow privileged unqualified references). RLS RESTRICTIVE deny-all policies on both audit_log + attempts tables per ADR-018 close the row-level access surface even against future GRANT misconfigurations. **L2 protects against:** unauthorized direct SQL access to the RPCs and tables. **L2 does NOT protect against:** a legitimate service_role caller passing a foreign `p_shop_id`.

**Layer 3 — Defense-in-depth presence assertions inside RPCs.**
STEP 0a: `p_shop_id IS NULL OR <= 0` → RAISE. STEP 0b: `p_actor_email IS NULL OR length(trim(...)) = 0` → RAISE (caller-identity backstop). STEP 0c: NULL boolean parameters (`p_dry_run`, `p_force_no_after_hash`) → RAISE. STEP 0d: upload-existence pre-check (`SELECT 1 FROM scheduler_admin_audit_log WHERE id = p_upload_id AND shop_id = p_shop_id`) — returns clean `not_found` rejection if no match, converting an FK violation into a structured rejection per ADR-002. **L3 protects against:** direct service_role callers bypassing orchestrator-mcp's L1 validation but still requiring caller-identity + parameter sanity. **L3 does NOT protect against:** a caller passing a `p_shop_id` they hold service_role for but are not authorized for at the application layer.

**Layer 4 — Handler-level Invariants (per ADR-019).**
Invariant 1 (RIGHT pattern): `INSERT … ON CONFLICT (id) DO UPDATE SET … WHERE target.shop_id = p_shop_id` — skips foreign-shop conflict-targets instead of hijacking. When a tenant-scoped composite unique key exists (`closed_dates(shop_id, closed_date)`, `concern_subcategories(shop_id, category, slug)`, etc.), use it as the conflict target directly — makes cross-shop hijack structurally impossible. Invariant 5: post-write row-count comparison RAISEs `cross_shop_hijack_attempt` if `expected > actual writes` (catches the rare case where Invariant 1's DO UPDATE WHERE filter silently filtered a foreign-shop conflict). Invariant 6: FK target tenant pre-validation — every distinct FK value in the snapshot must resolve in caller's tenant; raises `fk_target_tenant_mismatch` (classifier maps to `fk_broken` per ADR-007). **L4 protects against:** tampered snapshot content — even if a malicious snapshot carries IDs/FK targets from another shop, L4 ensures the actual writes stay in the caller's tenant. **L4 does NOT protect against:** the caller's `p_shop_id` itself being foreign — L4 binds writes to `p_shop_id`, but does not verify `p_shop_id` is authorized.

**Honest acknowledgement — the gap L1-L4 do NOT cover:** A legitimate service-role caller passing a foreign `p_shop_id` (e.g., an admin authorized for shop A passing `p_shop_id = shop_B`) is NOT blocked by L2-L4. L2 confirms the caller is service_role; L3 confirms the parameter is positive and non-null; L4 confirms the snapshot content is consistent with `p_shop_id`. None of those steps verify that the caller is AUTHORIZED for `p_shop_id`. That check happens ONLY at L1 (orchestrator-mcp derives `p_shop_id` from the authenticated identity).

## Consequences

- Defense-in-depth structure: four orthogonal layers each close a distinct failure mode (unauthenticated access, direct SQL, parameter tampering, snapshot content tampering).
- Operators rely on orchestrator-mcp's correctness as the trust boundary for tenant authorization. orchestrator-mcp's authentication logic warrants disproportionate review attention because no downstream layer independently verifies it.
- Compromised service_role bearer = total tenant-authorization compromise. Bearer rotation and audit-log review remain essential operational controls outside this ADR's scope.
- Future evolution path: when an `employees` table + `auth.uid()`-resolvable identity becomes available inside SECURITY DEFINER RPCs, a 5th-layer DB-side check (`auth.uid()` → employees.shop_id → assert match with `p_shop_id`) can be added. That future ADR would supersede this one with a true DB-enforced tenant authorization layer, closing the L1-only gap.
- The 4-layer model is honestly bounded by L1's correctness — this ADR does not claim the DB layers close the tenant-authorization gap, only that they defend against the orthogonal failure modes documented above.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §8.4 "Multi-tenant scoping" 4-layer narrative + §8.4 honest-limits acknowledgement
- Related ADRs: ADR-017 (search_path hardening — Layer 2 component), ADR-018 (RLS RESTRICTIVE — Layer 2 component), ADR-019 (handler Invariants 1+5+6 — Layer 4)
