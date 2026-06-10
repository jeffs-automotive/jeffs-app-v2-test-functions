/**
 * LEGACY per-RO/payment postings — READ-ONLY (daily-JE rework step 6).
 *
 * The per-RO posting WRITE path (enqueue / approve / reject / per-RO poster) is retired:
 * posting is bulk-per-day via `qteklink_daily_postings` (daily-postings.ts +
 * daily-poster.ts). What remains here:
 *   - `sourceStateHash` — the canonical deterministic hash, used by the DAILY diff,
 *     the approve scope, and the poster's staleness recheck.
 *   - `listPostings` — the read for the legacy /postings ledger page (the 80 pre-rework
 *     pending rows stay visible as audit until Chris retires them).
 *
 * MULTI-TENANT: realmId from the bound connection; reads scope shop_id + realm_id.
 * No silent failures: errors throw.
 */
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";

/** Recursively key-sorted JSON so the same logical value always hashes the same. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** sha256 of the canonical source state — the staleness fingerprint (daily diff +
 *  approve scope_hash + claim-time recheck all use this). */
export function sourceStateHash(sourceState: unknown): string {
  return createHash("sha256").update(stableStringify(sourceState)).digest("hex");
}

// ─── The legacy ledger read (the read-only /postings page) ────────────────────

export interface PostingJeLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
}

export interface PostingRow {
  id: string;
  kind: string;
  tekmetricRoId: number;
  paymentId: number | null;
  status: string;
  postingVersion: number;
  txnDate: string;
  batchDate: string;
  qboJeId: string | null;
  docNumber: string | null;
  /** Σ debit cents from the proposed JE (the posting's gross) — null if no lines. */
  totalCents: number | null;
  lines: PostingJeLine[];
  sourceStateHash: string | null;
  createdAt: string;
}

interface PostingListDbRow {
  id: string;
  kind: string;
  tekmetric_ro_id: number | string;
  payment_id: number | string | null;
  status: string;
  posting_version: number;
  txn_date: string;
  batch_date: string;
  qbo_je_id: string | null;
  proposed_je: {
    je?: { lines?: { accountId?: string; postingType?: string; amountCents?: number; description?: string }[]; docNumber?: string };
    source_state_hash?: string;
  } | null;
  created_at: string;
}

const OPEN_POSTING_STATUSES = ["pending", "approved", "posting", "failed", "needs_resolution"];
const POSTING_SELECT = "id, kind, tekmetric_ro_id, payment_id, status, posting_version, txn_date, batch_date, qbo_je_id, proposed_je, created_at";

function mapPostingRow(r: PostingListDbRow): PostingRow {
  const rawLines = r.proposed_je?.je?.lines ?? [];
  const lines: PostingJeLine[] = rawLines.map((l) => ({
    accountId: String(l.accountId ?? ""),
    postingType: l.postingType === "Credit" ? "Credit" : "Debit",
    amountCents: Number.isSafeInteger(l.amountCents) ? (l.amountCents as number) : 0,
    description: String(l.description ?? ""),
  }));
  const totalCents = lines
    .filter((l) => l.postingType === "Debit")
    .reduce((a, l) => a + l.amountCents, 0);
  return {
    id: r.id,
    kind: r.kind,
    tekmetricRoId: Number(r.tekmetric_ro_id),
    paymentId: r.payment_id == null ? null : Number(r.payment_id),
    status: r.status,
    postingVersion: r.posting_version,
    txnDate: r.txn_date,
    batchDate: r.batch_date,
    qboJeId: r.qbo_je_id,
    docNumber: r.proposed_je?.je?.docNumber ?? null,
    totalCents: lines.length > 0 ? totalCents : null,
    lines,
    sourceStateHash: r.proposed_je?.source_state_hash ?? null,
    createdAt: r.created_at,
  };
}

/** List the shop's legacy per-RO postings (default: the open statuses) — read-only. */
export async function listPostings(
  shopId: number,
  opts: { statuses?: string[] } = {},
): Promise<{ realmId: string | null; postings: PostingRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, postings: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_postings")
    .select(POSTING_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("status", opts.statuses ?? OPEN_POSTING_STATUSES)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPostings failed: ${error.message}`);

  return { realmId, postings: ((data ?? []) as PostingListDbRow[]).map(mapPostingRow) };
}
