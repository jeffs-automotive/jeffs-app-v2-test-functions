import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  resolveServiceRoleKey,
  resolvePublishableKey,
  resolveSupabaseUrl,
} from "../src/lib/supabase/resolve-keys";

/**
 * Seeds a real @supabase/ssr session into Playwright storageState so the authed
 * specs run as a genuine @jeffsautomotive.com admin. requireAdmin() uses
 * getUser() (validates the JWT against GoTrue), so the session must be REAL.
 *
 * The admin-app authenticates via Microsoft Entra OAuth — the test user has NO
 * Supabase password — so we mint a session WITHOUT one:
 *   admin.generateLink (service-role) → hashed_token
 *   → verifyOtp on a cookie-capturing @supabase/ssr client, which serializes the
 *     exact sb-<ref>-auth-token cookie via its OWN setAll (never hand-crafted).
 * No password is read or stored anywhere.
 *
 * Creds come from admin-app/.env.local (loaded by playwright.config's
 * loadEnvConfig): Supabase URL + anon/publishable key + the SERVICE_ROLE key —
 * resolved with the SAME helpers the app uses (resolve-keys). Run
 * `npx vercel env pull .env.local` first. With creds absent this writes an EMPTY
 * state so the authed project still loads; the authed specs skip themselves.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, ".auth", "state.json");

const EMAIL = process.env.E2E_TEST_USER_EMAIL ?? "service@jeffsautomotive.com";
const SUPABASE_URL = resolveSupabaseUrl() ?? "";
const ANON_KEY = resolvePublishableKey() ?? "";
const SERVICE_ROLE = resolveServiceRoleKey() ?? "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

function writeState(cookies: Array<Record<string, unknown>>): void {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2) + "\n");
}

/**
 * One generateLink → verifyOtp attempt. Returns the @supabase/ssr-serialized
 * auth cookies, or throws with a diagnostic message. Kept separate so the
 * caller can retry it (see below).
 */
async function seedSessionCookies(): Promise<Array<{ name: string; value: string }>> {
  // 1) Admin (service-role): mint a magic-link token for the existing
  //    (Microsoft-OAuth) user — no password required.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr) {
    throw new Error(
      `admin.generateLink failed for ${EMAIL}: ${linkErr.message}. Confirm the user exists in the ` +
        `test project (it's created on first Microsoft sign-in) and the SERVICE_ROLE key in ` +
        `.env.local is for that project.`,
    );
  }
  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error("admin.generateLink returned no hashed_token.");

  // 2) Verify the token on a cookie-capturing @supabase/ssr client → a real
  //    session is established + persisted via setAll (the exact server cookie).
  //    NB: verifyOtp must run on the @supabase/ssr client (not a plain
  //    supabase-js client) so ITS serializer writes the exact sb-<ref>-auth-token
  //    cookie — never hand-craft it.
  const captured: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (toSet) => {
        for (const c of toSet) captured.push({ name: c.name, value: c.value });
      },
    },
  });
  const { error: verifyErr } = await ssr.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyErr) throw new Error(`verifyOtp (magiclink) failed: ${verifyErr.message}`);
  if (captured.length === 0) {
    throw new Error(
      "verifyOtp succeeded but @supabase/ssr wrote no auth cookies — serializer/version change?",
    );
  }
  return captured;
}

setup("authenticate — seed @supabase/ssr session (admin generateLink)", async () => {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    // No test Supabase creds (run `npx vercel env pull .env.local`). Empty state
    // → the authed specs detect the missing creds and skip.
    writeState([]);
    return;
  }

  // generateLink→verifyOtp can fail transiently on the freshly-minted token
  // ("Email link is invalid or has expired") even when token/type/key are all
  // correct — observed once, then passed on retry with no code change. Retry a
  // few times with a short backoff so the seed (and CI) stays stable; each
  // attempt mints a brand-new token.
  const MAX_ATTEMPTS = 3;
  let captured: Array<{ name: string; value: string }> | null = null;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      captured = await seedSessionCookies();
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  if (!captured) {
    throw new Error(
      `Failed to seed a @supabase/ssr session for ${EMAIL} after ${MAX_ATTEMPTS} attempts. ` +
        `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  const host = new URL(BASE_URL).hostname;
  const secure = BASE_URL.startsWith("https://");
  const expires = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

  writeState(
    captured.map((c) => ({
      name: c.name,
      value: c.value,
      domain: host,
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "Lax" as const,
      expires,
    })),
  );
});
