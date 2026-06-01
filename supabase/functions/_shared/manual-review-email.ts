// Laymen-terms email templates for keytag manual reviews.
//
// One template per category. Each renders a self-contained explanation
// the service team can read on their phone without context from the
// codebase. Voice rules:
//   - Plain English, no jargon (no "RO id", no "posted_ar", no "PATCH")
//   - Concrete numbers and tag names ("Red 5", "RO #152407")
//   - Lead with WHAT HAPPENED, then WHAT IT MIGHT MEAN, then WHAT TO DO
//   - Options each have a use-case so the advisor knows when to pick which
//   - Footer instructs the exact phrase to type in Claude Desktop

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
  // HTTP transport extracted to ./resend-client.ts (file-size-refactor batch 1).
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

function tagLabel(color?: string | null, num?: number | null): string {
  if (!color || num === null || num === undefined) return "a key tag";
  return `${color === "red" ? "Red" : "Yellow"} ${num}`;
}

function buildSubject(args: SendManualReviewEmailArgs): string {
  const tag = tagLabel(args.context.tag_color as string | null, args.context.tag_number as number | null);
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
  const body = renderCategoryBody(category, context);
  const optionsHtml = options
    .map((o, i) => {
      const letter = String.fromCharCode(97 + i); // a, b, c...
      const tagInputNote = o.needs_tag_input
        ? `<div style="margin-top:6px;color:#999;font-style:italic;font-size:12px;">→ This choice needs a specific color + tag number. Reply: <code>code ${code} option ${o.key} red 5</code> (replace red 5 with the tag).</div>`
        : "";
      return `<li style="margin-bottom:14px;">
        <strong style="color:#D2B487;">Option ${letter} — ${escapeHtml(o.label)}</strong>
        <div style="margin-top:4px;color:#ddd;">${escapeHtml(o.description)}</div>
        ${tagInputNote}
      </li>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#1a1a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:28px 24px;background:#262626;">

  <h1 style="margin:0 0 4px 0;color:#96003C;font-size:22px;border-bottom:2px solid #D2B487;padding-bottom:10px;">
    Key Tag Review Needed
  </h1>
  <p style="margin:8px 0 18px 0;font-family:monospace;font-size:16px;color:#D2B487;font-weight:700;letter-spacing:2px;">
    Code: ${escapeHtml(code)}
  </p>

  <h2 style="color:#f0a8a8;font-size:15px;margin:18px 0 6px 0;">What happened</h2>
  <div style="color:#e0e0e0;line-height:1.55;font-size:14px;">${body}</div>

  <h2 style="color:#f0a8a8;font-size:15px;margin:24px 0 6px 0;">What you can do</h2>
  <ul style="margin:0;padding:0 0 0 18px;list-style:none;">
    ${optionsHtml}
  </ul>

  <div style="margin-top:28px;padding:14px 16px;background:#1f1f1f;border-left:3px solid #D2B487;border-radius:3px;">
    <strong style="color:#D2B487;font-size:13px;">How to resolve</strong>
    <div style="margin-top:6px;color:#ddd;font-size:13px;line-height:1.5;">
      Open Claude Desktop and type: <code style="background:#0f0f0f;padding:2px 6px;border-radius:3px;color:#f0c860;">code ${escapeHtml(code)} option a</code>
      (replace <code style="color:#f0c860;">a</code> with your choice).
      Any service team member can resolve this. The code is single-use, so once it's resolved here it's done.
    </div>
  </div>

  <p style="margin:28px 0 0 0;font-size:11px;color:#777;line-height:1.5;">
    Issued by Jeff's Automotive Key Tag system. Sent automatically when the system runs into something it can't decide on its own. Reply-to is not monitored — use Claude Desktop's key-tag tools to make changes.
  </p>

</div></body></html>`;
}

// ─── Per-category narrative body ────────────────────────────────────────────

function renderCategoryBody(
  category: ManualReviewCategory,
  context: ManualReviewContext,
): string {
  const tag = tagLabel(context.tag_color as string | null, context.tag_number as number | null);
  const ro = context.ro_number ? `RO #${context.ro_number}` : "the repair order";

  switch (category) {
    case "orphan_release": {
      const tekState = (context.tekmetric_status_at_release as string | null) ?? "no longer findable";
      const reason = (context.reason as string | null) ?? "";
      const isDeleted = /404|deleted/i.test(reason);
      const wasPaid = /posted_paid/i.test(reason);
      const symptom = isDeleted
        ? `Tekmetric told us "this repair order doesn't exist anymore."`
        : wasPaid
          ? `Tekmetric shows ${ro} as <strong>posted & paid</strong>, but we never got the payment notification that would normally free up ${tag}.`
          : `Tekmetric shows ${ro} as <strong>${escapeHtml(tekState)}</strong>, which our system didn't expect.`;
      const meaning = isDeleted
        ? `<ul style="margin:6px 0;padding-left:18px;color:#ddd;">
            <li>The RO was canceled or deleted (maybe by mistake) — the customer's keys are probably gone, and <strong>${tag} should come off</strong>.</li>
            <li>The RO was replaced or merged with a new RO number — <strong>${tag} is still on someone's keys</strong>, just under a different RO. Releasing it would create a mismatch.</li>
          </ul>`
        : wasPaid
          ? `<ul style="margin:6px 0;padding-left:18px;color:#ddd;">
              <li>The customer paid and the keys left the shop, and we just missed the notification — <strong>${tag} should come off</strong>.</li>
              <li>The keys are still here for some reason (waiting on parts, customer issue, etc.) — <strong>keep ${tag} held</strong> so we know where the keys are.</li>
            </ul>`
          : `<ul style="margin:6px 0;padding-left:18px;color:#ddd;">
              <li>The RO is in a state we don't recognize — Chris should probably look at it.</li>
              <li>If you know what state it's in, you can release ${tag} or keep it as appropriate.</li>
            </ul>`;
      return `Our nightly key-tag check found ${tag} on ${ro} in our records, but ${symptom}
        <p style="margin:10px 0;">What that could mean:</p>
        ${meaning}
        <p style="margin:10px 0 0 0;">Until you choose, <strong>${tag} stays held</strong> in our system (no one else can grab it).</p>`;
    }

    case "work_approved_drift": {
      const priorAt = (context.prior_action_at as string | null) ?? "earlier";
      const priorAction = (context.prior_action as string | null) ?? "had a tag";
      return `An advisor just approved work on ${ro}, which normally means it moved into the shop and our system would put a fresh key tag on it.
        <p style="margin:10px 0;">But ${ro} <strong>already has key-tag history</strong> — our records show it ${escapeHtml(priorAction)} at ${escapeHtml(priorAt)}. To avoid putting a different tag on keys that may already have a tag on them, the system <strong>did not</strong> auto-assign anything.
        </p>
        <p style="margin:10px 0;">What that could mean:</p>
        <ul style="margin:6px 0;padding-left:18px;color:#ddd;">
          <li>The keys came back in and got a new RO — they probably already have a tag on them physically. Tell us which color + number is on them so we can record it.</li>
          <li>The previous tag was released by mistake — same answer: tell us which tag is on the keys.</li>
          <li>The keys are <strong>not</strong> in the shop (estimate without a vehicle, etc.) — pick "no tag needed."</li>
        </ul>
        <p style="margin:10px 0 0 0;">Until you choose, ${ro} stays untagged in our system.</p>`;
    }

    case "ar_regression": {
      return `${ro} just moved from A/R back to Work-in-Progress (un-posted), which usually means the customer didn't actually pay or there was a billing correction.
        <p style="margin:10px 0;">Normally we'd flip its key tag back to active automatically. But ${ro}'s tag was already <strong>released</strong> in our system (someone freed it earlier), so we don't know what's on the keys right now.</p>
        <p style="margin:10px 0;">Tell us what's actually on the physical keys for ${ro}:</p>`;
    }

    case "ar_no_prior_tag": {
      return `Our nightly key-tag check found ${ro} sitting in A/R, but our system has <strong>no key tag tracked</strong> for it.
        <p style="margin:10px 0;">That's unusual — normally a tag would have been put on during WIP. Two possibilities:</p>
        <ul style="margin:6px 0;padding-left:18px;color:#ddd;">
          <li>The keys <strong>do</strong> have a physical tag on them and our records just missed it. Tell us the color + number so we can record it (we won't write to Tekmetric since A/R repair orders are locked — the record stays in our system only).</li>
          <li>The keys <strong>don't</strong> have a tag (left the shop without one, vendor pickup, etc.). Pick "no tag needed."</li>
        </ul>
        <p style="margin:10px 0 0 0;">Either way, the system will follow the keys until the RO is paid.</p>`;
    }

    case "tekmetric_patch_fail": {
      const patchError = (context.patch_error as string | null) ?? "unknown error";
      return `We assigned ${tag} to ${ro} in our system, but when we tried to write that into Tekmetric's "Key Tag" field, Tekmetric refused with:
        <p style="margin:10px 0;padding:8px 12px;background:#1f1f1f;border-left:3px solid #f0a8a8;font-family:monospace;font-size:12px;color:#f0a8a8;">${escapeHtml(patchError)}</p>
        <p style="margin:10px 0;">Right now, our system thinks the keys are tagged but Tekmetric doesn't show it. The advisor at the counter won't see ${tag} on the RO in Tekmetric.</p>`;
    }
  }
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
