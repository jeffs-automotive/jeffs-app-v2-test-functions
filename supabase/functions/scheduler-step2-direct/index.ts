// scheduler-step2-direct
//
// Deterministic Step 2 endpoint per chat-design.md §605 + audit B-1.
//
// Replaces the LLM-based orchestrator-direct path for Step 2 (phone+name
// submit → OTP send). The LLM specialist's free-form generateText() +
// manual JSON.parse pipeline was empirically fragile (2026-05-13: SMS
// arrived but parse failed → tool_error directive → escalation). This
// function does the same work in plain TypeScript, no LLM, no parsing.
//
// Request:
//   POST / { session_id, first_name, last_name, phone_e164,
//            customer_self_identified }
//
// Response 200:
//   { ok: true,
//     directive:
//       | 'send_otp_first'                 // OTP sent successfully
//       | 'show_new_customer_form'         // No match + 'new' bucket
//       | 'show_no_match_choose_path'      // No match + 'returning' bucket
//       | 'show_multi_account_disambiguation' // 2+ matches
//       | 'show_partial_verification_gate' // 1 match, partial verify
//       | 'show_escalation_card',          // hard fail
//     data: { phone_last_four?, ttl_seconds?, candidates?, matched_axis?, ... } }
//
// Response 401 / 400 / 500: { ok: false, error }
//
// Auth: same Pattern A bearer as orchestrator-direct.
// Env: TELNYX_API_KEY, TELNYX_FROM_NUMBER, TEKMETRIC_API_TOKEN, SUPABASE_*

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import {
  lookupCustomerByPhone,
  lookupCustomerByName,
  type TekmetricCustomer,
} from "../_shared/tools/scheduler-customer.ts";
import { sendOtp } from "../_shared/tools/scheduler-otp.ts";
import { isFuzzyNameMatch } from "../_shared/levenshtein.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface RequestBody {
  session_id: string;
  first_name: string;
  last_name: string;
  phone_e164: string; // expected: +1XXXXXXXXXX
  customer_self_identified: "returning" | "new" | "unsure";
}

function parseBody(raw: unknown):
  | { ok: true; input: RequestBody }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.session_id !== "string" || !r.session_id) {
    return { ok: false, error: "session_id required" };
  }
  if (typeof r.phone_e164 !== "string" || !/^\+1\d{10}$/.test(r.phone_e164)) {
    return { ok: false, error: "phone_e164 must match /^\\+1\\d{10}$/" };
  }
  const bucket = r.customer_self_identified;
  if (bucket !== "returning" && bucket !== "new" && bucket !== "unsure") {
    return {
      ok: false,
      error: "customer_self_identified must be 'returning'|'new'|'unsure'",
    };
  }
  return {
    ok: true,
    input: {
      session_id: r.session_id,
      first_name: typeof r.first_name === "string" ? r.first_name : "",
      last_name: typeof r.last_name === "string" ? r.last_name : "",
      phone_e164: r.phone_e164,
      customer_self_identified: bucket,
    },
  };
}

