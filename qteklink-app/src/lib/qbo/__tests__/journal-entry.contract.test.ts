/**
 * Contract suite — QBO JournalEntry invariants from the shared cookie-cutter kit
 * (@testkit/fixtures/qbo), asserted against the real toQboJournalEntry builder. Covers the
 * money + qbo families in .agents/test-kit/README.md (balanced JE, positive-Amount+PostingType,
 * fail-closed on corrupt money, SyncToken-required update).
 */
import { describe, it, expect } from "vitest";
import {
  balancedJe, zeroLineJe, negativeCentsJe, nonIntegerCentsJe, updateJe, updateJeNoSyncToken,
} from "@testkit/fixtures/qbo";
import { toQboJournalEntry } from "../journal-entry";

type QboLine = { Amount: number; JournalEntryLineDetail: { PostingType: string } };
const linesOf = (body: Record<string, unknown>) => body.Line as QboLine[];
const sumBy = (ls: QboLine[], type: string) =>
  ls.filter((l) => l.JournalEntryLineDetail.PostingType === type).reduce((a, l) => a + l.Amount, 0);

describe("contract: QBO JournalEntry money invariants", () => {
  it("a balanced JE stays balanced across the cents→dollars boundary (Σdebit === Σcredit, no rounding drift)", () => {
    const ls = linesOf(toQboJournalEntry(balancedJe));
    expect(sumBy(ls, "Debit")).toBeCloseTo(sumBy(ls, "Credit"), 2);
  });

  it("every line has a POSITIVE Amount and a PostingType ∈ {Debit, Credit} (sign is direction, not magnitude)", () => {
    for (const l of linesOf(toQboJournalEntry(balancedJe))) {
      expect(l.Amount).toBeGreaterThan(0);
      expect(["Debit", "Credit"]).toContain(l.JournalEntryLineDetail.PostingType);
    }
  });

  it("drops a zero-amount line (never an empty $0 line)", () => {
    expect(linesOf(toQboJournalEntry(zeroLineJe))).toHaveLength(balancedJe.lines.length);
  });

  it("FAILS CLOSED on negative or non-integer cents (never posts corrupt money)", () => {
    expect(() => toQboJournalEntry(negativeCentsJe)).toThrow();
    expect(() => toQboJournalEntry(nonIntegerCentsJe)).toThrow();
  });

  it("an UPDATE carries Id + SyncToken (full replace); a missing SyncToken FAILS CLOSED", () => {
    expect(toQboJournalEntry(updateJe)).toMatchObject({ Id: "26058", SyncToken: "4", sparse: false });
    expect(() => toQboJournalEntry(updateJeNoSyncToken)).toThrow(/SyncToken/);
  });
});
