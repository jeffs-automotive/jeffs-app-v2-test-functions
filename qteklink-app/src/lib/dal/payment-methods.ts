/**
 * Payment-methods view DAL (PR2) — the "Payment methods" mapping surface on /mappings.
 * Shows EVERY payment method the shop has actually taken (from the C4 `qteklink_payment_state`
 * projection) and HOW each books to QuickBooks:
 *   - FIRST-CLASS methods (Credit Card / Cash / Check / Affirm / Klarna…) always deposit to
 *     Undeposited Funds (the system mapping) — fixed, not per-method configurable.
 *   - "OTHER" sub-types (Synchrony / Mistake / Tire Protection Plan / Shop Vehicle…) are
 *     CONFIGURABLE: each is either a DEPOSIT (financing that pays the bank → Undeposited, role
 *     `undeposited_funds`, "deposits like a card") or a true CONTRA (warranty/internal → a
 *     contra account, role `noncash_contra`), or still UNMAPPED.
 *
 * The routing (deposit vs contra) is the MAPPING's job — this DAL only reflects it, so the
 * /approvals card + the JE builder + this view all agree. Reuses the existing mapping model
 * (no schema change); the editor reuses `mapTekmetricItemAction` (deposits_like_card).
 *
 * Fat-DAL: the combine logic is the PURE `buildPaymentMethodsView` (unit-tested); this module
 * is the thin DB seam. MULTI-TENANT: shopId server-derived; realmId from the bound connection.
 * No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { listMappings, type MappingRow } from "@/lib/dal/mappings";

/** Friendly labels for the Tekmetric first-class payment-type codes. */
const FIRST_CLASS_LABELS: Record<string, string> = {
  CC: "Credit Card",
  CASH: "Cash",
  CHK: "Check",
  DEBIT: "Debit",
  AFFIRM: "Affirm",
  KLARNA: "Klarna",
};

export type Booking = "deposit_undeposited" | "contra" | "unmapped";

export interface PaymentMethodView {
  /** Display name: "Credit Card", "Synchrony", … */
  label: string;
  /** Tekmetric payment_type code (CC/CASH/CHK/AFFIRM…) or "OTH". */
  code: string;
  /** otherPaymentType.name for an OTH sub-type; null for a first-class method. */
  subtype: string | null;
  seen: number;
  amountCents: number;
  /** How it books today. */
  booking: Booking;
  /** The account it books to (for display); null when unmapped. */
  accountLabel: string | null;
  accountId: string | null;
  /** OTH sub-types are classifiable here; first-class methods are fixed (→ Undeposited). */
  configurable: boolean;
}

export interface PaymentMethodsView {
  realmId: string | null;
  /** The system Undeposited Funds account (where deposit methods land) — label + id (the id
   *  is the target a "deposits like a card" classification maps to). */
  undepositedAccountLabel: string | null;
  undepositedAccountId: string | null;
  methods: PaymentMethodView[];
}

export interface MethodAgg {
  paymentType: string | null;
  subtype: string | null;
  seen: number;
  amountCents: number;
}
interface NoncashMap {
  sourceKey: string;
  role: string;
  accountLabel: string | null;
  accountId: string;
}

/**
 * PURE: combine the distinct seen methods + the active non-cash mappings into the view rows.
 * A first-class method (payment_type != OTH) always books to Undeposited; an OTH sub-type
 * books per its mapping (role undeposited_funds → deposit; noncash_contra → contra; none →
 * unmapped). Sorted: first-class (by $ desc) then OTH (by $ desc).
 */
export function buildPaymentMethodsView(
  aggs: MethodAgg[],
  noncash: NoncashMap[],
  undepositedAccountLabel: string | null,
): PaymentMethodView[] {
  const noncashByKey = new Map(noncash.map((m) => [m.sourceKey.trim().toLowerCase(), m]));
  const out: PaymentMethodView[] = [];
  for (const a of aggs) {
    const isOther = (a.paymentType ?? "").trim().toUpperCase() === "OTH";
    if (!isOther) {
      const code = (a.paymentType ?? "").trim();
      out.push({
        label: FIRST_CLASS_LABELS[code.toUpperCase()] ?? (code || "(unknown)"),
        code,
        subtype: null,
        seen: a.seen,
        amountCents: a.amountCents,
        booking: "deposit_undeposited",
        accountLabel: undepositedAccountLabel,
        accountId: null,
        configurable: false,
      });
    } else {
      const m = a.subtype ? noncashByKey.get(a.subtype.trim().toLowerCase()) : undefined;
      const booking: Booking = !m ? "unmapped" : m.role === "undeposited_funds" ? "deposit_undeposited" : "contra";
      out.push({
        label: a.subtype ?? "(unspecified Other)",
        code: "OTH",
        subtype: a.subtype,
        seen: a.seen,
        amountCents: a.amountCents,
        booking,
        accountLabel: m?.accountLabel ?? null,
        accountId: m?.accountId ?? null,
        configurable: true,
      });
    }
  }
  return out.sort(
    (x, y) => Number(x.configurable) - Number(y.configurable) || y.amountCents - x.amountCents,
  );
}

function accountLabelOf(m: MappingRow): string {
  return m.accountName ? (m.accountNum ? `${m.accountNum} · ${m.accountName}` : m.accountName) : m.qboAccountId;
}

/**
 * Read the payment methods the shop has taken + how each books. Returns {realmId:null,…}
 * when the shop has no connection. Throws (FAIL CLOSED) on any DB error.
 */
export async function listPaymentMethods(shopId: number): Promise<PaymentMethodsView> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, undepositedAccountLabel: null, undepositedAccountId: null, methods: [] };

  const admin = createSupabaseAdminClient();
  const { data: stateData, error } = await admin
    .from("qteklink_payment_state")
    .select("payment_type, other_payment_type, signed_amount_cents")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId);
  if (error) throw new Error(`listPaymentMethods (state) failed: ${error.message}`);

  // Aggregate distinct (payment_type, other_payment_type) → count + Σ abs amount.
  const aggMap = new Map<string, MethodAgg>();
  for (const r of (stateData ?? []) as { payment_type: string | null; other_payment_type: string | null; signed_amount_cents: number | string }[]) {
    const key = `${r.payment_type ?? ""}|${r.other_payment_type ?? ""}`;
    const raw = typeof r.signed_amount_cents === "number" ? r.signed_amount_cents : Number(r.signed_amount_cents);
    const amt = Number.isSafeInteger(raw) ? Math.abs(raw) : 0;
    const cur = aggMap.get(key);
    if (cur) {
      cur.seen += 1;
      cur.amountCents += amt;
    } else {
      aggMap.set(key, { paymentType: r.payment_type, subtype: r.other_payment_type, seen: 1, amountCents: amt });
    }
  }

  const { mappings } = await listMappings(shopId);
  const noncash: NoncashMap[] = mappings
    .filter((m) => m.kind === "noncash_payment_type")
    .map((m) => ({ sourceKey: m.sourceKey, role: m.postingRole, accountLabel: accountLabelOf(m), accountId: m.qboAccountId }));
  const undeposited = mappings.find((m) => m.kind === "system" && m.sourceKey === "undeposited_funds");
  const undepositedAccountLabel = undeposited ? accountLabelOf(undeposited) : null;

  return {
    realmId,
    undepositedAccountLabel,
    undepositedAccountId: undeposited?.qboAccountId ?? null,
    methods: buildPaymentMethodsView([...aggMap.values()], noncash, undepositedAccountLabel),
  };
}
