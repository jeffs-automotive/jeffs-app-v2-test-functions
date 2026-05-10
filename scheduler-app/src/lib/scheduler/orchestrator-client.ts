/**
 * Client wrapper for calls to the orchestrator-direct Supabase Edge Function.
 *
 * Per appointments_design.md §2 + §15 Q2:
 *   - Vercel Server Action / Route Handler → Supabase Edge Function path
 *   - Auth: Pattern A (secret-key bearer + apikey header)
 *   - The Edge Function reuses _shared/orchestrator.ts (the existing
 *     Sonnet 4.6 orchestrator agent, extended with new scheduler tools)
 *
 * This module is the only direct caller from the Vercel side. It's called
 * from the chat agent's `consult_orchestrator` tool's execute() function.
 */

export interface ConsultOrchestratorRequest {
  /** Scheduler session UUID; the orchestrator scopes its work to this. */
  session_id: string;
  /** Plain-English summary the chat agent built from the conversation. */
  context: string;
  /** Optional structured hints — e.g., { phone_e164, customer_id, ... } */
  hints?: Record<string, unknown>;
}

export interface ConsultOrchestratorResponse {
  /** What the chat agent should do next. */
  directive: string;
  /** Optional structured data the chat agent surfaces (slots, vehicles, etc.). */
  data?: Record<string, unknown>;
  /** Optional flags the chat agent should branch on. */
  flags?: {
    customer_unverified?: boolean;
    phone_verified?: boolean;
    escalate?: boolean;
    customer_status?: "matched" | "not_found" | "ambiguous";
    [k: string]: unknown;
  };
}

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

/**
 * Call orchestrator-direct with a structured request. Throws OrchestratorError
 * on transport failure or non-2xx response — the caller (consult_orchestrator
 * tool's execute) decides whether to surface as an in-chat error or escalate.
 */
export async function consultOrchestrator(
  req: ConsultOrchestratorRequest,
): Promise<ConsultOrchestratorResponse> {
  const url = process.env.ORCHESTRATOR_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url) {
    throw new OrchestratorError(
      "Missing ORCHESTRATOR_URL env var (typically " +
        "${SUPABASE_URL}/functions/v1/orchestrator-direct).",
    );
  }
  if (!secretKey) {
    throw new OrchestratorError(
      "Missing SUPABASE_SECRET_KEY env var. Required for service-role bearer.",
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
        // The orchestrator returns quickly for routine queries; longer
        // for Tekmetric round-trips. 30s gives generous headroom.
        // (route handler has maxDuration=300 so this doesn't block.)
      },
      body: JSON.stringify(req),
      // AbortSignal.timeout requires Node 18+ / modern Edge runtime
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new OrchestratorError(
      "Network error calling orchestrator-direct",
      undefined,
      e,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable body>");
    throw new OrchestratorError(
      `orchestrator-direct returned ${res.status}: ${text}`,
      res.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    throw new OrchestratorError(
      "orchestrator-direct returned non-JSON body",
      res.status,
      e,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("directive" in parsed)
  ) {
    throw new OrchestratorError(
      "orchestrator-direct response missing required `directive` field",
      res.status,
    );
  }

  return parsed as ConsultOrchestratorResponse;
}
