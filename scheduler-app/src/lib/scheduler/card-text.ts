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
