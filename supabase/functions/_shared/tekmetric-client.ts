// Tekmetric API client — shared utilities for read/write calls to Tekmetric.
//
// Edge functions and (later) the orchestrator's AI SDK tools all import from this
// module. Single place for: fetching the access token, attaching auth headers,
// formatting paginated GETs, surfacing API errors.
//
// Token strategy: lazy + cached. Each invocation reads `tekmetric_access_token`
// from the Vault on first use, then keeps it in module-scope memory for the
// duration of that edge-function instance. The token is non-expiring (per
// Tekmetric docs), so we never refresh.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { TEKMETRIC_API_BASE, VAULT_NAMES } from "./tekmetric.ts";

let cachedToken: string | null = null;

/** Fetches the Tekmetric access token from Vault, caching it for this instance. */
export async function getTekmetricAccessToken(sb: SupabaseClient): Promise<string> {
  if (cachedToken) return cachedToken;

  const { data, error } = await sb.rpc("tekmetric_get_secret", {
    p_name: VAULT_NAMES.ACCESS_TOKEN,
  });
  if (error) {
    throw new Error(`tekmetric_get_secret RPC failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `Vault has no value for "${VAULT_NAMES.ACCESS_TOKEN}". Run the tekmetric-bootstrap function first.`,
    );
  }

  cachedToken = data as string;
  return cachedToken;
}

interface FetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Builds a full Tekmetric URL with query string. Handles undefined/null values by
 * dropping them from the querystring entirely.
 */
function buildUrl(
  path: string,
  query?: FetchOptions["query"],
): string {
  const url = new URL(`${TEKMETRIC_API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

/** Authenticated fetch against the Tekmetric API. */
export async function tekmetricFetch(
  sb: SupabaseClient,
  path: string,
  options: FetchOptions = {},
): Promise<Response> {
  const token = await getTekmetricAccessToken(sb);
  const url = buildUrl(path, options.query);
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  return fetch(url, init);
}

/**
 * Fetches a JSON resource from Tekmetric. Throws on non-2xx with the response body
 * truncated to the first 300 chars (enough to debug, not enough to flood logs).
 */
export async function tekmetricGetJson<T = unknown>(
  sb: SupabaseClient,
  path: string,
  query?: FetchOptions["query"],
): Promise<T> {
  const res = await tekmetricFetch(sb, path, { method: "GET", query });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Tekmetric GET ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

// ── Shared response shapes ────────────────────────────────────────────────────

/** Spring-style pagination envelope used by Tekmetric list endpoints. */
export interface TekmetricPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number; // current page index, 0-based
  first: boolean;
  last: boolean;
}

/** Subset of repair-order fields we use across tools. The full object has more. */
export interface TekmetricRepairOrder {
  id: number;
  repairOrderNumber: number;
  shopId: number;
  repairOrderStatus: { id: number; code: string; name: string };
  customerId: number | null;
  vehicleId: number | null;
  serviceWriterId: number | null;
  technicianId: number | null;
  /** Note: response uses lowercase `keytag`, while the PATCH endpoint expects camelCase `keyTag`. */
  keytag: string | number | null;
  appointmentStartTime?: string | null;
  completedDate?: string | null;
  postedDate?: string | null;
}
