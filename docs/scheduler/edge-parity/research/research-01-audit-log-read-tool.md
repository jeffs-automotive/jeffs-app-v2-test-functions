# Research 01 — `list_scheduler_admin_audit_log` MCP tool design

**Feature:** `scheduler-edge-parity`
**Scope:** Design the new orchestrator MCP tool `list_scheduler_admin_audit_log` so the admin UI can list recent uploads per surface AND determine which ones are revertable. Blocker B3 from `.claude/work/ai-review-2026-05-25T22-40-58Z.md`.
**Authored:** 2026-05-25 via Explore sub-agent (Opus). Content returned inline + transcribed verbatim.

## 1. Schema

The base table is created at `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:134-147` and amended by `supabase/migrations/20260519140000_scheduler_md_edit_v2_schema.sql:30-32`.

| Column | Type | Nullable | One-line description |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` (PK) | NOT NULL | Audit row id — also the value `revert_md_upload({ upload_id })` accepts. |
| `occurred_at` | `TIMESTAMPTZ DEFAULT now()` | NOT NULL | When the upload ran. **Used by UI as `uploaded_at`.** |
| `oauth_client_id` | `TEXT` | NULL | DCR client id (Claude Desktop) or the literal `"admin-app"` for SERVICE_ROLE+actor calls (see `orchestrator-mcp/index.ts:108`). |
| `user_label` | `TEXT` | NULL | Actor email (lowercased) — the OAuth `user_label`, or `X-Actor-Email` for admin-app calls (`orchestrator-mcp/index.ts:327`). **Surface as `actor_email` in the UI.** |
| `table_name` | `TEXT` | NOT NULL | One of `routine_services`, `testing_services`, `concern_questions`, `concern_subcategories`, `concern_category_guidelines`, `appointment_default_limits`, `closed_dates`. See §3 below — table_name ≠ surface. |
| `operation` | `TEXT` w/ CHECK | NOT NULL | DB CHECK constraint allows only `'upload_md' | 'manual_change' | 'export_md'` (`20260513000100…:140`), but the application code writes `'revert_upload'` too (`scheduler-admin-catalog.ts:646, 937`; `scheduler-admin.ts:113`). **Open question / latent bug — flagged below.** |
| `rows_added` | `INT DEFAULT 0` | NOT NULL | UI column. |
| `rows_modified` | `INT DEFAULT 0` | NOT NULL | UI column. |
| `rows_deactivated` | `INT DEFAULT 0` | NOT NULL | UI column. |
| `md_content_hash` | `TEXT` | NULL | sha256 of uploaded MD. UI column. |
| `diff_summary` | `JSONB` | NULL | Structured per-row diff. Not in the row list, but may be useful for an expandable "details" panel — out of scope for this tool. |
| `error_message` | `TEXT` | NULL | If non-null, the upload failed. UI column. |
| `pre_state_snapshot` | `JSONB` | NULL | Added 2026-05-19 (`20260519140000…:31`). Captured only when an apply succeeds (`scheduler-admin-catalog.ts:600`). UI must report **truthiness only** (`has_snapshot: boolean`), not the bytes. |
| `snapshot_pruned_at` | `TIMESTAMPTZ` | NULL | Added 2026-05-19 (`20260519140000…:32`). Set when the daily `scheduler-admin-snapshot-prune` cron nulls the snapshot at 30-day retention (`20260522190500_fix_snapshot_prune_cron.sql:36-41`). Used to surface accurate revert-button reason. |

RLS is `deny_all` for all roles (`20260513000100…:155-156`); only `SERVICE_ROLE` bypasses it, which is what the orchestrator-mcp uses (`orchestrator-mcp/index.ts:111-113`).

Indexes available for fast queries: `scheduler_admin_audit_log_table_idx(table_name, occurred_at DESC)` (`20260513000100…:149-150`) and `scheduler_admin_audit_log_user_idx(user_label, occurred_at DESC) WHERE user_label IS NOT NULL` (`20260513000100…:151-153`). The new tool's main query pattern (`WHERE table_name = ? ORDER BY occurred_at DESC LIMIT N`) is index-covered.

## 2. Revert eligibility logic

Inside `revertMdUpload` at `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:826-961`, an upload is REJECTED for revert when **any** of the following hold:

| # | Reason | Source | Eligibility code |
| --- | --- | --- | --- |
| 1 | Audit row id does not exist | `scheduler-admin-catalog.ts:839-841` | `not_found` |
| 2 | `operation !== 'upload_md'` (i.e. row is a `revert_upload`, `manual_change`, or `export_md`) — blocks revert-of-revert chains | `scheduler-admin-catalog.ts:843-849` | `not_upload_md` |
| 3 | `snapshot_pruned_at IS NOT NULL` — snapshot nulled by the 30-day prune cron | `scheduler-admin-catalog.ts:851-858` | `snapshot_pruned` |
| 4 | `pre_state_snapshot IS NULL` (apply failed before snapshot was set, or pre-2026-05-19 legacy row) | `scheduler-admin-catalog.ts:860-867` | `no_snapshot` |
| 5 | `table_name` is anything other than `testing_services` or `routine_services` | `scheduler-admin-catalog.ts:874-882` | `table_not_supported` |

**Critical gaps the cross-verify report flagged that ARE NOT currently enforced inside `revertMdUpload`:**

- **30-day calendar cutoff is NOT directly checked.** It is enforced indirectly by the snapshot-prune cron (`20260522190500_fix_snapshot_prune_cron.sql:39-41`). Between days 30 and the next 03:30 UTC cron run, an audit row >30d old still has its snapshot and is technically revertable. The UI may want to compute this client-side too to match the 30-day promise (see open questions §8).
- **"Target already has a successor revert" is NOT checked.** Nothing in `revertMdUpload` queries the audit log for a later `revert_upload` row referencing this `upload_id` (which would be `diff_summary.reverted_upload_id`, set at `scheduler-admin-catalog.ts:943`). This is a real race the GPT cross-verify flagged. The new read tool can compute this in its eligibility pass (described in §4) and the existing `revertMdUpload` should be updated separately (see research-04).
- **`operation` CHECK constraint mismatch:** the DB constraint at `20260513000100…:140` only accepts `'upload_md','manual_change','export_md'`. The application writes `'revert_upload'` at `scheduler-admin-catalog.ts:937` and `scheduler-admin.ts:113`. Either every prior revert silently failed the INSERT (the `console.warn` at `scheduler-admin.ts:141-148` would be the only trace), or the constraint is missing in the deployed DB. This deserves its own investigation. **Flagging — not in this tool's scope.**

The new tool must compute `eligibility` per row using checks 1-5 plus the successor-revert check. The 30-day cutoff is a soft client-side filter only if we choose to model it; otherwise rely on `snapshot_pruned_at`.

## 3. Filtering surface

**Surface filter — the prompt's "10 surface filter values" do not 1:1 map to `table_name`.** The actual `table_name` column has 7 distinct values; three of the prompt's surfaces share a `table_name`:

- `subcategory_descriptions` → `table_name = 'concern_subcategories'` (`scheduler-admin-catalog.ts:1732`)
- `subcategory_service_map` → `table_name = 'concern_subcategories'` (`scheduler-admin-catalog.ts:1052`)
- `question_required_facts` → `table_name = 'concern_questions'` (`scheduler-admin-catalog.ts:2240`)
- `concern_subcategories` (Phase 9b uploader, `upload_concern_category_md`) → `table_name = 'concern_subcategories'` (writes via `scheduler-admin.ts:1801`)

To distinguish them, the new tool needs to inspect `diff_summary` (each uploader writes different keys) — that is brittle. **Better approach (recommended):** treat the `surface_filter` as a logical filter that maps to one or more `table_name` values; if the caller picks one of the three ambiguous surfaces, the tool returns ALL rows for that table_name and the UI lives with the mixed list. This matches today's UX where one surface's "recent uploads" effectively means "the underlying table's recent uploads." If the admin team genuinely needs separate timelines for the three sub-surfaces on `concern_subcategories`/`concern_questions`, that's an open question (§8).

**Pagination:** `getKeytagAuditHistory` (`tools/keytag-extras.ts:694-787`) uses **`limit + 1` to detect truncation with a boolean**, no offset/cursor. This is the convention. I will mirror it (no cursor). Default 10, max 50 per the prompt.

**Filters worth supporting (all optional):**
- `surface_filter` — one of the 10 logical surface names, maps to `table_name` internally
- `limit` — default 10, max 50
- `only_successful` — when true, filter to `error_message IS NULL`. The default "recent uploads" view will likely want successful + failed mixed (failed = visible "I tried to upload but it broke"), so default false
- `only_revertable` — when true, server-side filters to rows that would have `eligibility.eligible = true` (matches `operation = 'upload_md'` AND `error_message IS NULL` AND `pre_state_snapshot IS NOT NULL` AND `snapshot_pruned_at IS NULL` AND `table_name IN ('testing_services','routine_services')`). Useful for the future "show me what I can roll back" panel

Not including `since`/`until` filters in v1 — the UI's MVP needs "last 10 per surface" and nothing more.

Proposed Zod input schema (mirrors `scheduler-tools.ts` style):

```ts
inputSchema: z.object({
  surface_filter: z
    .enum([
      "routine_services",
      "testing_services",
      "subcategory_descriptions",
      "subcategory_service_map",
      "question_required_facts",
      "concern_questions",
      "concern_subcategories",
      "concern_category_guidelines",
      "appointment_default_limits",
      "closed_dates",
    ])
    .optional()
    .describe(
      "Logical surface name. Omit to return audit rows for ALL surfaces. " +
        "Note: subcategory_descriptions, subcategory_service_map, and concern_subcategories " +
        "all share table_name='concern_subcategories' in storage; question_required_facts " +
        "shares table_name='concern_questions' with concern_questions. Filtering by one of " +
        "those three sub-surfaces returns the full table's rows (see research note §3).",
    ),
  limit: z.number().int().min(1).max(50).optional()
    .describe("Max rows to return. Default 10, max 50."),
  only_successful: z.boolean().optional()
    .describe("When true, exclude rows where error_message IS NOT NULL. Default false."),
  only_revertable: z.boolean().optional()
    .describe(
      "When true, only return rows that satisfy ALL revert-eligibility " +
        "preconditions (operation=upload_md, no error, snapshot live, supported table). " +
        "Successor-revert check is NOT applied here (it's reflected per-row in eligibility). " +
        "Default false.",
    ),
}),
```

## 4. Return shape

```ts
interface AuditLogRow {
  id: number;
  uploaded_at: string;                 // ISO from occurred_at
  actor_email: string | null;          // user_label, may be null on very old rows
  oauth_client_id: string | null;
  surface_table: string;               // raw table_name (UI keeps logical surface from its own filter)
  operation: "upload_md" | "manual_change" | "export_md" | "revert_upload";
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  md_content_hash: string | null;
  error_message: string | null;
  has_snapshot: boolean;               // pre_state_snapshot IS NOT NULL AND snapshot_pruned_at IS NULL
  snapshot_pruned_at: string | null;   // expose so UI can show "snapshot expired 12 days ago"
  revert_eligibility: {
    eligible: boolean;
    reasons?: Array<
      | "not_upload_md"
      | "snapshot_pruned"
      | "no_snapshot"
      | "table_not_supported"
      | "upload_failed"
      | "successor_revert_exists"
    >;
    /** When eligible=false and reasons includes 'successor_revert_exists', the id of the revert audit row. */
    superseded_by_audit_log_id?: number;
  };
}

