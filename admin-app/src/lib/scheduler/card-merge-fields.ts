/**
 * Card-text merge fields — the whitelist of {{tokens}} the wizard cards can
 * fill in, with sample values for the editor preview.
 *
 * DELIBERATELY separate from template-renderer.ts's MERGE_FIELD_SAMPLES (the
 * SMS/email comms tokens) — card copy has its own set (agent_name, shop_name,
 * shop_phone, …) that the SMS whitelist doesn't cover (cross-verify §12.7).
 *
 * Client-safe (no server imports): the editor imports it for the chip preview
 * + inline validation; the server action imports it for the fail-closed save
 * check (the server is the authority; the editor only mirrors it).
 */
export const CARD_MERGE_FIELDS: Record<string, string> = {
  agent_name: "Jeff",
  shop_name: "Jeff's Automotive",
  shop_phone: "(610) 253-6565",
  first_name: "Sarah",
  appointment_label: "Friday, Jul 18",
  vehicle: "2019 Honda Civic",
};

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** Every {{token}} name referenced in a body (in order, with duplicates). */
export function tokensInBody(body: string): string[] {
  const out: string[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Validate a card-copy body: every {{token}} must be a KNOWN merge field AND
 * allowed on this slot. Fail-closed.
 */
export function validateCardTextBody(
  body: string,
  allowed: readonly string[],
): { ok: true } | { ok: false; error: string } {
  const tokens = tokensInBody(body);
  const unknown = tokens.filter((t) => !(t in CARD_MERGE_FIELDS));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown merge field(s): ${unknown.map((t) => `{{${t}}}`).join(", ")}. Remove or fix before saving.`,
    };
  }
  const notAllowed = tokens.filter((t) => !allowed.includes(t));
  if (notAllowed.length > 0) {
    return {
      ok: false,
      error: `Merge field(s) not available on this card: ${notAllowed.map((t) => `{{${t}}}`).join(", ")}.`,
    };
  }
  return { ok: true };
}

/** Render a body to a preview STRING using the sample values (for the editor). */
export function renderCardTextSample(body: string): string {
  return body.replace(TOKEN_RE, (whole, tok: string) => {
    const sample = CARD_MERGE_FIELDS[tok];
    return sample !== undefined ? sample : whole;
  });
}
