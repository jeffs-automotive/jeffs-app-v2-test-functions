import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Tokens are mocked — token refresh is tokens.test.ts's job; here we test the
// request path. getValidAccessToken(realmId, opts?) → { accessToken, realmId }.
const getTokenMock = vi.fn();
vi.mock("@/lib/qbo/tokens", () => ({
  getValidAccessToken: (...args: unknown[]) => getTokenMock(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { QboClient } from "@/lib/qbo/client";

const BASE = "https://quickbooks.api.intuit.com";
const CI = `${BASE}/v3/company/R/companyinfo/R`;
const INVOICE = `${BASE}/v3/company/R/invoice`;
const CUSTOMER = `${BASE}/v3/company/R/customer`;
const QUERY = `${BASE}/v3/company/R/query`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  getTokenMock.mockReset();
  getTokenMock.mockResolvedValue({ accessToken: "tok-1", realmId: "R" });
});

// Instant retries (no real backoff) for fast tests.
function client() {
  return new QboClient({ backoffMs: [0, 0, 0] });
}

describe("QboClient.request — happy path", () => {
  it("returns parsed JSON on 2xx", async () => {
    server.use(http.get(CI, () => HttpResponse.json({ CompanyInfo: { CompanyName: "Jeff's" } })));
    const data = await client().request("GET", "companyinfo/R");
    expect(data).toEqual({ CompanyInfo: { CompanyName: "Jeff's" } });
  });
});

describe("QboClient.request — retry policy", () => {
  it("retries 429 then succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(CI, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 429 })
          : HttpResponse.json({ ok: true });
      }),
    );
    const data = await client().request("GET", "companyinfo/R");
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does NOT retry a 400 — surfaces a validation Fault", async () => {
    let calls = 0;
    server.use(
      http.get(CI, () => {
        calls += 1;
        return HttpResponse.json(
          { Fault: { Error: [{ Message: "bad", code: "6000" }], type: "ValidationFault" } },
          { status: 400 },
        );
      }),
    );
    await expect(client().request("GET", "companyinfo/R")).rejects.toMatchObject({
      kind: "validation",
    });
    expect(calls).toBe(1);
  });

  it("does NOT retry a 5010 Stale Object — surfaces conflict (single call)", async () => {
    let calls = 0;
    server.use(
      http.post(CUSTOMER, () => {
        calls += 1;
        return HttpResponse.json(
          { Fault: { Error: [{ Message: "Stale Object", code: "5010" }], type: "ValidationFault" } },
          { status: 400 },
        );
      }),
    );
    await expect(
      client().sparseUpdate("Customer", { Id: "5", SyncToken: "1" }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(calls).toBe(1);
  });
});

describe("QboClient.request — 401 forced refresh", () => {
  it("on 401, forces a token refresh + retries once with the new token", async () => {
    getTokenMock
      .mockReset()
      .mockResolvedValueOnce({ accessToken: "tok-1", realmId: "R" })
      .mockResolvedValueOnce({ accessToken: "tok-2", realmId: "R" });
    let calls = 0;
    const seenAuth: string[] = [];
    server.use(
      http.get(CI, ({ request }) => {
        calls += 1;
        seenAuth.push(request.headers.get("authorization") ?? "");
        return calls === 1
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json({ ok: true });
      }),
    );
    const data = await client().request("GET", "companyinfo/R");
    expect(data).toEqual({ ok: true });
    expect(getTokenMock).toHaveBeenNthCalledWith(2, undefined, { forceRefresh: true });
    expect(seenAuth[1]).toBe("Bearer tok-2");
  });
});

describe("QboClient — idempotency + intuit_tid", () => {
  it("create() carries a requestid HELD CONSTANT across a retry", async () => {
    const requestIds: Array<string | null> = [];
    let calls = 0;
    server.use(
      http.post(INVOICE, ({ request }) => {
        calls += 1;
        requestIds.push(new URL(request.url).searchParams.get("requestid"));
        return calls === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ Invoice: { Id: "1" } });
      }),
    );
    await client().create("Invoice", { Line: [] });
    expect(calls).toBe(2);
    expect(requestIds[0]).toBeTruthy();
    expect(requestIds[0]).toBe(requestIds[1]);
  });

  it("captures intuit_tid onto the thrown error", async () => {
    server.use(
      http.get(CI, () =>
        HttpResponse.json(
          { Fault: { Error: [{ Message: "not found", code: "610" }], type: "ValidationFault" } },
          { status: 404, headers: { intuit_tid: "tid-xyz" } },
        ),
      ),
    );
    await expect(client().request("GET", "companyinfo/R")).rejects.toMatchObject({
      kind: "not_found",
      intuitTid: "tid-xyz",
    });
  });
});

describe("QboClient — query + sparse update", () => {
  it("query() POSTs the QBL as application/text to /query", async () => {
    let body = "";
    let contentType = "";
    server.use(
      http.post(QUERY, async ({ request }) => {
        body = await request.text();
        contentType = request.headers.get("content-type") ?? "";
        return HttpResponse.json({ QueryResponse: { Customer: [] } });
      }),
    );
    await client().query("SELECT * FROM Customer");
    expect(body).toBe("SELECT * FROM Customer");
    expect(contentType).toContain("application/text");
  });

  it("sparseUpdate() sends sparse:true + Id + SyncToken", async () => {
    let received: Record<string, unknown> = {};
    server.use(
      http.post(CUSTOMER, async ({ request }) => {
        received = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ Customer: { Id: "5" } });
      }),
    );
    await client().sparseUpdate("Customer", { Id: "5", SyncToken: "2", DisplayName: "New" });
    expect(received.sparse).toBe(true);
    expect(received.Id).toBe("5");
    expect(received.SyncToken).toBe("2");
  });
});
