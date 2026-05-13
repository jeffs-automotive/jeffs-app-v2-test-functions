/**
 * Free-text keyword scanner per chat-design.md §A (lines 2849-2861).
 *
 * Customer-submitted free text (concern_text, customer_notes_text,
 * customer_question) is screened for words that indicate the conversation
 * should be escalated to a human BEFORE Phase 2 sentiment classification
 * lands. The list is intentionally narrow — false positives are very
 * cheap (one extra escalation) but false negatives are expensive
 * (legal / refund / complaint situations that quietly land in the
 * service team's inbox after the fact).
 *
 * Scanning is case-insensitive, whole-word with simple boundary matching
 * (not just substring — "managerial" should NOT match "manager"; "I'm
 * livid" should NOT match "live").
 *
 * Profanity list is deliberately conservative — generic anger words
 * ("damn", "hell") aren't on it; only signals that genuinely warrant
 * human handling.
 */

const KEYWORD_GROUPS = [
  { category: "legal", words: ["lawyer", "attorney", "lawsuit", "sue"] },
  {
    category: "complaint",
    words: ["complaint", "complain", "manager", "supervisor"],
  },
  { category: "financial", words: ["refund", "chargeback", "dispute"] },
  { category: "warranty", words: ["warranty dispute", "warranty claim"] },
  // Conservative profanity — words that clearly indicate the customer
  // wants a human, not the bot.
  { category: "profanity", words: ["fuck", "shit", "bullshit", "fuckin"] },
] as const;

export interface KeywordHit {
  keyword: string;
  category: (typeof KEYWORD_GROUPS)[number]["category"];
}

/**
 * Scan free-text for escalation keywords. Returns the FIRST match (we
 * don't need an exhaustive list — one hit is enough to escalate).
 * Returns null if no match.
 */
export function scanForEscalationKeywords(
  text: string | null | undefined,
): KeywordHit | null {
  if (!text) return null;
  const normalized = text.toLowerCase();

  for (const group of KEYWORD_GROUPS) {
    for (const word of group.words) {
      // Whole-word boundary match. Allows the word to appear at start/end
      // of string OR surrounded by non-word characters. Multi-word
      // entries like "warranty dispute" match with internal spaces
      // preserved.
      const lower = word.toLowerCase();
      const pattern = new RegExp(
        `(^|[^a-z])${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`,
        "i",
      );
      if (pattern.test(normalized)) {
        return { keyword: word, category: group.category };
      }
    }
  }
  return null;
}
