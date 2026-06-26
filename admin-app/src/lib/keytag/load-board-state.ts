import "server-only";

/**
 * loadBoardState — the Live board's data (tagged in-use + untagged-needs-a-tag),
 * shared by the LiveBoardTab Server Component (initial render) and the
 * getBoardState poll action. Two cheap DB reads DIRECT IN-PROCESS via the
 * @jeffs/keytag-core read DAL (Phase 2 of the keytag orchestrator-removal plan,
 * docs/keytag/orchestrator-removal-plan.md §10) — no orchestrator-mcp HTTP hop,
 * no Tekmetric. Throws on read failure — callers handle (server component →
 * error card; action → { kind: 'error' }).
 *
 * Untagged source = open manual reviews of the "needs a tag" categories
 * (work_approved_drift / ar_regression = WIP-needs-tag; ar_no_prior_tag =
 * A/R-without-tag). Reconciled data — NOT raw webhook-lifecycle inference.
 */
import { getWipKeyTags, getManualReviews } from "@/lib/keytag/read-dal";
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

export async function loadBoardState(
  // The direct in-process reads resolve shop_id server-side and carry no
  // per-actor header, so actorEmail is no longer used by the read. It's kept in
  // the signature so the two callers (board-state action + LiveBoardTab) are
  // unchanged; dropping it is a separate Phase-3 cleanup (`_` prefix satisfies
  // the repo's no-unused-vars argsIgnorePattern).
  _actorEmail: string,
): Promise<BoardState> {
  const [tags, reviews] = await Promise.all([
    getWipKeyTags(),
    getManualReviews({ only_open: true, limit: 200 }),
  ]);

  const untagged: UntaggedBoardRow[] = reviews.results
    .filter((r) => !r.resolved_at && UNTAGGED_CATEGORIES.includes(r.category))
    .map((r) => {
      const { why, status_label } = untaggedWhy(r.category);
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
    generated_at: new Date().toISOString(),
    tagged: tags.results,
    untagged,
  };
}
