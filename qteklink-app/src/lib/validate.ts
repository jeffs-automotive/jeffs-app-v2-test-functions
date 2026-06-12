/** Shared input-validation primitives for the QTekLink actions. */

/** A pragmatic single-address email check (local@domain.tld) — the shared regex behind
 *  the /settings alert-recipient lists and the sign-in allowlist add form. */
export const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
