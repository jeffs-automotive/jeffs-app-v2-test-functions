/**
 * CARD_PREVIEW_MANIFEST — design-owned, PRESENTATIONAL config that tells the
 * generic HeritageCardPreview how to lay out each wizard card's faithful
 * "card on a workbench" preview.
 *
 * This carries NO business logic and NO data flow: it maps each card's
 * (card_key, slot_key) to a typography ROLE, a body render ORDER, and the
 * GHOST geometry of the non-copy controls (buttons/badges/etc.) so the card's
 * layout reads true. The editable copy itself (body/default_body/label/
 * allowed_merge_fields) always comes from the DB rows (CardTextRow) — never
 * from here. Keeping "role + position + ghost shape" out of the DB is the
 * whole point: the scheduler_card_text table stays pure copy.
 *
 * Contract: every slot_key named in a manifest (head[].slot_key,
 * body[].slot_key, footnotes[]) MUST have a matching scheduler_card_text row
 * for the shop. The preview looks each up by slot_key and skips gracefully if
 * a row is missing, so a follow-on card whose rows exist but whose manifest
 * entry hasn't landed yet simply falls back to the plain field list in the
 * tab (getCardPreviewManifest returns null → fallback).
 *
 * Add more cards by appending entries — the preview component never changes.
 */

/** On-scheduler typography role a slot renders in. */
export type TypographyRole =
  | "eyebrow"
  | "title"
  | "description"
  | "body"
  | "footnote";

/** How an in-body prose slot is wrapped (fidelity to the real card). */
export type BodySlotVariant =
  | "plain" // muted prose line (text-[15px]/text-ink-secondary)
  | "heading" // font-display text-[17px] text-ink (e.g. Greeting's "Have you been…")
  | "gold-note"; // border-l-2 border-brand-gold-400 bg-paper-200 callout (e.g. disclosure)

/** A non-copy control drawn as a static ghost so layout reads true. */
export type GhostHint =
  | {
      kind: "buttons";
      count: number;
      layout: "stack" | "row";
      labels: string[];
      primaryIndex?: number;
    }
  | { kind: "fields"; count: number; shape: "input" | "textarea"; labels?: string[] }
  | { kind: "badges"; count: number; labels?: string[] } // gold-dot trust row / chips
  | { kind: "list"; count: number } // summary bullet rows
  | { kind: "divider"; tone: "rule" | "gold" }
  | { kind: "countdown" | "note"; tone?: "rule" | "gold" }; // status pill / callout

/** Ordered content of Card.Body: interleaves editable prose slots + ghosts. */
export type BodyBlock =
  | { block: "slot"; slot_key: string; variant: BodySlotVariant }
  | { block: "ghost"; hint: GhostHint };

export interface CardPreviewManifest {
  /** === WizardCard.step (card-payloads.ts). */
  card_key: string;
  /** Picker label ("Greeting"). */
  display_name: string;
  group: "identity" | "vehicle" | "concerns" | "scheduling" | "confirmation";
  /** Fixed head slots above the body, in render order. */
  head: Array<{ slot_key: string; role: Exclude<TypographyRole, "body" | "footnote"> }>;
  /** Card.Body content order (prose slots + ghosts interleaved). */
  body: BodyBlock[];
  /** Footnote slot_keys under the body, in order. */
  footnotes: string[];
}

