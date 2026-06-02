import { describe, it, expect } from "vitest";
import {
  customerSchema,
  invoiceSchema,
  faultEnvelopeSchema,
} from "@/lib/qbo/entities";

describe("qbo entities", () => {
  it("customerSchema accepts a minimal customer", () => {
    const c = customerSchema.parse({ Id: "1", SyncToken: "0", DisplayName: "Acme" });
    expect(c.DisplayName).toBe("Acme");
  });

  it("invoiceSchema requires CustomerRef + Line", () => {
    expect(() => invoiceSchema.parse({ TxnDate: "2026-06-02" })).toThrow();
    const inv = invoiceSchema.parse({ CustomerRef: { value: "1" }, Line: [] });
    expect(inv.CustomerRef.value).toBe("1");
  });

  it("faultEnvelopeSchema parses a Fault with a STRING code", () => {
    const f = faultEnvelopeSchema.parse({
      Fault: { Error: [{ code: "003001", Message: "throttle" }], type: "ThrottleFault" },
    });
    expect(f.Fault.Error[0]!.code).toBe("003001");
  });
});
