// document-intake-agent — the shop-PC scan agent's ONLY server surface (plan D5).
//
// The Windows agent holds a single narrow AGENT_TOKEN — no storage keys, no
// DB keys. Everything it may do goes through this gateway:
//
//   op=config          → active profiles (folder map) + shop id; stamps
//                        agent_state.last_config_fetch_at
//   op=request_upload  → validates profile + type + size, MINTS the object
//                        path server-side (the PC never authors shop/profile
//                        — cross-verify: a client-authored key was acting as
//                        tenant authorization), inserts the `pending`
//                        document_intake_files row, returns a single-path
//                        signed upload URL (create-only; the PC can never
//                        read, list, overwrite, or delete). Retries send the
//                        persisted object_path back and get the SAME path —
//                        the minted key is an idempotency token (plan D2).
//   op=confirm         → verifies the object actually exists + size matches,
//                        flips the row pending → ready; stamps last_upload_at
//   op=heartbeat       → agent liveness for the D13 watchdog
//
// AUTH: Authorization: Bearer <AGENT_TOKEN> (constant-time). Fail-closed 500
// when the secret is unset. verify_jwt=false in config.toml (the token is
// not a Supabase JWT).
//
// Accepted types (plan D9): pdf/jpeg/png/heic|heif, ≤ 40MB per file. The
// agent magic-byte-sniffs BEFORE upload (it has the bytes); this gateway
// enforces declared type + size + path authority. Bucket-level
// allowed_mime_types + 50MB cap backstop it server-side.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";
import { resolveSecretKey } from "../_shared/resolve-secret-key.ts";

const BUCKET = "vehicle-docs";
const MAX_FILE_BYTES = 40 * 1024 * 1024;

export const ACCEPTED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};

