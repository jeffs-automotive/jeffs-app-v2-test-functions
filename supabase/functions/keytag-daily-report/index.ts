// keytag-daily-report
//
// Daily 7 AM Eastern Resend email summarizing the keytag pool state:
//   - Counts: in use / available / stale (>3 days posted_ar without release)
//   - Stale-tag table: tag id, customer name, RO#, days-stale, Tekmetric link
//   - Full 180-tag grid (R1..R90, Y1..Y90) — available green, in-use shaded red
//
// Triggered by pg_cron (jobname: keytag-daily-report) at 0 11 * * * UTC
// = 7 AM EDT. In winter (EST) this drops to 6 AM — acceptable for a
// morning ops digest.
//
// Auth: Pattern A bearer check (same as the scheduler functions).
//
// Email surface:
//   From: Jeff's Automotive Key Tags <alerts@jeffsautomotive.com>
//   To:   service@jeffsautomotive.com
//   Idempotency-Key: keytag-daily-report:YYYY-MM-DD (prevents Resend
//     double-sends if pg_cron retries within a 24h window)
//
// Env vars:
//   RESEND_API_KEY            — required
//   KEYTAG_REPORT_TO_EMAIL    — override To address (default service@)
//   KEYTAG_REPORT_FROM_EMAIL  — override From line (default alerts@)

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricGetJson,
} from "../_shared/tekmetric-client.ts";
import {
  buildTekmetricRoUrl,
  ENV_NAMES,
} from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);
const REPORT_TO_EMAIL =
  Deno.env.get("KEYTAG_REPORT_TO_EMAIL") ?? "service@jeffsautomotive.com";
const REPORT_FROM_EMAIL =
  Deno.env.get("KEYTAG_REPORT_FROM_EMAIL") ??
  "Jeff's Automotive Key Tags <alerts@jeffsautomotive.com>";

const STALE_DAYS = 3;

// Brand palette (matches scheduler-app + Jeff's Automotive identity)
const BRAND_PRIMARY = "#96003C"; // burgundy
const BRAND_ACCENT = "#D2B487"; // gold
const AVAILABLE_BG = "#1f4d2a";
const AVAILABLE_TEXT = "#a8e3b1";
const INUSE_BG = "#5a2528";
const INUSE_TEXT = "#f0a8a8";

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface KeytagRow {
  tag_color: "red" | "yellow";
  tag_number: number;
  status: "available" | "assigned" | "posted_ar" | string;
  ro_id: number | null;
  ro_number: number | null;
  customer_id: number | null;
  assigned_at: string | null;
  posted_at: string | null;
}

interface StaleTagDetail {
  tag_color: "red" | "yellow";
  tag_number: number;
  ro_id: number;
  ro_number: number;
  customer_name: string;
  days_stale: number;
  ro_url: string;
}

interface TekmetricCustomerSubset {
  firstName?: string | null;
  lastName?: string | null;
}

