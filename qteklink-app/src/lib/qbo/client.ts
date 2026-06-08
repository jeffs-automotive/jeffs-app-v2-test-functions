/**
 * QboClient — typed QBO Accounting API request layer (Node, server-only).
 *
 * Owns the v3 data-call path so we control the attestations precisely:
 *   #2 bounded retry on 429/5xx with backoff honoring Retry-After
 *   #3 structured errors (parseFault → QboClientError) — no silent failures
 *   #4 intuit_tid capture (structured log + Sentry tag)
 *   #6 write idempotency: a `requestid` UUID computed ONCE per logical write and
 *      held constant across every retry (a fresh UUID per attempt would defeat
 *      idempotency and double-post on a 5xx-then-success).
 * Tokens come from tokens.ts (refresh-on-expiry); a 401 triggers one forced
 * refresh + retry, then surfaces. See docs/qbo/qbo-api-client-plan.md.
 */
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";

import {
  qboBaseUrl,
  QBO_MINORVERSION,
  QBO_MAX_RETRIES,
  QBO_BACKOFF_MS,
  QBO_REQUEST_TIMEOUT_MS,
} from "@/lib/qbo/config";
import { getValidAccessToken } from "@/lib/qbo/tokens";
import { QboClientError, parseFault } from "@/lib/qbo/errors";

const isRetryableStatus = (s: number): boolean => s === 429 || (s >= 500 && s <= 599);

export interface QboClientOptions {
  realmId?: string;
  baseUrl?: string;
  maxRetries?: number;
  backoffMs?: readonly number[];
  timeoutMs?: number;
}

export interface QboRequestOptions {
  /** JSON body (serialized). Ignored when `textBody` is set. */
  body?: unknown;
  /** Raw text body — used for the /query endpoint (application/text). */
  textBody?: string;
  query?: Record<string, string | number | undefined>;
  /** Writes: add a `requestid` (idempotent, retry-safe). */
  idempotent?: boolean;
  /** An explicit STABLE requestid (e.g. the qteklink_postings.requestid) — reused across
   *  separate poster runs so a crash-after-create can't double-post. Overrides the
   *  per-call random UUID. Must be ≤ 50 chars (QBO cap). */
  requestId?: string;
  contentType?: string;
  accept?: string;
}

export class QboClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly backoffMs: readonly number[];
  private readonly timeoutMs: number;
  private readonly realmIdOverride?: string;

  constructor(opts: QboClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? qboBaseUrl();
    this.maxRetries = opts.maxRetries ?? QBO_MAX_RETRIES;
    this.backoffMs = opts.backoffMs ?? QBO_BACKOFF_MS;
    this.timeoutMs = opts.timeoutMs ?? QBO_REQUEST_TIMEOUT_MS;
    this.realmIdOverride = opts.realmId;
  }

  private auth(forceRefresh = false) {
    return getValidAccessToken(
      this.realmIdOverride,
      forceRefresh ? { forceRefresh: true } : undefined,
    );
  }

  async request<T = unknown>(
    method: string,
    resource: string,
    opts: QboRequestOptions = {},
  ): Promise<T> {
    // An explicit stable requestid (cross-run idempotency) wins; else a per-call UUID,
    // computed ONCE and reused across every retry of this logical write.
    const requestId = opts.requestId ?? (opts.idempotent ? randomUUID() : undefined);

    let auth = await this.auth();
    let triedForcedRefresh = false;

    for (let attempt = 0; ; attempt++) {
      const url = this.buildUrl(auth.realmId, resource, opts.query, requestId);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: opts.accept ?? "application/json",
      };
      const body =
        opts.textBody ??
        (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
      if (body !== undefined) {
        headers["Content-Type"] = opts.contentType ?? "application/json";
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, { method, headers, body, signal: controller.signal });
      } catch (cause) {
        clearTimeout(timer);
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffFor(attempt));
          continue;
        }
        throw new QboClientError("QBO request network error / timeout.", {
          kind: "network",
          cause,
        });
      } finally {
        clearTimeout(timer);
      }

      const intuitTid = res.headers.get("intuit_tid");
      this.log({ method, resource, status: res.status, intuitTid, attempt });

      if (res.ok) return (await this.parseBody(res)) as T;

      // 401 → one forced token refresh + immediate retry, then surface.
      if (res.status === 401 && !triedForcedRefresh) {
        triedForcedRefresh = true;
        auth = await this.auth(true);
        continue;
      }

      // 429 / 5xx → bounded retry (Retry-After wins over backoff schedule).
      if (isRetryableStatus(res.status) && attempt < this.maxRetries) {
        await this.sleep(this.retryAfterMs(res) ?? this.backoffFor(attempt));
        continue;
      }

      // Non-retryable, or retries exhausted → typed Fault. (5010 conflict and
      // other 4xx land here — never auto-retried.)
      const errBody = await this.parseBody(res);
      const err = parseFault({ body: errBody, httpStatus: res.status, intuitTid });
      Sentry.captureException(err, {
        level: "warning",
        tags: {
          surface: "qbo-client",
          qbo_kind: err.kind,
          intuit_tid: intuitTid ?? "none",
        },
        extra: { method, resource, status: res.status },
      });
      throw err;
    }
  }

  /** Read entity by query (always-POST per the plan; QBL in the text body). */
  query<T = unknown>(qbl: string): Promise<T> {
    return this.request<T>("POST", "query", {
      textBody: qbl,
      contentType: "application/text",
    });
  }

  /** Create an entity (idempotent via requestid). Pass `requestId` for a STABLE,
   *  cross-run idempotency key (the qteklink_postings.requestid); else a random UUID. */
  create<T = unknown>(entity: string, body: unknown, requestId?: string): Promise<T> {
    return this.request<T>("POST", entity.toLowerCase(), { body, idempotent: true, requestId });
  }

  /**
   * Sparse update — only the provided fields change (omitted fields are
   * preserved). Caller must include `Id` + current `SyncToken`.
   */
  sparseUpdate<T = unknown>(entity: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", entity.toLowerCase(), {
      body: { ...body, sparse: true },
      idempotent: true,
    });
  }

  private buildUrl(
    realmId: string,
    resource: string,
    query: QboRequestOptions["query"],
    requestId?: string,
  ): string {
    const u = new URL(`${this.baseUrl}/v3/company/${realmId}/${resource}`);
    u.searchParams.set("minorversion", QBO_MINORVERSION);
    if (requestId) u.searchParams.set("requestid", requestId);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private retryAfterMs(res: Response): number | null {
    const h = res.headers.get("retry-after");
    if (!h) return null;
    const secs = Number(h);
    return Number.isFinite(secs) ? secs * 1000 : null;
  }

  private backoffFor(attempt: number): number {
    return this.backoffMs[Math.min(attempt, this.backoffMs.length - 1)] ?? 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(ctx: {
    method: string;
    resource: string;
    status: number;
    intuitTid: string | null;
    attempt: number;
  }): void {
    // Structured JSON (observability D3); intuit_tid for Intuit-side tracing.
    console.log(
      JSON.stringify({ level: "info", surface: "qbo-client", ...ctx, intuit_tid: ctx.intuitTid }),
    );
  }
}
