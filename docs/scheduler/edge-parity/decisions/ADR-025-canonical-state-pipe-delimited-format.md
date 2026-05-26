# ADR-025: canonical_state_<kind> emits stable pipe-delimited structured format (NOT mirror existing TS-exporter MD output)

**Status:** Accepted (2026-05-26 — first post-implementation ADR; the ADR-Fix pre-implementation cross-verify exception per INDEX.md does NOT apply to this ADR because it documents a decision discovered during E1b dispatch-migration authoring)
**Supersedes:** ADR-024 §3 "Mirrors" column wording (which implied each `canonical_state_<kind>` plpgsql serializer mirrors a specific existing TS exporter byte-for-byte — e.g., `canonical_state_testing_services_v2` mirrors `exportTestingServicesMdV2`)
**Superseded by:** (none)

## Context

ADR-024 §3 defines 10 `canonical_state_<kind>` plpgsql serializers and a "Mirrors" column pointing at the existing TS MD exporter for each kind (e.g., `exportTestingServicesMdV2` for `canonical_state_testing_services_v2`). The plain reading is that the plpgsql serializer must produce **byte-for-byte identical Markdown output** to its paired TS exporter, so that the inner-RPC's step-6 staleness check (which compares the snapshot's `expected_after_state_canonical` against the freshly-computed canonical-current) can use either side interchangeably.

The TS exporters were authored for the admin-app UI: they emit human-readable Markdown with headers, column descriptions, prose guidance about how to use the catalog, and other presentation-layer concerns. Reproducing that output byte-for-byte in plpgsql is expensive (every prose change in the TS exporter requires a paired SQL migration to keep parity) and exposes a long tail of false-positive `current_state_drift` rejections: an admin updates the TS exporter's heading text from `## Routine Services` to `## Routine services` (case fix), the plpgsql serializer doesn't change, and the next revert on that surface fails with current_state_drift even though no data changed.

The E1b dispatch-migration author (2026-05-26 Opus sub-agent) flagged the problem as Open Item #1 in their author report:

> I chose a STABLE STRUCTURED pipe-delimited format for the 10 canonical_state_<kind> serializers (e.g., `| id=... | service_key=... | ... |`) rather than literal MD that mirrors the existing TS exporters. Rationale: MD format has cosmetic baggage … that adds zero staleness-detection value but high TS-mirroring cost. The structured form is easier to mirror byte-for-byte in TS's `computeCanonicalAfterState()` helper (built in E2).

PLAN.md §9 build order E2 already plans a NEW TS helper `computeCanonicalAfterState(kind, supabase, shopId, snapshot)` for the revert-path's diff-diagnostics surface. The design already separated the **canonical-state serializer** (used for staleness check) from the **MD exporter** (used for admin-app UI). ADR-024 §3 conflated the two by pointing the canonical-state serializer at the existing TS MD exporter.

## Decision

The 10 `canonical_state_<kind>` plpgsql serializers in `20260526000100_revert_md_upload_dispatch.sql` emit a **stable structured pipe-delimited format**, NOT a copy of the existing TS MD exporters' output.

**Format shape (per-row):**

```
| col1=value1 | col2=value2 | ... | colN=valueN |
```

Aggregated to one TEXT result per `(p_shop_id, p_snapshot)` invocation:

```
# <snapshot_kind> shop=<p_shop_id> rows=<count>
| col1=value1 | col2=value2 | ... |
| col1=value1' | col2=value2' | ... |
...
```

Row order is deterministic per kind (e.g., `ORDER BY id ASC` for V2 catalogs, `ORDER BY closed_date ASC` for `closed_dates_future`, `ORDER BY (category, display_order, id)` for `concern_questions_flat`).

