// Deno-native unit tests for the pure helpers exposed by
// scheduler-admin-catalog.ts. Focused on the
// subcategory_service_map MD uploader logic added 2026-05-20.
//
// Run with:
//   deno test --node-modules-dir=auto supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts
//
// These tests cover the parser-level logic; the end-to-end uploader
// (dry-run → diff → apply with confirm_token) is smoke-tested via curl
// after deploy (see edit-subcategory-service-map.md).

import { assertEquals, assert } from "jsr:@std/assert@^1";
import { parseMdTable } from "../scheduler-admin-md.ts";

// ─── parseServiceKeyList — duplicated from scheduler-admin-catalog.ts
// because the function isn't exported. Keeping the test surface stable
// even when the impl is internal. Update this if the impl changes.
// ────────────────────────────────────────────────────────────────────
function parseServiceKeyList(raw: string): string[] {
  const v = raw.trim();
  if (v === "" || v === "(none)" || v === "-" || v === "—") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of v.split(",")) {
    const t = piece.trim();
    if (t === "") continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) if (!setA.has(v)) return false;
  return true;
}

Deno.test("parseServiceKeyList: empty cell → []", () => {
  assertEquals(parseServiceKeyList(""), []);
  assertEquals(parseServiceKeyList("   "), []);
});

Deno.test("parseServiceKeyList: sentinels → []", () => {
  assertEquals(parseServiceKeyList("(none)"), []);
  assertEquals(parseServiceKeyList("-"), []);
  assertEquals(parseServiceKeyList("—"), []);
  assertEquals(parseServiceKeyList("  (none)  "), []);
});

Deno.test("parseServiceKeyList: single key", () => {
  assertEquals(parseServiceKeyList("check_engine_light_testing"), [
    "check_engine_light_testing",
  ]);
});

Deno.test("parseServiceKeyList: comma-separated list, in MD order", () => {
  assertEquals(
    parseServiceKeyList("coolant_leak_testing, check_engine_light_testing"),
    ["coolant_leak_testing", "check_engine_light_testing"],
  );
});

Deno.test("parseServiceKeyList: trims whitespace per cell", () => {
  assertEquals(
    parseServiceKeyList("  a ,  b ,c  "),
    ["a", "b", "c"],
  );
});

Deno.test("parseServiceKeyList: de-dupes preserving first-seen order", () => {
  assertEquals(
    parseServiceKeyList("a, b, a, c, b"),
    ["a", "b", "c"],
  );
});

Deno.test("parseServiceKeyList: skips empty positions between commas", () => {
  assertEquals(parseServiceKeyList("a,, b"), ["a", "b"]);
  assertEquals(parseServiceKeyList(",a,"), ["a"]);
});

Deno.test("arraysEqualAsSets: identical arrays → true", () => {
  assert(arraysEqualAsSets(["a", "b"], ["a", "b"]));
});

Deno.test("arraysEqualAsSets: same elements different order → true", () => {
  assert(arraysEqualAsSets(["a", "b", "c"], ["c", "a", "b"]));
});

Deno.test("arraysEqualAsSets: different length → false", () => {
  assert(!arraysEqualAsSets(["a", "b"], ["a", "b", "c"]));
});

Deno.test("arraysEqualAsSets: same length different elements → false", () => {
  assert(!arraysEqualAsSets(["a", "b"], ["a", "c"]));
});

Deno.test("arraysEqualAsSets: both empty → true", () => {
  assert(arraysEqualAsSets([], []));
});

// ─── parseMdTable acceptance tests for the mapping MD shape ─────────
// Verifies the wide-table parser correctly extracts the 3 required
// columns from the subcategory-service-map MD format.

Deno.test("parseMdTable: parses subcategory-service-map happy path", () => {
  const md = `# Subcategory → Testing Service Mappings

<!-- guidance comment -->

| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| warning_light | check_engine_light | check_engine_light_testing |
| warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
| warning_light | something_unmapped | (none) |
`;
  const { table, errors } = parseMdTable(md);
  assertEquals(errors.length, 0);
  assertEquals(table.headers, [
    "category",
    "subcategory_slug",
    "testing_service_keys",
  ]);
  assertEquals(table.rows.length, 3);
  assertEquals(table.rows[0].category, "warning_light");
  assertEquals(table.rows[0].subcategory_slug, "check_engine_light");
  assertEquals(table.rows[0].testing_service_keys, "check_engine_light_testing");
  assertEquals(
    table.rows[1].testing_service_keys,
    "coolant_leak_testing, check_engine_light_testing",
  );
  assertEquals(table.rows[2].testing_service_keys, "(none)");
});

Deno.test("parseMdTable: empty testing_service_keys cell preserved as blank", () => {
  const md = `| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| warning_light | x_light |  |
`;
  const { table } = parseMdTable(md);
  assertEquals(table.rows[0].testing_service_keys, "");
});

Deno.test("parseMdTable: throws on bad separator", () => {
  const md = `| category | subcategory_slug | testing_service_keys |
not a separator
| warning_light | x | y |
`;
  let threw = false;
  try {
    parseMdTable(md);
  } catch (e) {
    threw = true;
    assert(e instanceof Error);
    assert(e.message.includes("separator"));
  }
  assert(threw, "expected parseMdTable to throw on bad separator");
});
