/**
 * Editable wizard card copy — server-side loader + hardcoded defaults.
 *
 * Feature: card-text-editor (docs/scheduler/card-text-editor-plan.md). Staff
 * edit the "main copy" (eyebrow/title/description/footnote + in-body prose) of
 * each wizard card from /schedulerconfig; the wizard reads it here.
 *
 * Mirrors appointment-types.ts: a 5-minute TTL cache over
 * public.scheduler_card_text, overlaying the DB `body` onto CARD_TEXT_DEFAULTS.
 *
 * TWO deliberate differences from appointment-types.ts (cross-verify §12):
 *   - The cache is keyed by shop_id (a Map), never a single global — so if
 *     SHOP_ID ever becomes dynamic, one shop's copy can never be served to
 *     another (§12.2). Cheap insurance even though SHOP_ID is constant today.
 *   - ZERO rows is NORMAL (an uncustomized shop), NOT an outage — return
 *     defaults quietly. Only a genuine read ERROR is Sentry-captured
 *     (observability rule 9). (appointment-types treats 0 rows as an outage
 *     because the wizard can't function without bookable types; card copy has
 *     a complete hardcoded fallback, so it always renders.)
 *
 * The returned strings are RAW templates (they may contain {{merge_field}}
 * tokens). Substitution to text/nodes happens in the card component via
 * `interpolate` (wizard/card-copy.tsx), which has the per-render values.
 */
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHOP_ID } from "@/lib/scheduler/shop-config";

/** One editable copy slot: its shipped default + the merge tokens it allows. */
export interface CardTextSlotDef {
  default: string;
  allowed: readonly string[];
}

/**
 * CARD_TEXT_DEFAULTS — the single source of truth for the shipped copy + the
 * outage fail-safe + the TypeScript slot types. Byte-identical to the seed
 * rows in supabase/migrations/*_scheduler_card_text*.sql (so a card renders
 * identically whether it reads a seeded DB row or this fallback).
 *
 * card_key === WizardCard.step (card-payloads.ts). Add a card by adding its
 * entry here AND a matching seed row in a migration.
 */
