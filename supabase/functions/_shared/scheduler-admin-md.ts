// Markdown-table parser + writer for the scheduler admin tools.
//
// Per chat-design.md "MD-upload pattern" + scheduler_phase1_design_lock.md
// 2026-05-13: service advisors edit predefined-data tables by uploading a
// markdown file. The expected format is a single GitHub-flavored markdown
// table with a header row, a separator row, and one data row per record.
//
// Format example (routine_services):
//
//   # Routine Services
//
//   | service_key | display_name | abbreviation | display_order | wait_eligible | requires_explanation | active |
//   |-------------|--------------|--------------|---------------|---------------|----------------------|--------|
//   | oil_change  | Oil Change   | OILCHG       | 1             | true          | false                | true   |
//   | tire_rotate | Tire Rotation| TIREROT      | 2             | true          | false                | true   |
//
// The parser is forgiving:
//   - Surrounding whitespace per cell is trimmed
//   - Trailing/leading | are optional
//   - Heading-only lines (# / ##) are ignored
//   - Comment lines starting with `<!--` are ignored
//   - Blank rows between header and data, or between rows, are ignored
//
// The parser is STRICT about:
//   - Exactly one header row + one separator row at the top of the table
//   - Every data row must have the same column count as the header
//   - Header column names must exactly match the expected column-name set
//     (caller decides which columns to look for; this module just hands
//     back the row objects as Record<string, string>)
//
// Writer (mdTableFromRows) produces a GitHub-flavored table from a column
// schema + array of row objects. Round-trips cleanly through the parser.

// ─── file-size-refactor ──────────────────────────────────────────────────
// Split into ./scheduler-admin-md/* (parser / concern-parser / sections /
// canonical-state machinery / audit). This shim preserves the import path.
export * from "./scheduler-admin-md/index.ts";
