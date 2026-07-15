/**
 * interpolate — render an editable copy template (from scheduler_card_text)
 * with its {{merge_field}} tokens replaced by values.
 *
 * Feature: card-text-editor. A card's copy strings may carry tokens like
 * `{{agent_name}}` or `{{shop_phone}}`. The card component owns the per-render
 * VALUES (it already has first_name, appointment_label, the shop phone link,
 * etc. as props) and passes them here. A value can be a plain string OR a
 * ReactNode — so a token can render as rich content (a `tel:` link, a bold
 * label) without the copy being editable HTML. This is what lets the wording
 * stay editable while inline links/dynamic values keep working.
 *
 * Unknown tokens (not in `values`) are rendered literally — the admin editor
 * rejects unknown tokens at save (fail-closed), so this is just a safe render
 * fallback, never the primary guard.
 *
 * Client-safe: no server imports, so card components can use it directly.
 */
import { Fragment, type ReactNode } from "react";

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export function interpolate(
  template: string,
  values: Record<string, ReactNode> = {},
): ReactNode {
  const out: ReactNode[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) out.push(template.slice(last, m.index));
    const token = m[1] ?? "";
    out.push(
      <Fragment key={`tok-${k++}`}>
        {token in values ? values[token] : m[0]}
      </Fragment>,
    );
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}