export const CARD_TEXT_DEFAULTS = {
  greeting: {
    eyebrow: { default: "Welcome", allowed: [] },
    title: { default: "Hi, I'm {{agent_name}} 👋", allowed: ["agent_name"] },
    description: {
      default:
        "I'm the AI scheduling assistant for {{shop_name}}. I'll walk you through booking an appointment in just a few steps.",
      allowed: ["shop_name"],
    },
    body_disclosure: {
      default:
        "Heads up — this conversation is recorded and reviewed by our team to make sure we're taking good care of you.",
      allowed: [],
    },
    body_question: {
      default: "Have you been to our shop before?",
      allowed: [],
    },
    footnote: {
      default: 'Need a human instead? Tap "Talk to a person" below — no problem. 📞',
      allowed: [],
    },
  },
  completed: {
    eyebrow: { default: "All done", allowed: [] },
    title_named: { default: "You're all set, {{first_name}}.", allowed: ["first_name"] },
    title_anon: { default: "You're all set.", allowed: [] },
    description: {
      default:
        "We'll see you {{appointment_label}}. If anything comes up, text or call us at {{shop_phone}} and someone on our team will help you out.",
      allowed: ["appointment_label", "shop_phone"],
    },
    next_label: { default: "What happens next", allowed: [] },
    next_booked: { default: "We've booked it in our system", allowed: [] },
    next_reminders_consent: {
      default:
        "We'll text and email your confirmation and a reminder before your visit.",
      allowed: [],
    },
    next_reminders_noconsent: {
      default:
        "Your confirmation and summary are saved right here in this chat. Want text + email reminders? Just tell us at your visit and we'll turn them on.",
      allowed: [],
    },
    next_keys: {
      default: "Bring your keys and we'll take it from here",
      allowed: [],
    },
    thanks: {
      default:
        "Thanks for choosing {{shop_name}} — we appreciate it. A confirmation summary stays in this chat for your reference.",
      allowed: ["shop_name"],
    },
    footnote: {
      default: "Family-owned since 1976 · Questions? {{shop_phone}}",
      allowed: ["shop_phone"],
    },
  },
  phone_name: {
    title: { default: "Let's grab a few quick details.", allowed: [] },
    description: {
      default:
        "We'll send a one-time code to your phone to verify it's really you. 📲",
      allowed: [],
    },
    footnote: {
      default:
        "By continuing, you agree this conversation may be recorded and reviewed by our team to help us serve you better.",
      allowed: [],
    },
  },
  partial_verification_gate: {
    eyebrow: { default: "Quick check", allowed: [] },
    title_name: {
      default:
        "Found your name{{first_name}} — but the phone doesn't match what we have on file.",
      allowed: ["first_name"],
    },
    description_name: {
      default:
        "Want to try the number we'd have on file, or set up a fresh record with this number?",
      allowed: [],
    },
    body_name_note: {
      default:
        "We'll keep your old account on file — the service team can merge them later if needed.",
      allowed: [],
    },
    title_phone: {
      default: "We can't fully verify this combination from here.",
      allowed: [],
    },
  },
  multi_account_disambiguation: {
    eyebrow: { default: "Which one are you?", allowed: [] },
    title: {
      default: "Looks like more than one account on this phone 📱",
      allowed: [],
    },
    footnote: {
      default:
        "We'll only show your own appointments + history once we know which one you are. Your privacy matters.",
      allowed: [],
    },
  },
  no_match_choose_path: {
    eyebrow: { default: "One quick fork", allowed: [] },
    title: {
      default: "Hmm{{first_name}} — I'm not finding you in our records 🤔",
      allowed: ["first_name"],
    },
    body_reason_new: {
      default: "• You're new here — we'll set you up in a few quick steps.",
      allowed: [],
    },
    body_reason_moved: {
      default:
        "• You moved or changed your number — try the one we'd have on file.",
      allowed: [],
    },
    body_reason_guest: {
      default:
        "• You've been here as someone else's guest (a friend or family member). Continue as new and we'll sort it.",
      allowed: [],
    },
  },
  new_customer_info: {
    eyebrow: { default: "Set up your account", allowed: [] },
    title: {
      default: "Welcome to Jeff's, {{first_name}}! 👋",
      allowed: ["first_name"],
    },
    description: {
      default:
        "Just a few details so we can build your record. We'll save everything when you confirm the appointment.",
      allowed: [],
    },
  },
  new_vehicle_form: {
    eyebrow: { default: "Add your vehicle", allowed: [] },
    title: { default: "Now tell me about your ride! 🚗", allowed: [] },
    description: {
      default: "Just the basics — we'll add it to your account.",
      allowed: [],
    },
  },
  customer_info_edit: {
    eyebrow: { default: "Confirm your info", allowed: [] },
    title: { default: "Welcome back, {{first_name}}.", allowed: ["first_name"] },
    description: {
      default:
        "Quick check that we've got your contact info right. Update anything that's changed.",
      allowed: [],
    },
  },
  concern_explanation: {
    description: {
      default:
        "Even rough details help — when it started, what it sounds or feels like, where in the car you notice it. You don't need to know the cause.",
      allowed: [],
    },
  },
  diagnostic_loading: {
    eyebrow: { default: "Thinking through your concerns", allowed: [] },
    title_running: { default: "One moment...", allowed: [] },
    title_slow: { default: "Still thinking...", allowed: [] },
    title_very_slow: { default: "Still working on this...", allowed: [] },
    body_running: {
      default:
        "I'm thinking through what testing might be needed based on what you described.",
      allowed: [],
    },
    body_slow: {
      default: "Almost there — pulling together the right questions for you.",
      allowed: [],
    },
    body_very_slow: {
      default:
        "This is taking a little longer than usual. Feel free to call us at {{shop_phone}} if you'd rather skip ahead.",
      allowed: ["shop_phone"],
    },
  },
  clarification_question: {
    eyebrow_base: { default: "A few details", allowed: [] },
    description_single: {
      default:
        "Tap whichever feels closest. If you're unsure, that's OK — skip it. 🤔",
      allowed: [],
    },
    description_multi: {
      default:
        "Tap all that apply, then Continue. If you're unsure, that's OK — skip it. 🤔",
      allowed: [],
    },
    footnote: {
      default:
        "Your service advisor will see your answers — these help us spot the right thing faster.",
      allowed: [],
    },
  },
  concern_clarify: {
    eyebrow: { default: "A quick check", allowed: [] },
    title: { default: "Which of these sounds closest?", allowed: [] },
    body_concern_label: { default: "Here's what you told me", allowed: [] },
    description: {
      default:
        "A couple of these could fit. Tap whichever feels closest — or if none quite match, that's OK, I'll pass your note to one of our advisors. 🙂",
      allowed: [],
    },
    footnote: {
      default:
        'Not sure? No problem — pick "None of these" and a Jeff\'s advisor will read your note and sort it out. You can keep booking either way.',
      allowed: [],
    },
  },
  testing_service_approval: {
    eyebrow_base: { default: "Testing we'd recommend", allowed: [] },
    title: {
      default: "We'd like to look at a couple of things.",
      allowed: [],
    },
    description: {
      default:
        "Based on what you described, here's what our techs would test to narrow it down. Starting prices below — we'll send a final estimate before any work begins.",
      allowed: [],
    },
    body_pricing_note: {
      default:
        "Starting prices — additional testing may be needed if our techs find something extra. We'll always send an updated estimate before doing any extra work.",
      allowed: [],
    },
  },
  second_routine_pass: {
    eyebrow: { default: "Anything else?", allowed: [] },
    title: {
      default: "Want to add anything else while you're here?",
      allowed: [],
    },
    description: {
      default:
        "Tap any of these to add them on. The ones you've already picked are marked.",
      allowed: [],
    },
    body_describe_prompt: {
      default:
        "Noticing something that isn't on the list — a noise, a leak, a warning light?",
      allowed: [],
    },
  },
  summary: {
    eyebrow: { default: "Review before confirming", allowed: [] },
    title: { default: "Quick look — does this all look right? ✅", allowed: [] },
    body_appointment_label: { default: "Appointment", allowed: [] },
    body_type_waiter: { default: "Waiter ☕", allowed: [] },
    body_type_dropoff_sameday: {
      default: "Dropoff 🚗 — drop off as soon as you can today",
      allowed: [],
    },
    body_type_dropoff: {
      default: "Dropoff 🚗 — please drop off before 10 AM",
      allowed: [],
    },
    body_for_label: { default: "For", allowed: [] },
    body_services_label: { default: "Services", allowed: [] },
    body_routine_label: { default: "Routine", allowed: [] },
    body_concerns_label: { default: "Concerns to investigate", allowed: [] },
    body_testing_label: { default: "Testing", allowed: [] },
    body_reminders_label: { default: "Please bring", allowed: [] },
    footnote: {
      default:
        "We'll only use your info to schedule and remind you about this visit.",
      allowed: [],
    },
  },
  summary_edit_hub: {
    eyebrow: { default: "Edit your appointment", allowed: [] },
    title: { default: "What would you like to change?", allowed: [] },
    description: {
      default:
        "Tap Edit on any section. Everything else stays exactly as you left it — nothing is lost.",
      allowed: [],
    },
    body_section_contact: { default: "Contact", allowed: [] },
    body_section_vehicle: { default: "Vehicle", allowed: [] },
    body_section_services: { default: "Services & concerns", allowed: [] },
    body_section_time: { default: "Appointment time", allowed: [] },
    body_routine_label: { default: "Routine", allowed: [] },
    body_concerns_label: { default: "Concerns to investigate", allowed: [] },
    body_testing_label: { default: "Testing", allowed: [] },
    body_type_waiter: { default: "Waiter ☕", allowed: [] },
    body_type_dropoff: { default: "Dropoff 🚗 — before 10 AM", allowed: [] },
    body_hold_caution: {
      default:
        "Editing your time releases the slot we're holding. You'll pick a fresh time and we'll hold that one.",
      allowed: [],
    },
    footnote: {
      default:
        "Changes you don't touch stay saved. Nothing here is submitted until you confirm on the summary.",
      allowed: [],
    },
  },
  customer_notes: {
    input_eyebrow: { default: "One more thing (optional)", allowed: [] },
    input_title: {
      default: "Anything else our team should know? 🛠️",
      allowed: [],
    },
    input_description: {
      default:
        "Quirks, preferences, that one weird thing — whatever helps us take good care of your car. Or skip — it's up to you.",
      allowed: [],
    },
    approval_eyebrow: { default: "Sound right?", allowed: [] },
    approval_title: { default: "I'll write this down 📝", allowed: [] },
    approval_description: {
      default:
        "Here's the cleaned-up version of your note. Save it if it captures what you meant, or hit Edit to send your original wording.",
      allowed: [],
    },
    approval_last_try: {
      default:
        "Last try — if this still isn't quite right, hit Edit and we'll pass your original note straight to the team.",
      allowed: [],
    },
  },
  customer_question: {
    eyebrow: { default: "Last bit (optional)", allowed: [] },
    title: { default: "Got a question for our team? 🤔", allowed: [] },
    description: {
      default:
        "I'll pass it along — your advisor will text or call to follow up. Or skip if you're all set.",
      allowed: [],
    },
  },
  appointment_type: {
    eyebrow: { default: "How would you like to come in?", allowed: [] },
    title: { default: "Waiter or dropoff?", allowed: [] },
    footnote: {
      default: "Tap a card to continue. You'll pick the date next.",
      allowed: [],
    },
  },
} as const satisfies Record<string, Record<string, CardTextSlotDef>>;

