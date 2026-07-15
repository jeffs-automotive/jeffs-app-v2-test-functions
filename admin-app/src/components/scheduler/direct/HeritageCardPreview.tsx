"use client";

/**
 * HeritageCardPreview — ONE generic, data-driven reproduction of a wizard
 * card's "look", rendered inside the admin Card-Text editor's paper canvas.
 *
 * It reimplements the scheduler-app Heritage Card MARKUP (never imports from
 * scheduler-app — separate app/build) using the scoped `.hp-*` stylesheet
 * (card-preview.css). It fills the shell from two inputs merged at render:
 *   1. copy data  — the CardTextRow[] the page already fetched (body/default/
 *      label/allowed_merge_fields);
 *   2. presentation — the CARD_PREVIEW_MANIFEST entry (typography role, body
 *      order, ghost geometry).
 *
 * Editable "copy" slots are REAL labeled textareas rendered in their exact
 * on-scheduler typography (borderless at rest, affordance on hover/focus).
 * Merge tokens show as burgundy sample chips at rest (a read-mode overlay) and
 * as raw {{token}} text on focus. Non-copy controls (buttons/badges/…) are
 * static, inert, aria-hidden ghosts so the layout reads true while making it
 * physically impossible to edit anything but the words.
 *
 * PURE PRESENTATION: this component owns no server state and calls no action.
 * The parent (CardTextDirectTab) holds the values map + runs the imperative
 * save; this only renders + reports edits up via onChange / onResetSlot.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  Fragment,
} from "react";

import type { CardTextRow } from "@/lib/scheduler/read-dal";
import {
  CARD_MERGE_FIELDS,
  tokensInBody,
} from "@/lib/scheduler/card-merge-fields";
import type {
  BodyBlock,
  CardPreviewManifest,
  GhostHint,
} from "./card-preview-manifest";

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

type Segment = { t: "text"; v: string } | { t: "tok"; name: string };

/** Split raw body into text + {{token}} segments (for the chip overlay). */
function splitTokens(text: string): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    out.push({ t: "tok", name: m[1] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

type TokenIssue = { level: "none" | "error" | "warn"; message: string };

/** Classify a body's tokens: unknown → error (red), known-but-not-allowed →
 *  warn (amber). Both fail-closed on the server; severity drives the styling. */
function classifyTokens(value: string, allowed: readonly string[]): TokenIssue {
  const tokens = tokensInBody(value);
  const unknown = tokens.filter((t) => !(t in CARD_MERGE_FIELDS));
  if (unknown.length > 0) {
    return {
      level: "error",
      message: `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown
        .map((t) => `{{${t}}}`)
        .join(", ")}. Remove or fix before saving.`,
    };
  }
  const notAllowed = tokens.filter((t) => !allowed.includes(t));
  if (notAllowed.length > 0) {
    return {
      level: "warn",
      message: `${notAllowed.map((t) => `{{${t}}}`).join(", ")} ${
        notAllowed.length > 1 ? "aren't" : "isn't"
      } available on this card — ${
        notAllowed.length > 1 ? "they" : "it"
      } won't fill in.`,
    };
  }
  return { level: "none", message: "" };
}

// ─── inline editable field ───────────────────────────────────────────────────

interface InlineFieldProps {
  /** Accessible name prefix, e.g. "Greeting". */
  cardName: string;
  /** DB row backing this slot (label/body/default/allowed). */
  row: CardTextRow;
  /** Typography class: hp-eyebrow | hp-title | hp-desc | hp-body | hp-body-heading | hp-footnote. */
  fieldClass: string;
  value: string;
  onChange: (next: string) => void;
  onReset: () => void;
  saving: boolean;
}

function InlineField({
  cardName,
  row,
  fieldClass,
  value,
  onChange,
  onReset,
  saving,
}: InlineFieldProps) {
  const uid = useId();
  const fieldId = `${uid}-field`;
  const hintId = `${uid}-hint`;
  const msgId = `${uid}-msg`;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const ovRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  const allowed = row.allowed_merge_fields;
  const dirty = value !== row.body;
  const canReset = value !== row.default_body;
  const issue = classifyTokens(value, allowed);
  const invalid = issue.level !== "none";
  const segments = useMemo(() => splitTokens(value), [value]);

  // Auto-grow: size the textarea to the taller of the raw text (its own
  // scrollHeight) and the rendered chip overlay, so nothing clips in either
  // state and the height never jumps between rest/focus.
  const sync = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const raw = ta.scrollHeight;
    const rendered = ovRef.current ? ovRef.current.offsetHeight : 0;
    ta.style.height = `${Math.max(raw, rendered)}px`;
  }, []);

  useEffect(() => {
    sync();
  }, [value, sync]);

  useEffect(() => {
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

  // Re-measure once the Poppins swap-in reflows the metrics.
  // (document.fonts.ready never rejects per spec; `void` marks it intentionally
  // not awaited — no empty catch, per observability rule 15.)
  useEffect(() => {
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(() => sync());
    }
  }, [sync]);

  const insertToken = useCallback(
    (token: string) => {
      const el = taRef.current;
      const snippet = `{{${token}}}`;
      if (!el) {
        onChange(value + snippet);
        return;
      }
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + snippet + value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + snippet.length;
        el.setSelectionRange(caret, caret);
      });
    },
    [onChange, value],
  );

  const describedBy =
    [allowed.length > 0 ? hintId : null, invalid ? msgId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div>
      <div className="hp-field-wrap">
        <span className="hp-field-gutter">
          {dirty ? (
            <span className="hp-dot">
              <span className="sr-only">edited, unsaved</span>
            </span>
          ) : null}
          {canReset ? (
            <button
              type="button"
              className="hp-reset"
              disabled={saving}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onReset}
              aria-label={`Reset ${cardName} — ${row.label} to default`}
            >
              <span aria-hidden="true">↺</span>
            </button>
          ) : null}
        </span>

        <textarea
          id={fieldId}
          ref={taRef}
          className={`hp-field ${fieldClass}`}
          rows={1}
          value={value}
          disabled={saving}
          aria-label={`${cardName} — ${row.label}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-dirty={dirty || undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            // The chip overlay reappears on blur (CSS :focus) and can render
            // taller than the raw tokens — re-measure once :focus has cleared.
            requestAnimationFrame(sync);
          }}
          onChange={(e) => onChange(e.target.value)}
        />

        <div ref={ovRef} className={`hp-overlay ${fieldClass}`} aria-hidden="true">
          {segments.map((seg, i) =>
            seg.t === "text" ? (
              <Fragment key={i}>{seg.v}</Fragment>
            ) : seg.name in CARD_MERGE_FIELDS ? (
              <span
                key={i}
                className="hp-chip"
                title={`{{${seg.name}}} — sample: ${CARD_MERGE_FIELDS[seg.name]}`}
              >
                {CARD_MERGE_FIELDS[seg.name]}
              </span>
            ) : (
              <Fragment key={i}>{`{{${seg.name}}}`}</Fragment>
            ),
          )}
        </div>
      </div>

      {focused && allowed.length > 0 ? (
        <div className="hp-afford">
          {allowed.map((field) => (
            <button
              key={field}
              type="button"
              className="hp-insert"
              disabled={saving}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertToken(field)}
              title={`Insert {{${field}}} — sample: ${CARD_MERGE_FIELDS[field] ?? field}`}
            >
              {`+ {{${field}}}`}
            </button>
          ))}
          <span id={hintId} className="hp-hint">
            Fields fill in with each customer&rsquo;s details.
          </span>
        </div>
      ) : null}
      {!focused && allowed.length > 0 ? (
        <span id={hintId} className="sr-only">
          Personalized line. Available fields:{" "}
          {allowed.map((f) => `{{${f}}}`).join(", ")}.
        </span>
      ) : null}

      {invalid ? (
        <p
          id={msgId}
          role="alert"
          className={issue.level === "error" ? "hp-error" : "hp-warn"}
        >
          {issue.message}
        </p>
      ) : null}
    </div>
  );
}

// ─── ghosts (non-copy controls: static, inert, out of the a11y tree) ─────────

function Ghost({ hint }: { hint: GhostHint }) {
  if (hint.kind === "buttons") {
    return (
      <div className="hp-ghost hp-ghost-wrap" aria-hidden="true">
        <span className="hp-ghost-tag">preview only</span>
        <div className="hp-ghost-btns" data-layout={hint.layout}>
          {hint.labels.map((label, i) => {
            const tone =
              i === hint.primaryIndex ? "primary" : i < 2 ? "secondary" : "ghost";
            return (
              <span key={i} className="hp-ghost-btn" data-tone={tone}>
                {label}
              </span>
            );
          })}
        </div>
      </div>
    );
  }
  if (hint.kind === "fields") {
    return (
      <div className="hp-ghost hp-ghost-wrap" aria-hidden="true">
        <span className="hp-ghost-tag">preview only</span>
        <div className="hp-ghost-list">
          {Array.from({ length: hint.count }).map((_, i) => (
            <span key={i} className="hp-ghost-input">
              {hint.labels?.[i] ?? " "}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (hint.kind === "badges") {
    return (
      <div className="hp-ghost hp-ghost-badges" aria-hidden="true">
        {hint.labels?.map((label, i) => (
          <Fragment key={i}>
            <span className="hp-ghost-dot" />
            <span className="hp-ghost-badge">{label}</span>
          </Fragment>
        ))}
        <span className="hp-ghost-dot" />
      </div>
    );
  }
  if (hint.kind === "list") {
    return (
      <div className="hp-ghost hp-ghost-list" aria-hidden="true">
        {Array.from({ length: hint.count }).map((_, i) => (
          <span key={i} className="hp-ghost-listrow" />
        ))}
      </div>
    );
  }
  if (hint.kind === "divider") {
    return <div className="hp-ghost hp-ghost-divider" data-tone={hint.tone} aria-hidden="true" />;
  }
  // countdown | note
  return (
    <div className="hp-ghost" aria-hidden="true">
      <span className="hp-ghost-pill">
        {hint.kind === "countdown" ? "00:00" : "Note"}
      </span>
    </div>
  );
}

// ─── the card ────────────────────────────────────────────────────────────────

export interface HeritageCardPreviewProps {
  manifest: CardPreviewManifest;
  /** Every DB row for the selected card, keyed by slot_key. */
  rowsBySlot: Record<string, CardTextRow>;
  /** Current (possibly edited) body per slot_key. */
  values: Record<string, string>;
  onChange: (slotKey: string, next: string) => void;
  onResetSlot: (slotKey: string) => void;
  saving: boolean;
  /** Bumped on card switch → triggers the motion-safe cross-fade. */
  fadeKey?: string;
}

const VARIANT_CLASS: Record<string, string> = {
  plain: "hp-body",
  heading: "hp-body-heading",
  "gold-note": "hp-body",
};

export function HeritageCardPreview({
  manifest,
  rowsBySlot,
  values,
  onChange,
  onResetSlot,
  saving,
  fadeKey,
}: HeritageCardPreviewProps) {
  const titleId = `hp-preview-title-${manifest.card_key}`;
  const cardName = manifest.display_name;

  const field = (slotKey: string, fieldClass: string) => {
    const row = rowsBySlot[slotKey];
    if (!row) return null; // missing seed row → skip gracefully
    return (
      <InlineField
        cardName={cardName}
        row={row}
        fieldClass={fieldClass}
        value={values[slotKey] ?? row.body}
        onChange={(next) => onChange(slotKey, next)}
        onReset={() => onResetSlot(slotKey)}
        saving={saving}
      />
    );
  };

  const renderBodyBlock = (block: BodyBlock, i: number) => {
    if (block.block === "ghost") {
      return <Ghost key={`ghost-${i}`} hint={block.hint} />;
    }
    const cls = VARIANT_CLASS[block.variant] ?? "hp-body";
    const node = field(block.slot_key, cls);
    if (!node) return null;
    if (block.variant === "gold-note") {
      return (
        <div key={block.slot_key} className="hp-goldnote">
          {node}
        </div>
      );
    }
    return <div key={block.slot_key}>{node}</div>;
  };

  const footnoteRows = manifest.footnotes.filter((k) => rowsBySlot[k]);

  return (
    <article
      className="hp-card"
      role="group"
      aria-labelledby={titleId}
      data-fade="true"
      key={fadeKey}
    >
      <p className="sr-only">
        Buttons, inputs and badges shown below are for layout only and are not
        editable here.
      </p>

      {manifest.head.map(({ slot_key, role }) => {
        if (!rowsBySlot[slot_key]) return null;
        if (role === "title") {
          return (
            <h2 key={slot_key} id={titleId} className="hp-slot hp-h2">
              {field(slot_key, "hp-title")}
            </h2>
          );
        }
        const cls = role === "eyebrow" ? "hp-eyebrow" : "hp-desc";
        return (
          <div key={slot_key} className="hp-slot">
            {field(slot_key, cls)}
          </div>
        );
      })}

      {manifest.body.length > 0 ? (
        <div className="hp-body-region">
          {manifest.body.map((block, i) => renderBodyBlock(block, i))}
        </div>
      ) : null}

      {footnoteRows.length > 0 ? (
        <div className="hp-footnote-region">
          {footnoteRows.map((slot_key) => (
            <div key={slot_key}>{field(slot_key, "hp-footnote")}</div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
