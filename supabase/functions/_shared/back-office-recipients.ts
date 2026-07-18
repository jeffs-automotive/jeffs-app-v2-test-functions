// back-office-recipients — pure recipient selection for the back-office alert emails.
//
// Kept out of back-office-notify/index.ts so it unit-tests without importing that module's
// Deno.serve side effect. Which settings list drives each event:
//   detected     → reopened_emails (D4: dedicated list only, no fallback)
//   sent_to_sa / resent_to_sa → sa_emails
//   sa_submitted → office + accounting
//   verified     → sa + office + accounting
//   ro_closed    → office
import type { BackOfficeEvent } from "./back-office-email.ts";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RecipientBlob {
  sa_emails?: unknown;
  office_emails?: unknown;
  accounting_emails?: unknown;
  reopened_emails?: unknown;
}

export function recipientsFor(event: BackOfficeEvent, blob: RecipientBlob): string[] {
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && EMAIL_RX.test(x.trim())).map((x) => x.trim())
      : [];
  const sa = list(blob.sa_emails);
  const office = list(blob.office_emails);
  const accounting = list(blob.accounting_emails);
  const reopened = list(blob.reopened_emails);
  let picked: string[];
  switch (event) {
    case "sent_to_sa":
    case "resent_to_sa":
      picked = sa;
      break;
    case "sa_submitted":
      picked = [...office, ...accounting];
      break;
    case "verified":
      picked = [...sa, ...office, ...accounting];
      break;
    case "detected":
      picked = reopened; // reopened-RO alert → its own list only (empty ⇒ no send)
      break;
    case "ro_closed":
      picked = office;
      break;
  }
  return [...new Set(picked)];
}