interface ListResult {
  ok: true;
  filters: {
    surface_filter: string | null;
    limit: number;
    only_successful: boolean;
    only_revertable: boolean;
  };
  count: number;
  rows: AuditLogRow[];
  truncated: boolean;     // true when more results exist beyond `limit`
  message: string;        // human-readable summary, mirrors getKeytagAuditHistory line 781-786
}
```

Error path: on a Supabase query failure, throw — the MCP layer turns the throw into `{isError: true}` (`orchestrator-mcp/index.ts:576-592`). The admin-app's `client.ts:251-263` already maps `isError` to `OrchestratorClientError`.

**Implementation note for eligibility computation:** issue the audit-log query first; then, for any row that survives the cheap-rejection checks (operation, snapshot, table), do ONE follow-up `select id, diff_summary from scheduler_admin_audit_log where operation = 'revert_upload' and table_name = ? and diff_summary->>'reverted_upload_id' IN (...)` to detect successor-reverts in one round-trip. Don't N+1.

## 5. Auth boundary

The orchestrator-mcp is admin-only by construction; there is **no per-tool admin flag** in the MCP path. The gate is at the request boundary:

- All non-discovery requests must authenticate (`orchestrator-mcp/index.ts:619-620`)
- The auth function `authenticateRequest` (`orchestrator-mcp/index.ts:274-404`) accepts either:
  - **OAuth bearer** (Claude Desktop) — validates via `oauth_validate_access_token` RPC + audience binding (`:336-396`), or
  - **SERVICE_ROLE bearer + `X-Actor-Email` ending in `@jeffsautomotive.com`** (admin-app path) — `:283-331`, with the `ALLOWED_ADMIN_EMAIL_DOMAIN` constant at `:107`
- The registry is then built with `includeAdminTools: true` unconditionally (`mcp-tool-registry.ts:117-132`, comment at `:115-116`: "orchestrator-mcp is advisor-only, so always include admin tools")

Concretely, the new `list_scheduler_admin_audit_log` tool just goes inside the `adminTools` block in `scheduler-tools.ts` (the `if (includeAdminTools && audit) { ... }` body starting at `:796`) — same neighborhood as `upload_routine_services_md` and `revert_md_upload`. No extra gate is needed inside the tool's execute. The audit attribution (`audit.oauth_client_id`, `audit.display_name`) is already injected by `mcp-tool-registry.ts:126-129`; the new tool doesn't write anything but should still respect that env if we ever add a "filter to my own uploads" mode later.

## 6. Existing similar patterns to mirror

Three nearby read tools, in decreasing similarity to the proposed tool:

- **`getKeytagAuditHistory`** (`supabase/functions/_shared/tools/keytag-extras.ts:653-787`, registered at `orchestrator-tools.ts:514-583`) — closest analog. Same idea: query an audit-log table with filters, return `{ok, filters, count, results, truncated, message}`. Uses `limit + 1` to detect truncation. Default 50, max 200. **This is the template to follow.** Note its filter object echoes the request back at the caller (`filters: { since, until, ... }`) which is a nice debugging aid — worth mirroring.
- **`listWipKeyTags`** (`orchestrator-tools.ts:127-152`, impl at `tools/repair-orders.ts:125`) — trivial empty-input read tool, returns the full list with no pagination. Useful only as the "tools/list" naming reference (camelCase, returns `{ok, results, count}`-ish).
- **`list_routine_services` / `list_concern_questions`** (`scheduler-tools.ts:704-775`) — snake_case, simple filter args. Confirms the naming convention for tools defined in `scheduler-tools.ts` is `snake_case` (vs the keytag tools' `camelCase`). New tool should be **`list_scheduler_admin_audit_log`** (snake_case) since it's added to the scheduler registry.

No tool by another name already exists for this purpose. `getKeytagAuditHistory` was the closest miss the existing `revert_md_upload` description hints at — its description even points to a non-existent tool `list_admin_audits` (`scheduler-tools.ts:1181`), which is presumably the placeholder for the tool we're now designing.

## 7. Test surface

The test file `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` (`:1-162`) **does not mock Supabase or test DB-touching paths.** It tests only the pure helpers (`parseServiceKeyList`, `parseMdTable` acceptance) using `jsr:@std/assert@^1`. Run via `deno test --node-modules-dir=auto …`. Header comment at `:8-10` is explicit: "the end-to-end uploader (dry-run → diff → apply with confirm_token) is smoke-tested via curl after deploy."

A mock-Supabase pattern DOES exist for richer integration-style tests — `supabase/functions/_shared/test-helpers.ts:50-140` exports `createMockSupabaseClient()` / `MockSupabaseClient`, used heavily by the webhook tests (`supabase/functions/keytag-tekmetric-webhook/index.test.ts:23-31`). Those tests inject the mock via a `_setSupabaseClientForTesting(client)` seam in the handler module.

**Recommendation for the new tool's test file** (`scheduler-admin-catalog.test.ts` adjacent or a new `scheduler-admin-audit-log-list.test.ts`):
- Keep the existing parser-tests-only style for *pure logic* (e.g. the eligibility-computation function should be extracted as a pure helper and unit-tested with synthetic audit rows — no DB).
- For end-to-end query shape, either smoke-test via curl after deploy (matches existing pattern) or pull in `createMockSupabaseClient` and add chainable mocks for `.from('scheduler_admin_audit_log').select(...).eq(...).order(...).limit(...)` — heavier but worth it given this tool is purely a DB read.
- Minimum coverage per the GPT cross-verify report (B3): default filter returns rows, surface_filter narrows to that table_name, revert-disabled reasons are populated correctly for each of the 5 + successor-revert cases.

## 8. Open questions

1. **Should `surface_filter` distinguish the three sub-surfaces on `concern_subcategories` and the two on `concern_questions`?** Currently they share a `table_name`. The cheapest path: filter `surface_filter='subcategory_descriptions'` to `table_name='concern_subcategories'` and let the UI live with the mixed list. The expensive path: introduce a second discriminator column on the audit table (e.g. `upload_surface TEXT`) and backfill it from `diff_summary` shape. **Recommend punting** — the cross-verify report already noted "audit trail visible per surface" as a soft requirement, not "audit trail surface-perfect-partitioned." Confirm with Chris.

2. **Should the 30-day cutoff be enforced inside `list_scheduler_admin_audit_log`'s eligibility check too?** Today the cron is the only source of truth and runs daily at 03:30 UTC. A row at day 30 + 5 hours is still revertable in the DB but the UI may want to honor the 30-day promise strictly. Easiest fix: in the eligibility computation, treat `occurred_at < now() - interval '30 days'` as `snapshot_pruned` even if the column is still null. Low-risk addition; recommend including.

3. **Should this tool *also* gate the surface_filter enum to only the V2-snapshot-supported tables and hide legacy surfaces (where eligibility is always false)?** Probably no — the UI cross-verify report wants to display "audit trail" for ALL surfaces, even if revert is unavailable. The `eligibility.reasons` field surfaces the why.

4. **The `revert_upload` DB CHECK constraint issue** flagged in §2 is real and may have caused silent revert-audit-row losses. Out of scope for *this* tool but should be a follow-up task (covered in research-04 §6). Cite: `20260513000100_scheduler_phase1_new_tables.sql:140` vs `scheduler-admin-catalog.ts:937`.

5. **Should the `oauth_client_id` value `"admin-app"` be surfaced as a "source" badge in the UI?** It distinguishes admin-app calls from Claude Desktop calls. Easy to include in the return shape; no extra cost.

---

**Files cited:**
- `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql` (base table, RLS, indexes)
- `supabase/migrations/20260519140000_scheduler_md_edit_v2_schema.sql` (snapshot columns)
- `supabase/migrations/20260522190500_fix_snapshot_prune_cron.sql` (30-day prune cron)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` (revertMdUpload, V2 uploaders, snapshot capture)
- `supabase/functions/_shared/tools/scheduler-admin.ts` (legacy uploaders, audit insert helper, UploadResult)
- `supabase/functions/_shared/tools/keytag-extras.ts` (getKeytagAuditHistory — template tool)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` (test pattern)
- `supabase/functions/_shared/test-helpers.ts` (mock supabase client for richer tests)
- `supabase/functions/_shared/scheduler-tools.ts` (where the new tool goes — admin block at `:796`)
- `supabase/functions/_shared/mcp-tool-registry.ts` (always includeAdminTools=true)
- `supabase/functions/_shared/orchestrator-tools.ts` (listWipKeyTags + getKeytagAuditHistory registrations)
- `supabase/functions/orchestrator-mcp/index.ts` (auth boundary, JSON-RPC dispatch, MCP envelope)
- `admin-app/src/actions/keytag/who-is-on-tag.ts` (Server Action client example)
- `admin-app/src/lib/orchestrator/client.ts` (callKeytagTool — generic client to mirror for the new tool)
- `.claude/work/ai-review-2026-05-25T22-40-58Z.md` (cross-verify report flagging B3)
