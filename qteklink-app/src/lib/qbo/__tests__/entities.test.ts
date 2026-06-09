import { describe, it, expect } from "vitest";
import { accountSchema } from "@/lib/qbo/entities";

describe("accountSchema", () => {
  it("parses a minimal account (Name + Active required)", () => {
    const a = accountSchema.parse({ Name: "Accounts Receivable", Active: true });
    expect(a.Name).toBe("Accounts Receivable");
  });

  it("tolerates a null OR absent AcctNum (nullish — a null AcctNum never drops the account)", () => {
    expect(accountSchema.parse({ Name: "X", Active: true, AcctNum: null }).AcctNum).toBeNull();
    expect(accountSchema.parse({ Name: "X", Active: true }).AcctNum).toBeUndefined();
  });

  it("DROPS a malformed account missing Active (fail-closed)", () => {
    expect(() => accountSchema.parse({ Name: "X" })).toThrow();
  });
});
