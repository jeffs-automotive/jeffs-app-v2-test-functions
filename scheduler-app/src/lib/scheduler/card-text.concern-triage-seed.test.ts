import { describe, it, expect } from "vitest";

import { CARD_TEXT_DEFAULTS } from "@/lib/scheduler/card-text";

/**
 * concern-triage seed drift guard (INV-9 addendum).
 *
 * CARD_TEXT_DEFAULTS["concern_triage"] MUST stay byte-identical to the
 * scheduler_card_text seed rows in
 * supabase/migrations/20260719040000_scheduler_concern_triage.sql (§5/5), so
 * the concern_triage card renders the same copy whether it reads the seeded DB
 * override row or the hardcoded fallback. These literals are transcribed from
 * that migration's INSERT ... VALUES (SQL '' → a single ' in the string).
 */
const SEED = {
  eyebrow: "One more thing",
  title: "What kind of trouble is it?",
  description:
    "I couldn't quite match that to one of our tests — pick the closest and I'll narrow it down.",
  footnote: "",
} as const;

describe("CARD_TEXT_DEFAULTS.concern_triage matches the migration seed", () => {
  it("has exactly the four seeded slots", () => {
    expect(Object.keys(CARD_TEXT_DEFAULTS.concern_triage).sort()).toEqual(
      ["description", "eyebrow", "footnote", "title"],
    );
  });

  it.each(Object.entries(SEED))(
    "slot %s is byte-identical to the seed",
    (slot, expected) => {
      const def = (
        CARD_TEXT_DEFAULTS.concern_triage as Record<
          string,
          { default: string; allowed: readonly string[] } | undefined
        >
      )[slot];
      if (!def) throw new Error(`missing concern_triage slot: ${slot}`);
      expect(def.default).toBe(expected);
      // No merge tokens on any concern_triage slot (matches the seed's '{}').
      expect(def.allowed).toEqual([]);
    },
  );
});
