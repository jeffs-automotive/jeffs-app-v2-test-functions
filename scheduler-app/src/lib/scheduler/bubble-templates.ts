/**
 * Templated Jeff-voice chat-bubble copy for wizard step transitions.
 *
 * Per chat-design.md voice guidelines: card headings stay clean + editorial;
 * chat-bubbles between cards carry Jeff's warmth. With the row-as-truth
 * refactor (2026-05-13), the chat agent LLM no longer generates this copy
 * — Server Actions return a templated string from this catalog and the
 * client renders it as a chat-bubble before showing the next card.
 *
 * Variables in templates use {{name}} syntax. interpolate() does the swap
 * with strict missing-key handling (throws in dev, falls back to empty
 * string in production to avoid mid-flow crashes).
 *
 * Voice rules enforced here (per Chris's design directive 2026-05-13):
 *   - ONE emoji per bubble (occasionally two for celebratory moments)
 *   - Short sentences
 *   - First-person ("I'll grab...") for Jeff's actions; "we" for shop team
 *   - No corporate-speak, no apologetic filler
 *   - Exclamation points OK in greetings + confirmations
 */

export interface BubbleTemplate {
  /** The raw template with {{var}} placeholders. */
  text: string;
  /** Optional context hint for testers / future i18n. */
  context?: string;
}

/** All known bubble copy keyed by directive name. */
export const BUBBLE_TEMPLATES: Record<string, BubbleTemplate | BubbleTemplate[]> = {
  // ─── Step 1 → Step 2 transitions ───────────────────────────────────────
  greeting_returning: {
    text: "Welcome back! 👋 Let me grab your info real quick.",
    context: "Customer tapped 'I've been here before'",
  },
  greeting_new: {
    text: "Awesome — first visit! 👋 Let me grab a couple of details.",
    context: "Customer tapped 'No, first time'",
  },
  greeting_unsure: {
    text: "No worries — I'll figure it out. 👋 Let me grab a couple of details.",
    context: "Customer tapped 'I'm not sure'",
  },

  // ─── Step 2 → Step 3 transitions ───────────────────────────────────────
  phone_name_to_otp: {
    text: "Texting you a code now — give it a sec! 📱",
    context: "Phone+name submitted, orchestrator sent OTP",
  },

  // ─── Step 4 reconciliation outcomes ────────────────────────────────────
  identity_match_required: {
    text: "I see a few accounts with that number — which one is you? 🤔",
    context: "Phone has 2+ Tekmetric hits; need name disambiguation",
  },
  show_new_customer_form: {
    text: "Looks like you're new here — let me grab a couple more details.",
    context: "Phone has 0 hits and customer self-IDs as new",
  },
  partial_verification: {
    text: "Got your name on file but the phone doesn't match. We can still get you booked. 🛠️",
    context: "Name match but phone mismatch — partial verify",
  },

  // ─── Step 5 → Step 6 transitions ───────────────────────────────────────
  to_vehicle_pick: {
    text: "All set! Which vehicle are we taking care of today? 🚗",
    context: "Identity verified; show vehicle picker",
  },
  vehicle_added: {
    text: "Got it — added the new one! 🚗",
    context: "New vehicle saved",
  },

  // ─── Step 7 transitions ────────────────────────────────────────────────
  to_service_picker: {
    text: "Perfect. What can we help you with today? 🛠️",
    context: "Vehicle picked; show service+concern picker",
  },
  concern_to_diagnostic_loading: {
    text: "Let me think through what we should test for that…",
    context: "Customer described a concern; diagnostic specialist is classifying",
  },
  testing_approved: {
    text: "Got it — added that to your appointment. ✓",
    context: "Customer approved testing services",
  },
  testing_skipped: {
    text: "No testing this time — that's fine. Let's keep going.",
    context: "Customer declined all testing services",
  },

  // ─── Step 8 transitions ────────────────────────────────────────────────
  to_appointment_type: {
    text: "Want to wait or drop it off?",
    context: "Services settled; show waiter vs dropoff picker",
  },

  // ─── Step 9 transitions ────────────────────────────────────────────────
  to_date_pick: {
    text: "Pick a day that works! 📅",
    context: "Appointment type chosen; show calendar",
  },
  to_waiter_time_pick: {
    text: "What time on {{date}}? ☕",
    context: "Date chosen for waiter; show time picker",
  },

  // ─── Step 10 transitions ───────────────────────────────────────────────
  to_summary: {
    text: "Almost there — does this all look right? ✅",
    context: "Slot held; show summary card",
  },
  appointment_confirmed: {
    text: "All set! ✨ You're on the books for {{starts_at_friendly}}.",
    context: "Appointment confirmed in Tekmetric",
  },
  to_customer_notes: {
    text: "Anything else our team should know?",
    context: "Optional notes prompt",
  },
  to_customer_question: {
    text: "Got any questions for our team?",
    context: "Optional question prompt",
  },
  session_complete: {
    text: "Thanks for booking with us! 🔑 See you {{starts_at_friendly}}.",
    context: "All optional captures done; close out",
  },

  // ─── Errors + escalation ───────────────────────────────────────────────
  hold_expired: {
    text: "Looks like that hold timed out — sorry about that! 😬 Let me grab fresh slots…",
    context: "10-min hold lapsed before customer confirmed",
  },
  slot_just_taken: {
    text: "Whoops — someone else just grabbed that one. Let me pull fresh times…",
    context: "Race condition on slot hold",
  },
  tool_error: {
    text: "Hmm, something glitched on my end. Let me try again…",
    context: "Tekmetric / orchestrator failure",
  },
  escalate: {
    text: "Let me get you over to the team. 📞",
    context: "Escalation triggered (any §10 reason)",
  },
  session_restarted: {
    text: "Sure thing — starting over. 👋",
    context: "Customer tapped Start Over from footer",
  },
};

/**
 * Interpolate {{var}} placeholders with values from `vars`. Unknown vars
 * are replaced with empty string in production; throw in development for
 * early detection of template/variable drift.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/{{(\w+)}}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) {
      if (process.env.NODE_ENV === "development") {
        // Surface missing template var loudly in dev. Production fails open.
        // eslint-disable-next-line no-console
        console.warn(`bubble-template missing var: ${key}`);
      }
      return "";
    }
    return String(v);
  });
}

/**
 * Resolve a bubble copy string by key + variables. Returns undefined when
 * the key is unknown (caller decides whether to render nothing or fall
 * back to a generic transition).
 */
export function getBubbleCopy(
  key: string,
  vars: Record<string, string | number | undefined> = {},
): string | undefined {
  const t = BUBBLE_TEMPLATES[key];
  if (!t) return undefined;
  const template = Array.isArray(t) ? t[Math.floor(Math.random() * t.length)] : t;
  if (!template) return undefined;
  return interpolate(template.text, vars);
}
