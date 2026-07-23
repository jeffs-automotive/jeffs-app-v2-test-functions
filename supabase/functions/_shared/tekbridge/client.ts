// _shared/tekbridge/client.ts
//
// Authenticated fetch against Tekmetric's INTERNAL web API
// (https://shop.tekmetric.com/api/...), using the bot session JWT in the
// `x-auth-token` header. Separate from `_shared/tekmetric-client.ts`, which
// talks to the PUBLIC API (/api/v1, OAuth bearer).
//
// Failure model (deliberately different from the public client):
//   - The public client auto-refreshes its non-expiring OAuth token on a 401.
//   - tekbridge's JWT is minted by a reCAPTCHA-gated HUMAN login and CANNOT be
//     re-minted server-side. So on expiry/401 we DON'T retry — we mark the
//     session stale and throw a typed TekbridgeSessionError so the gateway can
//     say "session needs refresh" instead of silently hammering Tekmetric.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  TEKBRIDGE_DEFAULT_TIMEOUT_MS,
  TEKBRIDGE_INTERNAL_API_BASE,
} from "./constants.ts";
import {
  getBotJwt,
  isJwtExpired,
  markSessionStale,
  TekbridgeSessionError,
} from "./session.ts";

/** Non-2xx response from the internal API (that isn't a 401 session failure). */
export class TekbridgeApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, bodySnippet: string) {
    super(`tekbridge internal API ${path} → HTTP ${status}: ${bodySnippet}`);
    this.name = "TekbridgeApiError";
    this.status = status;
    this.path = path;
  }
}

export interface TekbridgeFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Per-request timeout (ms). Defaults to TEKBRIDGE_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Shop scope — used to key the session-health row on a 401/expiry. */
  shopId: number;
  /** Injected for deterministic tests; defaults to the wall clock. */
  nowSeconds?: number;
}

/**
 * Authenticated fetch against the internal API. Pre-checks expiry (so an
 * obviously-dead token never leaves the building), attaches `x-auth-token`, and
 * enforces a timeout. On 401 or local-expiry: marks the session stale + throws
 * TekbridgeSessionError. Returns the raw Response otherwise (caller inspects
 * status / parses body).
 */
export async function tekbridgeFetch(
  sb: SupabaseClient,
  path: string,
  opts: TekbridgeFetchOptions,
): Promise<Response> {
  const jwt = await getBotJwt(sb);
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (isJwtExpired(jwt, nowSeconds)) {
    await markSessionStale(sb, opts.shopId, "session JWT expired before request");
    throw new TekbridgeSessionError(
      "expired",
      "tekbridge session JWT is expired — log the bot in and resubmit a fresh token.",
    );
  }

  const url = `${TEKBRIDGE_INTERNAL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "x-auth-token": jwt,
    "accept": "application/json",
  };
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? TEKBRIDGE_DEFAULT_TIMEOUT_MS),
  };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);
  if (res.status === 401) {
    await markSessionStale(sb, opts.shopId, "internal API returned 401 (session rejected)");
    throw new TekbridgeSessionError(
      "expired",
      "tekbridge session was rejected by Tekmetric (401) — resubmit a fresh token.",
    );
  }
  return res;
}

/**
 * Fetch + parse JSON. Throws TekbridgeApiError on non-2xx (body truncated to
 * 300 chars, matching the public client). Returns null for an empty body
 * (e.g. some DELETE responses).
 */
export async function tekbridgeJson<T = unknown>(
  sb: SupabaseClient,
  path: string,
  opts: TekbridgeFetchOptions,
): Promise<T> {
  const res = await tekbridgeFetch(sb, path, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new TekbridgeApiError(res.status, path, text.slice(0, 300));
  }
  return (text ? JSON.parse(text) : null) as T;
}