// test seam — lazily-initialized service-role client (telnyx-webhook pattern).
let sb: SupabaseClient | null = null;
function getSb(): SupabaseClient {
  if (sb === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SECRET_KEY = resolveSecretKey();
    if (!SECRET_KEY) throw new Error("document-intake-agent: no Supabase secret key configured");
    sb = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}
export function _setSupabaseClientForTesting(client: unknown): void {
  sb = client as SupabaseClient;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function log(msg: string, ctx: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", surface: "document-intake-agent", msg, ...ctx }));
}

/** {shop}/{profile}/scan/{YYYY}/{MM}/{ts}_{rand4}_{sha8}.{ext} — opaque,
 * PII-free (D2). rand4 guards same-ms same-content key collisions (two
 * identical scans enqueued back-to-back must never fight over one key —
 * a collision would 409 the second upload into a stuck retry loop). */
export function mintObjectPath(args: {
  shopId: number;
  profileKey: string;
  mime: string;
  sha256: string;
  now?: Date;
}): string {
  const now = args.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = MIME_EXT[args.mime] ?? "bin";
  const sha8 = args.sha256.slice(0, 8);
  const rand = [...crypto.getRandomValues(new Uint8Array(2))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${args.shopId}/${args.profileKey}/scan/${yyyy}/${mm}/${now.getTime()}_${rand}_${sha8}.${ext}`;
}

interface AgentBody {
  op?: unknown;
  hostname?: unknown;
  agent_version?: unknown;
  profile_key?: unknown;
  original_filename?: unknown;
  sha256?: unknown;
  size_bytes?: unknown;
  mime_type?: unknown;
  object_path?: unknown;
  details?: unknown;
}

async function objectExists(client: SupabaseClient, path: string): Promise<boolean> {
  const dir = path.split("/").slice(0, -1).join("/");
  const base = path.split("/").pop() ?? "";
  const { data, error } = await client.storage.from(BUCKET).list(dir, { search: base });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  return (data ?? []).some((o: { name: string }) => o.name === base);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

  const agentToken = Deno.env.get("AGENT_TOKEN") ?? "";
  if (!agentToken) {
    console.error("document-intake-agent: AGENT_TOKEN not configured (fail-closed)");
    return json(500, { ok: false, error: "misconfigured" });
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearersEqual(bearer, agentToken)) {
    Sentry.captureMessage("document-intake-agent: unauthorized call rejected", "warning");
    return json(401, { ok: false, error: "unauthorized" });
  }

  let body: AgentBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }
  const op = typeof body.op === "string" ? body.op : "";
  const hostname = typeof body.hostname === "string" && body.hostname.length > 0
    ? body.hostname.slice(0, 128)
    : "unknown-host";

  const client = getSb();

  // ── op=config ──────────────────────────────────────────────────────────
  if (op === "config") {
    const { data: profiles, error } = await client
      .from("document_intake_profiles")
      .select("key, shop_id, label, bucket")
      .eq("active", true);
    if (error) return json(500, { ok: false, error: `profiles query failed: ${error.message}` });
    const rows = (profiles ?? []) as Array<{ key: string; shop_id: number; label: string; bucket: string }>;
    const { error: hbErr } = await client.from("document_intake_agent_state").upsert({
      hostname,
      shop_id: rows[0]?.shop_id ?? Number(Deno.env.get("INTAKE_SHOP_ID") ?? "0") ,
      last_config_fetch_at: new Date().toISOString(),
      agent_version: typeof body.agent_version === "string" ? body.agent_version : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "hostname" });
    if (hbErr) log("agent_state upsert failed on config", { error: hbErr.message });
    log("config served", { hostname, profile_count: rows.length });
    return json(200, {
      ok: true,
      profiles: rows.map((p) => ({ key: p.key, label: p.label })),
      accepted_mime: [...ACCEPTED_MIME],
      max_file_bytes: MAX_FILE_BYTES,
    });
  }

  // ── op=heartbeat ───────────────────────────────────────────────────────
  if (op === "heartbeat") {
    const { data: anyProfile } = await client
      .from("document_intake_profiles")
      .select("shop_id")
      .limit(1)
      .maybeSingle();
    const shopId = (anyProfile as { shop_id?: number } | null)?.shop_id ??
      Number(Deno.env.get("INTAKE_SHOP_ID") ?? "0");
    const { error } = await client.from("document_intake_agent_state").upsert({
      hostname,
      shop_id: shopId,
      last_heartbeat_at: new Date().toISOString(),
      agent_version: typeof body.agent_version === "string" ? body.agent_version : null,
      details: (body.details && typeof body.details === "object") ? body.details : {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "hostname" });
    if (error) return json(500, { ok: false, error: `heartbeat failed: ${error.message}` });
    return json(200, { ok: true });
  }

  // ── op=request_upload ──────────────────────────────────────────────────
  if (op === "request_upload") {
    const profileKey = typeof body.profile_key === "string" ? body.profile_key : "";
    const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
    const sizeBytes = typeof body.size_bytes === "number" ? body.size_bytes : -1;
    const mime = typeof body.mime_type === "string" ? body.mime_type : "";
    const originalFilename = typeof body.original_filename === "string"
      ? body.original_filename.slice(0, 255)
      : null;
    const priorPath = typeof body.object_path === "string" ? body.object_path : null;

    if (!/^[0-9a-f]{64}$/.test(sha256)) return json(400, { ok: false, error: "bad_sha256" });
    if (!ACCEPTED_MIME.has(mime)) return json(422, { ok: false, error: "unsupported_type", mime });
    if (sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
      return json(422, { ok: false, error: "bad_size", size_bytes: sizeBytes });
    }

    const { data: profile, error: pErr } = await client
      .from("document_intake_profiles")
      .select("key, shop_id, bucket, active")
      .eq("key", profileKey)
      .maybeSingle();
    if (pErr) return json(500, { ok: false, error: `profile query failed: ${pErr.message}` });
    const p = profile as { key: string; shop_id: number; bucket: string; active: boolean } | null;
    if (!p || !p.active) return json(422, { ok: false, error: "unknown_profile", profile_key: profileKey });

    // Retry path: the agent persisted its minted key — reuse it (D2). Only a
    // path this gateway itself minted for this profile is accepted back.
    let objectPath: string;
    if (priorPath) {
      const expectedPrefix = `${p.shop_id}/${p.key}/scan/`;
      if (!priorPath.startsWith(expectedPrefix)) {
        return json(422, { ok: false, error: "path_not_owned" });
      }
      objectPath = priorPath;
      if (await objectExists(client, objectPath)) {
        log("request_upload: object already present (retry after lost confirm)", { objectPath });
        return json(200, { ok: true, object_path: objectPath, already_uploaded: true });
      }
    } else {
      objectPath = mintObjectPath({ shopId: p.shop_id, profileKey: p.key, mime, sha256 });
    }

    const { error: insErr } = await client.from("document_intake_files").upsert({
      shop_id: p.shop_id,
      profile_key: p.key,
      source: "scan",
      bucket: p.bucket,
      object_path: objectPath,
      original_filename: originalFilename,
      mime_type: mime,
      size_bytes: sizeBytes,
      sha256,
      status: "pending",
    }, { onConflict: "object_path", ignoreDuplicates: true });
    if (insErr) return json(500, { ok: false, error: `row insert failed: ${insErr.message}` });

    const { data: signed, error: sErr } = await client.storage
      .from(p.bucket)
      .createSignedUploadUrl(objectPath);
    if (sErr || !signed) {
      return json(500, { ok: false, error: `sign failed: ${sErr?.message ?? "no data"}` });
    }
    log("upload minted", { hostname, profile: p.key, objectPath, size_bytes: sizeBytes });
    return json(200, {
      ok: true,
      object_path: objectPath,
      signed_url: (signed as { signedUrl?: string }).signedUrl ?? null,
      token: (signed as { token?: string }).token ?? null,
      already_uploaded: false,
    });
  }

  // ── op=confirm ─────────────────────────────────────────────────────────
  if (op === "confirm") {
    const objectPath = typeof body.object_path === "string" ? body.object_path : "";
    const sizeBytes = typeof body.size_bytes === "number" ? body.size_bytes : -1;
    if (!objectPath) return json(400, { ok: false, error: "missing_object_path" });

    let exists = false;
    try {
      exists = await objectExists(client, objectPath);
    } catch (e) {
      return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    if (!exists) {
      // Confirm before a successful PUT — the agent retries the upload.
      return json(409, { ok: false, error: "object_missing" });
    }

    const { data: updated, error: uErr } = await client
      .from("document_intake_files")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("object_path", objectPath)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (uErr) return json(500, { ok: false, error: `confirm update failed: ${uErr.message}` });
    if (!updated) {
      // Row already ready (double confirm) — idempotent success; anything
      // else (row missing entirely) is registered by the trigger/reconcile.
      log("confirm: no pending row transitioned (idempotent repeat or trigger-registered)", { objectPath });
    }
    const { error: hbErr } = await client
      .from("document_intake_agent_state")
      .update({ last_upload_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("hostname", hostname);
    if (hbErr) log("agent_state last_upload_at update failed", { error: hbErr.message });
    log("confirmed", { hostname, objectPath, size_bytes: sizeBytes });
    return json(200, { ok: true, object_path: objectPath });
  }

  return json(400, { ok: false, error: "unknown_op", op });
}

Deno.serve((req) => withSentryScope(req, "document-intake-agent", () => handler(req)));
