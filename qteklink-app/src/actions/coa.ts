"use server";

/**
 * refreshCoaAction — admin-triggered Chart-of-Accounts refresh (C1).
 *
 * Thin action (the QTekLink pattern): requireQtekUser() FIRST, gate to the
 * admin role (only admins manage config per plan §14), delegate to the
 * syncQboAccounts DAL, return a typed QboActionResult. Read-only against QBO
 * (queries the Account entity) + upserts the local mirror — NO QBO writes.
 *
 * Shaped for React 19 `useActionState` — (prevState, formData) in, state out.
 */
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { syncQboAccounts } from "@/lib/dal/coa";
import { qboFailure, type QboActionResult } from "./qbo/result";

type RefreshCoaState = QboActionResult<{ realmId: string; synced: number }>;

/**
 * Re-throw Next.js control-flow errors — redirect()/notFound() carry a `NEXT_*`
 * digest and MUST propagate (e.g. requireQtekUser() redirecting an unauthorized
 * user); everything else is turned into the failure envelope.
 */
function isNextControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

async function refreshCoaImpl(
  _prev: RefreshCoaState | null,
  _formData: FormData,
): Promise<RefreshCoaState> {
  // Full-body guard (observability rule 1/2): auth + RPC + QBO work all run
  // inside the try, so nothing escapes as a raw Server Action rejection — except
  // Next's redirect/notFound, which we re-throw so they still navigate.
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") {
      return {
        ok: false,
        reason: "validation",
        message: "Admin role required to refresh the chart of accounts.",
        timestamp: Date.now(),
      };
    }
    const data = await syncQboAccounts(shopId);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    return qboFailure(e);
  }
}

export const refreshCoaAction = wrapQtekAction("qboRefreshCoa", refreshCoaImpl);
