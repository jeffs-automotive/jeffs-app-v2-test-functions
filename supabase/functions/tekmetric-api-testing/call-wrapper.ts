// call-wrapper — tekmetric-api-testing module.
// Extracted from tekmetric-api-testing/index.ts (file-size-refactor). Mechanical split.

import { tekmetricFetch } from "../_shared/tekmetric-client.ts";
import { SHOP_ID, sb } from "./config.ts";

// ─── Generic call wrapper ───────────────────────────────────────────────────

interface CallResult {
  url_called: string;
  status: number;
  body: unknown;
  body_excerpt?: string;
}

export async function tekmetricCall(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): Promise<CallResult> {
  // Note: tekmetric-client's buildUrl handles undefined/null values by
  // dropping them. We always add shop=SHOP_ID when caller didn't.
  const mergedQuery: Record<string, string | number | boolean | undefined | null> = {
    ...(query ?? {}),
  };
  // shop_id is ALWAYS server-derived — overwrite any caller-supplied `shop`
  // tenant key (shop-id-server-derived / shop-agnostic.md). Most Tekmetric
  // endpoints scope by `shop`; /customers/{id} & /vehicles/{id} ignore the
  // extra param. Forcing it prevents a caller from scoping to another shop.
  mergedQuery.shop = SHOP_ID;

  const res = await tekmetricFetch(sb, path, {
    method: "GET",
    query: mergedQuery,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Tekmetric returned non-JSON (rare; usually an HTML error page on 500).
    return {
      url_called: buildUrlForLog(path, mergedQuery),
      status: res.status,
      body: null,
      body_excerpt: text.slice(0, 1000),
    };
  }
  return {
    url_called: buildUrlForLog(path, mergedQuery),
    status: res.status,
    body: parsed,
  };
}

/**
 * Build the called URL string for logging — mirrors tekmetric-client's
 * buildUrl but returns a string (we don't have access to the internal
 * helper). Used only in the response payload for debugging.
 */
function buildUrlForLog(
  path: string,
  query: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}
