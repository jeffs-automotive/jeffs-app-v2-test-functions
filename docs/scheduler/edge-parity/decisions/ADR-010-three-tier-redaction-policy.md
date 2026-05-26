# ADR-010: Three-tier redaction policy (Sentry / RPC return / DB attempt row)

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 two-column "Sentry / DB" redaction table. Distilled from the Sentry-emission pattern and cross-verify rounds 1-2 finding that no single redaction stance fits all three surfaces.
**Superseded by:** (none)

## Context

The revert pipeline surfaces failure information on three distinct surfaces, each with a different threat model:

1. **Sentry payload** — third-party indexed search; tags/extras can leak into search results, alert digests, and external dashboards. PII or customer-facing content here is a privacy + compliance hazard. Cardinality also matters (high-cardinality tags bloat indexes + degrade alert grouping).
2. **RPC return → TS caller** — any caller of `revert_md_upload_attempt` can read every field; the TS wrapper logs / propagates / displays them. PII or unsanitized DB exception text here flows to admin-app toasts and Claude Desktop transcripts.
3. **DB attempt row** (`scheduler_admin_revert_attempts`) — service-role-gated triage surface; only operators with admin-app access (or direct DB access) can read it. Acceptable home for verbose `SQLSTATE:CONSTRAINT_NAME:SQLERRM` bodies and inline staleness-diff content.

A single redaction policy doesn't fit all three. The canonical table below assigns each field a placement per-surface.

## Decision

| Field | Sentry payload | RPC return → TS | DB attempt row | Why |
|---|---|---|---|---|
| `reason_code` | YES — `tags.reason_code` | YES — `reason_code` column | YES — `reason_code` column | Canonical enum per ADR-007. Machine-readable. Safe everywhere — used for alert grouping in Sentry + UI messaging in admin-app + DB triage. |
| `error_message` | NO — intentionally omitted from Sentry `extra` (reason_code already covers the machine-readable signal) | YES — sanitized templated summary per ADR-009 | NO — not a persisted column | Built from `v_sanitized_error_message` CASE table. NEVER contains raw `v_sqlerrm` body. Safe for TS callers to log / propagate / display in admin-app toast. |
| `error_detail` | NO — intentionally omitted | NO — not in RETURN shape | YES — `error_detail` column | Verbose `SQLSTATE:CONSTRAINT_NAME:SQLERRM` body, including inline staleness-diff content from `compute_unified_diff` (may include customer-facing scheduler MD text). DB-only; operators query by `attempt_id` for triage in service-role-gated surfaces. |
| `attempt_id` | YES — `tags.attempt_id` | YES — `attempt_id` column | YES — primary key | Pivot key from Sentry event → RPC caller → DB row. Opaque BIGINT; no PII. |
| `shop_id` / `upload_id` | YES — `tags.shop_id`, `tags.upload_id` | YES (subset) | YES — columns | Identity for operator dispatch. shop_id is a Tekmetric integer; upload_id is the audit-log row id. |
| `actor_email` | YES — `tags.actor_email` | YES (passed through) | YES — `actor_email` column | Operator label, NOT strictly email-formatted. **HONEST NAMING NOTE:** the column is named `actor_email` for legacy compatibility with the audit_log schema (predates this feature), but its actual semantic is "human-readable operator label" — callers pass either a canonical email address OR a `display_name` (per archived PLAN §4.1 column COMMENT). The orchestrator-mcp `X-Actor-Email` header is set by admin-app to whichever string the OAuth identity provider returns; for Claude Desktop OAuth identities, that's typically a display_name not an email. **Operational implications:** (1) Sentry tag `actor_email` may carry a display_name, NOT a parseable email — alert rules / search queries should not assume RFC 5322 shape. (2) Notifications keyed by this column will fail if the column value is not actually email-shaped — surfaces that depend on email semantics (e.g., manual review emails, Pattern B 6-char-code resolution emails) must NOT use this column as the email recipient; instead they should look up the canonical email via a separate identity-resolution surface. (3) This is an explicit project decision; if policy ever requires "no PII in Sentry" OR "strict email format," see DEFERRED-AUDIT-ITEMS.md SEC-18 (rename to `actor_label` + add separate strict-email `actor_email` column with CHECK + identity-resolution backfill). |
| `oauth_client_id` | YES — `tags.oauth_client_id` (when present) | YES (passed through) | YES — column | Identifies the OAuth client (Claude Desktop instance) that initiated the revert. Useful for differentiating same-actor multi-session activity. |
| `confirm_token` (dry_run path) | NEVER — token is the authorization secret | YES (success only — fresh token from `outcome='dry_run_success'`) | NEVER — hash stored in `dry_run_confirm_token_hash` only | Token is RETURNED to the caller on dry_run_success only, never persisted in plaintext, never logged. The sha256 hash is the only persistent record. |

**Canonical TS Sentry-emission pattern** (lives in `scheduler-admin-catalog.ts` `revertMdUpload` wrapper, after the outer RPC returns):

```typescript
const OK_OUTCOMES = new Set(['success', 'dry_run_success']);

if (data && !OK_OUTCOMES.has(data.outcome)) {
  Sentry.captureMessage(`revert_attempt:${data.outcome}`, {
    level: data.outcome === 'crashed' ? 'error' : 'warning',
    tags: {
      shop_id: data.shop_id ?? p_shop_id,
      upload_id: args.upload_id,
      actor_email: args.audit.display_name,
      outcome: data.outcome,
      reason_code: data.reason_code ?? '<none>',
      attempt_id: data.attempt_id,
    },
    extra: {
      dry_run: args.dry_run ?? false,
      // INTENTIONALLY OMITTED: error_detail (carries SQLSTATE:CONSTRAINT_NAME:SQLERRM
      //   + diff content). Operator queries scheduler_admin_revert_attempts WHERE id = attempt_id
      //   in a service_role-gated admin-app server action.
    },
  });
  return { ok: false, outcome: data.outcome, reason_code: data.reason_code,
           error_message: data.error_message, attempt_id: data.attempt_id };
}
```

**Adding a new field to the redaction policy:** decide its column-by-column placement based on the threat model questions: (1) Is the value high-cardinality enough to bloat Sentry indexes? (2) Is the value PII or customer-facing content? (3) Does the value belong in the attempt-row schema or is it transient?

## Consequences

Operators have a clear, per-surface contract for what they will and won't see. Sentry alert rules can group on `tags.reason_code` and `tags.outcome` without leaking PII or diff text into third-party search indexes. TS callers get a sanitized `error_message` safe enough to display in admin-app toasts, but rich enough to point an operator at the right `attempt_id` for follow-up. Full triage detail — `error_detail` with raw SQLSTATE / CONSTRAINT_NAME / SQLERRM / unified diff — lives only in the service-role-gated DB attempt row, queried by `attempt_id` via the admin-app's server-side surface.

Future field additions follow the table's pattern: place each new field by answering the threat-model questions above, then update this ADR's table in the same commit as the schema change.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §3b CV2-B6 redaction policy table + §3b Sentry emission pattern code block
- Related ADRs: ADR-007 (canonical enum — the only failure field allowed in Sentry tags), ADR-008 (classifier), ADR-009 (sanitized error_message)
