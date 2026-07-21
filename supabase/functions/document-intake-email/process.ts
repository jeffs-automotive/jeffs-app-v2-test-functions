// document-intake-email — event/attachment processing (plan D8/D9).
//
// One graph_mail_events row per message drives a small state machine:
//   pending -> processing -> completed | retryable(attempts++, backoff) | failed
// Per-attachment child rows make partial success retryable exactly-once:
// an already-`uploaded` attachment is never re-fetched; a `skipped` one is
// never retried; only pending/failed attachments are (re)attempted.
//
// Validation (D9): magic bytes decide the real type — the sender-declared
// contentType/extension is untrusted. Inline images + non-file attachments
// are skipped with a reason. Oversize (>40MB) skipped. The minted object
// path is PERSISTED on the attachment row BEFORE upload so retries reuse
// the same key (idempotency token, D2); upload upsert:false + "already
// exists" counts as success.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Sentry } from "../_shared/sentry-edge.ts";
import type { GraphAttachmentMeta, GraphClient } from "./graph.ts";

export const BUCKET = "vehicle-docs";
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_ATTEMPTS = 8;

export interface EventRow {
  id: string;
  mailbox: string;
  graph_message_id: string;
  status: string;
  attempts: number;
}

function log(msg: string, ctx: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", surface: "document-intake-email", msg, ...ctx }));
}

/** Magic-byte sniffing (D9) — returns a canonical mime or null when unrecognized. */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf"; // %PDF
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // ISO-BMFF: size(4) + "ftyp" + brand(4). heic/heix/hevc/mif1/msf1/heif → HEIC family.
  if (bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = new TextDecoder().decode(bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "mif1", "msf1", "heif"].includes(brand)) return "image/heic";
  }
  return null;
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

/** 4 random hex chars — collision guard for same-ms, same-content mints
 * (two identical attachments in one message minted in one event loop turn
 * produced identical keys — caught by the test suite's own output). Retries
 * reuse the PERSISTED path, so randomness never breaks idempotency. */
