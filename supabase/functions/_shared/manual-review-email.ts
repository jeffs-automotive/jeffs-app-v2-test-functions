// Brief, link-first email templates for keytag manual reviews.
//
// One email per review (issued in real time — ORP/DRF/REG/PAF; ARN is folded
// into the daily report). 2026-06-18: reformatted from the old verbose
// per-category narrative to a BRIEF line + a link to the review page, now that
// the admin-app `/keytags` Manual Reviews tab is a real list you can open.
//
// Each email carries exactly:
//   - the review code (e.g. ORP-4XKZ9P)
//   - the key tag # and RO#
//   - a one-line description of the issue (the review's issue_summary)
//   - a button linking straight to the review on the admin app
// The full situation + options live on the review page; the email no longer
// repeats them. Claude Desktop's `code … option …` flow is kept as a fallback.
//
// Voice on the issue line stays plain-English (no "RO id" / "posted_ar" / "PATCH").

import type {
  ManualReviewCategory,
  ManualReviewContext,
  ManualReviewOption,
} from "./manual-review.ts";
import { sendResendEmail } from "./resend-client.ts";

const REVIEW_TO_EMAIL =
  Deno.env.get("KEYTAG_REPORT_TO_EMAIL") ?? "service@jeffsautomotive.com";
const REVIEW_FROM_EMAIL =
  Deno.env.get("KEYTAG_REPORT_FROM_EMAIL") ??
  "Jeff's Automotive Key Tags <alerts@jeffsautomotive.com>";

// Base URL of the admin app that hosts the review page. The deep link opens
// the Manual Reviews tab pre-filtered/expanded to this code. Entra-gated, so
// the advisor signs in if they aren't already.
const REVIEW_BASE_URL = (
  Deno.env.get("KEYTAG_REVIEW_BASE_URL") ?? "https://admin.jeffsautomotive.com"
).replace(/\/+$/, "");

const BRAND_PRIMARY = "#96003C"; // burgundy
const BRAND_ACCENT = "#D2B487"; // gold

/** Friendly one-liner for the category chip. */
const CATEGORY_LABEL: Record<ManualReviewCategory, string> = {
  orphan_release: "Tag may need to come off",
  work_approved_drift: "Needs a tag (had one before)",
  ar_regression: "Back in WIP, tag is gone",
  ar_no_prior_tag: "A/R repair order, no tag tracked",
  tekmetric_patch_fail: "Couldn't write the tag to Tekmetric",
};

export interface SendManualReviewEmailArgs {
  code: string;
  category: ManualReviewCategory;
  issueSummary: string;
  options: ManualReviewOption[];
  context: ManualReviewContext;
}

export interface SendManualReviewEmailResult {
  sent: boolean;
  error?: string;
}

export async function sendManualReviewEmail(
  args: SendManualReviewEmailArgs,
): Promise<SendManualReviewEmailResult> {
  // Idempotency: code is unique by DB constraint, so per-code dedup is safe —
  // a re-issued code → Resend 409 → treated as sent (no double-send).
  const r = await sendResendEmail({
    from: REVIEW_FROM_EMAIL,
    to: REVIEW_TO_EMAIL,
    subject: buildSubject(args),
    html: buildHtml(args),
    idempotencyKey: `keytag-manual-review:${args.code}`,
  });
  return r.ok ? { sent: true } : { sent: false, error: r.error };
}

// ─── Subject + HTML helpers ─────────────────────────────────────────────────

/** "Red 20" / "Yellow 45" / null when there's no tag on the review. */
function tagDisplay(color?: string | null, num?: number | null): string | null {
  if (!color || num === null || num === undefined) return null;
  return `${color === "red" ? "Red" : "Yellow"} ${num}`;
}

/** The same, but phrased for the subject line where null reads as "a key tag". */
function tagLabel(color?: string | null, num?: number | null): string {
  return tagDisplay(color, num) ?? "a key tag";
}

