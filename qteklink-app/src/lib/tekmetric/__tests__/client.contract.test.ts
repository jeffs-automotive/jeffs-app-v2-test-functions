/**
 * Contract suite — Tekmetric client invariants from the shared cookie-cutter kit
 * (@testkit/fixtures/tekmetric), asserted against the real client. Covers the tekmetric
 * pagination, posted-status {5,6}, and customer-name families in test-kit/README.md.
 */
import { describe, it, expect } from "vitest";
import {
  multiPageList, bareArrayList, emptyPage, repairOrderWithStatus, springPage,
  TEKMETRIC_POSTED_STATUS_IDS as KIT_POSTED, customerPerson, customerBusiness, customerBlank,
} from "@testkit/fixtures/tekmetric";
import { listPostedRepairOrders, TEKMETRIC_POSTED_STATUS_IDS, customerDisplayName } from "../client";

/** A fetch double that serves a `pages[]` array indexed by the URL's `?page=N`. */
function mockFetchPages(pages: unknown[]): typeof fetch {
  return (async (url: string) => {
    const m = String(url).match(/[?&]page=(\d+)/);
    const page = m ? Number(m[1]) : 0;
    const body = pages[page] ?? { content: [], totalPages: pages.length, last: true };
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe("contract: Tekmetric pagination drains every shape", () => {
  it("drains a multi-page Spring envelope (reads ALL pages, not just page 0)", async () => {
    const ros = await listPostedRepairOrders(7476, "2026-06-15T00:00:00Z", "2026-06-16T00:00:00Z", {
      token: "t", fetchImpl: mockFetchPages(multiPageList),
    });
    expect(ros).toHaveLength(101); // a full page 0 (100) + page 1 (1) — both drained
    expect(ros.at(-1)!.id).toBe(101); // the page-2 item is only present if it kept paginating
  });

  it("tolerates a bare-array response (no Spring envelope)", async () => {
    const ros = await listPostedRepairOrders(7476, "2026-06-15T00:00:00Z", "2026-06-16T00:00:00Z", {
      token: "t", fetchImpl: mockFetchPages([bareArrayList]),
    });
    expect(ros.map((r) => r.id)).toEqual([1, 2]);
  });

  it("returns nothing for an empty page", async () => {
    const ros = await listPostedRepairOrders(7476, "2026-06-15T00:00:00Z", "2026-06-16T00:00:00Z", {
      token: "t", fetchImpl: mockFetchPages([emptyPage]),
    });
    expect(ros).toEqual([]);
  });
});

describe("contract: Tekmetric posted-status counts BOTH 5 (Posted) and 6 (A/R)", () => {
  it("the shared posted-status set matches the client constant and includes 5 AND 6", () => {
    expect([...TEKMETRIC_POSTED_STATUS_IDS]).toEqual([...KIT_POSTED]);
    expect(TEKMETRIC_POSTED_STATUS_IDS).toContain(5);
    expect(TEKMETRIC_POSTED_STATUS_IDS).toContain(6); // A/R — the easy-to-miss one
  });

  // The status arrives ONLY as the NESTED repairOrderStatus object — parsing a flat
  // repairOrderStatusId nulls every status, empties the safety net's posted filter, and
  // missed_ro_webhook can never fire (RO 153886 / $21.38 incident, 2026-07-06). These run
  // the REAL-shape fixture through the client so that regression is pinned at the parse.
  it("parses repairOrderStatusId from the NESTED repairOrderStatus.id (no flat field exists)", async () => {
    const ros = await listPostedRepairOrders(7476, "2026-07-03T00:00:00Z", "2026-07-04T00:00:00Z", {
      token: "t",
      fetchImpl: mockFetchPages([springPage([repairOrderWithStatus(5), repairOrderWithStatus(6), repairOrderWithStatus(3)], 0, 1)]),
    });
    expect(ros.map((r) => r.repairOrderStatusId)).toEqual([5, 6, 3]);
  });

  it("a status-6 (A/R) RO is treated as posted; an in-progress status is not — through the client parse", async () => {
    const parsed = await listPostedRepairOrders(7476, "2026-07-03T00:00:00Z", "2026-07-04T00:00:00Z", {
      token: "t",
      fetchImpl: mockFetchPages([springPage([repairOrderWithStatus(6), repairOrderWithStatus(5), repairOrderWithStatus(3)], 0, 1)]),
    });
    const isPosted = (ro: { repairOrderStatusId: number | null }) =>
      ro.repairOrderStatusId != null &&
      (TEKMETRIC_POSTED_STATUS_IDS as readonly number[]).includes(ro.repairOrderStatusId);
    expect(isPosted(parsed[0]!)).toBe(true); // A/R posting recognized as a sale
    expect(isPosted(parsed[1]!)).toBe(true);
    expect(isPosted(parsed[2]!)).toBe(false); // Complete, not posted
  });
});

describe("contract: Tekmetric customer-name fallback never renders empty", () => {
  it("person → 'First Last'; business (company in firstName) → company; both-null → 'Customer #<id>'", () => {
    expect(customerDisplayName(customerPerson, customerPerson.id)).toBe("John Smith");
    expect(customerDisplayName(customerBusiness, customerBusiness.id)).toBe("Carmax");
    expect(customerDisplayName(customerBlank, customerBlank.id)).toBe(`Customer #${customerBlank.id}`);
  });
});
