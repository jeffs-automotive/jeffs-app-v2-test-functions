// scheduler-comms — confirmation + reminder sender (revamp Phase 3).
//
// Ops (POST, Pattern A bearer):
//   { op: "send_confirmation", session_id } — fire-and-forget from
//     submit-summary's confirm-success path. Claims + sends the
//     confirmation email (live) and SMS (consent + provider gated).
//   { op: "sweep_reminders" } — cron */10 (migration 20260702182000).
//     24h + 2h windows over the app-booked appointments shadow;
//     quiet-hours guarded (shop-local 08:00–20:59); claim-then-send.
//
// Plan: docs/scheduler/comms-phases-1-3-plan-2026-07-02.md. Core logic in
// ./core.ts (injectable sb + senders for tests).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope } from "../_shared/sentry-edge.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
} from "../_shared/scheduler-auth.ts";
import { resolveSecretKey } from "../_shared/resolve-secret-key.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { sendSms } from "../_shared/telnyx-client.ts";
import { sendResendEmail } from "../_shared/resend-client.ts";
import {
  sendConfirmationForSession,
  sweepReminders,
  type Senders,
} from "./core.ts";

let sb: SupabaseClient | null = null;
function getSb(): SupabaseClient {
  if (sb === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SECRET_KEY = resolveSecretKey();
    if (!SECRET_KEY) throw new Error("scheduler-comms: no Supabase secret key configured");
    sb = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}
export function _setSupabaseClientForTesting(client: unknown): void {
  sb = client as SupabaseClient;
}

const SENDERS: Senders = {
  sendSms,
  sendEmail: (args) => sendResendEmail(args),
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const auth = checkSchedulerBearer(req, "scheduler-comms");
  if (!auth.ok) return unauthorizedResponse(auth);

  let body: { op?: string; session_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { ok: false, error: "malformed_json" });
  }

  try {
    if (body.op === "send_confirmation") {
      if (typeof body.session_id !== "string" || body.session_id.length === 0) {
        return json(400, { ok: false, error: "missing_session_id" });
      }
      const result = await sendConfirmationForSession(
        getSb(),
        SENDERS,
        body.session_id,
      );
      if ("error" in result) {
        return json(422, { ok: false, error: result.error });
      }
      return json(200, { ok: true, result });
    }

    if (body.op === "sweep_reminders") {
      const result = await sweepReminders(getSb(), SENDERS, Date.now());
      const failed = result.processed.filter(
        (p) => p.sms === "failed" || p.email === "failed",
      );
      return json(200, {
        ok: failed.length === 0,
        quiet_hours: result.quiet_hours,
        processed: result.processed.length,
        failed: failed.length,
        results: result.processed,
      });
    }

    return json(400, { ok: false, error: `unknown_op: ${body.op}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEdgeError(getSb(), {
      surface: "scheduler-comms/unhandled",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "unhandled",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { op: body.op ?? null },
    });
    return json(500, { ok: false, error: "internal" });
  }
}

Deno.serve((req) => withSentryScope(req, "scheduler-comms", () => handler(req)));
