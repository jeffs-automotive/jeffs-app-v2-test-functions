// back-office-email — pure HTML builders for the back-office module's transition alerts.
//
// One email per status transition, sent by the back-office-notify edge fn. Hand-built
// inline-styled HTML (the repo has no template engine), burgundy/gold dark theme matching
// keytag-daily-report + the manual-review emails, with a deep-link CTA into the app.
//
// Pure + side-effect-free: takes the issue row + resolved links, returns { subject, html }.
// No I/O — the caller owns recipients + the Resend send.

const BRAND_PRIMARY = "#96003C"; // burgundy
const BRAND_ACCENT = "#D2B487"; // gold
const BG = "#1a1416";
const CARD = "#241c1f";
const TEXT = "#f2e9e4";
const MUTED = "#b8a9a2";
const RULE = "#3a2e30";

export type BackOfficeEvent =
  | "detected"
  | "ro_closed"
  | "sent_to_sa"
  | "resent_to_sa"
  | "sa_submitted"
  | "verified";

export interface BackOfficeIssueSummary {
  id: string;
  kind: "invoice_issue" | "open_ro" | "reopened_ro" | "misc";
  status: string;
  title: string | null;
  ro_number: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  bill_date: string | null;
  total_cents: number | null;
  qbo_txn_type: string | null;
  bo_notes: string | null;
  sa_notes: string | null;
  context: Record<string, unknown> | null;
}

export interface BackOfficeLinks {
  /** qteklink-app back-office tab for this kind (office manager). */
  office: string | null;
  /** admin-app back-office queue (service advisors). */
  advisor: string | null;
}

const KIND_LABEL: Record<BackOfficeIssueSummary["kind"], string> = {
  invoice_issue: "Invoice issue",
  open_ro: "Invoice on an open RO",
  reopened_ro: "Reopened repair order",
  misc: "Misc issue",
};

const CHANGE_TYPE_LABEL: Record<string, string> = {
  unposted: "Unposted (not yet reposted)",
  reposted: "Reposted (no change to date or total)",
  date_changed: "Reposted to a different date",
  total_changed: "Reposted with a different total",
  date_and_total_changed: "Reposted to a different date AND with a different total",
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** The recipient side + verb of each event (drives the heading + which link to show). */
function eventCopy(event: BackOfficeEvent): { heading: string; audience: "office" | "advisor" | "both" } {
  switch (event) {
    case "detected":
      return { heading: "A reopened repair order needs review", audience: "office" };
    case "ro_closed":
      return { heading: "A tracked RO has closed — please verify the entries", audience: "office" };
    case "sent_to_sa":
      return { heading: "A back-office issue was sent to you", audience: "advisor" };
    case "resent_to_sa":
      return { heading: "A back-office issue was re-sent to you", audience: "advisor" };
    case "sa_submitted":
      return { heading: "A service advisor submitted a fix to verify", audience: "office" };
    case "verified":
      return { heading: "A back-office issue was verified and closed", audience: "both" };
  }
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${esc(label)}</td>
    <td style="padding:6px 0;color:${TEXT};font-size:13px;vertical-align:top;">${value}</td>
  </tr>`;
}

function detailRows(issue: BackOfficeIssueSummary): string {
  const ctx = issue.context ?? {};
  const rows: string[] = [];
  rows.push(row("Type", esc(KIND_LABEL[issue.kind])));
  if (issue.title) rows.push(row("Title", esc(issue.title)));
  if (issue.ro_number) rows.push(row("RO #", esc(issue.ro_number)));
  if (issue.vendor_name) rows.push(row("Vendor", esc(issue.vendor_name)));
  if (issue.bill_no) {
    const t = issue.qbo_txn_type === "Purchase" ? "Expense #" : "Bill #";
    rows.push(row(t, esc(issue.bill_no)));
  }
  if (issue.bill_date) rows.push(row("Bill date", esc(issue.bill_date)));
  if (issue.total_cents !== null) rows.push(row("Amount", esc(money(issue.total_cents))));

  if (issue.kind === "reopened_ro") {
    const ct = String(ctx["change_type"] ?? "");
    if (ct) rows.push(row("What changed", esc(CHANGE_TYPE_LABEL[ct] ?? ct)));
    const od = ctx["original_posted_date"];
    const nd = ctx["new_posted_date"];
    if (od || nd) rows.push(row("Posted date", `${esc(od ?? "—")} &rarr; <strong>${esc(nd ?? "—")}</strong>`));
    const ot = ctx["original_total_cents"];
    const nt = ctx["new_total_cents"];
    if (ot !== undefined || nt !== undefined) {
      rows.push(row("Total sales", `${esc(money(ot as number))} &rarr; <strong>${esc(money(nt as number))}</strong>`));
    }
    if (ctx["unposted_by"]) rows.push(row("Unposted by", esc(ctx["unposted_by"])));
  }

  if (issue.bo_notes) rows.push(row("Back-office note", esc(issue.bo_notes)));
  if (issue.sa_notes) rows.push(row("Service-advisor fix", esc(issue.sa_notes)));
  return rows.join("");
}

function cta(event: BackOfficeEvent, links: BackOfficeLinks): string {
  const { audience } = eventCopy(event);
  const href = audience === "advisor" ? links.advisor : links.office;
  const label = audience === "advisor" ? "Open the fix-it queue" : "Open in QTekLink";
  if (!href) return "";
  return `<div style="margin-top:20px;">
    <a href="${esc(href)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:6px;">${esc(label)}</a>
  </div>`;
}

function subjectFor(event: BackOfficeEvent, issue: BackOfficeIssueSummary): string {
  const ref = issue.ro_number
    ? `RO #${issue.ro_number}`
    : issue.bill_no
      ? `#${issue.bill_no}`
      : issue.title
        ? issue.title
        : KIND_LABEL[issue.kind];
  switch (event) {
    case "detected":
      return `Back Office: reopened ${ref} needs review`;
    case "ro_closed":
      return `Back Office: ${ref} closed — verify entries`;
    case "sent_to_sa":
      return `Back Office: ${ref} needs a service advisor`;
    case "resent_to_sa":
      return `Back Office: ${ref} re-sent — still needs attention`;
    case "sa_submitted":
      return `Back Office: fix submitted for ${ref} — ready to verify`;
    case "verified":
      return `Back Office: ${ref} verified and closed`;
  }
}

export function buildNotifyEmail(
  event: BackOfficeEvent,
  issue: BackOfficeIssueSummary,
  links: BackOfficeLinks,
): { subject: string; html: string } {
  const { heading } = eventCopy(event);
  const subject = subjectFor(event, issue);
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${BG};">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="border-top:3px solid ${BRAND_ACCENT};background:${CARD};border-radius:0 0 8px 8px;padding:24px;">
      <div style="color:${BRAND_ACCENT};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Jeff's Automotive — Back Office</div>
      <h1 style="margin:0 0 18px;color:${TEXT};font-size:19px;line-height:1.35;font-weight:700;">${esc(heading)}</h1>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid ${RULE};padding-top:8px;">
        ${detailRows(issue)}
      </table>
      ${cta(event, links)}
    </div>
    <div style="color:${MUTED};font-size:11px;text-align:center;margin-top:16px;">
      Automated alert from the Back Office module. Do not reply to this email.
    </div>
  </div>
</body></html>`;
  return { subject, html };
}
