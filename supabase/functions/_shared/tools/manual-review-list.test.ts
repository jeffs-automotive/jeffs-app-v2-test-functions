// Deno-native unit tests for the pure logic in manual-review-list.ts.
//
// Run with:
//   deno test supabase/functions/_shared/tools/manual-review-list.test.ts

import { assert, assertEquals } from "jsr:@std/assert@^1";
import {
  reviewMatchesSearch,
  toListItem,
  type ManualReviewListItem,
} from "./manual-review-list.ts";

function item(overrides: Partial<ManualReviewListItem> = {}): ManualReviewListItem {
  return {
    code: "ORP-4XKZ9P",
    category: "orphan_release",
    issue_summary: "Red 5 may need to come off RO #153330",
    ro_id: 337732285,
    ro_number: 153330,
    tag_color: "red",
    tag_number: 5,
    options: [],
    context: {},
    issued_at: "2026-06-18T10:00:00Z",
    resolved_at: null,
    resolved_choice: null,
    resolved_by_user_label: null,
    ...overrides,
  };
}

Deno.test("toListItem — pulls ro/tag out of context JSONB", () => {
  const li = toListItem({
    code: "ARN-AB12CD",
    category: "ar_no_prior_tag",
    issue_summary: "A/R RO with no tag",
    context: { ro_id: 1, ro_number: 22, tag_color: "yellow", tag_number: 45 },
    options: [{ key: "no_tag", label: "No tag", description: "…" }],
    issued_at: "2026-06-18T10:00:00Z",
    resolved_at: null,
    resolved_choice: null,
    resolved_by_user_label: null,
  });
  assertEquals(li.ro_number, 22);
  assertEquals(li.tag_color, "yellow");
  assertEquals(li.tag_number, 45);
  assertEquals(li.options.length, 1);
});

Deno.test("toListItem — missing context fields → null", () => {
  const li = toListItem({
    code: "DRF-ZZ99ZZ",
    category: "work_approved_drift",
    issue_summary: "drift",
    context: null,
    options: null as unknown as [],
    issued_at: "2026-06-18T10:00:00Z",
    resolved_at: null,
    resolved_choice: null,
    resolved_by_user_label: null,
  });
  assertEquals(li.ro_number, null);
  assertEquals(li.tag_color, null);
  assertEquals(li.tag_number, null);
  assertEquals(li.options, []);
});

Deno.test("reviewMatchesSearch — empty query matches everything", () => {
  assert(reviewMatchesSearch(item(), ""));
  assert(reviewMatchesSearch(item(), "   "));
});

Deno.test("reviewMatchesSearch — code substring, dash-insensitive + case-insensitive", () => {
  assert(reviewMatchesSearch(item(), "ORP-4XK"));
  assert(reviewMatchesSearch(item(), "orp4xk"));
  assert(reviewMatchesSearch(item(), "4xkz9p"));
  assert(!reviewMatchesSearch(item(), "ZZZ"));
});

Deno.test("reviewMatchesSearch — key tag forms", () => {
  assert(reviewMatchesSearch(item(), "R5"));
  assert(reviewMatchesSearch(item(), "red5"));
  assert(reviewMatchesSearch(item(), "red 5"));
  assert(reviewMatchesSearch(item(), "5")); // bare number matches the tag number
  assert(!reviewMatchesSearch(item(), "R6"));
  assert(!reviewMatchesSearch(item({ tag_color: "yellow", tag_number: 45 }), "R45"));
  assert(reviewMatchesSearch(item({ tag_color: "yellow", tag_number: 45 }), "Y45"));
});

Deno.test("reviewMatchesSearch — RO# numeric substring (numeric queries only)", () => {
  assert(reviewMatchesSearch(item(), "153330"));
  assert(reviewMatchesSearch(item(), "5333")); // substring
  assert(!reviewMatchesSearch(item(), "999999"));
});

Deno.test("reviewMatchesSearch — null tag/ro don't throw", () => {
  const li = item({ tag_color: null, tag_number: null, ro_number: null });
  assert(!reviewMatchesSearch(li, "R5"));
  assert(!reviewMatchesSearch(li, "153330"));
  assert(reviewMatchesSearch(li, "orp")); // code still matches
});
