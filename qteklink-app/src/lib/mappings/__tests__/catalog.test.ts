/**
 * Unit tests for the client-safe mapping catalog — the `fee_expense` role + the
 * account-type→fee-role derivation (a fee may credit an income OR an expense
 * account). The DB gate `qteklink_role_accepts_type` is the authority; these
 * constants/helpers mirror it for input validation + display.
 */
import { describe, it, expect } from "vitest";
import {
  POSTING_ROLES,
  ROLE_LABELS,
  derivePostingRole,
  feePostingRoleForAccountType,
} from "../catalog";

describe("POSTING_ROLES / ROLE_LABELS", () => {
  it("includes fee_expense with a label", () => {
    expect(POSTING_ROLES).toContain("fee_expense");
    expect(ROLE_LABELS.fee_expense).toBeTruthy();
  });

  it("every role has a label", () => {
    for (const r of POSTING_ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
  });
});

describe("feePostingRoleForAccountType (a fee's role follows the chosen account)", () => {
  it("Income / Other Income → income (booked as revenue)", () => {
    expect(feePostingRoleForAccountType("Income")).toBe("income");
    expect(feePostingRoleForAccountType("Other Income")).toBe("income");
  });

  it("Expense / Other Expense → fee_expense (credited to offset the expense)", () => {
    expect(feePostingRoleForAccountType("Expense")).toBe("fee_expense");
    expect(feePostingRoleForAccountType("Other Expense")).toBe("fee_expense");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(feePostingRoleForAccountType("  Expense  ")).toBe("fee_expense");
  });

  it("any other type → null (unmappable for a fee)", () => {
    for (const t of ["Bank", "Other Current Asset", "Other Current Liability", "Accounts Receivable", "", null]) {
      expect(feePostingRoleForAccountType(t)).toBeNull();
    }
  });
});

describe("derivePostingRole (unchanged defaults)", () => {
  it("a fee still defaults to income from (kind, sourceKey) alone", () => {
    // The expense variant is chosen by the action from the account type, not here.
    expect(derivePostingRole("fee", "Gas")).toBe("income");
  });

  it("income-bearing kinds map to income; unknown system keys reject", () => {
    expect(derivePostingRole("labor", "Labor")).toBe("income");
    expect(derivePostingRole("system", "cc_fee")).toBe("cc_fee");
    expect(derivePostingRole("system", "bogus")).toBeNull();
  });
});
