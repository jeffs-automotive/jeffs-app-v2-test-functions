import { describe, it, expect } from "vitest";
import {
  validateMdContent,
  truncateDiffForDisplay,
  MAX_MD_BYTES,
  MAX_DIFF_DISPLAY_ROWS,
} from "@/lib/scheduler/md-file-utils";

/**
 * Pure client-side validators for the schedulerconfig MD-upload UX (no network/
 * DOM). These pin the §11 plan limits: empty reject, 2 MB cap, UTF-8 sanity,
 * and the 500-row diff truncation.
 */
describe("validateMdContent", () => {
  it("accepts non-empty UTF-8 content and reports byte length", () => {
    const r = validateMdContent("# Routine Services\n- Oil change\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toBeGreaterThan(0);
  });

  it("rejects empty / whitespace-only content", () => {
    expect(validateMdContent("")).toMatchObject({ ok: false, error_code: "empty_file" });
    expect(validateMdContent("   \n\t ")).toMatchObject({ ok: false, error_code: "empty_file" });
  });

  it("rejects content over the 2 MB cap", () => {
    const big = "x".repeat(MAX_MD_BYTES + 1);
    expect(validateMdContent(big)).toMatchObject({ ok: false, error_code: "file_too_large" });
  });

  it("rejects content with the UTF-8 replacement character", () => {
    expect(validateMdContent("bad � byte")).toMatchObject({
      ok: false,
      error_code: "invalid_utf8",
    });
  });

  it("counts bytes (not chars) — a multi-byte char is > 1 byte", () => {
    const r = validateMdContent("é"); // 2 UTF-8 bytes
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toBe(2);
  });
});

describe("truncateDiffForDisplay", () => {
  it("returns all rows + hidden_count 0 when at/under the cap", () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    expect(truncateDiffForDisplay(rows)).toEqual({ shown: rows, hidden_count: 0 });
  });

  it("truncates to MAX_DIFF_DISPLAY_ROWS and reports the hidden remainder", () => {
    const rows = Array.from({ length: MAX_DIFF_DISPLAY_ROWS + 25 }, (_, i) => i);
    const out = truncateDiffForDisplay(rows);
    expect(out.shown).toHaveLength(MAX_DIFF_DISPLAY_ROWS);
    expect(out.hidden_count).toBe(25);
  });

  it("honors a custom max", () => {
    expect(truncateDiffForDisplay([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], hidden_count: 2 });
  });
});
