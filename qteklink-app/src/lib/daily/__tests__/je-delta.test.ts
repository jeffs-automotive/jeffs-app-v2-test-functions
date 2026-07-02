/**
 * Unit tests for the pure JE-delta module (resolution-workflow Part C) — the
 * cosmetic-suppression + obsoletion logic that keeps wording-only corrections from
 * ever staging (and tripping QBO 6540 on deposited JEs). Fixtures replay the real
 * incidents: 2026-06-26 (one description reworded, $0 delta) and 2026-06-29 (two
 * late Carmax check payments added, +$757.10).
 */
import { describe, it, expect } from "vitest";
import { lineSignature, classifyDelta, isCosmeticDelta, type DeltaSide } from "../je-delta";

function side(over: Partial<DeltaSide>): DeltaSide {
  return {
    docNumber: "QTL-PAY-2026-06-26",
    txnDate: "2026-06-26",
    constituents: { roIds: [], paymentIds: ["p1", "p2"] },
    lines: [
      { accountId: "366", postingType: "Debit", amountCents: 15955 },
      { accountId: "235", postingType: "Credit", amountCents: 15955 },
      { accountId: "366", postingType: "Debit", amountCents: 5000 },
      { accountId: "235", postingType: "Credit", amountCents: 5000 },
    ],
    ...over,
  };
}

describe("lineSignature", () => {
  it("ignores descriptions but is sensitive to account/type/amount and ORDER", () => {
    const a = [{ accountId: "366", postingType: "Debit" as const, amountCents: 100 }];
    const b = [{ accountId: "366", postingType: "Debit" as const, amountCents: 100 }];
    expect(lineSignature(a)).toBe(lineSignature(b));
    expect(lineSignature(a)).not.toBe(lineSignature([{ ...a[0]!, amountCents: 101 }]));
    expect(lineSignature(a)).not.toBe(lineSignature([{ ...a[0]!, accountId: "235" }]));
    expect(lineSignature(a)).not.toBe(lineSignature([{ ...a[0]!, postingType: "Credit" }]));
    // order matters (a reorder is NOT cosmetic — conservative by design)
    const two = [a[0]!, { accountId: "235", postingType: "Credit" as const, amountCents: 100 }];
    expect(lineSignature(two)).not.toBe(lineSignature([...two].reverse()));
  });
});

describe("classifyDelta", () => {
  it("deleted when the correction is a delete", () => {
    expect(classifyDelta("payments", side({}), { ...side({}), isDelete: true }).changeKind).toBe("deleted");
  });

  it("membership — the 2026-06-29 shape: two late payments ADDED", () => {
    const prior = side({ constituents: { roIds: [], paymentIds: ["a", "b"] } });
    const next = side({ constituents: { roIds: [], paymentIds: ["a", "b", "61299633", "61299634"] } });
    const r = classifyDelta("payments", prior, next);
    expect(r.changeKind).toBe("membership");
    expect(r.added).toEqual(["61299633", "61299634"]);
    expect(r.removed).toEqual([]);
  });

  it("descriptions-only — the 2026-06-26 shape: identical members + lines, text reworded", () => {
    // lines carry no description in the signature, so identical structure = descriptions-only
    const r = classifyDelta("payments", side({}), side({}));
    expect(r.changeKind).toBe("descriptions-only");
  });

  it("amounts when a line's cents change with identical membership", () => {
    const next = side({
      lines: [
        { accountId: "366", postingType: "Debit", amountCents: 15956 },
        { accountId: "235", postingType: "Credit", amountCents: 15956 },
        { accountId: "366", postingType: "Debit", amountCents: 5000 },
        { accountId: "235", postingType: "Credit", amountCents: 5000 },
      ],
    });
    expect(classifyDelta("payments", side({}), next).changeKind).toBe("amounts");
  });

  it("uses RO ids for the sales category", () => {
    const prior = side({ constituents: { roIds: [1, 2], paymentIds: [] } });
    const next = side({ constituents: { roIds: [1, 2, 3], paymentIds: [] } });
    const r = classifyDelta("sales", prior, next);
    expect(r.changeKind).toBe("membership");
    expect(r.added).toEqual(["3"]);
  });
});

describe("isCosmeticDelta (strictly conservative)", () => {
  it("TRUE for a descriptions-only rework (6/26 incident: never stage → no 6540)", () => {
    expect(isCosmeticDelta("payments", side({}), side({}))).toBe(true);
  });

  it("FALSE for added payments (6/29 incident: real money is NOT cosmetic)", () => {
    const desired = side({ constituents: { roIds: [], paymentIds: ["p1", "p2", "late"] } });
    expect(isCosmeticDelta("payments", side({}), desired)).toBe(false);
  });

  it("FALSE on any structural difference: amount, account, type, order, count, docNumber, txnDate", () => {
    const base = side({});
    const l = base.lines;
    expect(isCosmeticDelta("payments", base, side({ lines: [{ ...l[0]!, amountCents: 1 }, l[1]!, l[2]!, l[3]!] }))).toBe(false);
    expect(isCosmeticDelta("payments", base, side({ lines: [{ ...l[0]!, accountId: "999" }, l[1]!, l[2]!, l[3]!] }))).toBe(false);
    expect(isCosmeticDelta("payments", base, side({ lines: [{ ...l[0]!, postingType: "Credit" }, l[1]!, l[2]!, l[3]!] }))).toBe(false);
    expect(isCosmeticDelta("payments", base, side({ lines: [...l].reverse() }))).toBe(false);
    expect(isCosmeticDelta("payments", base, side({ lines: l.slice(0, 2) }))).toBe(false);
    expect(isCosmeticDelta("payments", base, side({ docNumber: "QTL-PAY-2026-06-27" }))).toBe(false);
    expect(isCosmeticDelta("payments", base, side({ txnDate: "2026-06-27" }))).toBe(false);
  });

  it("membership is set-based per category (same members, different array order → still cosmetic)", () => {
    const desired = side({ constituents: { roIds: [], paymentIds: ["p2", "p1"] } });
    expect(isCosmeticDelta("payments", side({}), desired)).toBe(true);
  });
});
