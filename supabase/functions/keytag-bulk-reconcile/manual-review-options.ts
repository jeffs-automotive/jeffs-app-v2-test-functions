// manual-review-options — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import { type ManualReviewOption } from "../_shared/manual-review.ts";

// ── Manual-review option presets (per-category) ─────────────────────────────

export function orphanOptions(roNumber: number, priorTag: string): ManualReviewOption[] {
  return [
    {
      key: "release",
      label: `Release ${priorTag}`,
      description: `Mark ${priorTag} available and return it to the round-robin pool. Pick this if the keys are confirmed gone (RO canceled, paid, or replaced and the customer has the keys).`,
    },
    {
      key: "keep_tag",
      label: `Keep ${priorTag} held`,
      description: `Leave ${priorTag} on RO #${roNumber} in our records. Pick this if the keys are still in the shop — for instance, the RO was renumbered and the new RO has the same physical tag, or someone is still working on it.`,
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Don't change anything. Send the situation to Chris for review. Pick this if you're unsure.",
    },
  ];
}

export function arnOptions(roNumber: number): ManualReviewOption[] {
  return [
    {
      key: "track_tag",
      label: `Record a tag on the keys for RO #${roNumber}`,
      description: "Tell us which color + number is physically on the keys. We'll add it to our system (we won't write to Tekmetric — A/R repair orders are locked there).",
      needs_tag_input: true,
    },
    {
      key: "no_tag",
      label: "No tag is on these keys",
      description: "The keys don't have a physical tag on them (left without one, picked up by a vendor, etc.). We'll leave this RO alone in our system.",
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris — pick this if you don't know.",
    },
  ];
}

export function driftOptions(roNumber: number, priorTag: string): ManualReviewOption[] {
  return [
    {
      key: "use_prior_tag",
      label: `Re-confirm ${priorTag} is on the keys`,
      description: `The same physical tag (${priorTag}) is still on the keys. We'll re-attach it in our system AND write it to Tekmetric so everyone sees it.`,
    },
    {
      key: "use_different_tag",
      label: "A different tag is on the keys",
      description: "Tell us the color + number that's physically on the keys for this RO. We'll record it.",
      needs_tag_input: true,
    },
    {
      key: "assign_new",
      label: "Assign a fresh tag (round-robin)",
      description: "The keys don't have a tag yet but need one. We'll pick the next available tag, write it to Tekmetric, and you can put it on the keys.",
    },
    {
      key: "no_tag",
      label: "Don't tag this RO",
      description: `The keys aren't in the shop or RO #${roNumber} doesn't need a tag right now.`,
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris — pick this if you're unsure.",
    },
  ];
}

export function patchFailOptions(): ManualReviewOption[] {
  return [
    {
      key: "retry_patch",
      label: "Retry writing to Tekmetric",
      description: "Try the same write again. Pick this if you suspect the failure was a temporary Tekmetric outage.",
    },
    {
      key: "release_and_redo",
      label: "Release the tag and start over",
      description: "Release the tag in our system, then assign a fresh one (will retry the Tekmetric write). Use this if the Tekmetric record is too out-of-sync to recover cleanly.",
    },
    {
      key: "accept_unsynced",
      label: "Keep the tag in our system without Tekmetric",
      description: "Leave our records as-is. The Tekmetric Key Tag field stays blank. Advisors will see our system's data but not Tekmetric's.",
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris.",
    },
  ];
}
