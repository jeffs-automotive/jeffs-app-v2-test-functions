import { test, expect } from "@playwright/test";
import { resolveServiceRoleKey, resolveSupabaseUrl } from "../src/lib/supabase/resolve-keys";

/**
 * Authed render smoke (Phase G). With a seeded @jeffsautomotive.com session
 * (auth.setup.ts mints it via admin.generateLink), a protected page must render
 * — proving requireAdmin()'s getUser() + domain check PASS end-to-end, the
 * complement of the auth-gate spec. /dashboard is chosen because it's
 * requireAdmin() + static cards (no orchestrator call → no real Tekmetric/keytag
 * data touched). READ-ONLY.
 */
test("authenticated /dashboard renders the admin shell (not redirected to /login)", async ({
  page,
}) => {
  test.skip(
    !(resolveSupabaseUrl() && resolveServiceRoleKey()),
    "no test Supabase creds — run `npx vercel env pull .env.local` in admin-app to run the authed E2E",
  );

  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText("Admin dashboard")).toBeVisible();
  await expect(page.getByText(/Signed in as/i)).toBeVisible();
});
