/**
 * Unit tests for the QBO JournalEntry payload builder (C8c) — the cents→dollars boundary.
 */
import { describe, it, expect } from "vitest";
import { toQboJournalEntry, type QboJeLineInput } from "../journal-entry";

const LINES: QboJeLineInput[] = [
  { accountId: "235", postingType: "Debit", amountCents: 11202, description: "RO 152805" },
  { accountId: "272", postingType: "Credit", amountCents: 5386, description: "RO 152805 — Parts" },
  { accountId: "275", postingType: "Credit", amountCents: 5182, description: "RO 152805 — Labor" },
  { accountId: "250", postingType: "Credit", amountCents: 634, description: "RO 152805 — Sales tax" },
];

describe("toQboJournalEntry", () => {
  it("converts cents → dollars and builds the QBO Line shape (create, no Id)", () => {
    const body = toQboJournalEntry({ docNumber: "RO 152805", txnDate: "2026-05-19", privateNote: "QTL|7476|...", lines: LINES });
    expect(body.DocNumber).toBe("RO 152805");
    expect(body.TxnDate).toBe("2026-05-19");
    expect(body.PrivateNote).toBe("QTL|7476|...");
    expect(body.Id).toBeUndefined();
    const line = (body.Line as Record<string, unknown>[])[0]!;
    expect(line.DetailType).toBe("JournalEntryLineDetail");
    expect(line.Amount).toBe(112.02); // 11202 cents → dollars
    expect((line.JournalEntryLineDetail as Record<string, unknown>).PostingType).toBe("Debit");
    expect((line.JournalEntryLineDetail as { AccountRef: { value: string } }).AccountRef.value).toBe("235");
    // debits == credits in dollars
    const lines = body.Line as { Amount: number; JournalEntryLineDetail: { PostingType: string } }[];
    const dr = lines.filter((l) => l.JournalEntryLineDetail.PostingType === "Debit").reduce((a, l) => a + l.Amount, 0);
    const cr = lines.filter((l) => l.JournalEntryLineDetail.PostingType === "Credit").reduce((a, l) => a + l.Amount, 0);
    expect(dr).toBeCloseTo(cr, 2);
  });

  it("drops zero-amount lines", () => {
    const body = toQboJournalEntry({ docNumber: "RO 1", txnDate: "2026-05-19", privateNote: "m",
      lines: [...LINES, { accountId: "252", postingType: "Credit", amountCents: 0, description: "no tire fee" }] });
    expect((body.Line as unknown[]).length).toBe(4); // the zero line omitted
  });

  it("builds an UPDATE (full-replacement) with Id + SyncToken + sparse:false", () => {
    const body = toQboJournalEntry({ docNumber: "RO 1", txnDate: "2026-05-19", privateNote: "m", lines: LINES, id: "QBO-9", syncToken: "3" });
    expect(body.Id).toBe("QBO-9");
    expect(body.SyncToken).toBe("3");
    expect(body.sparse).toBe(false);
  });

  it("FAILS CLOSED on an UPDATE without the current SyncToken (never guesses '0')", () => {
    expect(() =>
      toQboJournalEntry({ docNumber: "RO 1", txnDate: "2026-05-19", privateNote: "m", lines: LINES, id: "QBO-9" }),
    ).toThrow(/requires the current SyncToken/);
  });

  it("FAILS CLOSED on a negative or non-integer cents amount", () => {
    expect(() => toQboJournalEntry({ docNumber: "x", txnDate: "2026-05-19", privateNote: "m", lines: [{ accountId: "1", postingType: "Debit", amountCents: -5, description: "" }] })).toThrow(/invalid cents/);
    expect(() => toQboJournalEntry({ docNumber: "x", txnDate: "2026-05-19", privateNote: "m", lines: [{ accountId: "1", postingType: "Debit", amountCents: 10.5, description: "" }] })).toThrow(/invalid cents/);
  });

  it("refuses to build a JournalEntry with no (non-zero) lines", () => {
    expect(() => toQboJournalEntry({ docNumber: "x", txnDate: "2026-05-19", privateNote: "m", lines: [] })).toThrow(/no lines/);
  });
});