**Column inclusion rule:** each canonical_state serializer includes ONLY the columns that the corresponding apply path writes (its mutation surface). Presentation-only TS-exporter prose (headers, column descriptions, guidance text) is OMITTED. Row-identity columns (PKs) are INCLUDED when the PK has business meaning (e.g., `testing_services.id` IS the service-key identifier the row represents) and EXCLUDED when the PK is incidental (e.g., `closed_dates.id` is an auto-generated UUID with no semantic role — `(closed_date, reason)` is the natural identity per ADR-Fix #19 review item #3).

**Byte-parity contract — revised from ADR-024 §3:**

| Pre-ADR-025 (ADR-024 §3) | Post-ADR-025 (this ADR) |
|---|---|
| `canonical_state_<kind>` mirrors existing TS MD exporter byte-for-byte | `canonical_state_<kind>` emits a new structured format |
| TS exporter is the single source of canonical bytes (used for both UI + staleness) | TS exporter remains the source for admin-app UI ONLY (no change to TS) |
| Apply-path post-mutation canonical comes from `canonical_state_<kind>` (running inside the apply RPC) | Same — 5 NEW apply RPCs call `canonical_state_<kind>` post-write; byte-parity is automatic |
| TS-revert path imports the existing TS exporter to compute apply-side canonical for revert diff diagnostics | TS-revert path imports a NEW E2 helper `computeCanonicalAfterState(kind, supabase, shopId, snapshot)` that emits the pipe-delimited format byte-for-byte matching `canonical_state_<kind>` |

The byte-parity contract is therefore between:
- **`canonical_state_<kind>`** (plpgsql, this migration) — produces the canonical bytes
- **`computeCanonicalAfterState()`** (TS, NEW in E2) — produces the SAME canonical bytes for the revert-path's diff-diagnostics surface

The 5 EXISTING V2 TS uploaders (modified in E4) ALSO need to emit `expected_after_state_canonical` in the new pipe-delimited format. The E4 modifications must use the new `computeCanonicalAfterState()` helper to populate the snapshot's `expected_after_state_canonical` field, NOT the existing MD exporters.

## Consequences

**Wins:**
- **No cosmetic-drift class.** Future edits to TS MD exporter prose (header wording, column descriptions, guidance text) cannot produce false-positive `current_state_drift` rejections on revert because the canonical-state format doesn't include presentation prose.
- **Cheaper byte-parity.** The TS `computeCanonicalAfterState()` helper is ~200 lines (10 kind-handlers, each ~20 lines of value-formatting) vs the existing MD exporters which carry full presentation responsibility. The new helper mirrors plpgsql output trivially.
- **Cleaner separation of concerns.** TS MD exporters = UI; plpgsql canonical_state = staleness comparison; new TS helper = revert-diff diagnostics. Each has one job.

**Costs:**
- **E2 builder must author `computeCanonicalAfterState()` from scratch** (10 kind handlers). Not a marginal addition to PLAN.md §9 E2 — it's the bulk of E2's TS work.
- **E4 V2 uploader modifications** must use `computeCanonicalAfterState()` to populate `expected_after_state_canonical`, NOT the existing MD exporters. This is a slightly larger E4 scope than the original PLAN implied.
- **E10 tests** must compare `canonical_state_<kind>` (plpgsql) against `computeCanonicalAfterState()` (TS) for byte-parity, NOT against existing MD exporters. PLAN §10 test descriptions must be reframed.

**What's now impossible:**
- A revert canNOT silently succeed against a TS-exporter-presentation-edit (the canonical text doesn't include those bytes).
- A revert canNOT use the existing MD exporter as its canonical reference (the byte sets differ).

**What's now harder:**
- An operator viewing `expected_after_state_canonical` in a debug query sees pipe-delimited text, not friendly MD. The admin-app UI doesn't render canonical-state-text; the operator-facing diff is produced by `compute_unified_diff` against the canonical text, which renders as a line-diff (per ADR-023). MD-friendly debug views are not part of Phase 1.

**Forward-looking:**
- If a future presentation surface needs "canonical state as friendly MD," a NEW TS helper `formatCanonicalAsHumanMd(canonical_text, kind)` can be authored to re-derive MD from the pipe-delimited format. This re-derivation is one-way (canonical → MD); the reverse (MD → canonical) is not supported by design.

## Sources

- E1b dispatch-migration author report (2026-05-26 Opus sub-agent, abc71e5a185ae9426) — Open Item #1 "Canonical-format design choice"
- Orchestrator review of E1b open items (2026-05-26) — Chris's call: "Accept agent's choice + write ADR-025 superseder (Recommended)"
- ADR-024 §3 "Mirrors" column — superseded by this ADR for the byte-parity contract
- PLAN.md §9 E2 — `computeCanonicalAfterState()` is the canonical TS helper
- PLAN.md §10 testing approach — byte-parity tests must be reframed per this ADR
- Related ADRs: ADR-014 (force_no_after_hash 3-branch — branch 3 fires when canonical present; canonical = pipe-delimited per this ADR), ADR-023 (compute_unified_diff — renders human-readable diff from pipe-delimited canonical text on staleness rejection slow path)
