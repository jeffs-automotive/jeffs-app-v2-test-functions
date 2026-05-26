# ADR-017: SECURITY DEFINER search_path = pg_catalog, extensions, public, pg_temp

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 `SET search_path = pg_catalog, public` (missed `extensions` schema; pgcrypto's `digest(...)` unresolvable). Cross-verify chunk 2 (ADR-Fix #4) flagged the omission of `pg_temp` — added in the canonical clause below. Distilled from X-FIX-#23 + cross-verify round 2 chunk 2 BLOCKER + ADR-Fix #4 (2026-05-26).
**Superseded by:** (none)

## Context

`SECURITY DEFINER` functions execute with the privileges of their owner (typically `postgres`), not the caller. This makes the `search_path` they run under a primary security-design concern. Three failure modes drive the canonical clause for this feature:

1. **Shadow-schema escalation.** If a SECURITY DEFINER function resolves an unqualified function call (`digest(...)`, `format(...)`, jsonb operators, array operators) against a schema where an untrusted role can `CREATE`, that role can register a same-name function and the SECURITY DEFINER body will execute *their* code with *owner* privileges. `pg_catalog` must therefore appear first so PostgreSQL resolves built-ins ahead of anything user-creatable.
2. **pgcrypto invisibility on Supabase.** PostgreSQL has no built-in `sha256(text)`; this feature relies on pgcrypto's `digest(...)` for confirm-token + canonical-hash computation in every dry-run / apply / revert. Supabase installs all extensions to the `extensions` schema by default (per https://supabase.com/docs/guides/database/extensions), NOT `public`. Without `extensions` in the search_path, unqualified `digest(...)` calls fail at runtime with `function digest(text, unknown) does not exist` — even though Migration A's `CREATE EXTENSION IF NOT EXISTS pgcrypto` succeeded. `CREATE EXTENSION` is idempotent and does NOT relocate the extension when it already exists somewhere else.
3. **`pg_temp` implicit-first lookup.** Per PostgreSQL docs (https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-SEARCH-PATH), if `pg_temp` is NOT explicitly listed in `search_path`, the active temporary schema is implicitly searched *first* (before every named entry, including `pg_catalog`) for relation/type names. A caller with `TEMP` privilege on the database (granted to `PUBLIC` by default on standard Supabase) can `CREATE TEMP TABLE scheduler_admin_audit_log (...)` in their session and, on the next call into a SECURITY DEFINER function that references the unqualified name `scheduler_admin_audit_log`, redirect the privileged read/write to their temp shadow. Listing `pg_temp` explicitly — at the END of the path — forces explicit ordering and removes the implicit-first behavior.

## Decision

Every SECURITY DEFINER function in this feature sets:

```sql
SET search_path = pg_catalog, extensions, public, pg_temp
```

Applied verbatim to:
- Outer RPC `revert_md_upload_attempt`
- Inner RPC `revert_md_upload_apply`
- 10 revert handlers `revert_<kind>(p_shop_id, p_snapshot)` — one per snapshot_kind
- 5 apply RPCs `apply_<table>_upload(p_shop_id, p_snapshot, p_diff, p_audit, ...)` — one per legacy uploader
- Helpers: `lock_targets_for_kind`, `compute_current_canonical_for_kind`, the 10 `canonical_state_<kind>` serializers, `compute_unified_diff`

**Order rationale:**

1. `pg_catalog` first — system catalogs + built-ins resolved before any user-creatable object. Mitigates shadow-schema attacks on every built-in this feature calls (jsonb_*, format, array operators, hash siblings).
2. `extensions` second — Supabase's default extension schema. Makes unqualified `digest(...)` resolve to `extensions.digest(...)`.
3. `public` third — project tables (`scheduler_admin_audit_log`, `closed_dates`, `concern_subcategories`, etc.) live here. Found when explicitly named or when prior schemas miss.
4. `pg_temp` LAST — explicit-last placement removes PostgreSQL's implicit-first temp-schema lookup. A session-created `TEMP TABLE` of the same name as a project table can no longer shadow the privileged reference because `public` resolves first.

**Belt-and-suspenders for pgcrypto:** if a legacy DB installed pgcrypto into `public` (older project template) rather than `extensions`, the third path entry still resolves `digest(...)` correctly. The `CREATE EXTENSION IF NOT EXISTS pgcrypto` in Migration A guarantees the function exists *somewhere*; the search_path entries guarantee unqualified calls reach it.

## Consequences

- Unqualified `digest(...)` resolves on standard Supabase deployments (extensions schema) and on legacy public-schema installs.
- Built-in resolution is hardened against the classic shadow-schema escalation on SECURITY DEFINER paths.
- Cost: one extra schema in every name-resolution chain (negligible).
- Function bodies stay readable — no need to write `public.scheduler_admin_audit_log` everywhere.
- **Honest residual — public-in-path privilege-escalation surface.** SECURITY DEFINER functions with `public` in their search_path are a known escalation class IF untrusted roles have `CREATE` on schema `public`. Supabase default grants `CREATE` on `public` to `anon` + `authenticated` + `service_role`. The maximum-safety alternative is `SET search_path = pg_catalog, extensions` (drop `public`) + fully qualify every project-table reference inside function bodies — OR `SET search_path = ''` with full qualification everywhere. Either was rejected for maintenance cost. The pg_catalog-first ordering closes the most-common attack (built-in shadowing). Hardening `public.CREATE` permissions project-wide is tracked as a follow-up in `DEFERRED-AUDIT-ITEMS.md` if it becomes operationally relevant.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.4 canonical security setup block + §4.1 pgcrypto extension installation block
- Related ADRs: ADR-016 (L2 — search_path is part of the Layer 2 hardening)