/** The admin-app deep link that opens this review. */
export function buildReviewLink(code: string, baseUrl: string = REVIEW_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}/keytags?tab=manual-reviews&review=${encodeURIComponent(code)}`;
}

function buildSubject(args: SendManualReviewEmailArgs): string {
  const tag = tagLabel(
    args.context.tag_color as string | null,
    args.context.tag_number as number | null,
  );
  const ro = args.context.ro_number ? `RO #${args.context.ro_number}` : "a repair order";
  switch (args.category) {
    case "orphan_release":
      return `Key Tag Review (${args.code}): ${tag} may need to come off ${ro}`;
    case "work_approved_drift":
      return `Key Tag Review (${args.code}): ${ro} needs a new tag (and previously had one)`;
    case "ar_regression":
      return `Key Tag Review (${args.code}): ${ro} is back in WIP but its tag is gone`;
    case "ar_no_prior_tag":
      return `Key Tag Review (${args.code}): A/R ${ro} has no tag tracked`;
    case "tekmetric_patch_fail":
      return `Key Tag Review (${args.code}): couldn't write ${tag} into Tekmetric for ${ro}`;
  }
}

function buildHtml(args: SendManualReviewEmailArgs): string {
  const { code, category, issueSummary, options, context } = args;
  const tag =
    tagDisplay(
      context.tag_color as string | null,
      context.tag_number as number | null,
    ) ?? "—";
  const roText = context.ro_number ? `RO #${context.ro_number}` : "—";
  const categoryLabel = CATEGORY_LABEL[category];
  const link = buildReviewLink(code);
  const optionCount = options.length;
  const optionHint =
    optionCount > 0
      ? `Open the review to choose how to resolve it (${optionCount} option${optionCount === 1 ? "" : "s"}).`
      : `Open the review to see what to do next.`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#1a1a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#262626;">

  <h1 style="margin:0 0 4px 0;color:${BRAND_PRIMARY};font-size:20px;border-bottom:2px solid ${BRAND_ACCENT};padding-bottom:10px;">
    Key Tag Review Needed
  </h1>
  <p style="margin:10px 0 0 0;font-family:'SF Mono',Menlo,monospace;font-size:16px;color:${BRAND_ACCENT};font-weight:700;letter-spacing:2px;">
    ${escapeHtml(code)}
  </p>

  <table role="presentation" style="width:100%;border-collapse:collapse;margin:18px 0 4px 0;font-size:14px;">
    <tr>
      <td style="padding:6px 12px 6px 0;color:#999;width:90px;">Key tag</td>
      <td style="padding:6px 0;color:#f0a8a8;font-family:'SF Mono',Menlo,monospace;font-weight:700;">${escapeHtml(tag)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0;color:#999;">Repair order</td>
      <td style="padding:6px 0;color:#e0e0e0;font-weight:600;">${escapeHtml(roText)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0;color:#999;">Issue</td>
      <td style="padding:6px 0;color:#e0e0e0;">${escapeHtml(categoryLabel)}</td>
    </tr>
  </table>

  <p style="margin:14px 0 0 0;color:#e0e0e0;line-height:1.55;font-size:14px;">${escapeHtml(issueSummary)}</p>

  <div style="margin:24px 0 8px 0;">
    <a href="${link}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:700;font-size:15px;border:1px solid ${BRAND_ACCENT};">
      Open the review →
    </a>
  </div>
  <p style="margin:6px 0 0 0;color:#999;font-size:13px;">${escapeHtml(optionHint)}</p>

  <div style="margin-top:24px;padding:12px 14px;background:#1f1f1f;border-left:3px solid ${BRAND_ACCENT};border-radius:3px;">
    <div style="color:#bbb;font-size:12px;line-height:1.5;">
      Prefer Claude Desktop? Type
      <code style="background:#0f0f0f;padding:2px 6px;border-radius:3px;color:#f0c860;">code ${escapeHtml(code)} option a</code>
      (replace <code style="color:#f0c860;">a</code> with your choice). Any service team member can resolve this. The code is single-use.
    </div>
  </div>

  <p style="margin:24px 0 0 0;font-size:11px;color:#777;line-height:1.5;">
    Issued by Jeff's Automotive Key Tag system. Sent automatically when the system runs into something it can't decide on its own. Reply-to is not monitored.
  </p>

</div></body></html>`;
}

// ─── HTML escaping (defensive) ──────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
