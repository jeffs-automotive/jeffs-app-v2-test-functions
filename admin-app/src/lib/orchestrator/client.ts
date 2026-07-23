/**
 * Typed orchestrator MCP client for admin-app Server Actions.
 *
 * Calls the orchestrator edge function (deployed at the test Supabase
 * project, ref `itzdasxobllfiuolmbxu`) using the SERVICE_ROLE +
 * X-Actor-Email auth branch added on 2026-05-25 (see
 * supabase/functions/orchestrator/index.ts SERVER_VERSION 0.4.0).
 *
 * Wire format: JSON-RPC 2.0 — the orchestrator dispatches to its tool
 * registry by name. Response is `{content: [{type: "text", text:
 * <JSON-string>}], isError: boolean}`; we unwrap text → JSON.parse for
 * the caller.
 *
 * Defense-in-depth host validation (mirrors scheduler-app's
 * booking-direct-client.ts P0.3 pattern from 2026-05-25):
 *   Layer 1: derived URL host MUST end with `.supabase.co`
 *   Layer 2: derived URL host MUST exactly match the host of
 *            NEXT_PUBLIC_SUPABASE_URL (the same project we use for auth)
 *
 * Without these gates a typo'd env var (or copy-paste of another
 * project's env) would silently send the SERVICE_ROLE bearer to an
 * arbitrary host. Both checks fail-CLOSED.
 */
