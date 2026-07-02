import { describe, expect, it } from "vitest";

import {
  estimateSmsSegments,
  renderTemplate,
  validateSmsTemplateBody,
} from "./template-renderer";

describe("renderTemplate", () => {
  it("replaces whitelisted tokens with sample values", () => {
    const r = renderTemplate("Hi {{first_name}}, see you {{appointment_date}}.", "sample");
    expect(r).toEqual({ ok: true, text: "Hi Chris, see you Tue, Jul 14." });
  });

  it("rejects unknown tokens (save-time fail-closed)", () => {
    const r = renderTemplate("Hi {{first_name}} {{evil_token}}", "sample");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unknown_tokens).toEqual(["evil_token"]);
  });

  it("uses provided values at send time and tolerates whitespace in braces", () => {
    const r = renderTemplate("{{ first_name }} / {{shop_phone}}", {
      first_name: "Dana",
      shop_phone: "610-810-3921",
    });
    expect(r).toEqual({ ok: true, text: "Dana / 610-810-3921" });
  });

  it("never evaluates content — tokens are literal replacements only", () => {
    const r = renderTemplate("{{first_name}} ${process.env.SECRET} `rm -rf`", {
      first_name: "X",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("${process.env.SECRET} `rm -rf`");
  });
});

describe("estimateSmsSegments", () => {
  it("GSM-7 single segment up to 160", () => {
    expect(estimateSmsSegments("a".repeat(160))).toEqual({
      encoding: "GSM-7",
      chars: 160,
      segments: 1,
    });
  });
  it("GSM-7 multi-segment at 153 per part", () => {
    expect(estimateSmsSegments("a".repeat(161)).segments).toBe(2);
    expect(estimateSmsSegments("a".repeat(307)).segments).toBe(3);
  });
  it("a single emoji forces UCS-2 (70/67)", () => {
    const s = estimateSmsSegments("🔧" + "a".repeat(69));
    expect(s.encoding).toBe("UCS-2");
    expect(s.segments).toBe(2); // surrogate pair counts 2 chars → 71 > 70
  });
  it("smart quote forces UCS-2", () => {
    expect(estimateSmsSegments("We’re ready").encoding).toBe("UCS-2");
  });
});

describe("validateSmsTemplateBody", () => {
  const ok =
    "Jeff's Automotive: Your {{appointment_type_label}} appointment is confirmed for {{appointment_date}}. Reply STOP to opt out.";

  it("accepts the seeded transactional shape", () => {
    expect(validateSmsTemplateBody(ok)).toEqual({ ok: true, segments: 1 });
  });
  it("requires the brand", () => {
    const r = validateSmsTemplateBody("Your appointment is confirmed.");
    expect(r.ok).toBe(false);
  });
  it("blocks marketing language (transactional-only campaign)", () => {
    const r = validateSmsTemplateBody(`${ok} Get 20% off your next visit!`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("marketing");
  });
  it("blocks public URL shorteners", () => {
    const r = validateSmsTemplateBody(`${ok} bit.ly/xyz`);
    expect(r.ok).toBe(false);
  });
  it("blocks bodies that render past 3 segments", () => {
    const r = validateSmsTemplateBody(`Jeff's Automotive: ${"word ".repeat(120)}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("segments");
  });
  it("blocks unknown merge fields", () => {
    const r = validateSmsTemplateBody("Jeff's Automotive: {{bogus}} Reply STOP to opt out.");
    expect(r.ok).toBe(false);
  });
});
