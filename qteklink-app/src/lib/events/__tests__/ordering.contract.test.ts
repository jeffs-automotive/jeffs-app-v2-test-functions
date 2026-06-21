/**
 * Contract suite — locks in the RO 153211 incident (backdated unpost/repost ordering) using the
 * SHARED cookie-cutter fixture (@testkit/fixtures/tekmetric). Any code that selects an RO's
 * current state must order by RECEIVED time, not Tekmetric's backdated business time. This is the
 * time-ordering family in .agents/test-kit/README.md; it also proves the shared-kit wiring works.
 */
import { describe, it, expect } from "vitest";
import { backdatedRepostBurst, backdatedRepostExpected } from "@testkit/fixtures/tekmetric";
import { sortByReceivedAtDesc } from "../ordering";

describe("contract: a backdated unpost never shadows the corrective repost (RO 153211)", () => {
  it("orders the burst by RECEIVED time → newest is the repost, not the backdated unpost", () => {
    const newest = sortByReceivedAtDesc(backdatedRepostBurst)[0]!;
    expect(newest.event_kind).toBe(backdatedRepostExpected.event_kind); // ro_posted
    expect(newest.raw_body.data.repairOrderNumber).toBe(backdatedRepostExpected.repairOrderNumber);
    expect(newest.raw_body.data.totalSales).toBe(backdatedRepostExpected.totalSales); // 48651 = the discounted current state
  });

  it("the fixture genuinely exercises the bug — business-time ordering picks the stale unpost", () => {
    const byBusinessTime = [...backdatedRepostBurst].sort(
      (a, b) => Date.parse(b.tekmetric_event_at ?? "") - Date.parse(a.tekmetric_event_at ?? ""),
    );
    expect(byBusinessTime[0]!.event_kind).toBe("ro_unposted"); // what the OLD code selected
    expect(sortByReceivedAtDesc(backdatedRepostBurst)[0]!.event_kind).not.toBe("ro_unposted"); // the fix disagrees
  });
});
