/**
 * QBO client error type + Fault parsing.
 *
 * Mirrors the `OrchestratorClientError` shape (Error subclass, readonly fields,
 * `{ ...opts }` ctor) so Server Actions can map `kind` → user-facing messages.
 *
 * Fault wire shape (QBO Accounting API): a non-2xx body is
 *   { Fault: { Error: [{ Message, Detail, code, element }], type }, time }
 * `Error[].code` is a STRING (e.g. "003001" has a leading zero) — we branch on
 * the string `code` first, with `Fault.type` then HTTP status as coarse
 * fallbacks. Code map per docs/qbo/qbo-api-client-plan.md §Compliance re-review
 * (2026-06-02). `reconnect_required` is produced by tokens.ts on `invalid_grant`
 * (a token-refresh failure, not a data-call Fault).
 */

export type QboClientErrorKind =
  | "validation"
  | "not_found"
  | "auth"
  | "throttle"
  | "conflict"
  | "not_available"
  | "reconnect_required"
  | "network"
  | "unknown";

export interface QboClientErrorOpts {
  kind: QboClientErrorKind;
  code?: string | null;
  faultType?: string | null;
  httpStatus?: number | null;
  intuitTid?: string | null;
  detail?: string | null;
  cause?: unknown;
}

export class QboClientError extends Error {
  readonly kind: QboClientErrorKind;
  readonly code: string | null;
  readonly faultType: string | null;
  readonly httpStatus: number | null;
  readonly intuitTid: string | null;
  readonly detail: string | null;
  readonly cause: unknown;

  constructor(message: string, opts: QboClientErrorOpts) {
    super(message);
    this.name = "QboClientError";
    this.kind = opts.kind;
    this.code = opts.code ?? null;
    this.faultType = opts.faultType ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.intuitTid = opts.intuitTid ?? null;
    this.detail = opts.detail ?? null;
    this.cause = opts.cause;
  }
}

/** Numeric-string Fault codes → kind. `code` arrives as a JSON string. */
const CODE_TO_KIND: Readonly<Record<string, QboClientErrorKind>> = {
  "6000": "validation",
  "610": "not_found",
  "100": "auth",
  "120": "auth",
  "003001": "throttle",
  "5010": "conflict", // Stale Object (SyncToken conflict) — NOT auto-retried
  "5030": "not_available", // feature not included in the company's tier
  "6190": "not_available", // invalid / read-only company status
};

function faultTypeToKind(type: string): QboClientErrorKind {
  const t = type.toLowerCase();
  if (t.includes("validation")) return "validation";
  if (t.includes("authentication") || t.includes("authorization")) return "auth";
  return "unknown";
}

function httpStatusToKind(status: number): QboClientErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "throttle";
  return "unknown";
}

interface QboFaultError {
  Message?: string;
  Detail?: string;
  code?: string;
  element?: string;
}
interface QboFault {
  Error?: QboFaultError[];
  type?: string;
}

function extractFault(body: unknown): QboFault | null {
  if (body && typeof body === "object" && "Fault" in body) {
    const fault = (body as { Fault?: unknown }).Fault;
    if (fault && typeof fault === "object") return fault as QboFault;
  }
  return null;
}

/**
 * Parse a non-2xx QBO response into a typed `QboClientError`. Branches on the
 * string `Error[].code`, falling back to `Fault.type` then the HTTP status.
 */
export function parseFault(opts: {
  body: unknown;
  httpStatus: number;
  intuitTid?: string | null;
}): QboClientError {
  const { body, httpStatus, intuitTid = null } = opts;
  const fault = extractFault(body);
  const first = fault?.Error?.[0];
  const code = typeof first?.code === "string" ? first.code : null;
  const faultType = typeof fault?.type === "string" ? fault.type : null;

  let kind: QboClientErrorKind;
  if (code && code in CODE_TO_KIND) {
    kind = CODE_TO_KIND[code]!;
  } else if (faultType) {
    const byType = faultTypeToKind(faultType);
    kind = byType === "unknown" ? httpStatusToKind(httpStatus) : byType;
  } else {
    kind = httpStatusToKind(httpStatus);
  }

  const message =
    typeof first?.Message === "string" && first.Message.length > 0
      ? `QBO ${faultType ?? "Fault"} (${code ?? httpStatus}): ${first.Message}`
      : `QBO request failed (HTTP ${httpStatus})`;

  return new QboClientError(message, {
    kind,
    code,
    faultType,
    httpStatus,
    intuitTid,
    detail: typeof first?.Detail === "string" ? first.Detail : null,
  });
}
