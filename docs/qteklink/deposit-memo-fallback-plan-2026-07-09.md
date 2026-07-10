# QTekLink — stop sending the QTL PrivateNote so the deposit screen shows line memos again

**Date:** 2026-07-09 · **Feature:** `qteklink-deposit-memo-fallback` · **Approved:** Chris ("option a", 2026-07-09)

## Why

On 2026-07-08 the QBO **bank-deposit screen** ("Select the payments included in this deposit")
stopped rendering the **line Description** in its MEMO column for undeposited JournalEntry rows and
began rendering the **JE-level PrivateNote** instead. Every QTekLink daily JE carries the machine
marker (`QTL|7476|{realm}|day=…|{category}|v{n}`) in PrivateNote, so every undeposited row shows the
same opaque string — the office manager can no longer tell **check vs credit card vs cash** when
building deposits. This matters daily.

Facts established (API dumps, 2026-07-08/09):

- The JEs themselves are untouched and correct: `SyncToken=0`, `Created==LastUpdated`, all per-line
  descriptions intact on 26703 / 26709 / 26749–26751. Display-side change at Intuit (coincident with
  their 7/8 all-region "Login Issue" major incident); no status-page or forum acknowledgment; still
  broken on 7/9. Chris ruled out waiting on Intuit.
- **Live probe (Chris-approved):** a 1-cent JE (26777, since deleted) created **without** PrivateNote
  → the deposit screen MEMO column **falls back to the line Description**. Screenshot-verified.
- The marker is not load-bearing in QBO: create/update idempotency rides on the **requestid**
  (content-keyed, audit 2026-06-12); **no code queries QBO by PrivateNote** (grep-verified); the
  ledger (`qteklink_daily_postings.proposed_je.marker`) keeps the marker for internal audit.

## Locked decisions

1. **Send NO PrivateNote at all** (omit the field, not `""`): the probe proved absence triggers the
   fallback; empty-string behavior is unproven. On full-replacement UPDATEs (`sparse:false`) the
   omitted field clears any previously-posted marker — desired convergence for future corrections.
2. **Keep the marker in the ledger** (`dailyPrivateNoteMarker`, `proposed_je.marker`) — unchanged
   generation and storage; it simply stops being sent to QBO.
3. **One-off sweep script** clears PrivateNote from already-posted, still-undeposited payments/fees
   JEs (sales JEs never touch Undeposited Funds → never on that screen → skipped). Deposit-locked
   JEs (QBO error 6540) are skipped and reported — QBO forbids touching them, and their deposited
   rows already display correctly from the Deposit's own stored line copies.
4. Sweep is **committed** (`qteklink-app/scripts/qbo-clear-daily-je-memos.mjs`), rerunnable, and
   fail-safe per-JE; after each successful QBO update it writes the **new SyncToken back to the
   ledger row** so future corrections don't fail closed on a stale token.
5. No UI change (backend posting behavior + ops script only) → **no design spec**.

## File-by-file changes (qteklink-app)

| File | Change |
|---|---|
| `src/lib/qbo/journal-entry.ts` | `QboJeInput.privateNote` → optional; only set `body.PrivateNote` when non-empty. Doc comment: marker is ledger-internal; QBO gets no JE-level memo (deposit-screen fallback, 2026-07-09). |
| `src/lib/dal/daily-poster.ts` | Stop passing the marker to the builder (send no `privateNote`). Comment points here. |
| `src/lib/dal/daily-postings.ts` | Doc comments only: marker is ledger-internal audit, not sent to QBO. |
| `src/lib/qbo/__tests__/journal-entry.test.ts` | New assertions: no `privateNote` (or empty) → `PrivateNote` **absent** from body; non-empty still passes through. |
| `src/lib/dal/__tests__/daily-poster.test.ts` | Line 137 expectation: posted body has **no** `PrivateNote` (replaces `stringContaining("day=…")`). |
| `src/lib/dal/__tests__/daily-postings.test.ts` | Unchanged (marker format test stays — ledger-internal). |
| `scripts/qbo-clear-daily-je-memos.mjs` | New one-off sweep (above). Dry-run by default; `--apply` to execute; per-JE verify-after (re-fetch, assert PrivateNote gone). |

Out of scope: test-kit fixtures (structural only, no PrivateNote assertions), `dailyPrivateNoteMarker`
removal (kept, ledger audit), Option B (per-method JEs) — falls back on the table only if Intuit
later hard-wires the column to the JE memo *and* removes the fallback.

## Phasing

Single commit: code + tests + sweep script. Then deploy (git push → Vercel, confirm READY), then run
the sweep with `--apply`, then verify on the live deposit screen.

## Verification

- `npm run typecheck`, `npm run test` (vitest), `npm run lint`, `npm run build` — clean in qteklink-app.
- `/code-review` gate on changed files — `gate=pass`, all agents complete.
- `node --check scripts/qbo-clear-daily-je-memos.mjs`.
- Post-deploy: sweep dry-run → `--apply` → per-JE verify (PrivateNote absent, ledger SyncToken synced).
- Human check (office manager): deposit-screen MEMO column shows per-payment descriptions again for
  swept rows and for the next morning's JEs.

## Open questions

None — approach locked by the live probe and Chris's approval.
