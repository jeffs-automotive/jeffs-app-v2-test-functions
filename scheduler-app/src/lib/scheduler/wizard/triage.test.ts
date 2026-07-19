import { describe, expect, it } from "vitest";

import {
  buildChipSnapshot,
  deriveConstraint,
  filterCandidatesToAllowed,
  shouldTriage,
  TRIAGE_ESCAPE_CHIP_KEY,
  type TriageChipRow,
  type TriageDecisionInput,
  type TriageEntry,
  type TriageItemFields,
} from "./triage";

// ─── helpers ────────────────────────────────────────────────────────────────

function decision(over: Partial<TriageDecisionInput> = {}): TriageDecisionInput {
  return {
    stage1_candidates: [],
    no_match_reason: "too_vague",
    parsed_ok: true,
    ...over,
  };
}

const freshItem: TriageItemFields = {}; // no triage_round yet (undefined → 0)

const CHIPS: TriageChipRow[] = [
  {
    chip_key: "brakes",
    display_label: "The brakes",
    maps_to_categories: ["brakes"],
    allowed_service_keys: ["brake_inspection", "abs_traction_stability_testing"],
    sort: 7,
    active: true,
  },
  {
    chip_key: "noise",
    display_label: "A noise it shouldn't be making",
    maps_to_categories: ["noise"],
    allowed_service_keys: ["brake_inspection", "exhaust_system_testing"],
    sort: 1,
    active: true,
  },
  {
    // every service inactive for this shop → must be hidden (INV-18)
    chip_key: "euro_only",
    display_label: "Euro thing",
    maps_to_categories: ["leak"],
    allowed_service_keys: ["coolant_leak_testing_euro"],
    sort: 3,
    active: true,
  },
  {
    // inactive chip → excluded regardless
    chip_key: "disabled",
    display_label: "Disabled",
    maps_to_categories: ["x"],
    allowed_service_keys: ["brake_inspection"],
    sort: 2,
    active: false,
  },
];

const ACTIVE_SERVICES = new Set([
  "brake_inspection",
  "abs_traction_stability_testing",
  "exhaust_system_testing",
  // note: coolant_leak_testing_euro is NOT active for this shop
]);

// ─── shouldTriage — the T1 trigger matrix (INV-5) ───────────────────────────

describe("shouldTriage (T1 predicate)", () => {
  it("fires on too_vague with 0 candidates, round 0, parsed_ok", () => {
    expect(shouldTriage(decision({ no_match_reason: "too_vague" }), freshItem)).toBe(true);
  });

  it("fires on no_catalog_fit", () => {
    expect(shouldTriage(decision({ no_match_reason: "no_catalog_fit" }), freshItem)).toBe(true);
  });

  it("does NOT fire on non_concern_request (work-order line → advisor)", () => {
    expect(shouldTriage(decision({ no_match_reason: "non_concern_request" }), freshItem)).toBe(false);
  });

  it("does NOT fire on a null reason (all-invalid-keys / desc<3 short-circuit)", () => {
    expect(shouldTriage(decision({ no_match_reason: null }), freshItem)).toBe(false);
  });

  it("does NOT fire when the LLM parse failed", () => {
    expect(shouldTriage(decision({ parsed_ok: false }), freshItem)).toBe(false);
  });

  it("does NOT fire when there ARE candidates (that's the direct/clarify path)", () => {
    expect(shouldTriage(decision({ stage1_candidates: ["brake_inspection"] }), freshItem)).toBe(false);
  });

  it("does NOT fire when the concern already had its one round (triage_round >= 1)", () => {
    expect(shouldTriage(decision(), { triage_round: 1 })).toBe(false);
  });

  it("treats a missing triage_round as 0 (fresh item)", () => {
    expect(shouldTriage(decision(), { triage_round: undefined })).toBe(true);
  });
});

// ─── buildChipSnapshot — INV-18 validate + hide-empty ───────────────────────

describe("buildChipSnapshot (INV-18)", () => {
  it("sorts by `sort`, drops inactive services, and hides chips with an empty resolved set", () => {
    const snap = buildChipSnapshot(CHIPS, ACTIVE_SERVICES);
    // euro_only (all services inactive) and `disabled` (inactive row) are gone.
    expect(snap.options.map((o) => o.chip_key)).toEqual(["noise", "brakes"]);
    expect(snap.allowed_by_chip.noise).toEqual(["brake_inspection", "exhaust_system_testing"]);
    // brakes drops nothing (both its services are active)
    expect(snap.allowed_by_chip.brakes).toEqual([
      "brake_inspection",
      "abs_traction_stability_testing",
    ]);
    expect(snap.allowed_by_chip.euro_only).toBeUndefined();
  });

  it("returns an empty snapshot when NO chip survives (advisor-fallback signal)", () => {
    const snap = buildChipSnapshot(CHIPS, new Set<string>());
    expect(snap.options).toEqual([]);
    expect(snap.allowed_by_chip).toEqual({});
  });
});

// ─── deriveConstraint — INV-14 server-side derivation ───────────────────────

describe("deriveConstraint (INV-14)", () => {
  const entry: TriageEntry = {
    concern_id: "c-1",
    concern_index: 0,
    service_key: "other_issue",
    concern_text: "something feels off",
    chips: [
      { chip_key: "brakes", display_label: "The brakes" },
      { chip_key: "noise", display_label: "A noise it shouldn't be making" },
    ],
    allowed_by_chip: {
      brakes: ["brake_inspection", "abs_traction_stability_testing"],
      noise: ["brake_inspection", "exhaust_system_testing"],
    },
    triage_round: 0,
    created_version: "v1",
  };

  it("resolves a valid tap from the PERSISTED snapshot", () => {
    expect(deriveConstraint(entry, "brakes")).toEqual({
      chip_key: "brakes",
      label: "The brakes",
      allowed_service_keys: ["brake_inspection", "abs_traction_stability_testing"],
    });
  });

  it("returns null for the escape chip (→ advisor)", () => {
    expect(deriveConstraint(entry, TRIAGE_ESCAPE_CHIP_KEY)).toBeNull();
  });

  it("returns null for a forged/unknown chip_key (never trust the client)", () => {
    expect(deriveConstraint(entry, "hvac")).toBeNull();
    expect(deriveConstraint(entry, "'; drop table --")).toBeNull();
  });

  it("returns null when the persisted allowed set is empty", () => {
    const empty: TriageEntry = { ...entry, allowed_by_chip: { brakes: [] } };
    expect(deriveConstraint(empty, "brakes")).toBeNull();
  });
});

// ─── filterCandidatesToAllowed — INV-14 post-LLM allowlist ──────────────────

describe("filterCandidatesToAllowed (INV-14)", () => {
  it("keeps only candidates inside the allowed set", () => {
    expect(
      filterCandidatesToAllowed(
        ["brake_inspection", "coolant_leak_testing", "exhaust_system_testing"],
        ["brake_inspection", "exhaust_system_testing"],
      ),
    ).toEqual(["brake_inspection", "exhaust_system_testing"]);
  });

  it("returns [] when the model returned only out-of-constraint keys (→ advisor)", () => {
    expect(filterCandidatesToAllowed(["coolant_leak_testing"], ["brake_inspection"])).toEqual([]);
  });
});
