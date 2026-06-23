"use server";

/**
 * getBoardState — the Live board's data, re-read on each poll (~15s).
 *
 * Thin instrumented wrapper over `loadBoardState` (the shared shaping the
 * LiveBoardTab Server Component also uses on first render). Direct-call action
 * the LiveBoardPoller awaits; re-reads the whole (small) in-use set each tick so
 * out-of-band (orchestrator) releases — which emit no webhook — still converge.
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import { loadBoardState } from "@/lib/keytag/load-board-state";
import type { BoardState } from "@/lib/orchestrator/types";

export type BoardStateResult =
  | { kind: "ok"; data: BoardState }
  | { kind: "error"; message: string };

async function getBoardStateImpl(): Promise<BoardStateResult> {
  const { email } = await requireAdmin();
  try {
    const data = await loadBoardState(email);
    return { kind: "ok", data };
  } catch (e) {
    return {
      kind: "error",
      message:
        e instanceof OrchestratorClientError
          ? e.message
          : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const getBoardStateAction = wrapAdminAction(
  "getBoardState",
  getBoardStateImpl,
);
