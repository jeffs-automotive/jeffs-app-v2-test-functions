import { describe, it, expect } from "vitest";
import { getCustomerById, customerDisplayName } from "../client";

function res(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("getCustomerById", () => {
  it("returns the name on 200", async () => {
    const fetchImpl = (async () => res(200, { id: 1, firstName: "John", lastName: "Smith" })) as unknown as typeof fetch;
    const c = await getCustomerById(7476, 44695835, { token: "t", fetchImpl });
    expect(c).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("returns null on 404 (deleted/unknown customer)", async () => {
    const fetchImpl = (async () => res(404, {})) as unknown as typeof fetch;
    expect(await getCustomerById(7476, 1, { token: "t", fetchImpl })).toBeNull();
  });

  it("throws on other HTTP errors (transient → caller retries next build)", async () => {
    const fetchImpl = (async () => res(500, {})) as unknown as typeof fetch;
    await expect(getCustomerById(7476, 1, { token: "t", fetchImpl })).rejects.toThrow(/HTTP 500/);
  });

  it("GETs /customers/{id}?shop= with the Bearer token", async () => {
    let calledUrl = "";
    let auth: string | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calledUrl = url;
      auth = (init.headers as Record<string, string>).Authorization;
      return res(200, { firstName: "A", lastName: "B" });
    }) as unknown as typeof fetch;
    await getCustomerById(7476, 99, { token: "tok", fetchImpl });
    expect(calledUrl).toContain("/customers/99?shop=7476");
    expect(auth).toBe("Bearer tok");
  });
});

describe("customerDisplayName", () => {
  it("person → 'First Last'", () => {
    expect(customerDisplayName({ firstName: "John", lastName: "Smith" }, 1)).toBe("John Smith");
  });
  it("commercial (company in firstName, blank last) → the company name", () => {
    expect(customerDisplayName({ firstName: "Carmax", lastName: null }, 1)).toBe("Carmax");
  });
  it("both blank / null → 'Customer #<id>' (never empty)", () => {
    expect(customerDisplayName({ firstName: " ", lastName: "" }, 44695835)).toBe("Customer #44695835");
    expect(customerDisplayName(null, 7)).toBe("Customer #7");
  });
});
