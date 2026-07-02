/**
 * consent-copy — the CANONICAL SMS-consent disclosure (revamp Phase 2).
 *
 * Single source of truth shared by the PhoneNameCard consent panel (renders
 * it) and submitPhoneNameV2 (stores it in sms_consents.cta_text). TCPA
 * proof-of-consent requires persisting the EXACT copy the customer saw —
 * storing the server-side constant (rather than trusting a client-supplied
 * string) makes the record tamper-proof: the client sends only the boolean.
 *
 * BUMP CONSENT_CTA_VERSION on ANY wording change — the ledger keys evidence
 * to the version that was live at grant time.
 *
 * URL note (design spec §7.6): the campaign registration used the
 * admin.jeffsautomotive.com legal pages (live). Swap to customer-facing
 * jeffsautomotive.com equivalents when Chris confirms the host.
 */

export const CONSENT_CTA_VERSION = "wizard-v1-2026-07-02";

export const CONSENT_TERMS_URL = "https://admin.jeffsautomotive.com/legal/terms";
export const CONSENT_PRIVACY_URL = "https://admin.jeffsautomotive.com/legal/privacy";

/** The checkbox's lead line (also part of the stored disclosure). */
export const CONSENT_LABEL_LEAD =
  "Text me appointment updates from Jeff's Automotive.";

/** The fine-print disclosure adjacent to the checkbox (CTIA elements). */
export const CONSENT_FINE_PRINT =
  "Appointment confirmations & reminders, up to ~4 messages per appointment. " +
  "Msg & data rates may apply. Reply STOP to opt out, HELP for help. " +
  `See our Terms (${CONSENT_TERMS_URL}) and Privacy Policy (${CONSENT_PRIVACY_URL}).`;

/** The optionality clarification under the box (part of what was shown). */
export const CONSENT_OPTIONAL_NOTE =
  "Leave this unchecked and you'll still get your one-time security code — " +
  "you just won't receive confirmation or reminder texts.";

/** The full stored disclosure — everything rendered adjacent to the action. */
export const CONSENT_CTA_TEXT =
  `${CONSENT_LABEL_LEAD} ${CONSENT_FINE_PRINT} ${CONSENT_OPTIONAL_NOTE}`;