export function rand4(): string {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function mintEmailObjectPath(args: {
  shopId: number;
  profileKey: string | null;
  mime: string;
  sha256: string;
  now?: Date;
}): string {
  const now = args.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const seg = args.profileKey ?? "unrouted";
  return `${args.shopId}/${seg}/email/${yyyy}/${mm}/${now.getTime()}_${rand4()}_${args.sha256.slice(0, 8)}.${MIME_EXT[args.mime] ?? "bin"}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveRoute(
  sb: SupabaseClient,
  mailbox: string,
): Promise<{ profileKey: string | null; shopId: number }> {
  const { data: mbRow, error } = await sb
    .from("document_intake_mailboxes")
    .select("profile_key, document_intake_profiles(shop_id, active)")
    .eq("address", mailbox.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`mailbox route query failed: ${error.message}`);
  const row = mbRow as
    | { profile_key: string; document_intake_profiles: { shop_id: number; active: boolean } | null }
    | null;
  if (row && row.document_intake_profiles?.active) {
    return { profileKey: row.profile_key, shopId: row.document_intake_profiles.shop_id };
  }
  // Unrouted: keep the doc (plan D7). Shop from config, falling back to any profile row.
  const envShop = Number(Deno.env.get("INTAKE_SHOP_ID") ?? "0");
  if (envShop > 0) return { profileKey: null, shopId: envShop };
  const { data: anyProfile } = await sb
    .from("document_intake_profiles")
    .select("shop_id")
    .limit(1)
    .maybeSingle();
  const shopId = (anyProfile as { shop_id?: number } | null)?.shop_id ?? 0;
  if (shopId <= 0) throw new Error("cannot resolve shop_id for unrouted mail (no profiles, no INTAKE_SHOP_ID)");
  return { profileKey: null, shopId };
}

function classifyAttachment(att: GraphAttachmentMeta): string | null {
  if (att.odataType && att.odataType !== "#microsoft.graph.fileAttachment") {
    return "not_a_file_attachment";
  }
  if (att.isInline) return "inline_image"; // signature logos etc. (D9)
  if (att.size > MAX_FILE_BYTES) return "oversize";
  return null;
}

/**
 * Process ONE event row end-to-end. Returns the terminal status written.
 * Never throws — failures land on the row (retryable/failed) + Sentry.
 */
export async function processEvent(
  sb: SupabaseClient,
  graph: GraphClient,
  event: EventRow,
): Promise<string> {
  // Atomic claim: only one runner may move pending/retryable -> processing
  // (webhook waitUntil vs cron drain — cross-verify concurrency finding).
  const { data: claimed, error: claimErr } = await sb
    .from("graph_mail_events")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", event.id)
    .in("status", ["pending", "retryable"])
    .select("id")
    .maybeSingle();
  if (claimErr) {
    Sentry.captureException(new Error(`event claim failed: ${claimErr.message}`), {
      tags: { module: "document-intake" },
    });
    return "unclaimed";
  }
  if (!claimed) return "unclaimed"; // someone else has it — not an error

  try {
    const meta = await graph.getMessageMeta(event.mailbox, event.graph_message_id);
    const route = await resolveRoute(sb, event.mailbox);

    await sb.from("graph_mail_events").update({
      internet_message_id: meta.internetMessageId,
      from_address: meta.from,
      subject: meta.subject,
      received_datetime: meta.receivedDateTime,
      updated_at: new Date().toISOString(),
    }).eq("id", event.id);

    const attachments = meta.hasAttachments
      ? await graph.listAttachments(event.mailbox, event.graph_message_id)
      : [];

    // Ensure a child row per attachment (idempotent on (event_id, attachment_id)).
    for (const att of attachments) {
      const { error } = await sb.from("graph_mail_attachments").upsert({
        event_id: event.id,
        graph_attachment_id: att.id,
        filename: att.name,
        mime_type: att.contentType,
        size_bytes: att.size,
        is_inline: att.isInline,
      }, { onConflict: "event_id,graph_attachment_id", ignoreDuplicates: true });
      if (error) throw new Error(`attachment row upsert failed: ${error.message}`);
    }

    const { data: attRowsRaw, error: attErr } = await sb
      .from("graph_mail_attachments")
      .select("id, graph_attachment_id, status, object_path")
      .eq("event_id", event.id);
    if (attErr) throw new Error(`attachment rows query failed: ${attErr.message}`);
    const attRows = (attRowsRaw ?? []) as Array<{
      id: string;
      graph_attachment_id: string;
      status: string;
      object_path: string | null;
    }>;
    const byId = new Map(attachments.map((a) => [a.id, a]));

    let transientFailure = false;

    for (const row of attRows) {
      if (row.status === "uploaded" || row.status === "skipped") continue; // exactly-once
      const att = byId.get(row.graph_attachment_id);
      if (!att) continue; // no longer listed (message mutated) — leave pending for sweep

      const skipReason = classifyAttachment(att);
      if (skipReason) {
        await sb.from("graph_mail_attachments").update({
          status: "skipped",
          skip_reason: skipReason,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        log("attachment skipped", { event_id: event.id, reason: skipReason });
        continue;
      }

      try {
        const bytes = await graph.getAttachmentBytes(event.mailbox, event.graph_message_id, att.id);
        const sniffed = sniffMime(bytes);
        if (!sniffed) {
          await sb.from("graph_mail_attachments").update({
            status: "skipped",
            skip_reason: "unrecognized_magic_bytes",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          Sentry.captureMessage("document-intake: attachment failed magic-byte validation", "warning");
          continue;
        }
        if (bytes.length > MAX_FILE_BYTES) {
          await sb.from("graph_mail_attachments").update({
            status: "skipped", skip_reason: "oversize_actual",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          continue;
        }

        const sha256 = await sha256Hex(bytes);
        // Reuse a previously-minted path (retry) or mint + persist BEFORE upload.
        let objectPath = row.object_path;
        if (!objectPath) {
          objectPath = mintEmailObjectPath({
            shopId: route.shopId,
            profileKey: route.profileKey,
            mime: sniffed,
            sha256,
          });
          const { error } = await sb.from("graph_mail_attachments")
            .update({ object_path: objectPath, updated_at: new Date().toISOString() })
            .eq("id", row.id);
          if (error) throw new Error(`persist minted path failed: ${error.message}`);
        }

        const { error: upErr } = await sb.storage.from(BUCKET).upload(objectPath, bytes, {
          contentType: sniffed,
          upsert: false,
        });
        const alreadyExists = upErr && /exists|duplicate/i.test(upErr.message ?? "");
        if (upErr && !alreadyExists) throw new Error(`storage upload failed: ${upErr.message}`);

        // Explicit rich registration (trigger's bare row converges via ON CONFLICT).
        const { error: fileErr } = await sb.from("document_intake_files").upsert({
          shop_id: route.shopId,
          profile_key: route.profileKey,
          source: "email",
          bucket: BUCKET,
          object_path: objectPath,
          original_filename: att.name,
          mime_type: sniffed,
          size_bytes: bytes.length,
          sha256,
          email_from: meta.from,
          email_subject: meta.subject,
          graph_message_id: event.graph_message_id,
          graph_attachment_id: att.id,
          status: "ready",
        }, { onConflict: "object_path", ignoreDuplicates: false });
        if (fileErr) throw new Error(`files upsert failed: ${fileErr.message}`);

        await sb.from("graph_mail_attachments").update({
          status: "uploaded", updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        log("attachment uploaded", { event_id: event.id, objectPath, size: bytes.length });
      } catch (attFailure) {
        transientFailure = true;
        const msg = attFailure instanceof Error ? attFailure.message : String(attFailure);
        await sb.from("graph_mail_attachments").update({
          status: "failed", last_error: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        // Reset to pending on the next drain via the event-level retry below.
        Sentry.captureException(attFailure, { tags: { module: "document-intake" } });
      }
    }

    if (transientFailure) {
      const attempts = event.attempts + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      const backoffMin = Math.min(5 * 2 ** attempts, 360);
      await sb.from("graph_mail_events").update({
        status: terminal ? "failed" : "retryable",
        attempts,
        next_retry_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
        last_error: "one or more attachments failed",
        updated_at: new Date().toISOString(),
      }).eq("id", event.id);
      // Failed attachments become retryable again with the event.
      await sb.from("graph_mail_attachments").update({
        status: "pending", updated_at: new Date().toISOString(),
      }).eq("event_id", event.id).eq("status", "failed");
      if (terminal) {
        Sentry.captureMessage(
          `document-intake: event exhausted retries (mailbox=${event.mailbox})`,
          "error",
        );
      }
      return terminal ? "failed" : "retryable";
    }

    await sb.from("graph_mail_events").update({
      status: "completed", updated_at: new Date().toISOString(),
    }).eq("id", event.id);
    return "completed";
  } catch (e) {
    // Whole-event failure (Graph meta fetch, routing, DB): schedule retry.
    const attempts = event.attempts + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const backoffMin = Math.min(5 * 2 ** attempts, 360);
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("graph_mail_events").update({
      status: terminal ? "failed" : "retryable",
      attempts,
      next_retry_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
      last_error: msg.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", event.id);
    Sentry.captureException(e, { tags: { module: "document-intake" } });
    return terminal ? "failed" : "retryable";
  }
}