import * as Sentry from "@sentry/nextjs";
import {
  resolvePublishableKey,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "@/lib/supabase/resolve-keys";
import type { KeytagToolMap, KeytagToolName } from "./types";

const ORCHESTRATOR_FUNCTION_NAME = "orchestrator";
const ALLOWED_HOST_SUFFIX = ".supabase.co";

/**
 * Default fetch timeout. Most tool calls finish in under 5 s; the longest
 * (`runBulkReconcile`) routinely takes 5-30 s depending on the Tekmetric
 * API; bump via options.timeoutMs when calling slow tools.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Errors raised by the orchestrator client. Distinguished from generic
 * network errors so Server Actions can map them to user-facing messages.
 */
export class OrchestratorClientError extends Error {
  readonly status: number | null;
  readonly cause: unknown;
  constructor(message: string, opts?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = "OrchestratorClientError";
    this.status = opts?.status ?? null;
    this.cause = opts?.cause;
  }
}

/**
 * Build the orchestrator URL from the configured Supabase URL.
 * Throws OrchestratorClientError if either env var is missing or the
 * derived host fails either of the two host-validation gates.
 */
function buildOrchestratorUrl(): string {
  // E2E-only (KEYTAG_E2E_MOCK=1 — never set in dev/prod): route orchestrator calls
  // to a local deterministic mock route so a real-browser Playwright test can drive
  // the Pattern-A confirmation flow without touching real Tekmetric/keytag data.
  // Returns BEFORE the Supabase-host validation below (the mock is localhost).
  if (process.env.KEYTAG_E2E_MOCK === "1") {
    const base = process.env.KEYTAG_E2E_MOCK_BASE_URL ?? "http://localhost:3001";
    return `${base}/api/e2e-mock/orchestrator`;
  }
  const supabaseUrl = resolveSupabaseUrl();
  if (!supabaseUrl) {
    throw new OrchestratorClientError(
      "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL — cannot build orchestrator URL.",
    );
  }

  // Standard Supabase edge function URL shape.
  const orchestratorUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${ORCHESTRATOR_FUNCTION_NAME}`;

  let derivedHost: string;
  try {
    derivedHost = new URL(orchestratorUrl).host;
  } catch {
    throw new OrchestratorClientError(
      `Derived orchestrator URL is not a valid URL: ${orchestratorUrl}`,
    );
  }

  // Layer 1: hardcoded suffix check
  if (!derivedHost.endsWith(ALLOWED_HOST_SUFFIX)) {
    throw new OrchestratorClientError(
      `Refusing to send service-role bearer: derived host '${derivedHost}' does not end with '${ALLOWED_HOST_SUFFIX}'. Check SUPABASE_URL env var.`,
    );
  }

  // Layer 2: must match the project's own Supabase URL host (NEXT_PUBLIC
  // variant — that's the one the @supabase/ssr auth client uses). If we
  // ever accidentally point at a different project, fail-closed.
  const publishableHost = (() => {
    try {
      const u = resolvePublishableKey() ? new URL(supabaseUrl).host : null;
      return u;
    } catch {
      return null;
    }
  })();
  if (publishableHost && derivedHost !== publishableHost) {
    throw new OrchestratorClientError(
      `Refusing to send service-role bearer: derived host '${derivedHost}' does not match expected '${publishableHost}'. Cross-project misconfiguration.`,
    );
  }

  return orchestratorUrl;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  };
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponseEnvelope = JsonRpcSuccess | JsonRpcFailure;

/**
 * Untyped JSON-RPC transport — used by every typed wrapper
 * (`callKeytagTool`, `callSchedulerTool`, etc.). Public so other tool
 * domains (scheduler, etc.) can share the env validation + host-allowlist
 * + Sentry instrumentation without copying the body.
 *
 * Throws OrchestratorClientError for transport/protocol failures. Tool-
 * level "ok: false" responses (e.g., not-found, validation errors,
 * Pattern A confirmation prompts) are returned to the caller — they're
 * part of the tool's normal return shape, not exceptional failures.
 *
 * Typed wrappers cast the `unknown` return to the per-tool result type.
 */
export async function callOrchestratorRpc(
  toolName: string,
  args: unknown,
  actorEmail: string,
  options?: { timeoutMs?: number },
): Promise<unknown> {
  const url = buildOrchestratorUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  if (!serviceRoleKey) {
    throw new OrchestratorClientError(
      "Missing SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY — cannot call orchestrator.",
    );
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestId = crypto.randomUUID();

  const body = {
    jsonrpc: "2.0" as const,
    id: requestId,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "X-Actor-Email": actorEmail,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Network failure / abort — fold to Sentry + structured error
    Sentry.captureException(e, {
      tags: {
        orchestrator_tool: toolName,
        orchestrator_error: "network",
      },
    });
    throw new OrchestratorClientError(
      `Network error calling orchestrator tool '${toolName}': ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "<unreadable>");
    Sentry.captureMessage(
      `Orchestrator returned HTTP ${response.status} for tool '${toolName}'`,
      {
        level: "warning",
        tags: {
          orchestrator_tool: toolName,
          orchestrator_status: String(response.status),
        },
        extra: {
          response_body_sample: text.slice(0, 500),
        },
      },
    );
    throw new OrchestratorClientError(
      `Orchestrator returned HTTP ${response.status} for tool '${toolName}'.`,
      { status: response.status },
    );
  }

  let envelope: JsonRpcResponseEnvelope;
  try {
    envelope = (await response.json()) as JsonRpcResponseEnvelope;
  } catch (e) {
    throw new OrchestratorClientError(
      `Orchestrator returned non-JSON body for tool '${toolName}'.`,
      { cause: e },
    );
  }

  if ("error" in envelope) {
    Sentry.captureMessage(
      `Orchestrator JSON-RPC error for tool '${toolName}': ${envelope.error.message}`,
      {
        level: "warning",
        tags: {
          orchestrator_tool: toolName,
          orchestrator_rpc_code: String(envelope.error.code),
        },
      },
    );
    throw new OrchestratorClientError(
      `Orchestrator JSON-RPC error: ${envelope.error.message}`,
      { status: envelope.error.code, cause: envelope.error.data },
    );
  }

  const result = envelope.result;
  if (!result?.content?.[0]?.text) {
    throw new OrchestratorClientError(
      `Orchestrator response missing content for tool '${toolName}'.`,
    );
  }

  // isError is set when the tool itself surfaced an error (e.g., RPC
  // failure inside the tool). Surface a structured throw so callers can
  // differentiate from successful "ok: false" tool returns.
  if (result.isError) {
    Sentry.captureMessage(
      `Orchestrator tool '${toolName}' reported isError`,
      {
        level: "warning",
        tags: { orchestrator_tool: toolName },
        extra: { content: result.content[0].text.slice(0, 500) },
      },
    );
    throw new OrchestratorClientError(
      `Orchestrator tool '${toolName}' reported isError: ${result.content[0].text.slice(0, 200)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content[0].text);
  } catch (e) {
    throw new OrchestratorClientError(
      `Orchestrator tool '${toolName}' returned non-JSON text content.`,
      { cause: e },
    );
  }

  return parsed;
}

/**
 * Call a single orchestrator tool by name with typed KEYTAG args. Returns
 * the tool's parsed result.
 *
 * Thin typed wrapper around `callOrchestratorRpc` — see that function for
 * transport details. Behavior is unchanged from the pre-refactor (2026-05-26)
 * implementation; the body now delegates to the shared transport.
 *
 * @param toolName - registered tool name (typed against KeytagToolMap)
 * @param args     - tool args (typed)
 * @param actorEmail - the authenticated employee's email; threaded through
 *                    X-Actor-Email so the edge fn's audit log captures
 *                    who-did-what. Must match the regex enforced
 *                    server-side: ends with @jeffsautomotive.com.
 *
 * Timeout: default 30s, configurable. The longest-running tool
 * (`runBulkReconcile`) routinely takes 5-30 seconds depending on the
 * Tekmetric API; bump to 60s when calling it.
 */
export async function callKeytagTool<N extends KeytagToolName>(
  toolName: N,
  args: KeytagToolMap[N]["args"],
  actorEmail: string,
  options?: { timeoutMs?: number },
): Promise<KeytagToolMap[N]["result"]> {
  const parsed = await callOrchestratorRpc(toolName, args, actorEmail, options);
  return parsed as KeytagToolMap[N]["result"];
}
