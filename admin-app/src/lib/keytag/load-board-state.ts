import "server-only";

/**
 * loadBoardState — the Live board's data (tagged in-use + untagged-needs-a-tag),
 * shared by the LiveBoardTab Server Component (initial render) and the
 * getBoardState poll action. Cheap DB reads via the orchestrator, no Tekmetric.
 * Throws on transport failure — callers handle (server component → error card;
 * action → { kind: 'error' }).
 *
 * Untagged sources (merged):
 *   1. OPEN manual reviews of the "needs a tag" categories (work_approved_drift /
 *      ar_regression = WIP-needs-tag; ar_no_prior_tag = A/R-without-tag).
 *   2. released_wip — ROs whose tag was released while still in WIP and that have
 *      no tag now (from keytag_audit_log, recency-windowed). Keeps a just-released
 *      WIP RO on the board so it can be re-tagged in place instead of vanishing
 *      (2026-06-24 board-release-fix). De-duped against (1): reviews win.
 */
import { callKeytagTool } from "@/lib/orchestrator/client";
import type {
  BoardState,
  ManualReviewCategory,
  UntaggedBoardRow,
} from "@/lib/orchestrator/types";

export const UNTAGGED_CATEGORIES: ManualReviewCategory[] = [
  "work_approved_drift",
  "ar_regression",
  "ar_no_prior_tag",
];

export function untaggedWhy(cat: ManualReviewCategory): {
  why: string;
  status_label: string;
} {
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

export async function loadBoardState(actorEmail: string): Promise<BoardState> {
  const [tags, reviews, releasedWip] = await Promise.all([
    callKeytagTool("listWipKeyTags", {}, actorEmail),
    callKeytagTool("listManualReviews", { only_open: true, limit: 200 }, actorEmail),
    callKeytagTool("listReleasedWipNeedingTag", {}, actorEmail),
  ]);

  const reviewRows: UntaggedBoardRow[] = reviews.results
    .filter((r) => !r.resolved_at && UNTAGGED_CATEGORIES.includes(r.category))
    .map((r) => {
      const { why, status_label } = untaggedWhy(r.category);
      return {
        ro_id: r.ro_id,
        ro_number: r.ro_number,
        kind: "review" as const,
        category: r.category,
        review_code: r.code,
        why,
        status_label,
        issued_at: r.issued_at,
        ro_url: null,
      };
    });

  // De-dupe: an RO already surfaced by an open review must not ALSO appear as a
  // released_wip row. Reviews win — they carry a real code + resolution path.
  const reviewRoNumbers = new Set(
    reviewRows
      .map((r) => r.ro_number)
      .filter((n): n is number => n !== null),
  );

  const releasedWipRows: UntaggedBoardRow[] = releasedWip.results
    .filter((r) => !reviewRoNumbers.has(r.ro_number))
    .map((r) => ({
      ro_id: r.ro_id,
      ro_number: r.ro_number,
      kind: "released_wip" as const,
      category: null,
      review_code: `rw-${r.ro_number}`,
      why: `Tag ${r.released_tag} was released while the RO was still in WIP — assign a new tag if the keys are back.`,
      status_label: "WIP",
      issued_at: r.released_at,
      ro_url: r.ro_url,
      released_tag: r.released_tag,
    }));

  return {
    generated_at: new Date().toISOString(),
    tagged: tags.results,
    untagged: [...reviewRows, ...releasedWipRows],
  };
}
