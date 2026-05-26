# ADR-011: snapshot_kind_unknown reclassified to crashed (not rejected)

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 default behavior where every `revert_blocked:` prefix mapped to `outcome='rejected'`. Distilled from X-FIX-#11 + Gemini round 2 chunk 2 IMPORTANT "Unhandled snapshot kinds misclassified as rejected".
**Superseded by:** (none)

## Context

The inner RPC's dispatch CASE block in `revert_md_upload_apply` step 9 routes per `v_kind` across 10 registered snapshot handlers (`testing_services_v2`, `routine_services_v2`, ..., `closed_dates_future`). Its ELSE branch fires when a snapshot_kind has no registered handler and RAISEs `revert_blocked: snapshot_kind_unknown: % is not in the per-kind handler dispatch — this is a system bug, not a user error`.

For the dispatch ELSE to fire, the snapshot_kind must have (a) passed step-2 eligibility — `table_not_supported` would have rejected it earlier if it couldn't be resolved at all, (b) resolved to a string value either from `snapshot.snapshot_kind` or the legacy `table_name`-based fallback, and (c) NOT matched any of the 10 WHEN arms. That combination means the code knows the kind exists conceptually but has no handler registered — a missing handler migration.

v0.5's default `revert_blocked:` → `outcome='rejected'` mapping classified this as user-remediable. But missing-handler is a SYSTEM BUG: telling the user "try again later" wastes their time and delays engineering's awareness of an unshipped handler.

## Decision

`snapshot_kind_unknown` is a documented exception to the default classifier mapping. After the regex extraction + allow-list check (per ADR-008), the outer EXCEPTION block checks:

```sql
IF v_reason = 'snapshot_kind_unknown' THEN
  v_outcome := 'crashed';
END IF;
```

The `reason_code` stays `snapshot_kind_unknown` (canonical per ADR-007's enum table). Only `v_outcome` is reclassified from `rejected` to `crashed`.

## Consequences

Per ADR-010's TS wrapper, Sentry alert level is `data.outcome === 'crashed' ? 'error' : 'warning'`. snapshot_kind_unknown → crashed → 'error' level → pages whoever owns scheduler-app alerts; engineering ships the missing handler migration + extends the CASE block + redeploys before another operator hits it. The admin-app UI surfaces ADR-009's sanitized "internal error occurred during revert; operators should investigate (attempt_id N)" message — operators understand to escalate rather than retry. Tradeoff: operators briefly see a "crashed" message instead of a "try later" message; that's intentional — the message routes the right people (engineering on-call, not the customer-facing operator).

## Sources
- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.4 outer RPC EXCEPTION block (special-case after the allow-list check) + §4.4 inner RPC dispatch CASE ELSE branch
- Related ADRs: ADR-007 (canonical enum — snapshot_kind_unknown listed in the table), ADR-008 (classifier — implements this special case), ADR-010 (redaction — Sentry alert level)