export const CARD_PREVIEW_MANIFEST: Record<string, CardPreviewManifest> = {
  greeting: {
    card_key: "greeting",
    display_name: "Greeting",
    group: "identity",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" }, // "Welcome"
      { slot_key: "title", role: "title" }, // "Hi, I'm {{agent_name}} 👋"
      { slot_key: "description", role: "description" }, // "I'm the AI scheduling assistant for {{shop_name}}…"
    ],
    body: [
      // recorded-&-reviewed note
      { block: "slot", slot_key: "body_disclosure", variant: "gold-note" },
      // "Have you been to our shop before?"
      { block: "slot", slot_key: "body_question", variant: "heading" },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 3,
          layout: "stack",
          labels: ["Yes — I'm a returning customer", "No — first time", "I'm not sure"],
          primaryIndex: 0,
        },
      },
      {
        block: "ghost",
        hint: {
          kind: "badges",
          count: 3,
          labels: ["Family-owned since 1976", "AAA-approved", "3yr/36k warranty"],
        },
      },
    ],
    footnotes: ["footnote"], // "Need a human instead? …"
  },
  completed: {
    card_key: "completed",
    display_name: "Completed",
    group: "confirmation",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" }, // "All done"
      { slot_key: "title_named", role: "title" }, // "You're all set, {{first_name}}."
      { slot_key: "title_anon", role: "title" }, // "You're all set." (no-name variant)
      { slot_key: "description", role: "description" }, // "We'll see you {{appointment_label}}…"
    ],
    body: [
      { block: "slot", slot_key: "next_label", variant: "heading" }, // "What happens next"
      { block: "slot", slot_key: "next_booked", variant: "plain" },
      { block: "slot", slot_key: "next_reminders_consent", variant: "plain" }, // opted-in variant
      { block: "slot", slot_key: "next_reminders_noconsent", variant: "plain" }, // not-opted-in variant
      { block: "slot", slot_key: "next_keys", variant: "plain" },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "thanks", variant: "plain" }, // "Thanks for choosing {{shop_name}}…"
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 2,
          layout: "row",
          labels: ["Close", "Schedule another"],
          primaryIndex: 1,
        },
      },
    ],
    footnotes: ["footnote"], // "Family-owned since 1976 · Questions? {{shop_phone}}"
  },
  phone_name: {
    card_key: "phone_name",
    display_name: "Phone & name",
    group: "identity",
    // Eyebrow (step_label) is dynamic (varies by greeting bucket) — not editable.
    head: [
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      {
        block: "ghost",
        hint: {
          kind: "fields",
          count: 3,
          shape: "input",
          labels: ["First name", "Last name", "Phone number"],
        },
      },
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // SMS-consent panel
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["Send my code"], primaryIndex: 0 },
      },
    ],
    footnotes: ["footnote"],
  },
  partial_verification_gate: {
    card_key: "partial_verification_gate",
    display_name: "Partial verification",
    group: "identity",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title_name", role: "title" },
      { slot_key: "description_name", role: "description" },
    ],
    body: [
      { block: "slot", slot_key: "body_name_note", variant: "plain" },
      // Alternate branch title (phone matched) — shown as an editable heading.
      { block: "slot", slot_key: "title_phone", variant: "heading" },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 2,
          layout: "row",
          labels: ["Try a different phone", "Continue with this number"],
          primaryIndex: 1,
        },
      },
    ],
    footnotes: [],
  },
  multi_account_disambiguation: {
    card_key: "multi_account_disambiguation",
    display_name: "Multiple accounts",
    group: "identity",
    // Description is dynamic (account count + phone last-four) — not editable.
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
    ],
    body: [
      { block: "ghost", hint: { kind: "list", count: 2 } }, // vehicle account rows
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["None of these are me"] },
      },
    ],
    footnotes: ["footnote"],
  },
  no_match_choose_path: {
    card_key: "no_match_choose_path",
    display_name: "No match found",
    group: "identity",
    // Description is dynamic (phone last-four) — not editable.
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
    ],
    body: [
      { block: "slot", slot_key: "body_reason_new", variant: "plain" },
      { block: "slot", slot_key: "body_reason_moved", variant: "plain" },
      { block: "slot", slot_key: "body_reason_guest", variant: "plain" },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 2,
          layout: "row",
          labels: ["Try a different phone", "Continue as new customer"],
          primaryIndex: 1,
        },
      },
    ],
    footnotes: [],
  },
  new_customer_info: {
    card_key: "new_customer_info",
    display_name: "New customer info",
    group: "identity",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // name banner
      {
        block: "ghost",
        hint: { kind: "fields", count: 3, shape: "input", labels: ["Phone", "Email", "Address"] },
      },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["Save and continue"], primaryIndex: 0 },
      },
    ],
    footnotes: [],
  },
  new_vehicle_form: {
    card_key: "new_vehicle_form",
    display_name: "New vehicle",
    group: "vehicle",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      {
        block: "ghost",
        hint: {
          kind: "fields",
          count: 5,
          shape: "input",
          labels: ["Year", "Make", "Model", "License plate", "Notes"],
        },
      },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["Add vehicle"], primaryIndex: 0 },
      },
    ],
    footnotes: [],
  },
  customer_info_edit: {
    card_key: "customer_info_edit",
    display_name: "Confirm your info",
    group: "identity",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // name banner
      {
        block: "ghost",
        hint: { kind: "fields", count: 3, shape: "input", labels: ["Phone", "Email", "Address"] },
      },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["Looks good"], primaryIndex: 0 },
      },
    ],
    footnotes: [],
  },
  concern_explanation: {
    card_key: "concern_explanation",
    display_name: "Concern explanation",
    group: "concerns",
    // Eyebrow (service name) + title (lead-in prompt) are dynamic — not editable.
    head: [{ slot_key: "description", role: "description" }],
    body: [
      {
        block: "ghost",
        hint: { kind: "fields", count: 1, shape: "textarea", labels: ["In your own words"] },
      },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["Continue"], primaryIndex: 0 },
      },
    ],
    footnotes: [],
  },
  diagnostic_loading: {
    card_key: "diagnostic_loading",
    display_name: "Diagnostic loading",
    group: "concerns",
    // Error-state body + failure alert stay hardcoded (error messaging).
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title_running", role: "title" },
    ],
    body: [
      { block: "slot", slot_key: "title_slow", variant: "heading" },
      { block: "slot", slot_key: "title_very_slow", variant: "heading" },
      { block: "slot", slot_key: "body_running", variant: "plain" },
      { block: "slot", slot_key: "body_slow", variant: "plain" },
      { block: "slot", slot_key: "body_very_slow", variant: "plain" },
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // loading dots
    ],
    footnotes: [],
  },
  clarification_question: {
    card_key: "clarification_question",
    display_name: "Clarification question",
    group: "concerns",
    // Title is the DB-driven question_text — not editable here.
    head: [{ slot_key: "eyebrow_base", role: "eyebrow" }],
    body: [
      { block: "slot", slot_key: "description_single", variant: "plain" },
      { block: "slot", slot_key: "description_multi", variant: "plain" },
      {
        block: "ghost",
        hint: { kind: "badges", count: 3, labels: ["Option A", "Option B", "Option C"] },
      },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 1, layout: "stack", labels: ["I'm not sure"] },
      },
    ],
    footnotes: ["footnote"],
  },
  concern_clarify: {
    card_key: "concern_clarify",
    display_name: "Concern clarify",
    group: "concerns",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
    ],
    body: [
      { block: "slot", slot_key: "body_concern_label", variant: "plain" },
      { block: "ghost", hint: { kind: "note", tone: "gold" } }, // echoed-concern quote
      { block: "slot", slot_key: "description", variant: "plain" },
      { block: "ghost", hint: { kind: "list", count: 2 } }, // candidate rows
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 1,
          layout: "stack",
          labels: ["None of these — pass it to an advisor"],
        },
      },
    ],
    footnotes: ["footnote"],
  },
  testing_service_approval: {
    card_key: "testing_service_approval",
    display_name: "Testing approval",
    group: "concerns",
    head: [
      { slot_key: "eyebrow_base", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      { block: "ghost", hint: { kind: "list", count: 2 } }, // testing-service checkboxes
      { block: "slot", slot_key: "body_pricing_note", variant: "plain" },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 1,
          layout: "stack",
          labels: ["Looks good — schedule these"],
          primaryIndex: 0,
        },
      },
    ],
    footnotes: [],
  },
  second_routine_pass: {
    card_key: "second_routine_pass",
    display_name: "Add-ons",
    group: "concerns",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      {
        block: "ghost",
        hint: { kind: "badges", count: 3, labels: ["Oil Change", "Tire Rotation", "Wiper Blades"] },
      },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_describe_prompt", variant: "plain" },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 2,
          layout: "row",
          labels: ["Describe another issue", "Continue without adding more"],
          primaryIndex: 1,
        },
      },
    ],
    footnotes: [],
  },
  summary: {
    card_key: "summary",
    display_name: "Summary",
    group: "confirmation",
    // Hold-ID footnote + countdown pill are dynamic — not editable.
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
    ],
    body: [
      { block: "slot", slot_key: "body_appointment_label", variant: "heading" },
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // date/time
      { block: "slot", slot_key: "body_type_waiter", variant: "plain" },
      { block: "slot", slot_key: "body_type_dropoff_sameday", variant: "plain" },
      { block: "slot", slot_key: "body_type_dropoff", variant: "plain" },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_for_label", variant: "heading" },
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // customer + vehicle
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_services_label", variant: "heading" },
      { block: "slot", slot_key: "body_routine_label", variant: "plain" },
      { block: "slot", slot_key: "body_concerns_label", variant: "plain" },
      { block: "slot", slot_key: "body_testing_label", variant: "plain" },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_reminders_label", variant: "heading" },
      { block: "ghost", hint: { kind: "list", count: 2 } }, // reminders
      { block: "ghost", hint: { kind: "countdown", tone: "rule" } }, // hold timer
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 2,
          layout: "row",
          labels: ["Edit something", "Confirm appointment 🔑"],
          primaryIndex: 1,
        },
      },
    ],
    footnotes: ["footnote"],
  },
  summary_edit_hub: {
    card_key: "summary_edit_hub",
    display_name: "Edit summary",
    group: "confirmation",
    // Empty-state italic fallbacks + per-section values are dynamic — not editable.
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      { block: "slot", slot_key: "body_section_contact", variant: "heading" },
      { block: "ghost", hint: { kind: "note", tone: "rule" } },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_section_vehicle", variant: "heading" },
      { block: "ghost", hint: { kind: "note", tone: "rule" } },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_section_services", variant: "heading" },
      { block: "slot", slot_key: "body_routine_label", variant: "plain" },
      { block: "slot", slot_key: "body_concerns_label", variant: "plain" },
      { block: "slot", slot_key: "body_testing_label", variant: "plain" },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      { block: "slot", slot_key: "body_section_time", variant: "heading" },
      { block: "slot", slot_key: "body_type_waiter", variant: "plain" },
      { block: "slot", slot_key: "body_type_dropoff", variant: "plain" },
      { block: "slot", slot_key: "body_hold_caution", variant: "plain" },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 1,
          layout: "stack",
          labels: ["Looks good — back to summary"],
          primaryIndex: 0,
        },
      },
    ],
    footnotes: ["footnote"],
  },
  customer_notes: {
    card_key: "customer_notes",
    display_name: "Customer notes",
    group: "confirmation",
    // Two render modes — input first, then the approval-mode copy below.
    head: [
      { slot_key: "input_eyebrow", role: "eyebrow" },
      { slot_key: "input_title", role: "title" },
      { slot_key: "input_description", role: "description" },
    ],
    body: [
      {
        block: "ghost",
        hint: { kind: "fields", count: 1, shape: "textarea", labels: ["Notes for the team"] },
      },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 2, layout: "row", labels: ["Skip", "Send note"], primaryIndex: 1 },
      },
      { block: "ghost", hint: { kind: "divider", tone: "rule" } },
      // Approval mode (shown when the note comes back for confirmation).
      { block: "slot", slot_key: "approval_eyebrow", variant: "heading" },
      { block: "slot", slot_key: "approval_title", variant: "heading" },
      { block: "slot", slot_key: "approval_description", variant: "plain" },
      { block: "ghost", hint: { kind: "note", tone: "rule" } }, // cleaned-up note quote
      { block: "slot", slot_key: "approval_last_try", variant: "plain" },
      {
        block: "ghost",
        hint: { kind: "buttons", count: 2, layout: "row", labels: ["Edit", "Save"], primaryIndex: 1 },
      },
    ],
    footnotes: [],
  },
  customer_question: {
    card_key: "customer_question",
    display_name: "Customer question",
    group: "confirmation",
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
      { slot_key: "description", role: "description" },
    ],
    body: [
      {
        block: "ghost",
        hint: { kind: "fields", count: 1, shape: "textarea", labels: ["Question for the team"] },
      },
      {
        block: "ghost",
        hint: {
          kind: "buttons",
          count: 2,
          layout: "row",
          labels: ["No questions — all set", "Send question"],
          primaryIndex: 1,
        },
      },
    ],
    footnotes: [],
  },
  appointment_type: {
    card_key: "appointment_type",
    display_name: "Appointment type",
    group: "scheduling",
    // Per-option copy (title/description/emoji) lives on the Appointment Types
    // tab; only the card chrome (eyebrow/title/footnote) is editable here.
    head: [
      { slot_key: "eyebrow", role: "eyebrow" },
      { slot_key: "title", role: "title" },
    ],
    body: [
      {
        block: "ghost",
        hint: { kind: "buttons", count: 2, layout: "stack", labels: ["Waiter", "Dropoff"] },
      },
    ],
    footnotes: ["footnote"],
  },
};

/** Look up a card's presentation manifest by card_key. Null when absent. */
export function getCardPreviewManifest(
  cardKey: string,
): CardPreviewManifest | null {
  return CARD_PREVIEW_MANIFEST[cardKey] ?? null;
}

