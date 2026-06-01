// Shared phone display/normalization helpers for the customer-info cards.
//
// Extracted (file-size-refactor batch 2) from the byte-identical copies in
// CustomerInfoEditCard.tsx + NewCustomerInfoCard.tsx. NOTE: EscalationCard has
// a DIFFERENT formatPhoneForDisplay (full-format-only) — intentionally not
// merged here; merging would change its partial-input behavior.

const PHONE_DISPLAY_REGEX = /^(\d{0,3})(\d{0,3})(\d{0,4})$/;

/** Progressive display formatter for live typing: "4155551234" → "(415) 555-1234". */
export function formatPhoneForDisplay(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 10);
  const m = d.match(PHONE_DISPLAY_REGEX);
  if (!m) return d;
  const [, a, b, c] = m;
  if (!a) return "";
  if (!b) return a;
  if (!c) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

/** "(415) 555-1234" → "+14155551234"; null if not a valid US 10/11-digit number. */
export function normalizePhoneE164(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** "+14155551234" → "(415) 555-1234" (uses the last 10 digits). */
export function e164ToDisplay(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return formatPhoneForDisplay(d);
}
