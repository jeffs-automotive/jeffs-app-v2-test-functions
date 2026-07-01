# QTekLink — allow fees to map to Expense accounts (`fee_expense` role)

**Feature:** `qteklink-fee-expense-mapping` · **Date:** 2026-07-01 · **Branch:** `main` (standalone)
**Author:** Claude (with Chris) · **Status:** plan → awaiting approval to implement

---

## 1. Problem

On `/mappings`, mapping the **`gas`** fee (and any fee) to an **Expense** QuickBooks account is
rejected: `posting_role income is not compatible with account type Expense`. Chris wants the gas fee to
post to an expense account so it **offsets** the shop's fuel cost.

## 2. Root cause (traced + adversarially verified — 3-agent workflow)

- A `fee` mapping's posting role is derived **server-side and hardcoded to `income`**
  (`qteklink-app/src/lib/mappings/catalog.ts` `derivePostingRole` L64-90; `case 'fee': return 'income'`).
- The authoritative role→account-type gate `qteklink_role_accepts_type` accepts **only `Income`/`Other
  Income`** for the `income` role. `Expense`/`Other Expense` is accepted only for `cc_fee` /
  `noncash_contra`.
- The `BEFORE INSERT/UPDATE` trigger `qteklink_mappings_validate`
  (`supabase/migrations/20260606020000...:138`) calls that gate on every active write → the Expense
  account is rejected. This is Chris's error.

## 3. Key finding — the journal-entry math needs **no change**

`resolveMappings` buckets every `fee` row by name into `feeAccountsByName = {accountId, passThrough}`,
**dropping `posting_role`** (`sale-je.ts:92-97`). `buildSaleJournalEntry` then **credits** that account
(gross − discount) regardless of type (`sale-builder.ts:310-319`). **Crediting an Expense account is a
contra-expense — it reduces/offsets that expense**, which is exactly the desired result. The daily
rollup, the §8 reconcile gate, and the QBO payload builder are all `posting_role`-agnostic for fees and
stay balanced. So the fix is purely an **enablement** change (let the mapping exist); no builder edits.

## 4. Decisions (Chris, 2026-07-01)

1. **Offset the expense** — the fee is credited to the Expense account (contra-expense); it never
   appears as revenue. (Gross sales and gross expense both drop by the fee vs booking it as income.)
2. **Allow discounts to reduce it** — the fee stays in the normal discount waterfall (**not**
   pass-through). No flag change; Chris leaves the existing "pass-through" checkbox unticked.
3. Fix is **general** — any fee can map to an Income *or* Expense account; `gas` is the first case.

## 5. Design

Introduce a new posting role **`fee_expense`** (accepts `Expense`/`Other Expense`). A fee's role
**follows the account type Chris picks** — resolved server-side, never trusted from the client:

| Picked account type        | Fee posting role | Effect                                   |
|----------------------------|------------------|------------------------------------------|
| `Income` / `Other Income`  | `income`         | Credit as revenue (unchanged)            |
| `Expense` / `Other Expense`| `fee_expense`    | Credit as a contra-expense (offset)      |
| anything else              | (rejected)       | clean validation message                 |

The account picker already lists Expense accounts (grouped by type) — no UI change is required to select
them; only the save-time gate + role derivation change.

## 6. Changes

### 6a. DB migration — `supabase/migrations/20260701_qteklink_fee_expense_role.sql`

Widen **four** gates in lock-step (the store-credit precedent, `20260623210000` + the follow-up
`20260623220000` that patched the **missed** `role_valid` CHECK — we include it up-front here):

```sql
BEGIN;

-- (1) role -> QBO account_type: fee_expense accepts Expense/Other Expense (mirrors cc_fee/noncash_contra).
CREATE OR REPLACE FUNCTION public.qteklink_role_accepts_type(p_role text, p_account_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(
    CASE p_role
      WHEN 'income'              THEN p_account_type IN ('Income','Other Income')
      WHEN 'sales_tax_payable'   THEN p_account_type IN ('Other Current Liability','Long Term Liability')
      WHEN 'tire_fee_payable'    THEN p_account_type IN ('Other Current Liability','Long Term Liability')
      WHEN 'accounts_receivable' THEN p_account_type = 'Other Current Asset'
      WHEN 'undeposited_funds'   THEN p_account_type = 'Other Current Asset'
      WHEN 'cc_fee'              THEN p_account_type IN ('Expense','Other Expense')
      WHEN 'noncash_contra'      THEN p_account_type IN ('Expense','Other Expense')
      WHEN 'store_credit'        THEN p_account_type = 'Other Current Liability'
      WHEN 'fee_expense'         THEN p_account_type IN ('Expense','Other Expense')
      ELSE false
    END, false);
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) TO service_role;

-- (2) kind -> role: fee accepts income OR fee_expense (all other arms preserved verbatim).
CREATE OR REPLACE FUNCTION public.qteklink_kind_accepts_role(p_kind text, p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'labor'                THEN p_role = 'income'
    WHEN 'part_category'        THEN p_role = 'income'
    WHEN 'fee'                  THEN p_role IN ('income','fee_expense')
    WHEN 'sublet'               THEN p_role = 'income'
    WHEN 'tax'                  THEN p_role IN ('sales_tax_payable','tire_fee_payable')
    WHEN 'payment_type'         THEN p_role = 'undeposited_funds'
    WHEN 'noncash_payment_type' THEN p_role IN ('noncash_contra','undeposited_funds')
    WHEN 'system'               THEN p_role IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit')
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) TO service_role;

-- (3) within-row kind<->role CHECK: split fee out to accept income|fee_expense (rest verbatim).
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_kind_role;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_kind_role CHECK (
  (kind IN ('labor','part_category','sublet') AND posting_role = 'income')
  OR (kind = 'fee' AND posting_role IN ('income','fee_expense'))
  OR (kind = 'tax' AND posting_role IN ('sales_tax_payable','tire_fee_payable'))
  OR (kind = 'payment_type' AND posting_role = 'undeposited_funds')
  OR (kind = 'noncash_payment_type' AND posting_role IN ('noncash_contra','undeposited_funds'))
  OR (kind = 'system' AND posting_role IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit'))
);

-- (4) standalone posting_role enum CHECK: add fee_expense (THE gate store-credit forgot -> live failure).
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_role_valid;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_role_valid CHECK (
  posting_role IN ('income','sales_tax_payable','tire_fee_payable','accounts_receivable',
    'undeposited_funds','cc_fee','noncash_contra','store_credit','fee_expense')
);

COMMIT;
```

