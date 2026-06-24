import { describe, it, expect } from "vitest";
import { QboClientError, parseFault } from "@/lib/qbo/errors";

function faultBody(
  code: string,
  type = "ValidationFault",
  message = "boom",
  detail = "detail",
) {
  return {
    Fault: { Error: [{ Message: message, Detail: detail, code, element: "" }], type },
    time: "2026-06-02T00:00:00Z",
  };
}

describe("QboClientError", () => {
  it("is an Error subclass carrying kind/code/httpStatus/intuitTid", () => {
    const e = new QboClientError("x", {
      kind: "validation",
      code: "6000",
      httpStatus: 400,
      intuitTid: "tid-1",
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("QboClientError");
    expect(e.kind).toBe("validation");
    expect(e.code).toBe("6000");
    expect(e.httpStatus).toBe(400);
    expect(e.intuitTid).toBe("tid-1");
  });
});

describe("parseFault — fault code → kind (compliance-folded map)", () => {
  const cases: Array<[string, string]> = [
    ["6000", "validation"],
    ["610", "not_found"],
    ["100", "auth"],
    ["120", "auth"],
    ["003001", "throttle"],
    ["5010", "conflict"],
    ["5030", "not_available"],
    ["6190", "not_available"],
    ["6540", "deposit_locked"], // "Deposited Transaction cannot be changed" — its own kind
  ];
  for (const [code, kind] of cases) {
    it(`maps fault code "${code}" → ${kind}`, () => {
      const e = parseFault({ body: faultBody(code), httpStatus: 400, intuitTid: "tid" });
      expect(e).toBeInstanceOf(QboClientError);
      expect(e.kind).toBe(kind);
      expect(e.code).toBe(code);
      expect(e.intuitTid).toBe("tid");
    });
  }

  it("treats code as a STRING — '003001' (leading zero) is preserved + matched", () => {
    const e = parseFault({ body: faultBody("003001"), httpStatus: 429 });
    expect(e.code).toBe("003001");
    expect(e.kind).toBe("throttle");
  });

  it("falls back to Fault.type when the code is unmapped", () => {
    const e = parseFault({ body: faultBody("999999", "AuthenticationFault"), httpStatus: 401 });
    expect(e.kind).toBe("auth");
  });

  it("falls back to HTTP status when the body is not a Fault envelope", () => {
    expect(parseFault({ body: { foo: "bar" }, httpStatus: 401 }).kind).toBe("auth");
    expect(parseFault({ body: "<<html>>", httpStatus: 429 }).kind).toBe("throttle");
    expect(parseFault({ body: null, httpStatus: 500 }).kind).toBe("unknown");
  });

  it("carries faultType + Message through for surfacing", () => {
    const e = parseFault({
      body: faultBody("6000", "ValidationFault", "Invalid field", "bad"),
      httpStatus: 400,
    });
    expect(e.faultType).toBe("ValidationFault");
    expect(e.message).toContain("Invalid field");
  });
});
