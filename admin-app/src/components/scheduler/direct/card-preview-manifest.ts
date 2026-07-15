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
};

/** Look up a card's presentation manifest by card_key. Null when absent. */
export function getCardPreviewManifest(
  cardKey: string,
): CardPreviewManifest | null {
  return CARD_PREVIEW_MANIFEST[cardKey] ?? null;
}

/**
 * Every slot_key a manifest references (head + body slots + footnotes), in
 * render order. Handy for manifest↔seed parity assertions and for the preview
 * to know which rows it consumes.
 */
export function manifestSlotKeys(manifest: CardPreviewManifest): string[] {
  const keys: string[] = manifest.head.map((h) => h.slot_key);
  for (const blk of manifest.body) {
    if (blk.block === "slot") keys.push(blk.slot_key);
  }
  keys.push(...manifest.footnotes);
  return keys;
}
