import { describe, it, expect, vi, beforeEach } from "vitest";

// QboClient methods + token resolver are mocked — these test the thin actions'
// validation, delegation, and error mapping (not the HTTP path).
const requestMock = vi.fn();
const queryMock = vi.fn();
const createMock = vi.fn();
const getValidAccessTokenMock = vi.fn();

vi.mock("@/lib/qbo/client", () => ({
  QboClient: class {
    request = requestMock;
    query = queryMock;
    create = createMock;
  },
}));
vi.mock("@/lib/qbo/tokens", () => ({
  getValidAccessToken: (...args: unknown[]) => getValidAccessTokenMock(...args),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ email: "admin@jeffsautomotive.com" })),
}));
// wrapAdminAction is pure observability — pass through to the inner fn in tests.
vi.mock("@/lib/instrument-action", () => ({
  wrapAdminAction: (_name: string, inner: (...a: unknown[]) => unknown) => inner,
}));

import { getCompanyInfoAction } from "@/actions/qbo/get-company-info";
import { findCustomerAction } from "@/actions/qbo/find-customer";
import { createInvoiceAction } from "@/actions/qbo/create-invoice";
import { QboClientError } from "@/lib/qbo/errors";

beforeEach(() => {
  requestMock.mockReset();
  queryMock.mockReset();
  createMock.mockReset();
  getValidAccessTokenMock.mockReset();
  getValidAccessTokenMock.mockResolvedValue({ accessToken: "t", realmId: "R" });
});

describe("getCompanyInfoAction", () => {
  it("returns CompanyInfo on success (GET companyinfo/<realmId>)", async () => {
    requestMock.mockResolvedValue({ CompanyInfo: { CompanyName: "Jeff's" } });
    const r = await getCompanyInfoAction();
    expect(r).toEqual({ ok: true, data: { CompanyInfo: { CompanyName: "Jeff's" } } });
    expect(requestMock).toHaveBeenCalledWith("GET", "companyinfo/R");
  });

  it("surfaces reconnect_required when not connected", async () => {
    getValidAccessTokenMock.mockRejectedValue(
      new QboClientError("reconnect", { kind: "reconnect_required" }),
    );
    const r = await getCompanyInfoAction();
    expect(r).toMatchObject({ ok: false, reason: "reconnect_required" });
  });
});

describe("findCustomerAction", () => {
  it("queries by DisplayName and returns results", async () => {
    queryMock.mockResolvedValue({ QueryResponse: { Customer: [{ Id: "1" }] } });
    const r = await findCustomerAction({ displayName: "Acme" });
    expect(r).toMatchObject({ ok: true });
    expect(queryMock).toHaveBeenCalledWith(
      "SELECT * FROM Customer WHERE DisplayName = 'Acme'",
    );
  });

  it("escapes single quotes (QBL injection guard)", async () => {
    queryMock.mockResolvedValue({ QueryResponse: { Customer: [] } });
    await findCustomerAction({ displayName: "O'Brien" });
    expect(queryMock).toHaveBeenCalledWith(
      "SELECT * FROM Customer WHERE DisplayName = 'O\\'Brien'",
    );
  });

  it("rejects an empty displayName (validation, no query)", async () => {
    const r = await findCustomerAction({ displayName: "" });
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("createInvoiceAction", () => {
  it("creates an invoice on valid input", async () => {
    createMock.mockResolvedValue({ Invoice: { Id: "42" } });
    const r = await createInvoiceAction({ CustomerRef: { value: "1" }, Line: [] });
    expect(r).toMatchObject({ ok: true });
    expect(createMock).toHaveBeenCalledWith("Invoice", {
      CustomerRef: { value: "1" },
      Line: [],
    });
  });

  it("surfaces a conflict (5010) from the client", async () => {
    createMock.mockRejectedValue(new QboClientError("stale", { kind: "conflict" }));
    const r = await createInvoiceAction({ CustomerRef: { value: "1" }, Line: [] });
    expect(r).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("rejects invalid input (missing CustomerRef)", async () => {
    const r = await createInvoiceAction({ Line: [] } as never);
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
