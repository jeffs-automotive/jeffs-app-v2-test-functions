// Shared Resend email transport for edge functions.
//
// Extracted (file-size-refactor batch 1) from the identical
// `fetch("https://api.resend.com/emails", ...)` boilerplate that was
// copy-pasted across keytag-daily-report, manual-review-email, and others.
// This module owns ONLY the HTTP transport — callers own the from/to/subject/
// html composition. Reads RESEND_API_KEY at call time. Never throws.
//
// Behavior preserved from the prior call sites:
//   - optional Idempotency-Key header (Resend dedups within 24h)
//   - HTTP 409 (idempotency replay) is treated as SUCCESS (deduped: true)
//   - the Resend message id is parsed from the 2xx JSON body when present

export interface SendEmailArgs {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  /** Resend Idempotency-Key. Same key within 24h → 409 dedup (treated as sent). */
  idempotencyKey?: string;
  /** Optional hard cap on the request (AbortSignal.timeout). A timeout
   *  resolves as { ok:false, status:0 } — this client never throws. */
  timeoutMs?: number;
}

export interface SendEmailResult {
  /** true on a 2xx response OR a 409 idempotency replay. */
  ok: boolean;
  /** HTTP status, or 0 when the key is missing / the request threw. */
  status: number;
  /** Resend message id, when returned on success. */
  id?: string;
  /** true when this was a 409 idempotency replay (already sent earlier). */
  deduped?: boolean;
  /** Set when ok === false. */
  error?: string;
}

export async function sendResendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    return { ok: false, status: 0, error: "RESEND_API_KEY not configured" };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (args.idempotencyKey) {
    headers["Idempotency-Key"] = args.idempotencyKey;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: args.from,
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        html: args.html,
      }),
      ...(args.timeoutMs ? { signal: AbortSignal.timeout(args.timeoutMs) } : {}),
    });
    const text = await res.text();

    // 409 = idempotency replay; the email DID land earlier. Treat as success.
    if (res.status === 409) {
      return { ok: true, status: 409, deduped: true };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }

    let id: string | undefined;
    try {
      const json = JSON.parse(text);
      if (typeof json?.id === "string") id = json.id;
    } catch {
      // 2xx with a non-JSON body — still a success, just no id to surface.
    }
    return { ok: true, status: res.status, id };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