interface TekmetricRepairOrderSubset {
  id: number;
  customer?: TekmetricCustomerSubset | null;
  customerId?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDays(daysOld: number): string {
  return daysOld === 1 ? "1 day" : `${daysOld} days`;
}

function tagLabel(c: "red" | "yellow", n: number): string {
  return `${c === "red" ? "R" : "Y"}${n}`;
}

function ymdEastern(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function todayLongEastern(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

async function fetchCustomerNameForRo(
  roId: number,
  customerId: number | null,
): Promise<string> {
  // Try the RO first (typically includes customer inline)
  try {
    const ro = await tekmetricGetJson<TekmetricRepairOrderSubset>(
      sb,
      `/repair-orders/${roId}`,
      { shop: SHOP_ID },
    );
    const c = ro?.customer;
    if (c && (c.firstName || c.lastName)) {
      return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    }
    // Fall through to direct customer lookup if RO didn't include customer
  } catch {
    // ignore, try fallback
  }
  if (customerId) {
    try {
      const cust = await tekmetricGetJson<TekmetricCustomerSubset>(
        sb,
        `/customers/${customerId}`,
        { shop: SHOP_ID },
      );
      if (cust && (cust.firstName || cust.lastName)) {
        return `${cust.firstName ?? ""} ${cust.lastName ?? ""}`.trim();
      }
    } catch {
      // ignore
    }
  }
  return "Unknown";
}

// ─── Email HTML builder ──────────────────────────────────────────────────────

function buildReportHtml(args: {
  tags: KeytagRow[];
  inUseCount: number;
  availableCount: number;
  staleCount: number;
  staleDetails: StaleTagDetail[];
}): string {
  const { tags, inUseCount, availableCount, staleCount, staleDetails } = args;
  const today = todayLongEastern();

  const reds = tags
    .filter((t) => t.tag_color === "red")
    .sort((a, b) => a.tag_number - b.tag_number);
  const yellows = tags
    .filter((t) => t.tag_color === "yellow")
    .sort((a, b) => a.tag_number - b.tag_number);

  // 90 tags / 15 cols = 6 even rows per color. Cells are width:auto inside a
  // table-layout:fixed table so every row stays the same width and no cell
  // is clipped in narrower email-client viewports (the prior 18-col layout
  // overflowed and the rightmost tag of each row was cut off in Gmail web).
  const GRID_COLS = 15;

  function tagCell(t: KeytagRow): string {
    const used = t.status !== "available";
    const bg = used ? INUSE_BG : AVAILABLE_BG;
    const fg = used ? INUSE_TEXT : AVAILABLE_TEXT;
    return `<td style="background:${bg};color:${fg};padding:6px 2px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:12px;border:1px solid #222;border-radius:3px;font-weight:600;width:${Math.floor(100 / GRID_COLS)}%;">${tagLabel(t.tag_color, t.tag_number)}</td>`;
  }

  function buildGridRows(rowTags: KeytagRow[], cols = GRID_COLS): string {
    const rows: string[] = [];
    for (let i = 0; i < rowTags.length; i += cols) {
      const slice = rowTags.slice(i, i + cols);
      const cells = slice.map(tagCell).join("");
      rows.push(`<tr>${cells}</tr>`);
    }
    return rows.join("");
  }

  const redGrid = buildGridRows(reds);
  const yellowGrid = buildGridRows(yellows);

  const staleSection =
    staleCount === 0
      ? `<p style="margin:0;color:#888;font-style:italic;">No stale tags. 👍</p>`
      : `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Tag</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Customer</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">RO #</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};color:#ddd;">Posted</th>
            </tr>
          </thead>
          <tbody>
            ${staleDetails
              .map(
                (s) => `<tr>
                <td style="padding:8px;border-bottom:1px solid #333;font-family:monospace;color:${INUSE_TEXT};font-weight:600;">${tagLabel(s.tag_color, s.tag_number)}</td>
                <td style="padding:8px;border-bottom:1px solid #333;color:#e0e0e0;">${escapeHtml(s.customer_name)}</td>
                <td style="padding:8px;border-bottom:1px solid #333;"><a href="${s.ro_url}" style="color:${BRAND_ACCENT};text-decoration:none;">RO ${s.ro_number}</a></td>
                <td style="padding:8px;border-bottom:1px solid #333;color:#bbb;">${fmtDays(s.days_stale)} ago</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Key Tag Daily Report — ${today}</title>
</head>
<body style="margin:0;padding:0;background:#1a1a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:820px;margin:0 auto;padding:24px;background:#262626;">

    <h1 style="margin:0;color:${BRAND_PRIMARY};font-size:24px;border-bottom:2px solid ${BRAND_ACCENT};padding-bottom:8px;">Key Tag Daily Report</h1>
    <p style="margin:8px 0 24px 0;color:#999;">${today}</p>

    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:24px;">
      <tr>
        <td style="background:#1f1f1f;padding:16px;border-radius:4px;border:1px solid #333;text-align:center;width:33%;">
          <div style="font-size:32px;font-weight:700;color:${BRAND_PRIMARY};">${inUseCount}</div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">In Use</div>
        </td>
        <td style="background:#1f1f1f;padding:16px;border-radius:4px;border:1px solid #333;text-align:center;width:33%;">
          <div style="font-size:32px;font-weight:700;color:${BRAND_PRIMARY};">${availableCount}</div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Available</div>
        </td>
        <td style="background:#1f1f1f;padding:16px;border-radius:4px;border:1px solid #333;text-align:center;width:33%;">
          <div style="font-size:32px;font-weight:700;color:${BRAND_PRIMARY};">${staleCount}</div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Stale (&gt;${STALE_DAYS} days)</div>
        </td>
      </tr>
    </table>

    <h2 style="margin:24px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Stale tags</h2>
    <p style="margin:0 0 12px 0;color:#999;font-size:13px;">Tags assigned to ROs posted more than ${STALE_DAYS} days ago that haven't been released. Investigate whether the customer picked up.</p>
    ${staleSection}

    <h2 style="margin:32px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Red tags (R1–R90)</h2>
    <table role="presentation" style="border-collapse:separate;border-spacing:3px;width:100%;table-layout:fixed;">${redGrid}</table>

    <h2 style="margin:24px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Yellow tags (Y1–Y90)</h2>
    <table role="presentation" style="border-collapse:separate;border-spacing:3px;width:100%;table-layout:fixed;">${yellowGrid}</table>

    <p style="margin:16px 0 0 0;font-size:12px;color:#777;">
      <span style="background:${AVAILABLE_BG};color:${AVAILABLE_TEXT};padding:3px 10px;border-radius:3px;font-family:monospace;font-weight:600;">available</span>
      &nbsp;
      <span style="background:${INUSE_BG};color:${INUSE_TEXT};padding:3px 10px;border-radius:3px;font-family:monospace;font-weight:600;">in use</span>
    </p>

    <h2 style="margin:32px 0 8px 0;color:${BRAND_PRIMARY};font-size:18px;border-bottom:1px solid ${BRAND_ACCENT};padding-bottom:4px;">Legend</h2>
    <p style="margin:0;font-size:13px;color:#aaa;line-height:1.5;">
      A tag is released automatically when the RO is posted-paid (status 5) or when an A/R balance is paid. If a tag has been stale for many days, the customer may have already picked up — use the Claude skill to release it manually.
    </p>

    <p style="margin:32px 0 0 0;font-size:11px;color:#666;border-top:1px solid #333;padding-top:12px;">
      Generated automatically by keytag-daily-report. Schedule: 7:00 AM Eastern, daily.
    </p>
  </div>
</body>
</html>`;
}

// ─── Resend send ─────────────────────────────────────────────────────────────

async function sendViaResend(args: {
  subject: string;
  html: string;
  idempotencyKey: string | null;
}): Promise<{
  ok: boolean;
  resend_id?: string;
  error?: string;
  status: number;
  deduped?: boolean;
}> {
  if (!RESEND_API_KEY) {
    return { ok: false, status: 0, error: "RESEND_API_KEY not configured" };
  }
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    };
    if (args.idempotencyKey) {
      headers["Idempotency-Key"] = args.idempotencyKey;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: REPORT_FROM_EMAIL,
        to: [REPORT_TO_EMAIL],
        subject: args.subject,
        html: args.html,
      }),
    });
    const text = await res.text();

    // 409 = idempotency replay. Resend's safety check fires when the same
    // idempotency key is used again within 24h. Treat as success (the
    // email DID land earlier — we'd just be re-sending an updated body).
    // Matches the transcript-dispatcher pattern (commit 9466de0).
    if (res.status === 409) {
      return { ok: true, status: 409, deduped: true };
    }

    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }

    let resend_id: string | undefined;
    try {
      const json = JSON.parse(text);
      if (typeof json.id === "string") resend_id = json.id;
    } catch {
      // 200 with non-JSON body — still treat as success
    }
    return { ok: true, status: res.status, resend_id };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }
  const auth = checkSchedulerBearer(req, "keytag-daily-report");
  if (!auth.ok) return unauthorizedResponse(auth);

  // `?force=true` bypasses Resend's idempotency-key dedup. Used for
  // ad-hoc smoke tests when we've already sent today's email but want
  // to verify a layout / content change. Daily cron NEVER passes this.
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // Pull all keytags
  const { data: rows, error } = await sb
    .from("keytags")
    .select(
      "tag_color, tag_number, status, ro_id, ro_number, customer_id, assigned_at, posted_at",
    )
    .order("tag_color")
    .order("tag_number");

  if (error) {
    return jsonResponse(
      { ok: false, error: `keytags query: ${error.message}` },
      500,
    );
  }

  const tags = (rows ?? []) as KeytagRow[];

  // Counts
  const inUseCount = tags.filter(
    (t) => t.status === "assigned" || t.status === "posted_ar",
  ).length;
  const availableCount = tags.filter((t) => t.status === "available").length;

  // Stale: posted_ar status, posted_at > STALE_DAYS ago, not released
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60_000);
  const staleRaw = tags.filter(
    (t) =>
      t.status === "posted_ar" &&
      t.posted_at &&
      new Date(t.posted_at) < cutoff,
  );

  // Resolve customer names for stale tags (in parallel to keep latency low)
  const staleDetails: StaleTagDetail[] = await Promise.all(
    staleRaw.map(async (t) => {
      const customerName =
        t.ro_id !== null
          ? await fetchCustomerNameForRo(t.ro_id, t.customer_id)
          : "Unknown";
      const daysStale = t.posted_at
        ? Math.floor(
            (Date.now() - new Date(t.posted_at).getTime()) /
              (24 * 60 * 60_000),
          )
        : 0;
      return {
        tag_color: t.tag_color,
        tag_number: t.tag_number,
        ro_id: t.ro_id ?? 0,
        ro_number: t.ro_number ?? 0,
        customer_name: customerName,
        days_stale: daysStale,
        ro_url:
          t.ro_id !== null
            ? buildTekmetricRoUrl({ roId: t.ro_id, shopId: SHOP_ID })
            : "",
      };
    }),
  );

  const html = buildReportHtml({
    tags,
    inUseCount,
    availableCount,
    staleCount: staleRaw.length,
    staleDetails,
  });
  const subject = `Key Tags: ${inUseCount} in use, ${availableCount} available, ${staleRaw.length} stale`;
  const idempotencyKey = force ? null : `keytag-daily-report:${ymdEastern()}`;

  const send = await sendViaResend({ subject, html, idempotencyKey });
  if (!send.ok) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "keytag_daily_report_send_failed",
        status: send.status,
        detail: send.error,
      }),
    );
    return jsonResponse(
      {
        ok: false,
        error: `resend_send_failed: ${send.error}`,
        status: send.status,
      },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    in_use: inUseCount,
    available: availableCount,
    stale: staleRaw.length,
    resend_id: send.resend_id ?? null,
    idempotency_key: idempotencyKey,
    forced: force,
    deduped: send.deduped ?? false,
  });
});