export type CardKey = keyof typeof CARD_TEXT_DEFAULTS;
/** The resolved copy object handed to a card: every slot_key → its string. */
export type CardCopy<K extends CardKey> = {
  [S in keyof (typeof CARD_TEXT_DEFAULTS)[K]]: string;
};

const TTL_MS = 5 * 60_000;

interface CardTextRow {
  card_key: string;
  slot_key: string;
  body: string;
}

/** Per-shop cache (§12.2 — never a single global). */
const cache = new Map<number, { fetchedAt: number; rows: CardTextRow[] }>();

/**
 * All active card-text override rows for a shop, or `null` on a genuine read
 * error (caller falls back to defaults). An empty array is a valid result
 * (uncustomized shop) and is cached + returned without a Sentry event.
 */
async function loadCardTextRows(shopId: number): Promise<CardTextRow[] | null> {
  const hit = cache.get(shopId);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit.rows;
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("scheduler_card_text")
      .select("card_key, slot_key, body")
      .eq("shop_id", shopId)
      .eq("active", true);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CardTextRow[];
    cache.set(shopId, { fetchedAt: Date.now(), rows });
    return rows;
  } catch (e) {
    // A genuine read failure — NOT "0 rows". Fall back to defaults, captured.
    Sentry.captureException(e, {
      tags: { surface: "card_text_load" },
      level: "warning",
    });
    return null;
  }
}

/**
 * The resolved raw copy for a card: CARD_TEXT_DEFAULTS overlaid with any DB
 * overrides for the shop. Never throws; on a read error returns pure defaults.
 */
export async function getCardText<K extends CardKey>(
  cardKey: K,
): Promise<CardCopy<K>> {
  const defs = CARD_TEXT_DEFAULTS[cardKey] as Record<string, CardTextSlotDef>;
  const out: Record<string, string> = {};
  for (const [slot, def] of Object.entries(defs)) {
    out[slot] = def.default;
  }
  const rows = await loadCardTextRows(SHOP_ID);
  if (rows) {
    for (const r of rows) {
      if (r.card_key === cardKey && r.slot_key in out) {
        out[r.slot_key] = r.body;
      }
    }
  }
  return out as CardCopy<K>;
}

/** Vitest-only: clear the per-shop cache between tests. */
export function __resetCardTextCacheForTests(): void {
  cache.clear();
}
