"use server";

/**
 * QBO connection actions — the in-app Disconnect (soft). Thin (the QTekLink
 * pattern): requireQtekUser() FIRST, gate to admin (plan §14), delegate to the
 * connection DAL, return a typed QboActionResult. Connect/reconnect is a redirect
 * route (app/qbo/connect), not an action. Shaped for React 19 useActionState.
 */
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { disconnectQbo, type DisconnectResult } from "@/lib/dal/connection";
import { qboFailure, type QboActionResult } from "./qbo/result";

type DisconnectState = QboActionResult<DisconnectResult>;

async function disconnectImpl(
  _prev: DisconnectState | null,
  _formData: FormData,
): Promise<DisconnectState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") {
      return {
        ok: false,
        reason: "validation",
        message: "Admin role required to disconnect QuickBooks.",
        timestamp: Date.now(),
      };
    }
    const data = await disconnectQbo(shopId);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const disconnectQboAction = wrapQtekAction("qboDisconnect", disconnectImpl);
