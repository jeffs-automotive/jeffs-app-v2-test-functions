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

setup("authenticate — seed @supabase/ssr session (admin generateLink)", async () => {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    // No test Supabase creds (run `npx vercel env pull .env.local`). Empty state
    // → the authed specs detect the missing creds and skip.
    writeState([]);
    return;
  }

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
  if (verifyErr) {
    throw new Error(`verifyOtp (magiclink) failed for ${EMAIL}: ${verifyErr.message}.`);
  }
  if (captured.length === 0) {
    throw new Error(
      "verifyOtp succeeded but @supabase/ssr wrote no auth cookies — serializer/version change?",
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
