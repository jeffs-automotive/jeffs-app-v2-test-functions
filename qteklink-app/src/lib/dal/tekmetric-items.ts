/**
 * Tekmetric-item picker DAL (mapping UX) — the list the /mappings dropdown shows. The
 * admin picks an ITEM (not a free-text key); each item is annotated with its current
 * QBO-account mapping. The list = the FIXED items (labor / sublet / tax / A-R /
 * undeposited / cc-fee) + the DISCOVERED items (the distinct fee names, part categories,
 * and non-cash payment types this shop has actually seen, via the discovery RPC). The
 * kind / posting-role / source-key are derived — never typed.
 *
 * Fat-DAL: pure TS, unit-testable. MULTI-TENANT: shopId server-derived; realmId from the
 * bound connection. No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { listMappings } from "@/lib/dal/mappings";
import { derivePostingRole } from "@/lib/mappings/catalog";

export interface TekmetricItem {
  /** Stable form token "kind|sourceKey" — the picker submits this; the action re-derives. */
  token: string;
  kind: string;
  sourceKey: string;
  postingRole: string;
  /** Display name in the dropdown. */
  label: string;
  /** Group heading in the dropdown (Labor / Parts / Fees / …). */
  group: string;
  /** The account this item is mapped to, e.g. "273 · Sales–Shop Supplies"; null if unmapped. */
  mappedAccountLabel: string | null;
  /** The mapped account id — preselects the account dropdown. */
  mappedQboAccountId: string | null;
  /** Current pass-through flag (fees only). */
  passThrough: boolean;
  /** Current "deposits like a card" state (non-cash payment types only) — true when the
   *  item's active mapping uses the undeposited_funds role (a financing/deposit type). */
  depositsLikeCard: boolean;
  /** How many times this item was seen in the data (null for a fixed item). */
  seen: number | null;
}

/** The non-discoverable items — always offered, with their canonical source keys. */
const FIXED_ITEMS: { kind: string; sourceKey: string; label: string; group: string }[] = [
  { kind: "labor", sourceKey: "Labor", label: "Labor", group: "Labor" },
  { kind: "sublet", sourceKey: "Sublet", label: "Sublet", group: "Sublet" },
  { kind: "tax", sourceKey: "Sales Tax", label: "Sales tax", group: "Tax" },
  { kind: "tax", sourceKey: "Tire Tax", label: "Tire fee (PTAL)", group: "Tax" },
  { kind: "system", sourceKey: "accounts_receivable", label: "Accounts receivable", group: "Cash & A/R" },
  { kind: "system", sourceKey: "undeposited_funds", label: "Undeposited funds", group: "Cash & A/R" },
  { kind: "system", sourceKey: "cc_fee", label: "Credit-card fee", group: "Cash & A/R" },
  { kind: "system", sourceKey: "store_credit", label: "Store credit (Customer Store Credit liability)", group: "Cash & A/R" },
];

const DISCOVERED_GROUP: Record<string, string> = {
  fee: "Fees",
  part_category: "Parts",
  noncash_payment_type: "Non-cash payments",
};

interface DiscoveredRow { kind: string; source_key: string; seen: number | string }

/** Normalized (kind, key) for matching items against mappings (casing/space-insensitive). */
function normKey(kind: string, sourceKey: string): string {
  return `${kind}|${sourceKey.trim().toLowerCase()}`;
}

export async function listTekmetricItems(
  shopId: number,
): Promise<{ realmId: string | null; items: TekmetricItem[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, items: [] };

  const admin = createSupabaseAdminClient();
  const { data: discovered, error } = await admin.rpc("qteklink_discover_tekmetric_items", {
    p_shop_id: shopId,
    p_realm_id: realmId,
  });
  if (error) throw new Error(`listTekmetricItems (discover) failed: ${error.message}`);

  // Current mappings, indexed by normalized (kind, sourceKey), with resolved account names.
  const { mappings } = await listMappings(shopId);
  const mapByKey = new Map(mappings.map((m) => [normKey(m.kind, m.sourceKey), m]));
  const accountLabel = (m: (typeof mappings)[number]): string =>
    m.accountName ? (m.accountNum ? `${m.accountNum} · ${m.accountName}` : m.accountName) : m.qboAccountId;

  const items: TekmetricItem[] = [];
  const seenTokens = new Set<string>();

  const pushItem = (kind: string, sourceKey: string, label: string, group: string, seen: number | null): void => {
    const dedupe = normKey(kind, sourceKey);
    if (seenTokens.has(dedupe)) return; // collapse casing variants (e.g. SHIPPING / Shipping)
    seenTokens.add(dedupe);
    const m = mapByKey.get(dedupe);
    items.push({
      token: `${kind}|${sourceKey}`,
      kind,
      sourceKey,
      // Prefer the STORED role for a mapped item (a fee mapped to an expense account
      // is fee_expense, which derivePostingRole can't tell from (kind, sourceKey));
      // fall back to the derived default for an unmapped item.
      postingRole: m?.postingRole ?? derivePostingRole(kind, sourceKey) ?? "income",
      label,
      group,
      mappedAccountLabel: m ? accountLabel(m) : null,
      mappedQboAccountId: m?.qboAccountId ?? null,
      passThrough: m?.passThrough ?? false,
      depositsLikeCard: m?.postingRole === "undeposited_funds",
      seen,
    });
  };

  // Fixed items first.
  for (const f of FIXED_ITEMS) pushItem(f.kind, f.sourceKey, f.label, f.group, null);

  // Discovered items, most-seen casing wins as the representative.
  const disc = ((discovered ?? []) as DiscoveredRow[])
    .map((d) => ({ kind: d.kind, sourceKey: d.source_key, seen: Number(d.seen) || 0 }))
    .sort((a, b) => b.seen - a.seen);
  for (const d of disc) {
    pushItem(d.kind, d.sourceKey, d.sourceKey, DISCOVERED_GROUP[d.kind] ?? "Other", d.seen);
  }

  // Finally, surface any ALREADY-MAPPED item not yet in the list — a mapping is never
  // hidden from the picker even if its item isn't in the current fixed/discovered set.
  for (const m of mappings) {
    pushItem(m.kind, m.sourceKey, m.sourceKey, DISCOVERED_GROUP[m.kind] ?? "Other", null);
  }

  return { realmId, items };
}
