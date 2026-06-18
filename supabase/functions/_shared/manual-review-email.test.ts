// Deno-native tests for the reformatted manual-review email.
//
// Run with:
//   deno test --allow-env supabase/functions/_shared/manual-review-email.test.ts
//
// Stubs globalThis.fetch (no real network) so we can inspect the exact Resend
// payload the brief email produces.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildReviewLink,
  sendManualReviewEmail,
  type SendManualReviewEmailArgs,
} from "./manual-review-email.ts";

const realFetch = globalThis.fetch;

function stubFetch(): {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

function args(): SendManualReviewEmailArgs {
  return {
    code: "ORP-4XKZ9P",
    category: "orphan_release",
    issueSummary: "Red 20 is on RO #152442 in our records, but Tekmetric says the RO doesn't exist anymore.",
    options: [
      { key: "release", label: "Release Red 20", description: "…" },
      { key: "keep_tag", label: "Keep it held", description: "…" },
    ],
    context: { ro_id: 1, ro_number: 152442, tag_color: "red", tag_number: 20 },
  };
}

Deno.test("buildReviewLink — encodes the code, honors base, strips trailing slash", () => {
  assertEquals(
    buildReviewLink("ORP-4XKZ9P", "https://admin.jeffsautomotive.com"),
    "https://admin.jeffsautomotive.com/keytags?tab=manual-reviews&review=ORP-4XKZ9P",
  );
  assertEquals(
    buildReviewLink("ARN-AB12CD", "https://example.com/"),
    "https://example.com/keytags?tab=manual-reviews&review=ARN-AB12CD",
  );
});

Deno.test("default base URL is the admin app", () => {
  assertStringIncludes(
    buildReviewLink("DRF-ZZ99ZZ"),
    "https://admin.jeffsautomotive.com/keytags?tab=manual-reviews&review=DRF-ZZ99ZZ",
  );
});

Deno.test("email carries code, tag, RO, description, and the review link", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const { calls, restore } = stubFetch();
  try {
    const r = await sendManualReviewEmail(args());
    assertEquals(r.sent, true);
    assertEquals(calls.length, 1);
    const body = JSON.parse(calls[0].init.body as string);

    assertStringIncludes(body.subject, "ORP-4XKZ9P");

    const html = body.html as string;
    assertStringIncludes(html, "ORP-4XKZ9P"); // code
    assertStringIncludes(html, "Red 20"); // key tag
    assertStringIncludes(html, "RO #152442"); // repair order
    assertStringIncludes(html, "in our records, but Tekmetric says"); // brief description
    assertStringIncludes(html, "doesn&#39;t exist"); // apostrophe is HTML-escaped
    assertStringIncludes(
      html,
      "https://admin.jeffsautomotive.com/keytags?tab=manual-reviews&review=ORP-4XKZ9P",
    ); // deep link
    assert(html.includes("2 options")); // option hint reflects the count
  } finally {
    restore();
  }
});

Deno.test("email omits a tag gracefully when the review has none (ARN)", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const { calls, restore } = stubFetch();
  try {
    await sendManualReviewEmail({
      code: "ARN-AB12CD",
      category: "ar_no_prior_tag",
      issueSummary: "RO #99 is in A/R but has no key tag tracked.",
      options: [{ key: "no_tag", label: "No tag", description: "…" }],
      context: { ro_id: 9, ro_number: 99, tag_color: null, tag_number: null },
    });
    const html = JSON.parse(calls[0].init.body as string).html as string;
    assertStringIncludes(html, "ARN-AB12CD");
    assertStringIncludes(html, "RO #99");
    assertStringIncludes(html, "review=ARN-AB12CD");
  } finally {
    restore();
  }
});
