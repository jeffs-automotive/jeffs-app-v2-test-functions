"use client";

import { useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step — Concern triage card (feature concern-triage, Tier-A, 2026-07-18).
 *
 * When Stage-1 of the concern-diagnosis pipeline returns 0 candidates for a
 * genuinely-vague concern ("something's off", "car feels weird") with a
 * triage-eligible no_match_reason, instead of silently forwarding to an advisor
 * the wizard asks ONE broad question to establish a category. This card:
 *
 *   1. Echoes the customer's OWN typed words back as an editorial pull-quote
 *      (the identical concern_text idiom as ConcernClarifyCard, 3-line clamp).
 *   2. Asks one broad, Jeff-voice question ("Which of these is closest?").
 *   3. Presents the ~12 concern categories in customer voice as single-tap
 *      emoji-topped paper tiles in a 2-column grid (3 columns at sm:) — one tap
 *      submits and advances to the re-diagnosis loading state. No multi-select,
 *      no Continue.
 *   4. Offers an always-present, visually-distinct escape — "Something else /
 *      not sure" — a ghost button below a hairline divider that forwards the
 *      concern to a human advisor (mirrors ConcernClarifyCard's escape exactly).
 *
 * Interaction model (design spec §0, §4.2): the tiles are ACTION buttons, NOT a
 * radiogroup / aria-pressed toggles — a tap immediately submits and unmounts the
 * card, so there is no persistent "one-of-many checked" state for AT to convey
 * (same rationale as ConcernClarifyCard). role="group" + aria-label scopes the
 * choice set; the card's aria-labelledby already names it.
 *
 * Design-and-wiring only — this is a presentational leaf that renders props and
 * calls onSubmit. It touches no Server Action / DAL / state machine. The escape
 * submits the reserved chip_key "not_sure".
 * See .claude/work/design/concern-triage-spec.md.
 */

export interface ConcernTriageChip {
  /** Stable key the action echoes back (audited chip_key from the seed). */
  chip_key: string;
  /** Customer-voice category label, e.g. "The brakes". The tile's accessible name. */
  display_label: string;
}

/** The resolved copy slots this card renders (card-text-editor strings). */
export interface ConcernTriageCopy {
  eyebrow: string;
  title: string;
  description: string;
  footnote: string;
}

export interface ConcernTriageCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings. */
  copy: ConcernTriageCopy;
  /** The customer's own typed concern text, echoed back verbatim (may be empty). */
  concernText: string;
  /** The category chips, ALREADY SORTED by the caller (seed `sort` column).
   *  Rendered in array order — never re-sorted here (same rule as ConcernClarify). */
  chips: ConcernTriageChip[];
  /** A submit is in flight (parent-owned). Disables every control while true. */
  pending: boolean;
  /** Submit the chosen category. The escape submits the reserved key "not_sure". */
  onSubmit: (chip_key: string) => void;
}

/** Reserved escape key — forwards the concern to a human advisor. */
const NOT_SURE_KEY = "not_sure";

/**
 * Presentational emoji map (aria-hidden, decorative; NOT the accessible name).
 * Keyed by chip_key with a generous set of likely slug aliases; an unknown key
 * falls through to `undefined` → the tile renders text-only, so adding/removing
 * or renaming a seed row can never break the card. Three glyphs (steering,
 * drivability, heat/AC) are semantically weak accents only — the card is fully
 * usable text-only (design spec §4.2 fallback).
 */
const TRIAGE_ICON: Record<string, string> = {
  noise: "🔊",
  sound: "🔊",
  shaking: "📳",
  vibration: "📳",
  warning_light: "⚠️",
  warning: "⚠️",
  dash_light: "⚠️",
  leak: "💧",
  leaking: "💧",
  fluid: "💧",
  smell: "👃",
  odor: "👃",
  smoke: "💨",
  steam: "💨",
  brakes: "🛑",
  brake: "🛑",
  steering: "🧭",
  pulling: "🧭",
  alignment: "🧭",
  heat_ac: "🌡️",
  hvac: "🌡️",
  climate: "🌡️",
  ac: "🌡️",
  battery: "🔋",
  electrical: "🔋",
  wont_start: "🔋",
  drivability: "⚙️",
  runs_drives: "⚙️",
  performance: "⚙️",
  stalling: "⚙️",
  tires: "🛞",
  wheels: "🛞",
  tire: "🛞",
};

export function ConcernTriageCard({
  copy,
  concernText,
  chips,
  pending,
  onSubmit,
}: ConcernTriageCardProps) {
  // Tracks WHICH control was tapped so the committing wash + spinner land on the
  // right tile (or the escape). The parent owns `pending`; this is the visual
  // partner. Same string-tracking idiom as ConcernClarifyCard's `pending`, split
  // out here because the wiring contract hands us a boolean in-flight flag.
  const [committingKey, setCommittingKey] = useState<string | null>(null);

  // When the parent releases `pending` without the card unmounting (e.g. an
  // error keeps this card mounted), clear the marker so controls re-enable and
  // the customer can retry or take the escape (behavior parity: ConcernClarify
  // resets its pending in `finally`).
  useEffect(() => {
    if (!pending) setCommittingKey(null);
  }, [pending]);

  const controlsDisabled = pending || committingKey !== null;

  function pick(chip_key: string) {
    if (controlsDisabled) return;
    setCommittingKey(chip_key);
    onSubmit(chip_key);
  }

  const displayedConcern = concernText.trim();

  return (
    <Card aria-labelledby="concern-triage-title">
      <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
      <Card.Title id="concern-triage-title">{copy.title}</Card.Title>

      {/* ── Echoed concern: editorial pull-quote (gold rule-accent) ── */}
      {displayedConcern.length > 0 ? (
        <blockquote
          className={
            "mt-1.5 border-l-2 border-brand-gold-400 pl-3.5 py-0.5 " +
            "text-[15px] leading-relaxed italic text-ink line-clamp-3"
          }
        >
          {displayedConcern}
        </blockquote>
      ) : null}

      <Card.Description>{copy.description}</Card.Description>

      {/* ── The category grid: 2-col mobile, 3-col at sm: (the one new layout).
          Skipped entirely if chips is empty (defensive) — the escape below still
          renders, so the customer never dead-ends. ── */}
      {chips.length > 0 ? (
        <Card.Body>
          <ul
            role="group"
            aria-label="Choose the closest category"
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          >
            {chips.map((chip) => {
              const isCommitting = committingKey === chip.chip_key;
              const icon = TRIAGE_ICON[chip.chip_key]; // undefined → no icon
              // Idle tile: rule-input resting boundary (3.21:1, passes the
              // non-text UI floor). Committing tile: burgundy border + burgundy-50
              // wash (8.53:1 border / 14.40:1 label). Raw template strings — no
              // cn(); class order matters (scheduler-app convention).
              const tileClass = isCommitting
                ? "flex h-full w-full flex-col items-start gap-1.5 rounded-[var(--radius-card)] " +
                  "border border-brand-burgundy-700 bg-brand-burgundy-50 px-3.5 py-3 text-left " +
                  "min-h-16 shadow-[var(--shadow-card)] " +
                  "transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out " +
                  "disabled:cursor-not-allowed disabled:opacity-60"
                : "flex h-full w-full flex-col items-start gap-1.5 rounded-[var(--radius-card)] " +
                  "border border-[var(--color-rule-input)] bg-paper-100 px-3.5 py-3 text-left " +
                  "min-h-16 shadow-[var(--shadow-card)] " +
                  "transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out " +
                  "hover:border-brand-burgundy-400 hover:bg-brand-burgundy-50 hover:shadow-[var(--shadow-card-hover)] " +
                  "active:scale-[0.99] " +
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-burgundy-500 " +
                  "disabled:cursor-not-allowed disabled:opacity-60";
              return (
                <li key={chip.chip_key}>
                  <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() => pick(chip.chip_key)}
                    className={tileClass}
                  >
                    {icon ? (
                      <span aria-hidden className="text-xl leading-none">
                        {icon}
                      </span>
                    ) : null}
                    <span className="text-[14px] font-medium leading-snug text-ink">
                      {chip.display_label}
                    </span>
                    {isCommitting ? (
                      // 14px inline spinner (same SVG as Button); aria-hidden.
                      // The global reduced-motion block freezes animate-spin; the
                      // burgundy wash + disabled state still convey "this one is
                      // working" when the spinner is frozen.
                      <span aria-hidden className="mt-0.5">
                        <svg
                          className="h-3.5 w-3.5 animate-spin text-brand-burgundy-700"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="9"
                            stroke="currentColor"
                            strokeOpacity="0.25"
                            strokeWidth="3"
                          />
                          <path
                            d="M21 12a9 9 0 0 0-9-9"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card.Body>
      ) : null}

      <Card.Divider tone="rule" />

      <Card.Actions align="left">
        <Button
          variant="ghost"
          size="md"
          leadingIcon="💬"
          loading={committingKey === NOT_SURE_KEY}
          disabled={controlsDisabled}
          onClick={() => pick(NOT_SURE_KEY)}
          fullWidthOnMobile
        >
          Something else / not sure
        </Button>
      </Card.Actions>

      <Card.Footnote>{copy.footnote}</Card.Footnote>
    </Card>
  );
}
