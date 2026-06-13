/**
 * Client wrapper for the scheduler-step2-direct Supabase Edge Function.
 *
 * This is the DETERMINISTIC replacement for the LLM-based orchestrator
 * path on Step 2 (per chat-design.md §605 + audit B-1). The LLM
 * specialist's generateText() + manual JSON.parse pipeline was
 * empirically fragile (2026-05-13 testing); this path does the same
 * Tekmetric lookup + Telnyx send_otp in plain TypeScript with no LLM.
 *
 * Pattern A bearer + apikey auth (service-role key). 30s request timeout.
 */

import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

export interface Step2DirectRequest {
  session_id: string;
  first_name: string;
  last_name: string;
  phone_e164: string;
  customer_self_identified: "returning" | "new" | "unsure";
}

export interface Step2DirectResponse {
  ok: boolean;
  /**
   * One of:
   *   - 'send_otp_first'           — OTP queued via Telnyx (data has
   *                                  phone_last_four + ttl_seconds)
   *   - 'show_new_customer_form'   — No phone match + 'new'/'unsure' bucket
   *   - 'show_no_match_choose_path'— No match + 'returning' bucket
   *   - 'show_multi_account_disambiguation' — 2+ matches (data.candidates)
   *   - 'show_partial_verification_gate'    — Partial match (data.matched_axis)
   *   - 'show_escalation_card'     — Tekmetric / Telnyx hard failure
   */
  directive: string;
  data?: Record<string, unknown>;
  meta?: { latency_ms?: number };
}

export class Step2DirectError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "Step2DirectError";
  }
}

/**
 * Resolve the edge function URL. Reuses the existing ORCHESTRATOR_URL
 * env var pattern — we just swap the function name in the path so we
 * don't need a new env var. ORCHESTRATOR_URL looks like
 *   https://<project>.functions.supabase.co/orchestrator-direct
 * We replace the trailing function segment with `scheduler-step2-direct`.
 */
function step2DirectUrl(): string {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    throw new Step2DirectError(
      "Missing ORCHESTRATOR_URL env var — needed to derive the step2 endpoint.",
    );
  }
  // Replace the last path segment.
  return orchestratorUrl.replace(
    /\/[^/]+\/?$/,
    "/scheduler-step2-direct",
  );
}

export async function callStep2Direct(
  req: Step2DirectRequest,
): Promise<Step2DirectResponse> {
  const url = step2DirectUrl();
  const secretKey = resolveServiceRoleKey();
  if (!secretKey) {
    throw new Step2DirectError(
      "Missing service-role bearer (SUPABASE_SECRET_KEYS / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        apikey: secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Step2DirectError(
      "Network error calling scheduler-step2-direct",
      undefined,
      e,
    );
  }

  // The function returns 200 even for orchestrator-internal soft-fails
  // (rate-limit, send_failed) — it carries the failure in the directive
  // field ('show_escalation_card' + data.reason). 4xx/5xx is reserved
  // for transport / auth / malformed-body errors.
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable body>");
    throw new Step2DirectError(
      `scheduler-step2-direct returned ${res.status}: ${text}`,
      res.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    throw new Step2DirectError(
      "scheduler-step2-direct returned non-JSON body",
      res.status,
      e,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("directive" in parsed)
  ) {
    throw new Step2DirectError(
      "scheduler-step2-direct response missing `directive` field",
      res.status,
    );
  }

  return parsed as Step2DirectResponse;
}
