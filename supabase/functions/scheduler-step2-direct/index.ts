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
import { logEdgeError } from "../_shared/log-edge-error.ts";

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

interface Decision {
  directive: string;
  data: Record<string, unknown>;
  match_customer_id?: number;
}

/**
 * Apply the §4.3 reconciliation matrix deterministically per chat-design.md
 * lines 680-690.
 *
 *   phone hits >= 1  → 'full' verification (OTP). Name mismatch is OK at
 *                      this layer — the OTP IS the proof of phone ownership.
 *     - 1 hit  → send_otp_first directly (load that customer on success)
 *     - 2+ hits → show_multi_account_disambiguation (vehicle-only per spec
 *                 line 685 + 710 — "VEHICLES only", "by VEHICLE, not by
 *                 customer name"; PII-protective)
 *
 *   phone hits == 0  → try fuzzy name lookup as typo-tolerant fallback
 *     - 1 name match (returning/unsure bucket) → 'partial' verification gate
 *       (no OTP; name-only match means appointment-only access per spec
 *       line 217)
 *     - 2+ name matches → escalate (security risk to disclose; spec line 687)
 *     - 0 name matches + returning → no-match choose path
 *     - 0 name matches + new/unsure → new customer form
 */
async function decide(
  input: RequestBody,
  hits: TekmetricCustomer[],
): Promise<Decision> {
  const { first_name, last_name, customer_self_identified } = input;
  const count = hits.length;

  // 0 phone hits — try fuzzy name lookup, then branch on bucket
  if (count === 0) {
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
          // Phone=0, Name=1 → 'partial' verification per spec line 217.
          return {
            directive: "show_partial_verification_gate",
            data: {
              matched_axis: "name",
              attempted_first_name: first_name,
              attempted_phone_last_four: input.phone_e164.slice(-4),
              // matched_first_name suppressed: spec line 217 says PII
              // suppressed at partial-verification. The card knows it's
              // matched but doesn't expose the other customer's name.
            },
            match_customer_id: byName.customers[0]?.id,
          };
        }
        if (byName.count > 1) {
          // Multiple name matches with no phone → escalate (spec line 687).
          return {
            directive: "show_escalation_card",
            data: {
              reason: "name_lookup_multi_match_no_phone",
              shop_phone: "6102536565",
            },
          };
        }
      } catch {
        // Tekmetric lookup failed — fall through.
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
    // 'new' or 'unsure' bucket + 0 phone match + 0 name match.
    //
    // Per chat-design.md §2589-§2755: "Steps 1-3 are IDENTICAL to Current
    // Client. Differences begin at Step 4." → new customers receive OTP
    // verification, then route to new_customer_info (Step 4 new-client)
    // post-verify based on customer_id being NULL on the row.
    //
    // Option B chosen 2026-05-13 (Phase 5 of the refactor):
    //   - directive='send_otp_first' with NO matched customer_id
    //   - submitOtpV2 on the Next.js side branches on row.customer_id ==
    //     NULL to advance to new_customer_info instead of customer_info_edit
    //   - Protects against bot / spam sign-ups and matches the spec verbatim
    return {
      directive: "send_otp_first",
      data: {},
    };
  }

  // 1 phone hit → full verification. Send OTP. Name mismatch irrelevant
  // — the OTP is the proof. Customer might type "John" when Tekmetric
  // has "Jonathan"; that's fine. After OTP success the row binds to the
  // Tekmetric customer_id regardless of the typed name.
  if (count === 1) {
    return {
      directive: "send_otp_first",
      data: {},
      match_customer_id: hits[0]!.id,
    };
  }

  // 2+ phone hits → vehicle-only disambig (spec line 685, 710).
  // Drop names entirely from the candidate output to avoid leaking
  // other household members' identities. Filter out customers whose
  // most-recent vehicle lookup returned null — the spec PII-protective
  // rule says we MUST NOT render unidentified rows, so they'd be dropped
  // at render time anyway. Filtering here means the count returned to
  // the customer matches what they see on the card. If filtering drops
  // us to 1 candidate, downgrade to send_otp_first against that single
  // remaining customer. If it drops us to 0, fall through to the
  // 0-phone-hits no-match branch.
  // (Bug audit 2026-05-16: previously every candidate with null vehicle
  // was emitted to the row but then filtered by parseCandidates, leaving
  // the customer with an empty list and no path forward.)
  const candidatesAll = await Promise.all(
    hits.slice(0, 8).map(async (c) => ({
      customer_id: c.id,
      recent_vehicle: await recentVehicleLabel(c.id),
    })),
  );
  const candidates = candidatesAll.filter(
    (c): c is { customer_id: number; recent_vehicle: string } =>
      typeof c.recent_vehicle === "string" && c.recent_vehicle.length > 0,
  );

  if (candidates.length === 1) {
    // Only one customer has a renderable vehicle — treat as a 1-hit
    // match and OTP-verify against it. Same semantics as the count===1
    // branch above.
    return {
      directive: "send_otp_first",
      data: {},
      match_customer_id: candidates[0]!.customer_id,
    };
  }
  if (candidates.length === 0) {
    // Defensive: every Tekmetric hit had no vehicle. Treat as a no-match
    // and route based on the customer's self-identified bucket so they
    // still have a path forward.
    if (customer_self_identified === "returning") {
      return {
        directive: "show_no_match_choose_path",
        data: {
          attempted_first_name: first_name,
          attempted_phone_last_four: input.phone_e164.slice(-4),
        },
      };
    }
    return { directive: "send_otp_first", data: {} };
  }

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
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "step2_direct_lookup_failed",
        detail: msg,
      }),
    );
    await logEdgeError(sb, {
      session_id: input.session_id,
      surface: "scheduler-step2-direct/lookupCustomerByPhone",
      origin_id: "scheduler-step2-direct",
      level: "error",
      error_code: "tekmetric_lookup_failed",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { phone_last_four: input.phone_e164.slice(-4) },
    });
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

  // Bug audit 2026-05-16: previously, only the send_otp_first branch
  // persisted match_customer_id to the row. The partial-verification
  // gate branch (name match, no phone match) computes match_customer_id
  // too but never wrote it, so downstream Tekmetric ops couldn't find
  // the matched customer record. Persist it here BEFORE branching so
  // every directive that carries a matched id gets the same treatment.
  if (decision.match_customer_id) {
    await sb
      .from("customer_chat_sessions")
      .update({
        customer_id: decision.match_customer_id,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", input.session_id);
  }

  // For send_otp_first, actually send the OTP + write session row.
  if (decision.directive === "send_otp_first") {

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
      await logEdgeError(sb, {
        session_id: input.session_id,
        surface: "scheduler-step2-direct/sendOtp",
        origin_id: "scheduler-step2-direct",
        level: "warning",
        error_code: `otp_${otp.error}`,
        message: otp.detail ?? null,
        context: { phone_last_four: input.phone_e164.slice(-4) },
      });
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

  // Stash candidates for the §3.5c multi-account-disambiguation card.
  // Per chat-design.md "Architecture amendment — 2026-05-14" + row-as-
  // truth: the next page render reads candidates from this column via
  // get-current-card.ts. Cleared by submit-multi-account-choice once
  // the customer picks (or "none of these" falls through).
  if (decision.directive === "show_multi_account_disambiguation") {
    const candidatesPayload =
      (decision.data as Record<string, unknown>).candidates ?? [];
    const { error: candidatesWriteErr } = await sb
      .from("customer_chat_sessions")
      .update({
        pending_candidates: candidatesPayload as unknown as Record<
          string,
          unknown
        >[],
        last_active_at: new Date().toISOString(),
      })
      .eq("id", input.session_id);
    if (candidatesWriteErr) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "step2_direct_pending_candidates_write_failed",
          session_id: input.session_id,
          detail: candidatesWriteErr.message,
        }),
      );
      await logEdgeError(sb, {
        session_id: input.session_id,
        surface: "scheduler-step2-direct/pending_candidates_write",
        origin_id: "scheduler-step2-direct",
        level: "warning",
        error_code: "pending_candidates_write_failed",
        message: candidatesWriteErr.message,
      });
      // Don't fail the response — the card will render with 0 candidates
      // and the customer can still tap "None of these" to fall through
      // to NoMatchChoosePath. Better than a hard escalation.
    }
  }

  // All non-OTP branches: just return the directive + data. The Server
  // Action persists any further row updates from the customer's next card.
  return jsonResponse({
    ok: true,
    directive: decision.directive,
    data: decision.data,
    meta: { latency_ms: Date.now() - startedAt },
  });
}

Deno.serve(handleRequest);
