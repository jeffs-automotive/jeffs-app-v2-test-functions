/**
 * consent-copy — the CANONICAL appointment-SMS disclosure (2026-07-17 rewrite).
 *
 * Appointment confirmation/reminder SMS is TRANSACTIONAL — it sends by default;
 * the customer can OPT OUT via the checkbox. Leaving the box UNCHECKED is the
 * consent act, disclosed by APPT_SMS_CONSENT_STATEMENT. Marketing SMS consent
 * lives in the customer portal (separate) and is out of scope here.
 *
 * Single source of truth shared by the PhoneNameCard opt-out panel (renders it)
 * and submitPhoneNameV2 (records APPT_SMS_DISCLOSURE_VERSION on the session as
 * proof of the exact disclosure the customer saw). BUMP the version on ANY
 * wording change — proof-of-consent keys evidence to the version live at the
 * time the customer proceeded.
 *
 * URL note (design spec §7.6): the campaign registration used the
 * admin.jeffsautomotive.com legal pages (live). Swap to customer-facing
 * jeffsautomotive.com equivalents when Chris confirms the host.
 */

export const APPT_SMS_DISCLOSURE_VERSION = "appt-optout-v1-2026-07-17";

export const CONSENT_TERMS_URL = "https://admin.jeffsautomotive.com/legal/terms";
export const CONSENT_PRIVACY_URL = "https://admin.jeffsautomotive.com/legal/privacy";

/** The opt-out checkbox label (checked = do NOT text me). */
export const APPT_SMS_OPT_OUT_LABEL =
  "Don't send me text messages about my appointment.";

/** The consent-by-default statement shown next to the (unchecked) box. */
export const APPT_SMS_CONSENT_STATEMENT =
  "By not checking this box, you consent to receive text messages about your appointment.";

/** CTIA disclosure elements shown under the statement. */
export const APPT_SMS_FINE_PRINT =
  "Appointment confirmations & reminders, up to ~4 messages per appointment. " +
  "Msg & data rates may apply. Reply STOP to opt out, HELP for help. " +
  `See our Terms (${CONSENT_TERMS_URL}) and Privacy Policy (${CONSENT_PRIVACY_URL}).`;

/** The full disclosure the customer saw — versioned for proof-of-consent. */
export const APPT_SMS_DISCLOSURE_TEXT =
  `${APPT_SMS_OPT_OUT_LABEL} ${APPT_SMS_CONSENT_STATEMENT} ${APPT_SMS_FINE_PRINT}`;
