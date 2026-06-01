import { describe, it, expect } from "vitest";
import {
  isConfirmationRequired,
  type ConfirmationRequiredResult,
} from "@/lib/orchestrator/types";

/**
 * isConfirmationRequired is the type-narrow that switches the UI into the
 * Pattern A confirmation-modal flow. It must fire ONLY on the
 * `{ ok:false, needs_confirmation:true }` envelope — never on a success
 * result or a plain error — so a sensitive action can't skip the second-step
 * confirmation (pattern-a-two-step-confirmation).
 */
describe("isConfirmationRequired", () => {
  const envelope: ConfirmationRequiredResult = {
    ok: false,
    needs_confirmation: true,
    confirmation: {
      token_id: "11111111-1111-1111-1111-111111111111",
      expires_at: "2026-06-01T00:00:00Z",
      action_kind: "release_ar_tag",
      scope_summary: "Release R4 from RO 12345",
    },
    message: "Confirm to release.",
  };

  it("returns true for the Pattern A confirmation envelope", () => {
    expect(isConfirmationRequired(envelope)).toBe(true);
  });

  it("returns false for a success result", () => {
    expect(isConfirmationRequired({ ok: true, ro_number: 12345 })).toBe(false);
  });

  it("returns false for a plain error result (ok:false, no needs_confirmation)", () => {
    expect(
      isConfirmationRequired({ ok: false, error_code: "ro_not_found", message: "nope" }),
    ).toBe(false);
  });

  it("returns false for null / undefined / primitives", () => {
    expect(isConfirmationRequired(null)).toBe(false);
    expect(isConfirmationRequired(undefined)).toBe(false);
    expect(isConfirmationRequired("needs_confirmation")).toBe(false);
    expect(isConfirmationRequired(42)).toBe(false);
  });

  it("returns false when needs_confirmation is present but not strictly true", () => {
    expect(
      isConfirmationRequired({ ok: false, needs_confirmation: "yes" }),
    ).toBe(false);
    expect(
      isConfirmationRequired({ ok: true, needs_confirmation: true }),
    ).toBe(false); // ok must be false too
  });
});
