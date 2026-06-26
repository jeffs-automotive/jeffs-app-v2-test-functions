/**
 * LiveBoardTab — Server Component. The merged Live board (replaces the old
 * Live state + Assign/Release tabs).
 *
 * Fetches the initial board state (tagged in-use + untagged-needs-a-tag) and
 * hands it to the interactive BoardClient (which polls + renders per-row
 * actions). The manual backup tools sit at the bottom.
 */
import { AlertCircle } from "lucide-react";
import { loadBoardState } from "@/lib/keytag/load-board-state";
import { OrchestratorClientError } from "@/lib/orchestrator/client";
import type { BoardState } from "@/lib/orchestrator/types";
import { BoardClient } from "./BoardClient";
import { BoardBackupTools } from "./BoardBackupTools";

export async function LiveBoardTab() {
  let initial: BoardState | null = null;
  let error: string | null = null;
  try {
    initial = await loadBoardState();
  } catch (e) {
    error =
      e instanceof OrchestratorClientError
        ? e.message
        : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return (
    <div className="space-y-6">
      {error || !initial ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Couldn&apos;t load the key tag board.</p>
              <p className="mt-0.5 text-destructive/90">{error}</p>
            </div>
          </div>
        </div>
      ) : (
        <BoardClient initial={initial} />
      )}

      <BoardBackupTools />
    </div>
  );
}
