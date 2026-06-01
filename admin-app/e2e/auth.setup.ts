import { test as setup } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Seeds a real @supabase/ssr session into Playwright storageState so the
 * authed specs run as a genuine @jeffsautomotive.com admin (requireAdmin uses
 * getUser(), which validates the JWT against GoTrue — so the session must be
 * real, not faked).
 *
 * The cookie is serialized by @supabase/ssr's OWN setAll (same version the
 * admin-app server reads with) — never hand-crafted — so the
 * `sb-<ref>-auth-token` chunking/format is exact.
 *
 * Creds come from env (admin-app/.env.local via playwright.config's loadEnvConfig
 * for the Supabase URL/anon key; E2E_TEST_USER_PASSWORD passed at runtime — it is
 * NEVER committed). With no creds this writes an EMPTY state so the authed
 * project can still load it; the authed specs `test.skip` themselves.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, ".auth", "state.json");

const EMAIL = process.env.E2E_TEST_USER_EMAIL ?? "service@jeffsautomotive.com";
const PASSWORD = process.env.E2E_TEST_USER_PASSWORD ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

function writeState(cookies: Array<Record<string, unknown>>): void {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2) + "\n");
}

setup("authenticate — seed @supabase/ssr session", async () => {
  if (!PASSWORD || !SUPABASE_URL || !ANON_KEY) {
    // Skip-by-empty-state: authed specs detect the missing password and skip.
    writeState([]);
    return;
  }

  const host = new URL(BASE_URL).hostname;
  const secure = BASE_URL.startsWith("https://");
  const expires = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

  const captured: Array<{ name: string; value: string }> = [];
  const supabase = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (toSet) => {
        for (const c of toSet) captured.push({ name: c.name, value: c.value });
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) {
    throw new Error(
      `E2E sign-in failed for ${EMAIL}: ${error.message}. If this account is Microsoft-OAuth-only ` +
        `it has no Supabase password — set one for the test user (Supabase Auth → Users) or switch ` +
        `this fixture to admin.generateLink + a service-role key.`,
    );
  }
  if (captured.length === 0) {
    throw new Error(
      "Sign-in succeeded but @supabase/ssr wrote no auth cookies — its serializer/version may have changed.",
    );
  }

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
