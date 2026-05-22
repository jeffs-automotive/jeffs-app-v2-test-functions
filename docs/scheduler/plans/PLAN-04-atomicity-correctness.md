---
plan: 04
title: Atomicity + correctness fixes
audit_findings: [I-COR-1, I-COR-2, I-COR-3, I-COR-4, I-COR-5, I-COR-6, I-COR-7, I-COR-8, I-OTH-3]
research_inputs: [research-server-action-atomicity, research-supabase-postgres]
estimated_effort: 4 days
prerequisites: [Plan-01 Phase 4 (critical tests — so refactors don't regress)]
risk_level: medium-high
---

# Plan 04 — Atomicity + correctness fixes

> **Highest correctness-risk plan.** Each change moves a multi-step write into a Postgres RPC, adds a CAS lock for a race window, or strengthens client-input validation. The pattern is well-established but the migrations touch hot paths — Plan 01 Phase 4 tests MUST land first so we can detect regressions.

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **I-COR-1** | correctness | `applyWizardTransition` non-atomic (UPDATE → 2 bubble inserts → revalidate) | 1 |
| **I-COR-2** | correctness | `hydrateSession` stale-reset non-atomic (4 sequential writes) | 1 |
| **I-COR-3** | correctness | `submit-summary` hold race (read-modify-write across queries) | 2 |
| **I-COR-4** | correctness | `submit-vehicle-pick` doesn't validate vehicle_id is in customer's vehicles | 3 |
| **I-COR-5** | correctness | `submit-multi-account-choice` doesn't validate customer_id is in `pending_candidates` | 3 |
| **I-COR-6** | correctness | `submit-summary` proceeds to confirm on verification mismatch | 4 |
| **I-OTH-3** | perf | `WIZARD_REVALIDATE_PATHS` triple revalidates every wizard advance | 5 |
| **I-COR-7** | correctness | 4 FKs `ON DELETE CASCADE` without rationale | 6 |
| **I-COR-8** | correctness | 2 early migrations (`20260508025621`, `20260510131752`) lack idempotency guards | 6 |

## Research summary

- **Postgres RPC wrapped by PostgREST is transactional.** `RAISE EXCEPTION` rolls everything back. supabase-js cannot start transactions directly. Edge Functions need `deno-postgres` for BEGIN/COMMIT. Safe under Supavisor transaction-pool mode. [atomicity §1]
- **CAS pattern:** `UPDATE ... WHERE guard RETURNING ...` is atomic at every isolation level. Zero rows updated = lost race. Use `pg_advisory_xact_lock` (NOT session form) for non-row resources under transaction pooling. SERIALIZABLE works but requires retry on 40001. [§2]
- **IDOR is the dominant Server Action failure mode.** "Query as filter" (`.eq('id', x).eq('owner_id', session.id)`) is the preferred race-free re-validation pattern. RLS silently filters, so assert row counts (not exceptions). [§3]
- **`revalidatePath('/')` has root-layout blast radius + a currently-temporary "all previously visited pages refresh" behavior** — exactly the I-OTH-3 fan-out. `revalidateTag(\`session-${id}\`, 'max')` confines invalidation to one session. The "row-as-truth" pattern often makes revalidation unnecessary for the same tab. [§4 + §6]
- **Verification mismatch — industry standard is the 3-state envelope:** pending → confirmed | needs_review. Idempotency keys + pre-persist our-side record + diff on response + manual-review queue. Surface user-facing "booked but couldn't verify" message; don't silently proceed. [§5]
- **RPC vs Edge vs Inline decision matrix:** RPC for pure DB multi-step writes; Edge for DB+external atomicity; inline for single-row no-atomicity. ~30-line threshold for consolidating into RPC. [§8]
- **`SET search_path = ''` is the 2026-preferred form** (not `SET search_path = public`). Combined with fully-qualified references (`public.users`, `pg_catalog.now()`), eliminates the entire search_path attack surface. [supabase-postgres §7]

---

## Phase 1 — RPC-wrap `applyWizardTransition` + `hydrateSession` reset (I-COR-1 + I-COR-2, ~1.5 days)

### Phase 1A — `apply_wizard_transition` RPC (I-COR-1)

**Goal:** Atomic UPDATE + 2 bubble inserts in one transaction.

**Files:**
- New migration `supabase/migrations/20260522NNNNNN_rpc_apply_wizard_transition.sql`
- `scheduler-app/src/lib/scheduler/wizard/transition.ts:69-93` — replace inline writes with `supabase.rpc('apply_wizard_transition', ...)`

**Migration:**
```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.apply_wizard_transition(
  p_chat_id UUID,
  p_updates JSONB,        -- columns to update on customer_chat_sessions
  p_user_bubble JSONB,    -- {id, content, surface, ...} for customer_chat_messages
  p_assistant_bubble JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER  -- caller's RLS applies; service_role bypasses
SET search_path = ''
AS $$
DECLARE
  v_row public.customer_chat_sessions;
  v_session_id UUID;
BEGIN
  -- 1. UPDATE the row, atomically
  UPDATE public.customer_chat_sessions
     SET
       current_step = COALESCE((p_updates->>'current_step')::text, current_step),
       last_active_at = now(),
       -- ... apply each column from p_updates (jsonb_each-style or explicit per-column)
       updated_at = now()
   WHERE id = p_chat_id
     AND status = 'active'  -- IDOR/race guard: only mutate active sessions
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found_or_inactive'
      USING ERRCODE = 'P0002'; -- so caller can match by code
  END IF;

  -- 2. Insert user bubble
  IF p_user_bubble IS NOT NULL AND p_user_bubble != 'null'::jsonb THEN
    INSERT INTO public.customer_chat_messages
      (id, session_id, role, content, surface, created_at)
    VALUES (
      p_user_bubble->>'id',
      p_chat_id,
      'user',
      p_user_bubble->>'content',
      p_user_bubble->>'surface',
      now()
    );
  END IF;

  -- 3. Insert assistant bubble
  IF p_assistant_bubble IS NOT NULL AND p_assistant_bubble != 'null'::jsonb THEN
    INSERT INTO public.customer_chat_messages
      (id, session_id, role, content, surface, created_at)
    VALUES (
      p_assistant_bubble->>'id',
      p_chat_id,
      'assistant',
      p_assistant_bubble->>'content',
      p_assistant_bubble->>'surface',
      now()
    );
  END IF;

  -- All 3 writes are now in the same transaction. Either all commit or none.
  RETURN row_to_json(v_row)::jsonb;
END;
$$;

-- Lock down: only service_role can call (we use admin client from Server Actions)
REVOKE EXECUTE ON FUNCTION public.apply_wizard_transition FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wizard_transition TO service_role;

COMMIT;
```

**TypeScript caller:**
```typescript
// scheduler-app/src/lib/scheduler/wizard/transition.ts (replace lines 69-93)
const { data: row, error } = await supabase.rpc("apply_wizard_transition", {
  p_chat_id: chatId,
  p_updates: updates as Record<string, unknown>,
  p_user_bubble: userBubble ?? null,
  p_assistant_bubble: assistantBubble ?? null,
});

if (error) {
  if (error.code === "P0002") {
    return { ok: false, error: "session_not_found_or_inactive" };
  }
  await Sentry.captureException(error, { tags: { surface: "applyWizardTransition" } });
  return { ok: false, error: "transition_failed" };
}

// Then revalidate (next phase fixes this scope)
revalidatePath("/", "layout");
return { ok: true, data: row };
```

**Verification:**
1. Vitest test: mock `supabase.rpc` to return `{data: {row}, error: null}` → action returns ok
2. Vitest test: mock to return `{data: null, error: {code: "P0002"}}` → returns `session_not_found`
3. Integration: trigger a wizard advance, verify row + 2 bubbles all present (or all absent on rollback)
4. Force a bubble insert failure inside the RPC → row update also rolls back

### Phase 1B — `hydrate_session_reset` RPC (I-COR-2)

**Goal:** Atomic 4-write reset for stale sessions.

**Migration:**
```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.hydrate_session_reset(
  p_chat_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_hold_token TEXT;
  v_messages_deleted INTEGER;
BEGIN
  -- 1. Get hold_token (for release) + verify row exists
  SELECT hold_token INTO v_hold_token
    FROM public.customer_chat_sessions
   WHERE id = p_chat_id;

  IF v_hold_token IS NULL THEN
    -- Row doesn't exist or no hold to release; still wipe the rest
    NULL;
  END IF;

  -- 2. Release hold by hold_token
  UPDATE public.appointment_holds
     SET released_at = now()
   WHERE hold_token = v_hold_token AND released_at IS NULL;

  -- 3. Release any holds by session_id (defensive)
  UPDATE public.appointment_holds
     SET released_at = now()
   WHERE session_id = p_chat_id AND released_at IS NULL;

  -- 4. Wipe wizard columns on the session row
  UPDATE public.customer_chat_sessions
     SET
       current_step = NULL,
       hold_token = NULL,
       customer_id = NULL,
       vehicle_id = NULL,
       pending_candidates = NULL,
       -- ... ALL columns from RESET_COLUMNS in scheduler-app
       updated_at = now()
   WHERE id = p_chat_id;

  -- 5. Delete chat messages
  DELETE FROM public.customer_chat_messages
   WHERE session_id = p_chat_id;
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  -- All 4 writes are in one transaction
  RETURN jsonb_build_object(
    'messages_deleted', v_messages_deleted,
    'hold_token_released', v_hold_token IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hydrate_session_reset FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hydrate_session_reset TO service_role;

COMMIT;
```

**TypeScript caller:**
```typescript
// scheduler-app/src/lib/scheduler/hydrate-session.ts (replace lines 194-225)
const { data: resetResult, error } = await supabase.rpc("hydrate_session_reset", {
  p_chat_id: chatId,
});

if (error) {
  // bump to error level per audit (currently warning) — failed reset is a real customer-visible issue
  await logError({
    surface: "hydrate_session_reset",
    level: "error",
    chat_id: chatId,
    error: error.message,
  });
  // Continue with stale row; better than crashing
  return existingState;
}
```

**Source RESET_COLUMNS:**
- `scheduler-app/src/lib/scheduler/hydrate-session.ts:64-111`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-start-over.ts:96-141`

These need to be **kept in sync** — Plan 06 Phase X extracts them to a shared `reset-columns.ts`. For now, mirror the column list into the RPC.

**Verification:**
1. Vitest test for RPC + supabase mock
2. Integration: trigger stale reset by setting `last_active_at` to 10 min ago, hit a wizard endpoint → verify all 4 writes happen atomically
3. Force a partial failure (e.g., temporarily change a column name in the RPC) → verify NOTHING happens (transaction rolls back)

**Risk + rollback:**
- MEDIUM. Both RPCs touch hot paths. Plan 01 Phase 4 tests + a thorough wizard E2E run are mandatory before merging.
- Rollback: revert the TypeScript caller to the inline writes. Drop the RPC functions.

---

## Phase 2 — `submit-summary` hold CAS lock (I-COR-3, ~4 hours)

**Goal:** Prevent the race where `mark-abandoned` releases the hold between our read + Tekmetric POST.

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts:285-313`

**Approach:** CAS-claim the hold BEFORE the Tekmetric POST.

**Code:**
```typescript
// BEFORE Tekmetric POST: try to claim the hold (CAS)
const { data: claimedHold, error: claimErr } = await supabase
  .from("appointment_holds")
  .update({ released_at: new Date().toISOString() })
  .eq("session_id", chatId)
  .eq("hold_token", holdToken)
  .is("released_at", null) // CAS guard: only claim if not already released
  .select("*")
  .single();

if (claimErr || !claimedHold) {
  // Lost the race — hold was already released by mark-abandoned or another tab
  await Sentry.captureMessage("hold_lost_race_before_confirm", "warning");
  return {
    ok: false,
    error: "hold_already_released",
    nextStep: "date_pick",
    timestamp: Date.now(),
  };
}

// Hold is now ours. Call Tekmetric.
const confirmResult = await confirmBooking({ /* ... */ });

if (!confirmResult.ok) {
  // Tekmetric failed AFTER we claimed the hold. Best-effort: leave the hold released
  // (it's already released_at-stamped). The hold-reaper cron will clean up if needed.
  return { ok: false, error: "tekmetric_confirm_failed", timestamp: Date.now() };
}

// ... rest of confirm flow
```

**Note:** The CAS-claim uses the `released_at = now()` to mark the hold as "ours" — slightly unusual but reuses the existing mark-abandoned signal. An alternative is a separate `claimed_by_session_id` column, but that's bigger surface.

**Verification:**
1. Vitest test: simulate hold already-released (mock returns 0 rows) → action returns `hold_already_released`
2. Integration: launch 2 concurrent confirm requests → exactly 1 succeeds, the other returns the error
3. Race test: invoke confirm + mark-abandoned in parallel → no Tekmetric appointment lands when the abandon won

**Risk + rollback:**
- LOW-MEDIUM. Customer-facing impact: a small fraction of confirms that previously succeeded with mismatched state will now correctly fail with a retry path.
- Rollback: revert the CAS check, leave the existing read-then-POST behavior.

---

## Phase 3 — Defense-in-depth validation (I-COR-4 + I-COR-5, ~6 hours)

### Phase 3A — `submit-vehicle-pick` validates vehicle ownership (I-COR-4)

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-vehicle-pick.ts:71-129`

**Code:**
```typescript
// After fetching vehicle list from Tekmetric:
const result = await fetchVehiclesForCustomer({ customer_id: row.customer_id });

if (!result.vehicles?.some((v) => v.id === vehicleIdNum)) {
  // IDOR attempt: client picked a vehicle ID that doesn't belong to this customer
  await Sentry.captureMessage("vehicle_id_not_owned_by_customer", "warning", {
    tags: { chat_id: chatId, customer_id: row.customer_id, attempted_vehicle_id: vehicleIdNum },
  });
  return {
    ok: false,
    error: "vehicle_id_not_owned",
    timestamp: Date.now(),
  };
}

// ... proceed with the write
```

### Phase 3B — `submit-multi-account-choice` validates pending_candidates membership (I-COR-5)

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-multi-account-choice.ts:80-94`

**Code:**
```typescript
// Read pending_candidates from the row BEFORE writing customer_id
const { data: row } = await supabase
  .from("customer_chat_sessions")
  .select("pending_candidates")
  .eq("id", chatId)
  .single();

const candidates = row?.pending_candidates as Array<{ id: number }> | null;
if (!candidates?.some((c) => c.id === selected_customer_id)) {
  await Sentry.captureMessage("customer_id_not_in_pending_candidates", "warning", {
    tags: { chat_id: chatId, attempted_customer_id: selected_customer_id },
  });
  return {
    ok: false,
    error: "customer_id_invalid",
    timestamp: Date.now(),
  };
}

// ... proceed with write
```

**Verification (both):**
1. Vitest test: client sends invalid vehicle_id / customer_id → action returns the new error
2. Integration: hand-craft a request with an arbitrary vehicle_id → returns 400-like
3. Happy path still works for valid picks

**Risk + rollback:**
- LOW. Additive validation. Worst case: a legitimate edge case (e.g. vehicle just added to Tekmetric not yet visible to scheduler) gets blocked — bump to a `level: 'info'` log + add a manual escalation path.

---

## Phase 4 — Verification mismatch — 3-state envelope (I-COR-6, ~1 day)

**Goal:** When `confirmResult.verification.ok === false`, do NOT mark the appointment confirmed. Instead: surface "booked but please call" + queue for manual review.

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts:411-419`

**Approach (industry-standard 3-state per research §5):**

1. **Add `appointment_verification_status TEXT CHECK (... IN ('confirmed', 'needs_review'))`** to `customer_chat_sessions` (or use a dedicated `appointment_verifications` table).

2. **On verification mismatch:**
   ```typescript
   if (confirmResult.verification.ok === false) {
     // Tekmetric returned data that differs from what we sent
     await supabase
       .from("customer_chat_sessions")
       .update({
         appointment_id: confirmResult.appointment_id,
         appointment_verification_status: "needs_review",
         appointment_verification_diff: confirmResult.verification.diff, // JSONB of mismatched fields
       })
       .eq("id", chatId);

     await Sentry.captureMessage("appointment_verification_mismatch", "error", { // error level, not warning
       tags: {
         chat_id: chatId,
         appointment_id: confirmResult.appointment_id,
         surface: "submit-summary",
       },
       extra: { diff: confirmResult.verification.diff },
     });

     // Also: create a manual_review row (pattern from keytag) so advisor gets email
     await createSchedulerManualReview({
       category: "appointment_verification_mismatch",
       context: { chat_id: chatId, appointment_id: confirmResult.appointment_id, diff: confirmResult.verification.diff },
       options: [
         { code: "a", label: "Update Tekmetric to match what we sent" },
         { code: "b", label: "Update our records to match Tekmetric" },
         { code: "c", label: "Contact customer to resolve" },
       ],
       issue_summary: "Appointment confirmation succeeded but verification fields don't match",
     });

     // Customer-facing copy
     return {
       ok: true,
       data: { appointment_id: confirmResult.appointment_id },
       customerBubble: "We've booked your appointment, but there was a small issue confirming the details. Our team will call you shortly to verify everything is correct.",
       nextStep: "completed",
       timestamp: Date.now(),
     };
   }
   ```

**Verification:**
1. Force a verification mismatch in test (mock confirm response with `verification.ok: false`)
2. Verify: row has `appointment_verification_status: "needs_review"`, manual_review row created, Sentry error fires
3. Customer sees the "we've booked you but please call" message instead of normal confirmation

**Risk + rollback:**
- MEDIUM. Customer-facing UX change. Test with Chris before rollout.
- Rollback: revert the action change. Existing `needs_review` rows stay tracked.

---

## Phase 5 — revalidate scope reduction (I-OTH-3, ~3 hours)

**Goal:** Replace `revalidatePath("/", "layout")` with `revalidateTag(\`session-${chatId}\`)` to scope cache invalidation per-session.

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/transition.ts:43-46` (the `WIZARD_REVALIDATE_PATHS` constant + its consumers)
- Any RSC component that reads session data — instrument with `next: { tags: [`session-${chatId}`] }`

**Code:**
```typescript
// transition.ts
import { revalidateTag } from "next/cache";

// Replace: WIZARD_REVALIDATE_PATHS.forEach(p => revalidatePath(p));
revalidateTag(`session-${chatId}`);
```

**Instrument session reads:**
```typescript
// Where the session row is fetched (e.g., chat-store.ts or get-current-card.ts)
const session = await fetch(`internal://supabase-session-${chatId}`, {
  next: { tags: [`session-${chatId}`] },
}).then(r => r.json());

// OR if using supabase-js directly, the data isn't fetch-cached by default;
// instead, use unstable_cache:
import { unstable_cache } from "next/cache";

const getCachedSession = (chatId: string) =>
  unstable_cache(
    async () => {
      const { data } = await supabase.from("customer_chat_sessions").select("*").eq("id", chatId).single();
      return data;
    },
    ["session", chatId],
    { tags: [`session-${chatId}`], revalidate: 60 }
  )();
```

**Verification:**
1. 10 concurrent wizard sessions running → advancing session A should NOT invalidate sessions B-J's RSC payloads
2. Same-session advance: still rerenders correctly
3. Performance test: measure RSC re-render count under load before + after

**Risk + rollback:**
- MEDIUM-HIGH. `revalidatePath` is the "safe" hammer; switching to tags means relying on tag instrumentation across every session read. Missing a tag = stale data.
- Mitigation: do this incrementally, starting with the wizard cards only. Keep `revalidatePath("/book-v2", "page")` as a fallback for now (single-path, not "layout" scope).
- Rollback: revert to `revalidatePath`. Slight perf hit but correctness-safe.

---

## Phase 6 — DB hygiene: CASCADE FK rationale + early-migration idempotency (I-COR-7 + I-COR-8, ~3 hours)

### Phase 6A — Document or change CASCADE FKs (I-COR-7)

**4 FKs affected:**
- `customer_chat_messages.session_id` → customer_chat_sessions (CASCADE)
- `appointment_holds.session_id` → customer_chat_sessions (CASCADE)
- `appointment_concerns.session_id` → customer_chat_sessions (CASCADE)
- `scheduler_audit_log.session_id` → customer_chat_sessions (CASCADE)

**Decision per audit recommendation:**
- For `scheduler_audit_log.session_id` — change to `ON DELETE SET NULL` (audit log should OUTLIVE the session for compliance)
- For the other 3 — DOCUMENT inline `COMMENT ON CONSTRAINT` explaining "sessions are never hard-deleted; child rows have no value without parent"

**Migration:**
```sql
BEGIN;

-- 1. Change scheduler_audit_log.session_id to ON DELETE SET NULL
ALTER TABLE public.scheduler_audit_log
  DROP CONSTRAINT scheduler_audit_log_session_id_fkey;

ALTER TABLE public.scheduler_audit_log
  ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE public.scheduler_audit_log
  ADD CONSTRAINT scheduler_audit_log_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.customer_chat_sessions(id)
  ON DELETE SET NULL;

-- 2. Document the OTHER 3 as intentional cascades
COMMENT ON CONSTRAINT customer_chat_messages_session_id_fkey ON public.customer_chat_messages IS
  'ON DELETE CASCADE is intentional: messages have no value without their session, and the customer_chat_sessions lifecycle uses ended_at/abandoned_at timestamps — sessions are NEVER hard-deleted by app code. Cascade is a safety net for future ops cleanup.';

COMMENT ON CONSTRAINT appointment_holds_session_id_fkey ON public.appointment_holds IS
  'ON DELETE CASCADE is intentional: holds have no value without their session. Same lifecycle as customer_chat_messages — sessions are never hard-deleted by app code.';

COMMENT ON CONSTRAINT appointment_concerns_session_id_fkey ON public.appointment_concerns IS
  'ON DELETE CASCADE is intentional: concerns have no value without their session.';

COMMIT;
```

### Phase 6B — Early migration idempotency (I-COR-8)

**Goal:** Audit found `20260508025621_keytag_system.sql` + `20260510131752_scheduler_phase1_schema.sql` lack `IF NOT EXISTS` guards. Partial-apply failure leaves DB unrecoverable.

**Decision:** Since these migrations have ALREADY been applied to all environments, the risk is purely re-application scenarios (fresh `supabase db reset` + push). Two options:

**Option A — Rewrite the migrations** (rewrites git history, can be risky)

**Option B — Add a `README.md` next to migrations/** that documents:
- These two migrations assume clean slate (do not partial-apply)
- The exact failure mode + recovery (drop everything from those migrations, retry)
- All migrations AFTER them are idempotent

**Recommend Option B** for safety. Plan tracks Option A as a future cleanup if/when migration history is rewritten anyway.

**File:**
- New `supabase/migrations/README.md`

```markdown
# Migrations

## Idempotency

All migrations dated `20260513140000_*` and later use `IF NOT EXISTS` / `IF EXISTS` / `ON CONFLICT DO NOTHING` so re-running is safe.

**The 2 foundational migrations** lack these guards (predates the convention):
- `20260508025621_keytag_system.sql`
- `20260510131752_scheduler_phase1_schema.sql`

They assume clean slate. If a partial-apply ever fails, the recovery is:

1. `DROP TABLE` every table the failed migration introduced
2. Retry from the same migration

If you're starting fresh, `supabase db reset` handles this correctly.
```

**Verification:**
1. Apply Phase 6A migration: `npx supabase db push`
2. Verify: `\d+ scheduler_audit_log` shows `ON DELETE SET NULL`
3. Run `\d+ customer_chat_messages` etc to verify the COMMENT lines

**Risk + rollback:**
- LOW. Changing CASCADE → SET NULL on an empty audit table is risk-free. COMMENT statements are docs-only.

---

## Sequence with other plans

- **Plan 01 Phase 4 (critical tests)** MUST land first — refactoring multi-step writes without tests is the highest-bug-risk activity in the whole audit.
- Independent of Plans 02 (observability), 03 (security), 05 (integrations), 06 (tests), 07 (operational).

## Open questions for Chris

1. **CAS lock value:** use `released_at = now()` as the claim mark (simpler, reuses existing column) or add a dedicated `claimed_by_session_id` column (cleaner semantics, bigger migration)? Recommend the former for Phase 2.
2. **Verification-mismatch UX copy:** want to wordsmith the "we've booked you but please call" customer message together before deploy?
3. **revalidatePath scope reduction:** start with just the wizard cards (lower risk) or full session-tag refactor across all RSC reads?
4. **Early-migration rewrite:** Option A (rewrite git history) or Option B (README documentation)? Recommend Option B.

## Success criteria

- [ ] `apply_wizard_transition` RPC handles all wizard advance writes atomically; failure rolls back row + bubbles together
- [ ] `hydrate_session_reset` RPC handles stale-row reset atomically
- [ ] `submit-summary` cannot land a Tekmetric appointment when the hold was concurrently released
- [ ] `submit-vehicle-pick` rejects vehicle_ids not in customer's vehicle list
- [ ] `submit-multi-account-choice` rejects customer_ids not in `pending_candidates`
- [ ] Verification mismatch surfaces a customer-friendly message + creates a manual_review row
- [ ] `WIZARD_REVALIDATE_PATHS` no longer triple-invalidates; `revalidateTag(\`session-${chatId}\`)` confines scope
- [ ] `scheduler_audit_log.session_id` is `ON DELETE SET NULL`; other 3 CASCADE FKs have inline COMMENT rationale
- [ ] `supabase/migrations/README.md` documents the 2 non-idempotent early migrations

**Estimated effort:** 4 days.
