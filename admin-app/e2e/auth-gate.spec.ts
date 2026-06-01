import { test, expect } from "@playwright/test";

/**
 * Auth-gate smoke (Phase G). The admin dashboard is Entra-gated; every
 * protected route must bounce an unauthenticated visitor to /login via
 * requireAdmin() (admin-app/src/lib/auth.ts). This is the hermetic E2E that
 * needs NO Microsoft session — it asserts the GATE, not the authed UX.
 *
 * Authenticated read/write flows (with a mocked Supabase session cookie) are a
 * documented follow-up — they need an OAuth-session fixture.
 */
const PROTECTED_ROUTES = ["/", "/dashboard", "/keytags", "/schedulerconfig"];

for (const route of PROTECTED_ROUTES) {
  test(`unauthenticated ${route} redirects to /login`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("/login renders for an unauthenticated visitor (no redirect loop)", async ({
  page,
}) => {
  const res = await page.goto("/login");
  expect(res?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/login/);
});
