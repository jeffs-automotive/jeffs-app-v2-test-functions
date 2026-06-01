// write-helpers — tekmetric-api-testing module.
// Extracted from tekmetric-api-testing/index.ts (file-size-refactor). Mechanical split.

import { tekmetricFetch } from "../_shared/tekmetric-client.ts";
import { Sentry } from "../_shared/sentry-edge.ts";
import { SHOP_ID, sb, jsonResponse } from "./config.ts";

interface TekmetricWriteResult {
  url_called: string;
  status: number;
  body: unknown;
  body_excerpt?: string;
}

export async function tekmetricWrite(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<TekmetricWriteResult> {
  const res = await tekmetricFetch(sb, path, { method, body });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return {
      url_called: path,
      status: res.status,
      body: null,
      body_excerpt: text.slice(0, 1000),
    };
  }
  return { url_called: path, status: res.status, body: parsed };
}

/**
 * Best-effort audit log row. Never throws — a logging failure must not
 * block the write op's response.
 */
export async function logTestWrite(args: {
  op: string;
  scope: unknown;
  result: TekmetricWriteResult;
}): Promise<void> {
  try {
    const auditRes = await sb.from("scheduler_admin_audit_log").insert({
      // shop_id is NOT NULL since migration 20260526100000 (hardening part B1);
      // omitting it made this best-effort audit insert silently fail.
      shop_id: SHOP_ID,
      table_name: "tekmetric_api",
      operation: args.op,
      diff_summary: {
        scope: args.scope,
        url_called: args.result.url_called,
        status: args.result.status,
        body_excerpt:
          args.result.body_excerpt ??
          JSON.stringify(args.result.body).slice(0, 500),
      },
    });
    if (auditRes.error) {
      Sentry.captureMessage("tekmetric-api-testing: audit insert failed", {
        level: "warning",
        tags: { tekmetric_op: args.op },
        extra: { detail: auditRes.error.message },
      });
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "test_write_audit_log_failed",
          detail: auditRes.error.message,
        }),
      );
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { tekmetric_op: args.op } });
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "test_write_audit_log_failed",
        detail: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}

/**
 * Build the response for a write op. Surfaces a downstream Tekmetric failure to
 * Sentry (silent-webhook-200 fix) and returns 502 instead of a silent 200.
 */
export function writeOpResponse(op: string, result: TekmetricWriteResult): Response {
  if (result.status >= 400) {
    Sentry.captureMessage(`tekmetric ${op} returned ${result.status}`, {
      level: "error",
      tags: { tekmetric_op: op },
      extra: { url_called: result.url_called, status: result.status },
    });
  }
  return jsonResponse(
    { ok: result.status < 400, op, ...result },
    result.status >= 400 ? 502 : 200,
  );
}
