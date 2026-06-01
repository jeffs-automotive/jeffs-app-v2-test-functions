import { describe, it, expect } from "vitest";
import {
  formatPhoneForDisplay,
  normalizePhoneE164,
  e164ToDisplay,
} from "@/lib/scheduler/phone-format";

describe("formatPhoneForDisplay (progressive)", () => {
  it("formats incrementally as digits arrive", () => {
    expect(formatPhoneForDisplay("")).toBe("");
    expect(formatPhoneForDisplay("4")).toBe("4");
    expect(formatPhoneForDisplay("415")).toBe("415");
    expect(formatPhoneForDisplay("4155")).toBe("(415) 5");
    expect(formatPhoneForDisplay("415555")).toBe("(415) 555");
    expect(formatPhoneForDisplay("4155551234")).toBe("(415) 555-1234");
  });
  it("strips non-digits and caps at 10 digits", () => {
    expect(formatPhoneForDisplay("(415) 555-1234")).toBe("(415) 555-1234");
    expect(formatPhoneForDisplay("4155551234999")).toBe("(415) 555-1234");
  });
});

describe("normalizePhoneE164", () => {
  it("accepts 10-digit and 1+10-digit US numbers", () => {
    expect(normalizePhoneE164("4155551234")).toBe("+14155551234");
    expect(normalizePhoneE164("14155551234")).toBe("+14155551234");
    expect(normalizePhoneE164("(415) 555-1234")).toBe("+14155551234");
  });
  it("returns null for invalid lengths", () => {
    expect(normalizePhoneE164("415")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("24155551234")).toBeNull(); // 11 digits not starting with 1
  });
});

describe("e164ToDisplay", () => {
  it("formats the last 10 digits", () => {
    expect(e164ToDisplay("+14155551234")).toBe("(415) 555-1234");
    expect(e164ToDisplay("14155551234")).toBe("(415) 555-1234");
  });
});