**Not re-issued:** `qteklink_set_mapping` (the RPC) and the `qteklink_mappings_validate` trigger call the
two functions **by name** — a `CREATE OR REPLACE` of the functions takes effect immediately, so neither
needs a body change. (The store-credit change re-issued the RPC only because it changed the RPC's own
`system` allowlist; there's no fee allowlist in the RPC to touch.) The fee-only `pass_through` guard is
unaffected.

### 6b. App code

- **`qteklink-app/src/lib/mappings/catalog.ts`**
  - `POSTING_ROLES` + `PostingRole`: add `'fee_expense'`.
  - `ROLE_LABELS`: `fee_expense: "Fee → expense (offset)"`.
  - New pure, client-safe helper:
    ```ts
    /** A fee's role follows the CHOSEN account's QBO type: Income => revenue (income);
     *  Expense => contra-expense offset (fee_expense). null for any other type (unmappable). */
    export function feePostingRoleForAccountType(accountType: string | null): PostingRole | null {
      const t = (accountType ?? "").trim();
      if (t === "Income" || t === "Other Income") return "income";
      if (t === "Expense" || t === "Other Expense") return "fee_expense";
      return null;
    }
    ```
- **`qteklink-app/src/lib/dal/mappings.ts`** — add `getMappableAccountType(shopId, qboAccountId)`:
  resolves realm server-side, reads `qbo_accounts.account_type` for that (shop, realm, account); returns
  the type or `null`. (Trigger still re-validates role↔type — fail-closed if it ever diverges.)
- **`qteklink-app/src/actions/mappings.ts`** — for `kind === 'fee'`, derive the role from the account
  type via the two helpers above and reject a non-income/expense pick with a clear message; all other
  kinds unchanged (incl. the `depositsLikeCard` branch).
- **`qteklink-app/src/lib/dal/tekmetric-items.ts`** — L96 reads the **stored** role for a mapped item
  (`m?.postingRole ?? derivePostingRole(...) ?? "income"`) so a `fee_expense` mapping isn't mislabeled.
  (Display-only; the field isn't rendered today, fixed for hygiene.)

**No UI change.** Expense accounts are already selectable (grouped under an `Expense` optgroup). An
optional microcopy hint ("credited to offset the expense") is deferred to the frontend design pair.

### 6c. Tests (TDD — authored before/with the change)

- **pgTAP** `supabase/tests/database/qteklink_mappings.test.sql` (the store-credit lesson — this would
  have caught the missed CHECK): `fee`→Expense w/ `fee_expense` **OK**; `fee`→Income w/ `income` **OK**;
  `fee_expense`→Income **rejected**; `income`→Expense **still rejected**; `fee_expense` on a non-fee kind
  **rejected**; `role_valid` accepts `fee_expense`, rejects a bogus role.
- **Vitest** `catalog.test.ts` (role/label + `feePostingRoleForAccountType` matrix),
  `dal/__tests__/mappings.test.ts` (`getMappableAccountType`),
  `actions/__tests__/mappings.test.ts` (fee+Expense→`fee_expense`; fee+Income→`income`;
  fee+other-type→validation reject), and a `sale-builder.test.ts` case documenting a fee credited to an
  expense account (balances; contra-expense).

## 7. Verify (the `/feature-verify` gate)

`npm run typecheck` · `vitest` · `npm run build` · **`/code-review`** (fail-closed) · pgTAP authored
(run at next `supabase test db` — no local PG stack, per prior note). Gate on `_summary.json.gate`.

## 8. Deploy (Chris approves each)

1. `supabase db push` — apply the migration (CLI; **Chris approves** — it's a DB gate change).
2. `git push origin main` → Vercel auto-deploys `qteklink-app`; confirm **state:READY** + `get_advisors`.
3. Chris maps `gas` → the expense account on `/mappings` and confirms it posts.

## 9. Risks / notes

- **Complete gate set** — the four gates above are the full lock-step set (verified); the `role_valid`
  CHECK (the one missed once) is included. pgTAP covers each.
- **Gas is currently unmapped** (Chris's error = it can't be mapped yet), so this **unblocks
  previously-queued days** — it does **not** reclassify already-posted income. (General note: because the
  JE builder uses the *current* active mapping, re-mapping a fee later would re-post a correction for
  already-posted days via the nightly sales-JE sweep — sales JEs never deposit-lock, so they update
  cleanly. Confirm at implement whether gas was ever previously mapped.)
- **Worktree overlap** — the `qteklink` module claim (held by `~/worktrees/qteklink-fixes`) is being
  ignored per Chris; overlap risk is low (that worktree touches `app/approvals/*`; this touches the
  mapping gates + catalog + tests).
```
