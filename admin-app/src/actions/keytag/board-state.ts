"use server";

/**
 * getBoardState — the Live board's data, re-read on each poll.
 *
 * Two cheap DB reads (no Tekmetric):
 *   - tagged: listWipKeyTags (the in-use keytags set, now with customer_name).
 *   - untagged: open manual reviews of the "needs a tag" categories
 *     (work_approved_drift / ar_regression = WIP-needs-tag; ar_no_prior_tag =
 *     A/R-without-tag). This is the RECONCILED source — NOT raw webhook-
 *     lifecycle inference, which the research proved surfaces paid-out ROs.
 *
 * Direct-call action (the LiveBoardPoller awaits it ~every 15s). Re-reading the
 * whole (small) in-use set each tick keeps it authoritative even for out-of-band
 * (orchestrator) releases that emit no webhook event.
 */
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import {
  callKeytagTool,
  OrchestratorClientError,
} from "@/lib/orchestrator/client";
import type {
  BoardState,
  ManualReviewCategory,
  UntaggedBoardRow,
} from "@/lib/orchestrator/types";

const UNTAGGED_CATEGORIES: ManualReviewCategory[] = [
  "work_approved_drift",
  "ar_regression",
  "ar_no_prior_tag",
];

function whyLabel(cat: ManualReviewCategory): { why: string; status_label: string } {
  switch (cat) {
    case "work_approved_drift":
      return {
        why: "Work approved, but the RO had prior tag history — needs a tag.",
        status_label: "WIP",
      };
    case "ar_regression":
      return {
        why: "Back in WIP, but its tag was already released — needs a tag.",
        status_label: "WIP",
      };
    case "ar_no_prior_tag":
      return {
        why: "A/R repair order with no key tag tracked.",
        status_label: "A/R",
      };
    default:
      return { why: "Needs a key tag.", status_label: "—" };
  }
}

export type BoardStateResult =
  | { kind: "ok"; data: BoardState }
  | { kind: "error"; message: string };

async function getBoardStateImpl(): Promise<BoardStateResult> {
  const { email } = await requireAdmin();
  try {
    const [tags, reviews] = await Promise.all([
      callKeytagTool("listWipKeyTags", {}, email),
      callKeytagTool("listManualReviews", { only_open: true, limit: 200 }, email),
    ]);

    const untagged: UntaggedBoardRow[] = reviews.results
      .filter((r) => !r.resolved_at && UNTAGGED_CATEGORIES.includes(r.category))
      .map((r) => {
        const { why, status_label } = whyLabel(r.category);
        return {
          ro_id: r.ro_id,
          ro_number: r.ro_number,
          category: r.category,
          review_code: r.code,
          why,
          status_label,
          issued_at: r.issued_at,
          ro_url: null,
        };
      });

    return {
      kind: "ok",
      data: {
        generated_at: new Date().toISOString(),
        tagged: tags.results,
        untagged,
      },
    };
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
