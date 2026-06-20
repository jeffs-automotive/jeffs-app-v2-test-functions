/**
 * Unit tests for the sale-event observation ordering — the RO 153211 incident: Tekmetric
 * backdated an unpost to a LATER business time than the corrective repost, so business-time
 * ordering dropped the RO. received-time ordering must pick the corrective repost.
 */
import { describe, it, expect } from "vitest";
import { sortByReceivedAtDesc } from "../ordering";

describe("sortByReceivedAtDesc", () => {
  it("a corrective repost (received last) beats a backdated unpost (RO 153211 incident)", () => {
    // Provided in business-time order (the unpost is backdated AHEAD of the repost), but the
    // repost was the last thing actually received.
    const rows = [
      { event_kind: "ro_unposted", received_at: "2026-06-19T20:38:34Z" },
      { event_kind: "ro_sent_to_ar", received_at: "2026-06-15T20:44:21Z" },
      { event_kind: "ro_posted", received_at: "2026-06-19T20:39:17Z" }, // corrective repost — latest observed
    ];
    expect(sortByReceivedAtDesc(rows).map((r) => r.event_kind)).toEqual([
      "ro_posted", // the correction wins, not the backdated unpost
      "ro_unposted",
      "ro_sent_to_ar",
    ]);
  });

  it("is pure (no mutation) and sinks an unparseable timestamp to the bottom", () => {
    const rows = [
      { id: "a", received_at: "not-a-date" },
      { id: "b", received_at: "2026-06-19T00:00:00Z" },
      { id: "c", received_at: "also-bad" },
    ];
    expect(sortByReceivedAtDesc(rows)[0]!.id).toBe("b"); // the only parseable one floats up
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]); // input unchanged
  });
});