// Pull a short "recent vehicle" label for the multi-account picker UX.
async function recentVehicleLabel(
  customerId: number,
): Promise<string | null> {
  try {
    const { data } = await sb
      .from("tekmetric_customer_vehicles")
      .select("year, make, model")
      .eq("customer_id", customerId)
      .eq("deleted", false)
      .order("updated_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const parts = [data.year, data.make, data.model]
      .map((p) => (p == null ? "" : String(p).trim()))
      .filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  } catch {
    return null;
  }
}

function customerNameMatches(
  customer: TekmetricCustomer,
  firstName: string,
  lastName: string,
): { firstMatches: boolean; lastMatches: boolean } {
  const cFirst = (customer.firstName ?? "").trim();
  const cLast = (customer.lastName ?? "").trim();
  return {
    firstMatches:
      firstName.trim().length > 0 &&
      cFirst.length > 0 &&
      isFuzzyNameMatch(firstName, cFirst, 2),
    lastMatches:
      lastName.trim().length > 0 &&
      cLast.length > 0 &&
      isFuzzyNameMatch(lastName, cLast, 2),
  };
}

interface Decision {
  directive: string;
  data: Record<string, unknown>;
  match_customer_id?: number;
}

/**
 * Apply the §4.3 reconciliation matrix deterministically.
 * Branches based on (phone-hit count) × (self-id bucket) × (name match).
 */
async function decide(
  input: RequestBody,
  hits: TekmetricCustomer[],
): Promise<Decision> {
  const { first_name, last_name, customer_self_identified } = input;
  const count = hits.length;

  // 0 phone hits — branch on bucket
  if (count === 0) {
    // For 'returning' or 'unsure' buckets, try fuzzy name lookup as a
    // typo-tolerant fallback (§4.3 — "Jefery" → "Jeffrey").
    if (
      customer_self_identified !== "new" &&
      first_name.trim().length > 0 &&
      last_name.trim().length > 0
    ) {
      try {
        const nameQ = `${first_name.trim()} ${last_name.trim()}`;
        const byName = await lookupCustomerByName(sb, SHOP_ID, nameQ, {
          max_distance: 2,
        });
        if (byName.count === 1) {
          // Found by name, phone mismatch → partial verify gate.
          return {
            directive: "show_partial_verification_gate",
            data: {
              matched_axis: "name",
              attempted_first_name: first_name,
              attempted_phone_last_four: input.phone_e164.slice(-4),
              matched_first_name: byName.customers[0]?.firstName ?? null,
            },
            match_customer_id: byName.customers[0]?.id,
          };
        }
        if (byName.count > 1) {
          // Multiple name matches → escalate (suspicious + ambiguous).
          return {
            directive: "show_escalation_card",
            data: {
              reason: "name_lookup_multi_match_no_phone",
              shop_phone: "6102536565",
            },
          };
        }
      } catch {
        // Tekmetric lookup failed — fall through to the no-match path below.
      }
    }

    if (customer_self_identified === "returning") {
      return {
        directive: "show_no_match_choose_path",
        data: {
          attempted_first_name: first_name,
          attempted_phone_last_four: input.phone_e164.slice(-4),
        },
      };
    }
    // 'new' or 'unsure' + 0 hits → new customer form
    return {
      directive: "show_new_customer_form",
      data: { mode: "full" },
    };
  }

  // 1 phone hit — check name match for partial-verify edge case
  if (count === 1) {
    const c = hits[0]!;
    const { firstMatches, lastMatches } = customerNameMatches(
      c,
      first_name,
      last_name,
    );
    const namePartial =
      first_name.trim().length > 0 || last_name.trim().length > 0;

    // Phone matches; name matches (or no name to compare) → send OTP.
    if (!namePartial || (firstMatches && lastMatches)) {
      return {
        directive: "send_otp_first",
        data: {},
        match_customer_id: c.id,
      };
    }
    // Phone matches but name doesn't → partial verify gate.
    return {
      directive: "show_partial_verification_gate",
      data: {
        matched_axis: "phone",
        attempted_first_name: first_name,
        attempted_phone_last_four: input.phone_e164.slice(-4),
        matched_first_name: c.firstName,
      },
      match_customer_id: c.id,
    };
  }

  // 2+ phone hits — multi-account disambig (or send OTP if exactly one
  // name-matches; rare but happens with married couples)
  const nameMatched = hits.filter((c) => {
    const { firstMatches, lastMatches } = customerNameMatches(
      c,
      first_name,
      last_name,
    );
    return firstMatches && lastMatches;
  });
  if (nameMatched.length === 1) {
    return {
      directive: "send_otp_first",
      data: {},
      match_customer_id: nameMatched[0]!.id,
    };
  }

  // Build the candidate list for the picker (capped at 8 per the card schema).
  const candidates = await Promise.all(
    hits.slice(0, 8).map(async (c) => ({
      customer_id: c.id,
      first_name: c.firstName ?? "",
      last_name: c.lastName ?? "",
      recent_vehicle: await recentVehicleLabel(c.id),
    })),
  );
  return {
    directive: "show_multi_account_disambiguation",
    data: {
      candidates,
      attempted_phone_last_four: input.phone_e164.slice(-4),
    },
  };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "POST only" }, 405);
  }

  // checkSchedulerBearer requires the function name for diagnostic logging,
  // and returns the AuthCheckResult OBJECT (with `reason` field) — NOT a
  // bare error string. Bug fix 2026-05-13 per audit:
  //   was: checkSchedulerBearer(req) + unauthorizedResponse(authCheck.error)
  //   now: checkSchedulerBearer(req, "...") + unauthorizedResponse(authCheck)
  // The prior shape would have thrown TypeError on unauthorized requests
  // since `.error` is undefined on the success-shaped result type.
  const authCheck = checkSchedulerBearer(req, "scheduler-step2-direct");
  if (!authCheck.ok) {
    return unauthorizedResponse(authCheck);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
  }
  const parse = parseBody(raw);
  if (!parse.ok) {
    return jsonResponse({ ok: false, error: parse.error }, 400);
  }
  const input = parse.input;

  const startedAt = Date.now();
  let hits: TekmetricCustomer[] = [];
  try {
    const result = await lookupCustomerByPhone(sb, SHOP_ID, input.phone_e164);
    hits = result.customers;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "step2_direct_lookup_failed",
        detail: e instanceof Error ? e.message : String(e),
      }),
    );
    return jsonResponse({
      ok: false,
      directive: "show_escalation_card",
      data: {
        reason: "tekmetric_lookup_failed",
        shop_phone: "6102536565",
      },
      meta: { latency_ms: Date.now() - startedAt },
    });
  }

  const decision = await decide(input, hits);

  // For send_otp_first, actually send the OTP + write session row.
  if (decision.directive === "send_otp_first") {
    // Write match_customer_id onto the row so the OTP-verify step + later
    // tools see it.
    if (decision.match_customer_id) {
      await sb
        .from("customer_chat_sessions")
        .update({
          customer_id: decision.match_customer_id,
          last_active_at: new Date().toISOString(),
        })
        .eq("id", input.session_id);
    }

    const otp = await sendOtp(sb, SHOP_ID, { phone_e164: input.phone_e164 });

    if (!otp.ok) {
      // Rate-limited or send_failed. The chat agent escalates on this.
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "step2_direct_otp_send_failed",
          error: otp.error,
          detail: otp.detail ?? null,
          phone_last_four: input.phone_e164.slice(-4),
        }),
      );
      return jsonResponse({
        ok: false,
        directive: "show_escalation_card",
        data: {
          reason: `otp_${otp.error}`,
          shop_phone: "6102536565",
        },
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    // OTP sent. Stamp otp_sent_at + clear otp_attempts onto the row.
    await sb
      .from("customer_chat_sessions")
      .update({
        otp_sent_at: new Date().toISOString(),
        otp_attempts: 0,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", input.session_id);

    return jsonResponse({
      ok: true,
      directive: "send_otp_first",
      data: {
        phone_last_four: otp.phone_last_four,
        ttl_seconds: otp.ttl_seconds,
      },
      meta: { latency_ms: Date.now() - startedAt },
    });
  }

  // All non-OTP branches: just return the directive + data. The Server
  // Action persists any row updates from the customer's next card.
  return jsonResponse({
    ok: true,
    directive: decision.directive,
    data: decision.data,
    meta: { latency_ms: Date.now() - startedAt },
  });
}

Deno.serve(handleRequest);
