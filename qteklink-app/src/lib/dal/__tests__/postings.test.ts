/**
 * Unit tests for the canonical sourceStateHash — the deterministic source-state
 * fingerprint the daily diff (`dailySourceState`) / approve scope_hash / poster
 * staleness recheck all depend on. (The legacy per-RO postings read + write path was
 * retired by the daily-JE rework step 6.)
 */
import { describe, it, expect } from "vitest";

import { sourceStateHash } from "../postings";

describe("sourceStateHash", () => {
  it("is deterministic + independent of key order", () => {
    expect(sourceStateHash({ a: 1, b: [2, 3] })).toBe(sourceStateHash({ b: [2, 3], a: 1 }));
  });
  it("changes when the value changes", () => {
    expect(sourceStateHash({ total: 1 })).not.toBe(sourceStateHash({ total: 2 }));
  });
});
